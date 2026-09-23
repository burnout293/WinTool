<#
.SYNOPSIS
    Validateur du contrat de script WinTool v2.

.DESCRIPTION
    Vérifie que chaque .ps1 respecte le contrat défini dans docs/SPECIFICATION.md §5.

    Ce script fait autorité. La documentation décrit ce qu'il vérifie, jamais l'inverse :
    c'est exactement la dérive qui a rendu la v3 inexploitable (une convention soigneusement
    documentée, et zéro script sur treize qui la respectait).

    Structure attendue (style B) : tout ce qui s'adresse à un humain vit dans des blocs ##,
    et $CONFIG ne contient que des clés et des valeurs par défaut. Le nom d'une clé apparaît
    donc dans trois endroits — OPTIONS, LANG et $CONFIG — et ce validateur croise les trois
    dans les deux sens. C'est ce croisement qui rend la dérive impossible.

    Deux usages, deux exigences :
      · En intégration continue sur scripts/Default/ — tolérance zéro, code de sortie 1
        à la moindre erreur. Ces scripts-là, on les maîtrise.
      · En local sur un script personnel — informatif. L'application, elle, n'empêche
        jamais un script non conforme de s'exécuter (§5.4 « constater, jamais bloquer »).

.PARAMETER Path
    Dossier à analyser. Par défaut scripts/ à la racine du dépôt.

.PARAMETER Strict
    Traite les avertissements comme des erreurs. À utiliser en CI sur Default/.

.EXAMPLE
    .\tools\lint-scripts.ps1
    .\tools\lint-scripts.ps1 -Path .\scripts\Default -Strict
#>
[CmdletBinding()]
param(
    [string] $Path,
    [switch] $Strict
)

$ErrorActionPreference = 'Stop'

