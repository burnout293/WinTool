<#
  Construit index.json, l'index du catalogue de scripts (specification 16.3).

  Usage (CI du depot WinTool-Catalogue, apres le validateur) :
    ./tools/construire-index-catalogue.ps1 -Scripts <dossier> -Version 1.0.0 -Sortie index.json

  Le format est celui que lit src-tauri/src/catalogue.rs. Les deux evoluent
  ensemble : c'est pourquoi cet outil vit ici, a cote du lecteur, et non dans le
  depot du catalogue. Chaque regle controlee ici l'est aussi a la lecture, par
  l'application : ce controle sert a echouer tot, dans la CI, jamais a remplacer
  celui de WinTool.

  L'empreinte de chaque script est celle des octets EXACTS du fichier. Construire
  l'index depuis le dossier meme qui sera publie : une conversion de fins de
  ligne entre les deux, et chaque installation refuserait le catalogue.
#>
param(
    [Parameter(Mandatory)] [string] $Scripts,
    [Parameter(Mandatory)] [string] $Version,
    # Etiquette de la release ou les scripts seront publies. WinTool les
    # telecharge depuis cette release precise, jamais depuis 'la derniere'.
    [string] $Tag,
    [string] $Sortie = 'index.json',
    [string] $Publie = (Get-Date -Format 'yyyy-MM-dd'),
    # Identifiant de la source. Un fork le change ici ET dans catalogue.rs.
    [string] $Source = 'officiel'
)

$ErrorActionPreference = 'Stop'

function Echec([string] $titre, [string] $detail) {
    Write-Host "::error title=$titre::$detail"
    exit 1
}

# --- Les memes regles que catalogue.rs -------------------------------------
$reserves = @('CON', 'PRN', 'AUX', 'NUL') +
    (0..9 | ForEach-Object { "COM$_" }) + (0..9 | ForEach-Object { "LPT$_" })

