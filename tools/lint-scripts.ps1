<#
.SYNOPSIS
    Validateur du contrat de script WinTool v2.

.DESCRIPTION
    Vérifie que chaque .ps1 respecte le contrat défini dans docs/SPECIFICATION.md §5.

    Ce script fait autorité. La documentation décrit ce qu'il vérifie, jamais l'inverse :
    c'est exactement la dérive qui a rendu la v3 inexploitable (une convention soigneusement
    documentée, et zéro script sur treize qui la respectait).

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

# Champs d'entête obligatoires. 'tags' est volontairement absent : il est facultatif.
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

# Marqueurs de sortie normalisés (§5.3). Toute balise proche mais absente de cette
# liste est signalée avec une suggestion — c'est le cas [REBBOT] → [REBOOT].
$MARQUEURS = @('INFO', 'OK', 'WARN', 'ERR', 'STEP', 'CKPT', 'REBOOT', 'DONE')

$TYPES_CONFIG = @('bool', 'number', 'string', 'hidden')

# Catégories d'usine. Une valeur hors liste n'est pas une faute : le script part
# simplement en « Non classé » (§5.1). D'où un avertissement, pas une erreur.
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
    <# Distance de Levenshtein, pour suggérer la balise correcte. #>
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
        Fichier = $Fichier
        Ligne   = $Ligne
        Gravite = $Gravite
        Code    = $Code
        Message = $Message
    }
}

# ==============================================================================
# Contrôles
# ==============================================================================

function Test-Entete {
    param([string] $Fichier, [string[]] $Lignes)

    $debut = -1; $fin = -1
    for ($i = 0; $i -lt $Lignes.Count; $i++) {
        if ($debut -lt 0 -and $Lignes[$i] -match '^\s*##\s*WINTOOL:START\s*$') { $debut = $i; continue }
        if ($debut -ge 0 -and $Lignes[$i] -match '^\s*##\s*WINTOOL:END\s*$')   { $fin = $i; break }
    }

    if ($debut -lt 0) {
        Add-Constat $Fichier 1 'erreur' 'ENTETE_ABSENT' 'Aucun bloc ## WINTOOL:START ... ## WINTOOL:END.'
        return @{}
    }
    if ($fin -lt 0) {
        Add-Constat $Fichier ($debut + 1) 'erreur' 'ENTETE_NON_FERME' 'Bloc WINTOOL:START jamais refermé par WINTOOL:END.'
        return @{}
    }

    $champs = @{}
    for ($i = $debut + 1; $i -lt $fin; $i++) {
        if ($Lignes[$i] -match '^\s*##\s*([A-Za-z_]+)\s*:\s*(.*?)\s*(#.*)?$') {
            $cle = $Matches[1].ToLower()
            $val = $Matches[2].Trim()
            if ($champs.ContainsKey($cle)) {
                Add-Constat $Fichier ($i + 1) 'avertissement' 'CHAMP_DOUBLON' "Le champ '$cle' est déclaré plusieurs fois ; seule la première valeur compte."
            } else {
                $champs[$cle] = @{ Valeur = $val; Ligne = $i + 1 }
            }
        }
    }

    foreach ($requis in $CHAMPS_REQUIS) {
        if (-not $champs.ContainsKey($requis)) {
            Add-Constat $Fichier ($debut + 1) 'erreur' 'CHAMP_MANQUANT' "Champ obligatoire absent de l'entête : '$requis'."
        }
    }

    foreach ($cle in $VALEURS_ADMISES.Keys) {
        if ($champs.ContainsKey($cle)) {
            $v = $champs[$cle].Valeur.ToLower()
            if ($VALEURS_ADMISES[$cle] -notcontains $v) {
                $attendu = $VALEURS_ADMISES[$cle] -join ' | '
                Add-Constat $Fichier $champs[$cle].Ligne 'erreur' 'VALEUR_INVALIDE' "'$cle' vaut '$v' ; valeurs admises : $attendu."
            }
        }
    }

    if ($champs.ContainsKey('id')) {
        $guid = [ref]([guid]::Empty)
        if (-not [guid]::TryParse($champs['id'].Valeur, $guid)) {
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

        # Les emojis sont proscrits : rendus par la police système, ils changent
        # d'aspect sur chaque machine, ne peuvent pas hériter de la couleur du texte
        # et ne s'alignent pas sur la grille. C'était le défaut de la v3.
        if ($ic -match '[\uD800-\uDBFF]|[←-⯿]|[️]') {
            Add-Constat $Fichier $champs['icon'].Ligne 'erreur' 'ICONE_EMOJI' "'icon' contient un emoji. Utilisez un nom d'icône Lucide, par exemple 'moon'."
        }
        elseif ($ICONES -notcontains $ic) {
            $meilleur = $null; $meilleureDistance = 99
            foreach ($connu in $ICONES) {
                if ([Math]::Abs($connu.Length - $ic.Length) -gt 3) { continue }
                $d = Get-Distance $ic $connu
                if ($d -lt $meilleureDistance) { $meilleureDistance = $d; $meilleur = $connu }
            }
            if ($meilleureDistance -le 3) {
                Add-Constat $Fichier $champs['icon'].Ligne 'erreur' 'ICONE_INCONNUE' "Icône '$ic' absente de Lucide — vouliez-vous dire '$meilleur' ?"
            } else {
                Add-Constat $Fichier $champs['icon'].Ligne 'erreur' 'ICONE_INCONNUE' "Icône '$ic' absente de Lucide. Voir la liste dans tools/lucide-icon-names.txt."
            }
        }
    }

    return $champs
}

function Test-Traduction {
    param([string] $Fichier, [string[]] $Lignes, [string[]] $ClesConfig, [string] $LangBase)

    # L'application est bilingue (§10). On exige donc un bloc de traduction vers une
    # langue DIFFÉRENTE de celle de l'entête — et non un bloc 'en' en dur : les scripts
    # officiels sont rédigés en anglais et traduits vers le français, les scripts
    # personnels feront souvent l'inverse. La règle doit tenir dans les deux sens.
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
        Add-Constat $Fichier ($debut + 1) 'erreur' 'TRADUCTION_NON_FERMEE' 'Bloc WINTOOL:LANG jamais refermé par WINTOOL:END.'
        return
    }

    $traduits = @()
    for ($i = $debut + 1; $i -lt $fin; $i++) {
        if ($Lignes[$i] -match '^\s*##\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$') {
            $traduits += $Matches[1]
        }
    }

    foreach ($obligatoire in @('title', 'desc')) {
        if ($traduits -notcontains $obligatoire) {
            Add-Constat $Fichier ($debut + 1) 'erreur' 'TRADUCTION_INCOMPLETE' "Le bloc '$langTrouvee' ne traduit pas '$obligatoire'."
        }
    }

    foreach ($cle in $ClesConfig) {
        if ($traduits -notcontains $cle) {
            Add-Constat $Fichier ($debut + 1) 'avertissement' 'TRADUCTION_OPTION' "L'option '$cle' n'a pas de libellé '$langTrouvee' ; elle s'affichera en '$LangBase' dans cette langue."
        }
    }
}