if (-not $Path) { $Path = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts' }

# ==============================================================================
# Référentiel — la seule source de vérité sur les valeurs admises
# ==============================================================================

$CHAMPS_REQUIS = @(
    'id', 'lang', 'title', 'desc', 'category', 'icon', 'version',
    'admin', 'risk', 'duration', 'reversible', 'interruptible', 'reboot', 'engine'
)

$VALEURS_ADMISES = @{
    risk          = @('low', 'medium', 'high')
    duration      = @('fast', 'medium', 'slow')
    engine        = @('auto', 'winps', 'pwsh')
    admin         = @('true', 'false')
    reversible    = @('true', 'false')
    interruptible = @('true', 'false')
    reboot        = @('true', 'false')
}

$MARQUEURS = @('INFO', 'OK', 'WARN', 'ERR', 'STEP', 'CKPT', 'REBOOT', 'DONE')

# Types d'option. 'select' et 'multi' exigent des choix déclarés en sous-lignes.
$TYPES_OPTION     = @('bool', 'number', 'string', 'hidden', 'select', 'multi')
$TYPES_AVEC_CHOIX = @('select', 'multi')

$CATEGORIES_USINE = @(
    'menage', 'performance', 'vieprivee', 'applications', 'sante', 'outillage'
)

# Noms d'icônes Lucide valides. La liste est versionnée à côté de ce script pour que
# la vérification fonctionne hors ligne — WinTool sert justement quand la machine va
# mal, et le validateur tourne en CI. Les SVG eux-mêmes arrivent par npm côté frontend.
$FICHIER_ICONES = Join-Path $PSScriptRoot 'lucide-icon-names.txt'
$ICONES = @()
if (Test-Path $FICHIER_ICONES) {
    $ICONES = @(Get-Content $FICHIER_ICONES -Encoding UTF8 | Where-Object { $_ -and $_ -notmatch '^\s*#' })
}

# ==============================================================================
# Outils
# ==============================================================================

function Get-Distance {
    <# Distance de Levenshtein, pour suggérer l'orthographe correcte. #>
    param([string] $A, [string] $B)

    $A = $A.ToUpper(); $B = $B.ToUpper()
    if ($A -eq $B) { return 0 }
    if ($A.Length -eq 0) { return $B.Length }
    if ($B.Length -eq 0) { return $A.Length }

    $d = New-Object 'int[,]' ($A.Length + 1), ($B.Length + 1)
    for ($i = 0; $i -le $A.Length; $i++) { $d[$i, 0] = $i }
    for ($j = 0; $j -le $B.Length; $j++) { $d[0, $j] = $j }

    for ($i = 1; $i -le $A.Length; $i++) {
        for ($j = 1; $j -le $B.Length; $j++) {
            if ($A[$i - 1] -eq $B[$j - 1]) { $cout = 0 } else { $cout = 1 }
            $sup = $d[($i - 1), $j] + 1
            $ins = $d[$i, ($j - 1)] + 1
            $sub = $d[($i - 1), ($j - 1)] + $cout
            $d[$i, $j] = [Math]::Min([Math]::Min($sup, $ins), $sub)
        }
    }
    return $d[$A.Length, $B.Length]
}

$script:Constats = @()

function Add-Constat {
    param(
        [string] $Fichier,
        [int]    $Ligne,
        [ValidateSet('erreur', 'avertissement')] [string] $Gravite,
        [string] $Code,
        [string] $Message
    )
    $script:Constats += [pscustomobject]@{
        Fichier = $Fichier; Ligne = $Ligne; Gravite = $Gravite
        Code = $Code; Message = $Message
    }
}

function Find-Bloc {
    <# Renvoie @{Debut; Fin} des lignes d'un bloc ## WINTOOL:<Motif> ... ## WINTOOL:END #>
    param([string[]] $Lignes, [string] $Motif)

    $debut = -1
    for ($i = 0; $i -lt $Lignes.Count; $i++) {
        if ($debut -lt 0 -and $Lignes[$i] -match $Motif) { $debut = $i; continue }
        if ($debut -ge 0 -and $Lignes[$i] -match '^\s*##\s*WINTOOL:END\s*$') {
            return @{ Debut = $debut; Fin = $i }
        }
    }
    if ($debut -ge 0) { return @{ Debut = $debut; Fin = -1 } }
    return $null
}

# ==============================================================================
# Contrôles
# ==============================================================================

function Test-Encodage {
    param([string] $Fichier, [string] $CheminComplet)

    # Piège rencontré lors de l'écriture de ce validateur lui-même : PowerShell 5.1
    # — celui livré nativement avec Windows, donc celui qui exécutera la plupart des
    # scripts — lit un .ps1 SANS BOM comme de l'ANSI, pas de l'UTF-8. Un fichier
    # contenant des accents est alors mal décodé, et le script casse à l'analyse.
    $octets = [System.IO.File]::ReadAllBytes($CheminComplet)
    if ($octets.Length -lt 3) { return }
    if ($octets[0] -eq 0xEF -and $octets[1] -eq 0xBB -and $octets[2] -eq 0xBF) { return }

    if ([System.Text.Encoding]::UTF8.GetString($octets) -match '[^\x00-\x7F]') {
        Add-Constat $Fichier 1 'erreur' 'BOM_ABSENT' 'Fichier UTF-8 sans BOM contenant des caractères non-ASCII : PowerShell 5.1 le lira en ANSI et le script cassera. Enregistrez-le en UTF-8 avec BOM.'
    }
}

function Test-Entete {
    param([string] $Fichier, [string[]] $Lignes)

    $bloc = Find-Bloc $Lignes '^\s*##\s*WINTOOL:START\s*$'
    if (-not $bloc) {
        Add-Constat $Fichier 1 'erreur' 'ENTETE_ABSENT' 'Aucun bloc ## WINTOOL:START ... ## WINTOOL:END.'
        return @{}
    }
    if ($bloc.Fin -lt 0) {
        Add-Constat $Fichier ($bloc.Debut + 1) 'erreur' 'ENTETE_NON_FERME' 'Bloc WINTOOL:START jamais refermé par WINTOOL:END.'
        return @{}
    }

    $champs = @{}
    for ($i = $bloc.Debut + 1; $i -lt $bloc.Fin; $i++) {
        if ($Lignes[$i] -match '^\s*##\s*([A-Za-z_]+)\s*:\s*(.*?)\s*$') {
            $cle = $Matches[1].ToLower(); $val = $Matches[2].Trim()
            if ($champs.ContainsKey($cle)) {
                Add-Constat $Fichier ($i + 1) 'avertissement' 'CHAMP_DOUBLON' "Le champ '$cle' est déclaré plusieurs fois ; seule la première valeur compte."
            } else {
                $champs[$cle] = @{ Valeur = $val; Ligne = $i + 1 }
            }
        }
    }

    foreach ($requis in $CHAMPS_REQUIS) {
        if (-not $champs.ContainsKey($requis)) {
            Add-Constat $Fichier ($bloc.Debut + 1) 'erreur' 'CHAMP_MANQUANT' "Champ obligatoire absent de l'entête : '$requis'."
        }
    }

    foreach ($cle in $VALEURS_ADMISES.Keys) {
        if ($champs.ContainsKey($cle)) {
            $v = $champs[$cle].Valeur.ToLower()
            if ($VALEURS_ADMISES[$cle] -notcontains $v) {
                Add-Constat $Fichier $champs[$cle].Ligne 'erreur' 'VALEUR_INVALIDE' "'$cle' vaut '$v' ; valeurs admises : $($VALEURS_ADMISES[$cle] -join ' | ')."
            }
        }
    }

    if ($champs.ContainsKey('id')) {
        $g = [ref]([guid]::Empty)
        if (-not [guid]::TryParse($champs['id'].Valeur, $g)) {
            Add-Constat $Fichier $champs['id'].Ligne 'erreur' 'ID_INVALIDE' "'id' n'est pas un GUID valide. Générez-en un avec New-Guid."
        }
    }

    if ($champs.ContainsKey('category')) {
        $cat = $champs['category'].Valeur.ToLower()
        if ($CATEGORIES_USINE -notcontains $cat) {
            Add-Constat $Fichier $champs['category'].Ligne 'avertissement' 'CATEGORIE_INCONNUE' "Catégorie '$cat' hors des catégories d'usine ; le script arrivera dans « Non classé »."
        }
    }

    if ($champs.ContainsKey('icon') -and $ICONES.Count -gt 0) {
        $ic = $champs['icon'].Valeur.Trim()
        if ($ic -match '[\uD800-\uDBFF]|[←-⯿]|[️]') {
            Add-Constat $Fichier $champs['icon'].Ligne 'erreur' 'ICONE_EMOJI' "'icon' contient un emoji. Utilisez un nom d'icône Lucide, par exemple 'moon'."
        }
        elseif ($ICONES -notcontains $ic) {
            $meilleur = $null; $dMin = 99
            foreach ($connu in $ICONES) {
                if ([Math]::Abs($connu.Length - $ic.Length) -gt 3) { continue }
                $d = Get-Distance $ic $connu
                if ($d -lt $dMin) { $dMin = $d; $meilleur = $connu }
            }
            if ($dMin -le 3) {
                Add-Constat $Fichier $champs['icon'].Ligne 'erreur' 'ICONE_INCONNUE' "Icône '$ic' absente de Lucide — vouliez-vous dire '$meilleur' ?"
            } else {
                Add-Constat $Fichier $champs['icon'].Ligne 'erreur' 'ICONE_INCONNUE' "Icône '$ic' absente de Lucide. Voir la liste dans tools/lucide-icon-names.txt."
            }
        }
    }

    return $champs
}

function Read-BlocOptions {
    <#
      Lit un bloc de déclarations. Une ligne dont le contenu après ## commence par UN
      espace déclare une option ; deux espaces ou plus déclarent un choix rattaché à
      l'option précédente. C'est l'indentation, et elle seule, qui fait la différence.
      Renvoie @{ Options = <ordonné cle -> @{Type;Libelle;Ligne;Choix=@{}}> ; Erreurs }
    #>
    param([string[]] $Lignes, [int] $Debut, [int] $Fin, [bool] $AvecType)

    $options = [ordered]@{}
    $derniere = $null

    for ($i = $Debut + 1; $i -lt $Fin; $i++) {
        $ligne = $Lignes[$i]
        if ($ligne -notmatch '^\s*##(\s+)(\S+)\s*:\s*(.*?)\s*$') { continue }

        $indent = $Matches[1].Length
        $nom    = $Matches[2]
        $reste  = $Matches[3]

        if ($indent -ge 2 -and $derniere) {
            $options[$derniere].Choix[$nom] = @{ Libelle = $reste; Ligne = $i + 1 }
            continue
        }

        $type = ''
        if ($AvecType) {
            if ($reste -match '^\[([a-z]+)\]\s*(.*)$') {
                $type  = $Matches[1]
                $reste = $Matches[2].Trim()
            }
        }
        $options[$nom] = @{ Type = $type; Libelle = $reste; Ligne = $i + 1; Choix = [ordered]@{} }
        $derniere = $nom
    }
    return $options
}

function Test-Options {
    param([string] $Fichier, [string[]] $Lignes)

    $bloc = Find-Bloc $Lignes '^\s*##\s*WINTOOL:OPTIONS\s*$'
    if (-not $bloc) {
        Add-Constat $Fichier 1 'erreur' 'OPTIONS_ABSENT' "Aucun bloc '## WINTOOL:OPTIONS'. C'est lui qui donne aux options leur type et leur libellé ; sans lui l'interface afficherait les clés brutes."
        return [ordered]@{}
    }
    if ($bloc.Fin -lt 0) {
        Add-Constat $Fichier ($bloc.Debut + 1) 'erreur' 'OPTIONS_NON_FERME' 'Bloc WINTOOL:OPTIONS jamais refermé par WINTOOL:END.'
        return [ordered]@{}
    }

    $options = Read-BlocOptions $Lignes $bloc.Debut $bloc.Fin $true

    foreach ($nom in $options.Keys) {
        $o = $options[$nom]

        if (-not $o.Type) {
            Add-Constat $Fichier $o.Ligne 'erreur' 'TYPE_ABSENT' "L'option '$nom' n'a pas de type. Attendu : # [type] Libellé — Description."
        }
        elseif ($TYPES_OPTION -notcontains $o.Type) {
            Add-Constat $Fichier $o.Ligne 'erreur' 'TYPE_INVALIDE' "Type '[$($o.Type)]' inconnu pour '$nom' ; types admis : $($TYPES_OPTION -join ' | ')."
        }

        if (-not $o.Libelle) {
            Add-Constat $Fichier $o.Ligne 'erreur' 'LIBELLE_VIDE' "L'option '$nom' est déclarée sans libellé."
        }

        if ($TYPES_AVEC_CHOIX -contains $o.Type) {
            if ($o.Choix.Count -lt 2) {
                Add-Constat $Fichier $o.Ligne 'erreur' 'CHOIX_MANQUANT' "'$nom' est de type [$($o.Type)] mais déclare $($o.Choix.Count) choix. Il en faut au moins deux, en sous-lignes indentées."
            }
            foreach ($c in $o.Choix.Keys) {
                if (-not $o.Choix[$c].Libelle) {
                    Add-Constat $Fichier $o.Choix[$c].Ligne 'erreur' 'LIBELLE_VIDE' "Le choix '$c' de '$nom' n'a pas de libellé."
                }
            }
        }
        elseif ($o.Choix.Count -gt 0) {
            Add-Constat $Fichier $o.Ligne 'erreur' 'CHOIX_INATTENDU' "'$nom' est de type [$($o.Type)] et ne peut pas avoir de choix. Utilisez [select] ou [multi]."
        }
    }

    return $options
}

function Test-Config {
    <# Lit $CONFIG : uniquement des clés et des valeurs par défaut (style B). #>
    param([string] $Fichier, [string[]] $Lignes)

    $debut = -1
    for ($i = 0; $i -lt $Lignes.Count; $i++) {
        if ($Lignes[$i] -match '^\s*\$CONFIG\s*=\s*@\{') { $debut = $i; break }
    }
    if ($debut -lt 0) {
        Add-Constat $Fichier 1 'erreur' 'CONFIG_ABSENT' 'Aucun bloc $CONFIG = @{ ... }.'
        return [ordered]@{}
    }

    $fin = -1
    for ($i = $debut + 1; $i -lt $Lignes.Count; $i++) {
        if ($Lignes[$i] -match '^\s*\}\s*$') { $fin = $i; break }
    }
    if ($fin -lt 0) {
        Add-Constat $Fichier ($debut + 1) 'erreur' 'CONFIG_NON_FERME' 'Bloc $CONFIG jamais refermé.'
        return [ordered]@{}
    }

    $config = [ordered]@{}
    for ($i = $debut + 1; $i -lt $fin; $i++) {
        $ligne = $Lignes[$i]
        if ($ligne -match '^\s*$' -or $ligne -match '^\s*#') { continue }

        if ($ligne -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$') {
            Add-Constat $Fichier ($i + 1) 'avertissement' 'CONFIG_LIGNE_ILLISIBLE' 'Ligne non reconnue comme « Clé = valeur » dans le bloc $CONFIG.'
            continue
        }
        $cle    = $Matches[1]
        $valeur = ($Matches[2] -split '#')[0].Trim().TrimEnd(',')

        $estTableau = $valeur -match '^@\('
        $elements   = @()
        if ($estTableau) {
            foreach ($m in [regex]::Matches($valeur, '"([^"]*)"|''([^'']*)''')) {
                if ($m.Groups[1].Success) { $elements += $m.Groups[1].Value } else { $elements += $m.Groups[2].Value }
            }
        }
        $config[$cle] = @{ Valeur = $valeur; EstTableau = $estTableau; Elements = $elements; Ligne = $i + 1 }
    }
    return $config
}

function Test-Coherence {
    <# Croise le bloc OPTIONS et $CONFIG dans les DEUX sens, et valide les défauts. #>
    param([string] $Fichier, $Options, $Config)

    foreach ($cle in $Config.Keys) {
        if (-not $Options.Contains($cle)) {
            Add-Constat $Fichier $Config[$cle].Ligne 'erreur' 'OPTION_NON_DECLAREE' "'$cle' est dans `$CONFIG mais absente du bloc OPTIONS : l'interface afficherait la clé brute."
        }
    }
    foreach ($nom in $Options.Keys) {
        if (-not $Config.Contains($nom)) {
            Add-Constat $Fichier $Options[$nom].Ligne 'erreur' 'OPTION_ORPHELINE' "'$nom' est déclarée dans OPTIONS mais absente de `$CONFIG : elle n'a pas de valeur par défaut."
            continue
        }

        $o = $Options[$nom]; $c = $Config[$nom]

        switch ($o.Type) {
            'bool'   { if ($c.Valeur -notmatch '^\$(true|false)$') { Add-Constat $Fichier $c.Ligne 'avertissement' 'TYPE_INCOHERENT' "'$nom' est [bool] mais vaut '$($c.Valeur)'." } }
            'number' { if ($c.Valeur -notmatch '^-?\d+(\.\d+)?$')  { Add-Constat $Fichier $c.Ligne 'avertissement' 'TYPE_INCOHERENT' "'$nom' est [number] mais vaut '$($c.Valeur)'." } }
            'select' {
                if ($c.EstTableau) {
                    Add-Constat $Fichier $c.Ligne 'erreur' 'DEFAUT_INVALIDE' "'$nom' est [select] : sa valeur par défaut doit être UN choix, pas un tableau. Utilisez [multi] pour plusieurs."
                } else {
                    $v = $c.Valeur.Trim('"', "'")
                    if ($o.Choix.Count -gt 0 -and -not $o.Choix.Contains($v)) {
                        Add-Constat $Fichier $c.Ligne 'erreur' 'DEFAUT_INVALIDE' "'$nom' vaut '$v', qui ne fait pas partie des choix déclarés : $($o.Choix.Keys -join ', ')."
                    }
                }
            }
            'multi' {
                if (-not $c.EstTableau) {
                    Add-Constat $Fichier $c.Ligne 'erreur' 'DEFAUT_INVALIDE' "'$nom' est [multi] : sa valeur par défaut doit être un tableau, par exemple @(`"temp`", `"cache`") ou @() pour aucun."
                } else {
                    foreach ($e in $c.Elements) {
                        if ($o.Choix.Count -gt 0 -and -not $o.Choix.Contains($e)) {
                            Add-Constat $Fichier $c.Ligne 'erreur' 'DEFAUT_INVALIDE' "'$nom' inclut '$e' par défaut, qui ne fait pas partie des choix déclarés : $($o.Choix.Keys -join ', ')."
                        }
                    }
                }
            }
        }
    }
}

