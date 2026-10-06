<#
  Génère la clé de signature des mises à jour SANS qu'aucun mot de passe ne soit
  jamais tapé ni collé dans un terminal.

  Pourquoi ce script existe : la publication de la 1.1.0 a échoué cinq fois, dont
  deux sur « Wrong password for that key » avec deux clés différentes. Le seul
  geste commun aux deux essais était la saisie du mot de passe à l'invite
  masquée de `tauri signer generate`. Coller dans une invite masquée n'est pas
  fiable : selon le terminal, le collage est ignoré, ou entouré de caractères
  invisibles (marqueurs de « collage entre crochets »). La clé est alors
  chiffrée avec autre chose que ce que contient le gestionnaire de mots de passe.

  Ici le mot de passe est tiré au hasard par le script, transmis directement à
  la génération, vérifié, puis remis par le presse-papiers pour être collé dans
  KeePass et dans GitHub — deux endroits où un collage est fiable.

  Usage, depuis la racine du dépôt :
    powershell -NoProfile -File tools\generer-cle-signature.ps1
    powershell -NoProfile -File tools\generer-cle-signature.ps1 -Cible catalogue

  Deux clés distinctes, jamais la même :
    mises-a-jour  signe les installeurs de WinTool. Clé publique dans
                  src-tauri/tauri.conf.json (plugins.updater.pubkey).
    catalogue     signe l'index du catalogue officiel de scripts. Clé publique
                  dans src-tauri/catalogue.pub, compilée dans l'application.
  Si l'une fuitait, elle ne signerait que son propre domaine : une clé de
  catalogue compromise ne fabrique pas de fausse mise à jour, et inversement.

  ATTENTION : écrase la clé existante. Une clé déjà utilisée pour publier ne doit
  être remplacée qu'en connaissance de cause : chaque installation existante
  refuserait les versions signées par la nouvelle (§11.2 de la spécification).
#>
param(
    [ValidateSet('mises-a-jour', 'catalogue')]
    [string] $Cible = 'mises-a-jour',
    [string] $Fichier,
    [string] $Config = 'src-tauri/tauri.conf.json',
    [string] $ClePublique = 'src-tauri/catalogue.pub',
    # Pour les essais seulement : ne touche pas au presse-papiers.
    [switch] $SansPressePapiers
)

$catalogue = $Cible -eq 'catalogue'
if (-not $Fichier) {
    $nom = if ($catalogue) { 'wintool-catalogue.key' } else { 'wintool.key' }
    $Fichier = Join-Path (Join-Path $env:USERPROFILE '.tauri') $nom
}
$depot = if ($catalogue) { 'WinTool-Catalogue' } else { 'WinTool' }

function Arret([string] $Message) {
    Write-Host ''
    Write-Host "ÉCHEC : $Message" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $Config)) {
    Arret "$Config introuvable. Lancez ce script depuis la racine du dépôt WinTool."
}

# --- 1. Un mot de passe tiré au hasard ------------------------------------------
# Lettres et chiffres uniquement, sans les caractères qui se confondent à l'œil
# (0/O, 1/l/I) : 57 symboles, 32 caractères, environ 186 bits. Tirage par
# rejet, pour que chaque symbole ait exactement la même probabilité.
$alphabet = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
$limite = 256 - (256 % $alphabet.Length)
$hasard = [Security.Cryptography.RandomNumberGenerator]::Create()
$octet = New-Object byte[] 1
$mdp = -join (1..32 | ForEach-Object {
    do { $hasard.GetBytes($octet) } while ($octet[0] -ge $limite)
    $alphabet[$octet[0] % $alphabet.Length]
})

# --- 2. La clé -------------------------------------------------------------------
Write-Host 'Génération de la clé…'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Fichier) | Out-Null
$ancienne = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& npx tauri signer generate --ci -f -p $mdp -w $Fichier 2>&1 | Out-Null
$code = $LASTEXITCODE
$ErrorActionPreference = $ancienne
if ($code -ne 0 -or -not (Test-Path -LiteralPath "$Fichier.pub")) {
    Arret 'la génération de la clé a échoué.'
}