function Test-Config {
    param([string] $Fichier, [string[]] $Lignes)

    $debut = -1
    for ($i = 0; $i -lt $Lignes.Count; $i++) {
        if ($Lignes[$i] -match '^\s*\$CONFIG\s*=\s*@\{') { $debut = $i; break }
    }
    if ($debut -lt 0) {
        Add-Constat $Fichier 1 'erreur' 'CONFIG_ABSENT' 'Aucun bloc $CONFIG = @{ ... }.'
        return @()
    }

    $fin = -1
    for ($i = $debut + 1; $i -lt $Lignes.Count; $i++) {
        if ($Lignes[$i] -match '^\s*\}\s*$') { $fin = $i; break }
    }
    if ($fin -lt 0) {
        Add-Constat $Fichier ($debut + 1) 'erreur' 'CONFIG_NON_FERME' 'Bloc $CONFIG jamais refermé.'
        return @()
    }

    $cles = @()
    for ($i = $debut + 1; $i -lt $fin; $i++) {
        $ligne = $Lignes[$i]
        if ($ligne -match '^\s*$' -or $ligne -match '^\s*#') { continue }

        if ($ligne -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$') {
            Add-Constat $Fichier ($i + 1) 'avertissement' 'CONFIG_LIGNE_ILLISIBLE' 'Ligne non reconnue comme « Clé = valeur » dans le bloc $CONFIG.'
            continue
        }
        $cle = $Matches[1]
        $reste = $Matches[2]
        $cles += $cle

        if ($reste -notmatch '#\s*\[([a-z]+)\]\s*(.*)$') {
            Add-Constat $Fichier ($i + 1) 'erreur' 'ANNOTATION_ABSENTE' "L'option '$cle' n'a pas d'annotation « # [type] Libellé — Description » ; l'interface afficherait la clé brute."
            continue
        }
        $type    = $Matches[1]
        $libelle = $Matches[2].Trim()

        if ($TYPES_CONFIG -notcontains $type) {
            $attendu = $TYPES_CONFIG -join ' | '
            Add-Constat $Fichier ($i + 1) 'erreur' 'TYPE_INVALIDE' "Type '[$type]' inconnu pour '$cle' ; types admis : $attendu."
        }
        if (-not $libelle) {
            Add-Constat $Fichier ($i + 1) 'erreur' 'LIBELLE_VIDE' "L'option '$cle' est annotée sans libellé."
        }

        # Cohérence entre le type déclaré et la valeur par défaut
        $valeur = ($reste -split '#')[0].Trim().TrimEnd(',')
        if ($type -eq 'bool'   -and $valeur -notmatch '^\$(true|false)$') {
            Add-Constat $Fichier ($i + 1) 'avertissement' 'TYPE_INCOHERENT' "'$cle' est déclarée [bool] mais vaut '$valeur'."
        }
        if ($type -eq 'number' -and $valeur -notmatch '^-?\d+(\.\d+)?$') {
            Add-Constat $Fichier ($i + 1) 'avertissement' 'TYPE_INCOHERENT' "'$cle' est déclarée [number] mais vaut '$valeur'."
        }
    }

    return $cles
}

