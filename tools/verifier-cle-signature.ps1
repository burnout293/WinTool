<#
  Verifie, AVANT de construire une release, que les secrets de signature des
  mises a jour sont presents, bien formes, et qu'ils correspondent a la cle
  publique compilee dans l'application.

  Pourquoi un script a part : une release signee avec une autre cle que celle
  de tauri.conf.json serait refusee par CHAQUE installation existante, et un
  secret mal colle fait echouer la construction au bout de dix minutes, avec
  pour seul message "exit code 1". Ici chaque echec dit sa cause.

  Chaque echec est publie en annotation GitHub (::error::). Les annotations
  d'un depot public se lisent par l'API sans compte : le diagnostic ne depend
  plus de quelqu'un qui fouille le journal d'execution.

  Usage en CI : variables TAURI_SIGNING_PRIVATE_KEY et
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD tirees des secrets du depot.
  Usage local : memes variables, depuis la racine du depot.
#>
param([string] $Config = 'src-tauri/tauri.conf.json')

function Echec([string] $Titre, [string] $Message) {
    Write-Host "::error title=$Titre::$Message"
    exit 1
}

# Une cle ou une signature Tauri est un texte base64 qui, decode, contient un
# texte minisign : une ligne de commentaire, puis le blob en base64. Dans le
# blob, 2 octets d'algorithme puis les 8 octets de l'identifiant de cle, que
# minisign affiche a l'envers, en hexadecimal.
function Get-IdentifiantCle([string] $Base64) {
    $texte = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Base64.Trim()))
    $blob  = [Convert]::FromBase64String((($texte -split "`r?`n")[1]).Trim())
    $id    = $blob[2..9]
    [array]::Reverse($id)
    return ([BitConverter]::ToString($id) -replace '-', '')
}

$cle = $env:TAURI_SIGNING_PRIVATE_KEY
$mdp = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD

# --- 1. Presence ---------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($cle)) {
    Echec 'Secret manquant' "TAURI_SIGNING_PRIVATE_KEY est absent ou vide. Il se cree dans Settings > Secrets and variables > Actions > onglet Secrets > Repository secrets."
}
if ([string]::IsNullOrEmpty($mdp)) {
    Echec 'Secret manquant' "TAURI_SIGNING_PRIVATE_KEY_PASSWORD est absent ou vide. La cle de WinTool est protegee par un mot de passe : sans lui, elle ne s'ouvre pas."
}

# --- 2. Forme ------------------------------------------------------------------
try {
    $texte = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($cle.Trim()))
} catch {
    Echec 'Cle illisible' "TAURI_SIGNING_PRIVATE_KEY n'est pas un texte base64 valide : le contenu de wintool.key a probablement ete coupe ou mal colle."
}
$entete = ($texte -split "`r?`n")[0]
if ($entete -match 'public key') {
    Echec 'Mauvaise cle' "TAURI_SIGNING_PRIVATE_KEY contient la cle PUBLIQUE (wintool.key.pub). Il faut y coller le contenu de wintool.key, le fichier SANS .pub."
}
if ($entete -notmatch 'secret key') {
    Echec 'Cle inattendue' "TAURI_SIGNING_PRIVATE_KEY ne ressemble pas a une cle de signature Tauri (entete lue : '$entete')."
}

# --- 3. Le mot de passe ouvre-t-il la cle ? -------------------------------------
# On signe un fichier d'essai. tauri lit la cle et le mot de passe dans les
# variables d'environnement : ils ne passent jamais sur une ligne de commande.
$essai = Join-Path ([IO.Path]::GetTempPath()) 'wintool-essai-signature.txt'
Set-Content -LiteralPath $essai -Value 'WinTool' -Encoding Ascii
Remove-Item -LiteralPath "$essai.sig" -ErrorAction SilentlyContinue

$ancienne = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$sortie = & npx tauri signer sign $essai 2>&1 | Out-String
$code = $LASTEXITCODE
$ErrorActionPreference = $ancienne

if ($code -ne 0 -or -not (Test-Path -LiteralPath "$essai.sig")) {
    # La sortie melange un avertissement sans rapport ("Signing without an
    # app version") et, selon la version de PowerShell, le bruit d'une
    # NativeCommandError. Seule la ligne qui porte la cause est gardee.
    $detail = $sortie -split "`r?`n" | Where-Object { $_ -match 'incorrect|wrong|invalid|error' } | Select-Object -First 1
    if (-not $detail) { $detail = ($sortie.Trim() -replace "`r?`n", ' ') }
    $detail = $detail.Trim()
    Echec 'Mot de passe refuse' "La cle n'a pas pu signer un fichier d'essai : TAURI_SIGNING_PRIVATE_KEY_PASSWORD ne correspond probablement pas a cette cle. Detail : $detail"
}

# --- 4. La cle privee est-elle celle de l'application ? -------------------------
$idPrivee = Get-IdentifiantCle (Get-Content -LiteralPath "$essai.sig" -Raw)
Remove-Item -LiteralPath $essai, "$essai.sig" -ErrorAction SilentlyContinue

$pub = (Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json).plugins.updater.pubkey
if ([string]::IsNullOrWhiteSpace($pub)) {
    Echec 'Cle publique absente' "$Config ne declare pas plugins.updater.pubkey : l'application ne saurait verifier aucune mise a jour."
}
$idPublique = Get-IdentifiantCle $pub

if ($idPrivee -ne $idPublique) {
    Echec 'Cles differentes' "La cle privee des secrets ($idPrivee) n'est pas celle dont la cle publique est compilee dans l'application ($idPublique). Chaque installation refuserait cette release. Le secret doit contenir la cle generee AVEC cette cle publique."
}

Write-Host "Secrets de signature valides : cle $idPrivee, conforme a $Config."
exit 0