function Test-Traduction {
    param([string] $Fichier, [string[]] $Lignes, $Options, [string] $LangBase)

    # On exige une traduction vers une langue DIFFÉRENTE de celle de l'entête — et non
    # un bloc 'en' en dur : les scripts officiels sont rédigés en anglais et traduits
    # vers le français, un script personnel fera souvent l'inverse.
    if (-not $LangBase) { $LangBase = 'fr' }

    $debut = -1; $fin = -1; $langTrouvee = ''
    for ($i = 0; $i -lt $Lignes.Count; $i++) {
        if ($debut -lt 0 -and $Lignes[$i] -match '^\s*##\s*WINTOOL:LANG\s+([A-Za-z]{2})\s*$') {
            if ($Matches[1].ToLower() -ne $LangBase.ToLower()) { $debut = $i; $langTrouvee = $Matches[1].ToLower() }
            continue
        }
        if ($debut -ge 0 -and $Lignes[$i] -match '^\s*##\s*WINTOOL:END\s*$') { $fin = $i; break }
    }

    if ($debut -lt 0) {
        Add-Constat $Fichier 1 'erreur' 'TRADUCTION_ABSENTE' "Aucun bloc de traduction. L'entête est en '$LangBase' : il faut un bloc '## WINTOOL:LANG <autre langue>' (§10)."
        return
    }
    if ($fin -lt 0) {
        Add-Constat $Fichier ($debut + 1) 'erreur' 'TRADUCTION_NON_FERMEE' 'Bloc de traduction jamais refermé par WINTOOL:END.'
        return
    }

    $traduits = Read-BlocOptions $Lignes $debut $fin $false

    foreach ($obligatoire in @('title', 'desc')) {
        if (-not $traduits.Contains($obligatoire)) {
            Add-Constat $Fichier ($debut + 1) 'erreur' 'TRADUCTION_INCOMPLETE' "Le bloc '$langTrouvee' ne traduit pas '$obligatoire'."
        }
    }

    # Sens 1 : chaque option déclarée doit être traduite.
    foreach ($nom in $Options.Keys) {
        if (-not $traduits.Contains($nom)) {
            Add-Constat $Fichier ($debut + 1) 'avertissement' 'TRADUCTION_OPTION' "L'option '$nom' n'a pas de libellé '$langTrouvee' ; elle s'affichera en '$LangBase'."
            continue
        }
        foreach ($c in $Options[$nom].Choix.Keys) {
            if (-not $traduits[$nom].Choix.Contains($c)) {
                Add-Constat $Fichier $traduits[$nom].Ligne 'avertissement' 'TRADUCTION_CHOIX' "Le choix '$c' de '$nom' n'a pas de libellé '$langTrouvee'."
            }
        }
    }

    # Sens 2 : toute traduction doit correspondre à quelque chose. C'est ce contrôle
    # qui manquait et par lequel la dérive s'installait — une clé renommée d'un côté
    # laissait derrière elle une traduction orpheline que rien ne signalait.
    foreach ($nom in $traduits.Keys) {
        if ($nom -in @('title', 'desc')) { continue }
        if (-not $Options.Contains($nom)) {
            $meilleur = $null; $dMin = 99
            foreach ($connu in $Options.Keys) {
                $d = Get-Distance $nom $connu
                if ($d -lt $dMin) { $dMin = $d; $meilleur = $connu }
            }
            if ($dMin -le 3 -and $meilleur) {
                Add-Constat $Fichier $traduits[$nom].Ligne 'erreur' 'TRADUCTION_ORPHELINE' "Le bloc '$langTrouvee' traduit '$nom', qui n'existe pas dans OPTIONS — vouliez-vous dire '$meilleur' ?"
            } else {
                Add-Constat $Fichier $traduits[$nom].Ligne 'erreur' 'TRADUCTION_ORPHELINE' "Le bloc '$langTrouvee' traduit '$nom', qui n'existe dans aucune option déclarée."
            }
            continue
        }
        foreach ($c in $traduits[$nom].Choix.Keys) {
            if (-not $Options[$nom].Choix.Contains($c)) {
                Add-Constat $Fichier $traduits[$nom].Choix[$c].Ligne 'erreur' 'TRADUCTION_ORPHELINE' "Le bloc '$langTrouvee' traduit le choix '$c' de '$nom', qui n'existe pas dans OPTIONS."
            }
        }
    }
}