function Test-Override {
    param([string] $Fichier, [string[]] $Lignes)

    $trouve = $false
    for ($i = 0; $i -lt $Lignes.Count; $i++) {
        if ($Lignes[$i] -match '\$env:WINTOOL_CONFIG') { $trouve = $true; break }
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
            # Balise inconnue : proche d'un marqueur connu ?
            $meilleur = $null; $meilleureDistance = 99
            foreach ($connu in $MARQUEURS) {
                $d = Get-Distance $balise $connu
                if ($d -lt $meilleureDistance) { $meilleureDistance = $d; $meilleur = $connu }
            }
            if ($meilleureDistance -le 2) {
                Add-Constat $Fichier ($i + 1) 'erreur' 'MARQUEUR_INCONNU' "Marqueur '[$balise]' inconnu — vouliez-vous dire '[$meilleur]' ?"
            }
        }
    }
}

function Test-Encodage {
    param([string] $Fichier, [string] $CheminComplet)

    # Piège rencontré lors de l'écriture de ce validateur lui-même : PowerShell 5.1
    # — celui livré nativement avec Windows, donc celui qui exécutera la plupart des
    # scripts — lit un .ps1 SANS BOM comme de l'ANSI, pas de l'UTF-8. Un fichier
    # contenant des accents est alors mal décodé, et le script casse à l'analyse ou
    # affiche du charabia. Le BOM est donc obligatoire dès qu'il y a un accent.
    $octets = [System.IO.File]::ReadAllBytes($CheminComplet)
    if ($octets.Length -lt 3) { return }

    $aBom = ($octets[0] -eq 0xEF -and $octets[1] -eq 0xBB -and $octets[2] -eq 0xBF)
    if ($aBom) { return }

    $texte = [System.Text.Encoding]::UTF8.GetString($octets)
    if ($texte -match '[^\x00-\x7F]') {
        Add-Constat $Fichier 1 'erreur' 'BOM_ABSENT' 'Fichier UTF-8 sans BOM contenant des caractères non-ASCII : PowerShell 5.1 le lira en ANSI et le script cassera. Enregistrez-le en UTF-8 avec BOM.'
    }
}

function Test-SortieAnglaise {
    param([string] $Fichier, [string[]] $Lignes)

    # Indice grossier et volontairement conservateur : caractères accentués dans une
    # chaîne affichée. La sortie brute des scripts est en anglais (§10).
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

    Test-Encodage               $relatif $f.FullName
    $champs = Test-Entete       $relatif $lignes
    $cles   = Test-Config       $relatif $lignes
    if ($champs.ContainsKey('lang')) { $langBase = $champs['lang'].Valeur } else { $langBase = 'fr' }
    Test-Traduction             $relatif $lignes $cles $langBase
    Test-Override               $relatif $lignes
    Test-Marqueurs              $relatif $lignes
    Test-SortieAnglaise         $relatif $lignes

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