# --- 3. La clé publique dans la configuration ------------------------------------
# Remplacement textuel de l'ancienne valeur : ConvertTo-Json reformaterait tout le
# fichier. Écrit en UTF-8 sans BOM, comme le reste du dépôt.
$pub = (Get-Content -LiteralPath "$Fichier.pub" -Raw).Trim()
if ($catalogue) {
    # Un fichier a lui seul : la cle publique, rien d'autre.
    $dossierPub = Split-Path -Parent ([IO.Path]::GetFullPath($ClePublique))
    New-Item -ItemType Directory -Force -Path $dossierPub | Out-Null
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($ClePublique), "$pub`n", (New-Object Text.UTF8Encoding $false))
    $destination = $ClePublique
} else {
    $texte = [IO.File]::ReadAllText((Resolve-Path $Config).Path)
    $avant = ($texte | ConvertFrom-Json).plugins.updater.pubkey
    if ([string]::IsNullOrWhiteSpace($avant)) {
        Arret "$Config ne déclare pas plugins.updater.pubkey."
    }
    $texte = $texte.Replace($avant, $pub)
    [IO.File]::WriteAllText((Resolve-Path $Config).Path, $texte, (New-Object Text.UTF8Encoding $false))
    $destination = $Config
}

# --- 4. Vérification complète, avant que rien ne quitte la machine ----------------
Write-Host 'Vérification de la paire clé / mot de passe…'
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $Fichier -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $mdp
$verificateur = Join-Path $PSScriptRoot 'verifier-cle-signature.ps1'
$verdict = if ($catalogue) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $verificateur -ClePublique $ClePublique 2>&1 | Out-String
} else {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $verificateur -Config $Config 2>&1 | Out-String
}
$codeVerif = $LASTEXITCODE
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
if ($codeVerif -ne 0) {
    Arret "la vérification a échoué :`n$($verdict.Trim())"
}
$identifiant = if ($verdict -match 'cle ([0-9A-F]{16})') { $Matches[1] } else { '?' }
Write-Host "Clé $identifiant générée et vérifiée. $destination est à jour." -ForegroundColor Green

# --- 5. Remise par le presse-papiers ---------------------------------------------
if ($SansPressePapiers) {
    Write-Host '(essai : presse-papiers non utilisé)'
    exit 0
}

$secrets = "https://github.com/burnout293/$depot/settings/secrets/actions"
Write-Host ''
Write-Host "Ouvrez la page des secrets : $secrets"
Write-Host ''

Set-Clipboard -Value $mdp
Write-Host '1/2  Le MOT DE PASSE est dans le presse-papiers. Collez-le (Ctrl+V) :' -ForegroundColor Cyan
Write-Host '       - dans KeePass, dans une nouvelle entrée'
Write-Host '       - dans GitHub : crayon de TAURI_SIGNING_PRIVATE_KEY_PASSWORD, puis Update secret'
[void](Read-Host '     Entrée quand les deux sont faits')

Set-Clipboard -Value (Get-Content -LiteralPath $Fichier -Raw).Trim()
Write-Host '2/2  La CLÉ PRIVÉE est dans le presse-papiers. Collez-la (Ctrl+V) :' -ForegroundColor Cyan
Write-Host '       - dans KeePass, dans la même entrée'
Write-Host '       - dans GitHub : crayon de TAURI_SIGNING_PRIVATE_KEY, puis Update secret'
[void](Read-Host '     Entrée quand les deux sont faits')

# Le presse-papiers ne garde pas le secret au-delà du nécessaire.
Set-Clipboard -Value ' '
Write-Host ''
Write-Host 'Presse-papiers vidé.' -ForegroundColor Green
Write-Host "Si l'historique du presse-papiers de Windows est activé (Win+V), effacez-le : il a pu en garder une copie."
Write-Host "Dans GitHub, la colonne « Last updated » des DEUX secrets doit maintenant indiquer quelques minutes."
exit 0