function Test-Override {
    param([string] $Fichier, [string[]] $Lignes)

    $trouve = $false
    for ($i = 0; $i -lt $Lignes.Count; $i++) {
        $l = $Lignes[$i]
        if ($l -notmatch '\$env:WINTOOL_CONFIG') { continue }
        $trouve = $true

        # WinTool transmet désormais le JSON dans la variable elle-même, et non
        # le chemin d'un fichier. L'ancienne forme passerait donc du JSON à
        # Get-Content, qui échouerait : le script tournerait avec ses valeurs par
        # défaut sans que rien ne le signale. Ce contrôle existe pour que ce
        # basculement ne puisse pas passer inaperçu.
        if ($l -match 'Get-Content\s') {
            Add-Constat $Fichier ($i + 1) 'erreur' 'OVERRIDE_OBSOLETE' "Ancienne ligne d'override : WINTOOL_CONFIG contient le JSON, plus un chemin de fichier. Remplacez par ( `$env:WINTOOL_CONFIG | ConvertFrom-Json )."
        }
    }

    if (-not $trouve) {
        Add-Constat $Fichier 1 'erreur' 'OVERRIDE_ABSENT' "Ligne d'override absente : sans elle, les réglages choisis dans l'interface sont ignorés et le script tourne toujours avec ses valeurs par défaut."
    }
}

