<#
  Verifie, AVANT de construire une release, que les secrets de signature des
  mises a jour sont presents, bien formes, et qu'ils correspondent a la cle
  publique compilee dans l'application. En CI, transmet ensuite aux etapes
  suivantes une version NETTOYEE de ces secrets.

  Pourquoi un script a part : une release signee avec une autre cle que celle
  de tauri.conf.json serait refusee par CHAQUE installation existante, et un
  secret mal colle fait echouer la construction au bout de dix minutes, avec
  pour seul message "exit code 1". Ici chaque echec dit sa cause.

  Chaque echec est publie en annotation GitHub (::error::). Les annotations
  d'un depot public se lisent par l'API sans compte : le diagnostic ne depend
  plus de quelqu'un qui fouille le journal d'execution.

  Usage en CI : variables TAURI_SIGNING_PRIVATE_KEY et
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD tirees des secrets du depot. Les valeurs
  nettoyees sont ecrites dans GITHUB_ENV : l'etape de construction doit donc
  les lire de la, et NE PAS reprendre les secrets bruts dans son propre env.
  Usage local, pour verifier une cle AVANT de la confier a GitHub, depuis la
  racine du depot :
    powershell -NoProfile -File tools\verifier-cle-signature.ps1 -FichierCle "$env:USERPROFILE\.tauri\wintool.key"
  Le mot de passe est alors demande en saisie masquee. Lance ainsi, dans un
  processus a part, rien ne survit dans la session : ni la cle, ni le mot de
  passe.
#>
param(
    [string] $Config = 'src-tauri/tauri.conf.json',
    # Usage local : le fichier de cle privee, plutot que la variable.
    [string] $FichierCle
)

if ($FichierCle) {
    if (-not (Test-Path -LiteralPath $FichierCle)) {
        Write-Host "::error title=Fichier introuvable::$FichierCle n'existe pas."
        exit 1
    }
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $FichierCle -Raw
}

# En local seulement, un mot de passe absent se demande, en saisie masquee. En
# CI, jamais : un secret manquant doit faire echouer, pas attendre une saisie.
if ($env:GITHUB_ACTIONS -ne 'true' -and [string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
    $saisie = Read-Host 'Mot de passe de la cle (saisie masquee, collez-le)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($saisie)
    try {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

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

# --- 2. Nettoyage --------------------------------------------------------------
# La cle est du base64 : un espace ou un saut de ligne n'y a jamais de sens. Un
# copier-coller depuis le Bloc-notes en ajoute presque toujours un a la fin, et
# tauri le refuse ("Invalid symbol 10"). On les retire tous, et on le dit.
# Le mot de passe, lui, peut contenir des espaces : on ne retire que les sauts
# de ligne finaux, qu'aucun mot de passe ne contient volontairement.
$clePropre = $cle -replace '\s', ''
if ($clePropre -ne $cle) {
    Write-Host "::notice title=Cle nettoyee::TAURI_SIGNING_PRIVATE_KEY contenait des sauts de ligne ou des espaces (copier-coller) ; ils ont ete retires. Aucune action necessaire."
}
$mdpPropre = $mdp.TrimEnd("`r", "`n")
if ($mdpPropre -ne $mdp) {
    Write-Host "::notice title=Mot de passe nettoye::TAURI_SIGNING_PRIVATE_KEY_PASSWORD se terminait par un saut de ligne ; il a ete retire. Aucune action necessaire."
}
$cle = $clePropre
$mdp = $mdpPropre
# L'essai de signature ci-dessous doit voir exactement ce que verra la construction.
$env:TAURI_SIGNING_PRIVATE_KEY = $cle
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $mdp

# --- 3. Forme ------------------------------------------------------------------
try {
    $texte = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($cle))
} catch {
    Echec 'Cle illisible' "TAURI_SIGNING_PRIVATE_KEY n'est pas un texte base64 valide, meme une fois les blancs retires : le contenu de wintool.key a probablement ete coupe."
}
$entete = ($texte -split "`r?`n")[0]
if ($entete -match 'public key') {
    Echec 'Mauvaise cle' "TAURI_SIGNING_PRIVATE_KEY contient la cle PUBLIQUE (wintool.key.pub). Il faut y coller le contenu de wintool.key, le fichier SANS .pub."
}
if ($entete -notmatch 'secret key') {
    Echec 'Cle inattendue' "TAURI_SIGNING_PRIVATE_KEY ne ressemble pas a une cle de signature Tauri (entete lue : '$entete')."
}

# --- 4. Le mot de passe ouvre-t-il la cle ? -------------------------------------
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
    $detail = $sortie -split "`r?`n" | Where-Object { $_ -match 'incorrect|wrong|invalid|error|failed' } | Select-Object -First 1
    if (-not $detail) { $detail = ($sortie.Trim() -replace "`r?`n", ' ') }
    $detail = $detail.Trim()
    # Le titre se deduit de la cause, pas du seul fait que la signature a
    # echoue : la premiere version de ce script annoncait "mot de passe refuse"
    # pour une cle mal collee.
    if ($detail -match 'password') {
        Echec 'Mot de passe refuse' "Le mot de passe de TAURI_SIGNING_PRIVATE_KEY_PASSWORD n'ouvre pas cette cle. Detail : $detail"
    }
    if ($detail -match 'base64|decode') {
        Echec 'Cle illisible' "TAURI_SIGNING_PRIVATE_KEY ne se decode pas : le contenu de wintool.key a probablement ete coupe ou altere. Detail : $detail"
    }
    Echec 'Signature impossible' "La cle n'a pas pu signer un fichier d'essai. Detail : $detail"
}

# --- 5. La cle privee est-elle celle de l'application ? -------------------------
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

# --- 6. Transmission aux etapes suivantes (CI seulement) ------------------------
# Les valeurs nettoyees remplacent les secrets bruts pour la suite du job. On les
# masque d'abord, pour qu'aucune trace ne les affiche, puis on les ecrit avec la
# syntaxe a delimiteur de GITHUB_ENV, sure meme pour un mot de passe contenant
# un signe egal.
if ($env:GITHUB_ENV) {
    Write-Host "::add-mask::$cle"
    Write-Host "::add-mask::$mdp"
    $delim = 'FIN_' + [guid]::NewGuid().ToString('N')
    Add-Content -LiteralPath $env:GITHUB_ENV -Value @(
        "TAURI_SIGNING_PRIVATE_KEY<<$delim", $cle, $delim,
        "TAURI_SIGNING_PRIVATE_KEY_PASSWORD<<$delim", $mdp, $delim
    )
}

Write-Host "Secrets de signature valides : cle $idPrivee, conforme a $Config."
exit 0