function Test-NomSur([string] $nom) {
    if ($nom.Length -eq 0 -or $nom.Length -gt 100) { return $false }
    if ($nom -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { return $false }
    if ($nom.Contains('..') -or $nom.EndsWith('.')) { return $false }
    $racine = $nom.Split('.')[0]
    return -not ($reserves -contains $racine.ToUpperInvariant())
}

if (-not $Tag) { $Tag = "v$Version" }
if ($Version -notmatch '^\d{1,9}\.\d{1,9}\.\d{1,9}$') {
    Echec 'Version invalide' "'$Version' n'a pas la forme X.Y.Z."
}
if ($Tag.Length -gt 64 -or -not (Test-NomSur $Tag)) {
    Echec 'Etiquette invalide' "'$Tag' : lettres, chiffres, point, tiret et souligne seulement."
}

$dossier = (Resolve-Path -LiteralPath $Scripts).Path
$sousDossiers = @(Get-ChildItem -LiteralPath $dossier -Directory)
if ($sousDossiers.Count -gt 0) {
    Echec 'Catalogue non plat' "L'index est une liste plate, sans sous-dossier : $($sousDossiers.Name -join ', ')."
}

# Ordre ordinal, independant de la culture de la machine : deux constructions
# du meme dossier donnent le meme index, octet pour octet.
$noms = New-Object 'System.Collections.Generic.List[string]'
Get-ChildItem -LiteralPath $dossier -File -Filter *.ps1 | ForEach-Object { $noms.Add($_.Name) }
$noms.Sort([StringComparer]::Ordinal)
if ($noms.Count -eq 0) { Echec 'Catalogue vide' "Aucun .ps1 dans $dossier." }

$sha = [Security.Cryptography.SHA256]::Create()
$utf8 = New-Object Text.UTF8Encoding $false
$ids = @{}
$fichiers = @{}
$entrees = @()

foreach ($nom in $noms) {
    if (-not (Test-NomSur $nom)) {
        Echec 'Nom refuse' "$nom : lettres, chiffres, point, tiret et souligne seulement, ni nom reserve par Windows."
    }
    if ($fichiers.ContainsKey($nom.ToLowerInvariant())) {
        Echec 'Nom en double' "$nom ne differe d'un autre que par la casse."
    }
    $fichiers[$nom.ToLowerInvariant()] = $true

    $chemin = Join-Path $dossier $nom
    $octets = [IO.File]::ReadAllBytes($chemin)
    if ($octets.Length -eq 0 -or $octets.Length -gt 2MB) {
        Echec 'Taille hors limites' "$nom : $($octets.Length) octets."
    }
    $empreinte = -join ($sha.ComputeHash($octets) | ForEach-Object { $_.ToString('x2') })

    # Entete : id, version, titre dans la langue declaree, puis les titres des
    # blocs de traduction. Le BOM est retire avant lecture.
    $texte = $utf8.GetString($octets)
    if ($texte.Length -gt 0 -and $texte[0] -eq [char]0xFEFF) { $texte = $texte.Substring(1) }
    $id = ''
    $versionScript = ''
    $langue = 'en'
    $titres = [ordered]@{}
    $bloc = ''
    foreach ($ligne in ($texte -split "`r?`n")) {
        $l = $ligne.Trim()
        if ($l -match '^##\s*WINTOOL:START\s*$') { $bloc = 'entete'; continue }
        if ($l -match '^##\s*WINTOOL:LANG\s+([A-Za-z-]+)\s*$') { $bloc = 'lang:' + $Matches[1].ToLowerInvariant(); continue }
        if ($l -match '^##\s*WINTOOL:END\s*$') { $bloc = ''; continue }
        if (-not $bloc -or $l -notmatch '^##\s*([A-Za-z_]+)\s*:\s*(.*)$') { continue }
        $cle = $Matches[1].ToLowerInvariant()
        $valeur = $Matches[2].Trim()
        if ($bloc -eq 'entete') {
            switch ($cle) {
                'id' { $id = $valeur }
                'version' { $versionScript = $valeur }
                'lang' { $langue = $valeur.ToLowerInvariant() }
                'title' { $titres['__entete'] = $valeur }
            }
        } elseif ($cle -eq 'title') {
            $titres[$bloc.Substring(5)] = $valeur
        }
    }
    if ($titres.Contains('__entete')) {
        $titreEntete = $titres['__entete']
        $titres.Remove('__entete')
        if (-not $titres.Contains($langue)) { $titres[$langue] = $titreEntete }
    }

    if (-not $id) { Echec 'Id absent' "$nom ne declare pas d'id : sans lui, une mise a jour ferait perdre sa configuration." }
    if ($ids.ContainsKey($id)) { Echec 'Id en double' "$nom et $($ids[$id]) declarent le meme id $id." }
    $ids[$id] = $nom

    $entrees += [ordered]@{
        id      = $id
        file    = $nom
        version = $versionScript
        size    = $octets.Length
        sha256  = $empreinte
        title   = $titres
    }
}

$index = [ordered]@{
    format    = 1
    source    = $Source
    version   = $Version
    published = $Publie
    tag       = $Tag
    scripts   = $entrees
}

$json = ($index | ConvertTo-Json -Depth 6) -replace "`r`n", "`n"
$cible = if ([IO.Path]::IsPathRooted($Sortie)) { $Sortie } else { Join-Path (Get-Location).Path $Sortie }
$cible = [IO.Path]::GetFullPath($cible)
[IO.File]::WriteAllText($cible, "$json`n", $utf8)

$empreinteIndex = -join ($sha.ComputeHash([IO.File]::ReadAllBytes($cible)) | ForEach-Object { $_.ToString('x2') })
Write-Host "::notice title=Index du catalogue::$($entrees.Count) scripts, version $Version, $Tag. SHA-256 de index.json : $empreinteIndex"