function Test-Marqueurs {
    param([string] $Fichier, [string[]] $Lignes)

    for ($i = 0; $i -lt $Lignes.Count; $i++) {
        $ligne = $Lignes[$i]
        if ($ligne -match '^\s*##') { continue }

        # La balise n'est cherchée qu'en tête de chaîne affichée — c'est la seule
        # position où un marqueur apparaît réellement : Write-Host "[OK] message".
        # Sans cette contrainte, les transtypages PowerShell deviennent des faux
        # positifs : [long] ressemble à [DONE] à deux caractères près, [int] à [INFO].
        foreach ($m in [regex]::Matches($ligne, '["'']\s*\[([A-Za-z]{2,8})\]')) {
            $balise = $m.Groups[1].Value
            if ($MARQUEURS -contains $balise.ToUpper()) {
                if ($balise -cne $balise.ToUpper()) {
                    Add-Constat $Fichier ($i + 1) 'avertissement' 'MARQUEUR_CASSE' "Marqueur '[$balise]' : les marqueurs s'écrivent en majuscules."
                }
                continue
            }
            $meilleur = $null; $dMin = 99
            foreach ($connu in $MARQUEURS) {
                $d = Get-Distance $balise $connu
                if ($d -lt $dMin) { $dMin = $d; $meilleur = $connu }
            }
            if ($dMin -le 2) {
                Add-Constat $Fichier ($i + 1) 'erreur' 'MARQUEUR_INCONNU' "Marqueur '[$balise]' inconnu — vouliez-vous dire '[$meilleur]' ?"
            }
        }
    }
}

function Test-SortieAnglaise {
    param([string] $Fichier, [string[]] $Lignes)

    # Indice grossier et volontairement conservateur : caractères accentués dans une
    # chaîne affichée. La sortie brute des scripts est en anglais (§10), les
    # commentaires peuvent rester en français.
    for ($i = 0; $i -lt $Lignes.Count; $i++) {
        $ligne = $Lignes[$i]
        if ($ligne -match '^\s*#') { continue }
        if ($ligne -match 'Write-(Host|Output|Warning|Error)' -and $ligne -match '[àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]') {
            Add-Constat $Fichier ($i + 1) 'avertissement' 'SORTIE_NON_ANGLAISE' "Message affiché contenant des accents : la sortie d'exécution est en anglais (§10)."
        }
    }
}

# ==============================================================================
# Exécution
# ==============================================================================

if (-not (Test-Path $Path)) {
    Write-Host "[ERR] Dossier introuvable : $Path" -ForegroundColor Red
    exit 2
}

$fichiers = @(Get-ChildItem -Path $Path -Filter '*.ps1' -Recurse -File | Sort-Object FullName)
if ($fichiers.Count -eq 0) {
    Write-Host "[!] Aucun script .ps1 sous $Path" -ForegroundColor Yellow
    exit 0
}

$racine = (Resolve-Path $Path).Path
$idsVus = @{}

foreach ($f in $fichiers) {
    $relatif = $f.FullName.Substring($racine.Length).TrimStart('\', '/')
    $lignes  = @(Get-Content -LiteralPath $f.FullName -Encoding UTF8)

    Test-Encodage $relatif $f.FullName
    $champs  = Test-Entete  $relatif $lignes
    $options = Test-Options $relatif $lignes
    $config  = Test-Config  $relatif $lignes
    Test-Coherence $relatif $options $config

    if ($champs.ContainsKey('lang')) { $langBase = $champs['lang'].Valeur } else { $langBase = 'fr' }
    Test-Traduction     $relatif $lignes $options $langBase
    Test-Override       $relatif $lignes
    Test-Marqueurs      $relatif $lignes
    Test-SortieAnglaise $relatif $lignes

    if ($champs.ContainsKey('id')) {
        $id = $champs['id'].Valeur.ToLower()
        if ($idsVus.ContainsKey($id)) {
            Add-Constat $relatif $champs['id'].Ligne 'erreur' 'ID_COLLISION' "Le même 'id' est déjà utilisé par '$($idsVus[$id])'. Générez-en un nouveau avec New-Guid."
        } else {
            $idsVus[$id] = $relatif
        }
    }
}

# ==============================================================================
# Rapport
# ==============================================================================

$erreurs        = @($script:Constats | Where-Object { $_.Gravite -eq 'erreur' })
$avertissements = @($script:Constats | Where-Object { $_.Gravite -eq 'avertissement' })

Write-Host ''
Write-Host '  Validateur du contrat de script WinTool v2' -ForegroundColor Cyan
Write-Host "  $($fichiers.Count) script(s) analysé(s) sous $racine"
Write-Host ''

if ($script:Constats.Count -eq 0) {
    Write-Host '  Aucun constat. Tous les scripts sont conformes.' -ForegroundColor Green
    Write-Host ''
    exit 0
}

foreach ($groupe in ($script:Constats | Group-Object Fichier | Sort-Object Name)) {
    Write-Host "  $($groupe.Name)" -ForegroundColor White
    foreach ($c in ($groupe.Group | Sort-Object Ligne)) {
        if ($c.Gravite -eq 'erreur') { $couleur = 'Red'; $etiquette = 'ERREUR ' }
        else                         { $couleur = 'Yellow'; $etiquette = 'AVERTIR' }
        Write-Host ("    ligne {0,-4} {1} {2,-22} {3}" -f $c.Ligne, $etiquette, $c.Code, $c.Message) -ForegroundColor $couleur
    }
    Write-Host ''
}

Write-Host "  $($erreurs.Count) erreur(s), $($avertissements.Count) avertissement(s)." -ForegroundColor White
Write-Host ''

if ($erreurs.Count -gt 0) { exit 1 }
if ($Strict -and $avertissements.Count -gt 0) { exit 1 }
exit 0
