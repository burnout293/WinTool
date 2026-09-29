## WINTOOL:START
## id            : b77f1dc0-a8b8-4fde-9d01-68c5b2258460
## lang          : en
## title         : Export browser data
## desc          : Saves your bookmarks and browser data into one package you can carry to another PC
## category      : tools
## icon          : upload
## tags          : browser, export, bookmarks, backup, migration, edge, chrome, firefox
## version       : 1.0
## admin         : false
## risk          : medium
## duration      : medium
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Browser      : [select] Source browser — the browser to export from
##   edge       : Microsoft Edge
##   chrome     : Google Chrome
##   brave      : Brave
##   opera      : Opera
##   firefox    : Mozilla Firefox
## ExportPath   : [string] Package file — full path of the .zip to create
## Items        : [multi]  What to export — bookmarks are always reliable, secrets are risky
##   bookmarks  : Bookmarks — reliable, also saved as a readable HTML file
##   history    : History — browsing and download history
##   cookies    : Cookies — you will stay signed in on the other PC (sensitive)
##   sitedata   : Site data — local storage kept by websites
##   permissions : Site permissions — camera, location and similar choices
##   passwords  : Saved passwords — SENSITIVE, raw encrypted store only
##   payments   : Payment methods — SENSITIVE, raw encrypted store only
##   addresses  : Addresses — raw encrypted store only
## SecretMode   : [select] How to handle secrets — passwords, payments, addresses
##   native     : Skip secrets — safest, only non-secret data is exported
##   raw        : Copy the encrypted store — only restores on the SAME Windows account
## Protection   : [select] Package protection
##   password   : Password — encrypts the package, the password is written in clear in the logs
##   keyfile    : Key file — encrypts using a file you provide, nothing secret in the logs
##   none       : None — the package is NOT encrypted
## Password     : [string] Package password — only for the password protection
## KeyFilePath  : [string] Key file — full path of the file used as the key
## SafeTest     : [bool]   Safe test — lists what would be exported without reading secrets
## WINTOOL:END

## WINTOOL:LANG fr
## title        : Exporter les données du navigateur
## desc         : Enregistre vos favoris et données de navigateur dans un paquet à emporter sur un autre PC
## Browser      : Navigateur source — le navigateur d'où exporter
##   edge       : Microsoft Edge
##   chrome     : Google Chrome
##   brave      : Brave
##   opera      : Opera
##   firefox    : Mozilla Firefox
## ExportPath   : Fichier du paquet — chemin complet du .zip à créer
## Items        : Quoi exporter — les favoris sont fiables, les secrets sont risqués
##   bookmarks  : Favoris — fiable, aussi enregistrés en fichier HTML lisible
##   history    : Historique — navigation et téléchargements
##   cookies    : Cookies — vous resterez connecté sur l'autre PC (sensible)
##   sitedata   : Données de sites — stockage local gardé par les sites
##   permissions : Autorisations de sites — caméra, localisation et autres choix
##   passwords  : Mots de passe enregistrés — SENSIBLE, copie brute chiffrée seulement
##   payments   : Moyens de paiement — SENSIBLE, copie brute chiffrée seulement
##   addresses  : Adresses — copie brute chiffrée seulement
## SecretMode   : Traitement des secrets — mots de passe, paiements, adresses
##   native     : Ignorer les secrets — le plus sûr, seules les données non secrètes partent
##   raw        : Copier la base chiffrée — ne se restaure que sur le MÊME compte Windows
## Protection   : Protection du paquet
##   password   : Mot de passe — chiffre le paquet, le mot de passe est écrit en clair dans les logs
##   keyfile    : Fichier clé — chiffre avec un fichier que vous fournissez, rien de secret dans les logs
##   none       : Aucune — le paquet n'est PAS chiffré
## Password     : Mot de passe du paquet — seulement pour la protection par mot de passe
## KeyFilePath  : Fichier clé — chemin complet du fichier utilisé comme clé
## SafeTest     : Test sans risque — liste ce qui serait exporté sans lire les secrets
## WINTOOL:END

$CONFIG = @{
    Browser     = "edge"
    ExportPath  = ""
    Items       = @("bookmarks", "history")
    SecretMode  = "native"
    Protection  = "password"
    Password    = ""
    KeyFilePath = ""
    SafeTest    = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# Approche fiable et sans dependance :
#   - non-secrets : copie des fichiers du profil (+ favoris Chromium -> HTML).
#   - secrets (mode raw) : copie des bases CHIFFREES telles quelles. Elles ne se
#     rechiffrent qu'avec DPAPI du meme compte Windows -> restauration same-PC.
#     Mode native : secrets ignores avec [WARN].
#   - paquet : ZIP simple, puis chiffrement AES-256 maison (PBKDF2) en .NET pur
#     si Protection = password/keyfile. Aucune dependance, marche en PS 5.1.
#
# Le CSV portable dechiffre (mots de passe lisibles partout) N'EST PAS fait ici :
# impossible proprement en PowerShell pur sans lecteur SQLite ni AES-GCM (5.1).
# A ameliorer plus tard (cf. decision projet).
#
# SafeTest : liste les fichiers qui partiraient, ne lit aucun secret, ne cree
# ni copie ni paquet.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$LOCAL    = $env:LOCALAPPDATA
$ROAM     = $env:APPDATA
$errors   = 0

$SECRET_ITEMS = @('passwords', 'payments', 'addresses')

# --- Definition des navigateurs et de leurs fichiers ------------------------
# Chaque item -> liste de chemins relatifs au profil (fichiers ou dossiers).
function Get-BrowserProfile {
    param([string] $Key)
    switch ($Key) {
        'edge'    { return @{ Kind = 'chromium'; Proc = 'msedge'; Root = (Join-Path $LOCAL 'Microsoft\Edge\User Data'); Profile = 'Default' } }
        'chrome'  { return @{ Kind = 'chromium'; Proc = 'chrome'; Root = (Join-Path $LOCAL 'Google\Chrome\User Data'); Profile = 'Default' } }
        'brave'   { return @{ Kind = 'chromium'; Proc = 'brave';  Root = (Join-Path $LOCAL 'BraveSoftware\Brave-Browser\User Data'); Profile = 'Default' } }
        'opera'   { return @{ Kind = 'chromium'; Proc = 'opera';  Root = (Join-Path $ROAM 'Opera Software\Opera Stable'); Profile = '.' } }
        'firefox' { return @{ Kind = 'firefox';  Proc = 'firefox'; Root = (Join-Path $ROAM 'Mozilla\Firefox\Profiles'); Profile = '' } }
        default   { return $null }
    }
}

# Renvoie les chemins ABSOLUS a exporter pour un item, dans le profil resolu.
function Get-ItemPaths {
    param($Def, [string] $ProfileDir, [string] $Item)
    $p = @()
    if ($Def.Kind -eq 'chromium') {
        switch ($Item) {
            'bookmarks'   { $p += (Join-Path $ProfileDir 'Bookmarks') }
            'history'     { $p += (Join-Path $ProfileDir 'History') }
            'cookies'     { $p += (Join-Path $ProfileDir 'Network\Cookies') }
            'sitedata'    { $p += (Join-Path $ProfileDir 'Local Storage'); $p += (Join-Path $ProfileDir 'IndexedDB') }
            'permissions' { $p += (Join-Path $ProfileDir 'Preferences') }
            'passwords'   { $p += (Join-Path $ProfileDir 'Login Data'); $p += (Join-Path $Def.Root 'Local State') }
            'payments'    { $p += (Join-Path $ProfileDir 'Web Data') }
            'addresses'   { $p += (Join-Path $ProfileDir 'Web Data') }
        }
    } else {
        switch ($Item) {
            'bookmarks'   { $p += (Join-Path $ProfileDir 'places.sqlite') }
            'history'     { $p += (Join-Path $ProfileDir 'places.sqlite') }
            'cookies'     { $p += (Join-Path $ProfileDir 'cookies.sqlite') }
            'sitedata'    { $p += (Join-Path $ProfileDir 'storage'); $p += (Join-Path $ProfileDir 'webappsstore.sqlite') }
            'permissions' { $p += (Join-Path $ProfileDir 'permissions.sqlite') }
            'passwords'   { $p += (Join-Path $ProfileDir 'logins.json'); $p += (Join-Path $ProfileDir 'key4.db') }
            'payments'    { $p += (Join-Path $ProfileDir 'autofill-profiles.json') }
            'addresses'   { $p += (Join-Path $ProfileDir 'autofill-profiles.json') }
        }
    }
    return @($p | Sort-Object -Unique)
}

# Resout le dossier de profil (Firefox : profil par defaut *.default*).
function Resolve-ProfileDir {
    param($Def)
    if ($Def.Kind -eq 'firefox') {
        if (-not (Test-Path -LiteralPath $Def.Root)) { return $null }
        $pd = Get-ChildItem -LiteralPath $Def.Root -Directory -Force -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -like '*.default-release' } | Select-Object -First 1
        if (-not $pd) { $pd = Get-ChildItem -LiteralPath $Def.Root -Directory -Force -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -like '*.default*' } | Select-Object -First 1 }
        if ($pd) { return $pd.FullName } else { return $null }
    }
    if ($Def.Profile -eq '.') { return $Def.Root }
    return (Join-Path $Def.Root $Def.Profile)
}

function Format-Size {
    param([long] $Bytes)
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    return ('{0:N0} KB' -f ($Bytes / 1KB))
}

# Rend un fichier Bookmarks (JSON Chromium) en HTML Netscape (favoris standard).
function Convert-BookmarksToHtml {
    param([string] $JsonPath, [string] $OutHtml)
    $json = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('<!DOCTYPE NETSCAPE-Bookmark-file-1>')
    [void]$sb.AppendLine('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">')
    [void]$sb.AppendLine('<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1><DL><p>')
    function Walk($node) {
        foreach ($c in $node.children) {
            if ($c.type -eq 'folder') {
                [void]$sb.AppendLine("<DT><H3>$([System.Web.HttpUtility]::HtmlEncode($c.name))</H3><DL><p>")
                Walk $c
                [void]$sb.AppendLine('</DL><p>')
            } elseif ($c.type -eq 'url') {
                [void]$sb.AppendLine("<DT><A HREF=""$($c.url)"">$([System.Web.HttpUtility]::HtmlEncode($c.name))</A>")
            }
        }
    }
    Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue
    foreach ($rootName in 'bookmark_bar','other','synced') {
        if ($json.roots.$rootName) { Walk $json.roots.$rootName }
    }
    [void]$sb.AppendLine('</DL><p>')
    Set-Content -LiteralPath $OutHtml -Value $sb.ToString() -Encoding UTF8
}

# Chiffre un fichier avec AES-256 (PBKDF2). Format : WTB1 | salt(16) | iv(16) | data.
function Protect-File {
    param([string] $InFile, [string] $OutFile, [string] $Pass)
    $salt = New-Object byte[] 16
    $iv   = New-Object byte[] 16
    $rng  = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($salt); $rng.GetBytes($iv)
    $kdf = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($Pass, $salt, 200000)
    $key = $kdf.GetBytes(32)
    $aes = [System.Security.Cryptography.Aes]::Create()
    $aes.KeySize = 256; $aes.Key = $key; $aes.IV = $iv
    $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'
    $plain = [System.IO.File]::ReadAllBytes($InFile)
    $enc   = $aes.CreateEncryptor().TransformFinalBlock($plain, 0, $plain.Length)
    $out   = [System.IO.File]::Create($OutFile)
    $out.Write([System.Text.Encoding]::ASCII.GetBytes('WTB1'), 0, 4)
    $out.Write($salt, 0, 16); $out.Write($iv, 0, 16); $out.Write($enc, 0, $enc.Length)
    $out.Close()
}

function Get-Passphrase {
    if ($CONFIG.Protection -eq 'keyfile') {
        if (-not (Test-Path -LiteralPath $CONFIG.KeyFilePath)) { return $null }
        return [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($CONFIG.KeyFilePath))
    }
    return "$($CONFIG.Password)"
}

# ==============================================================================

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - listing only, no secret is read and no package is created" }

$def = Get-BrowserProfile $CONFIG.Browser
if (-not $def) { Write-Host "[ERR]  Unknown browser '$($CONFIG.Browser)'"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1 }

if (-not "$($CONFIG.ExportPath)") { Write-Host "[ERR]  No package path given (ExportPath)"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1 }

# Protection : validation des entrees.
if ($CONFIG.Protection -eq 'password' -and -not "$($CONFIG.Password)") {
    Write-Host "[ERR]  Password protection selected but no password given"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1
}
if ($CONFIG.Protection -eq 'keyfile' -and -not (Test-Path -LiteralPath "$($CONFIG.KeyFilePath)")) {
    Write-Host "[ERR]  Key file not found: $($CONFIG.KeyFilePath)"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1
}
if ($CONFIG.Protection -eq 'password') {
    Write-Host "[WARN] The package password is written in clear text in the logs, as configured"
}
if ($CONFIG.Protection -eq 'none') {
    Write-Host "[WARN] The package will NOT be encrypted - anyone can open it"
}

# --- 1/4 : profil et navigateur ---------------------------------------------
Write-Host "[STEP] 1/4 Locating the browser profile"
$profileDir = Resolve-ProfileDir $def
if (-not $profileDir -or -not (Test-Path -LiteralPath $profileDir)) {
    Write-Host "[ERR]  Profile not found for $($CONFIG.Browser)"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1
}
Write-Host "[OK]   Profile: $profileDir"

if (@(Get-Process -Name $def.Proc -ErrorAction SilentlyContinue).Count -gt 0) {
    Write-Host "[ERR]  $($CONFIG.Browser) is open - close it and run again (its files are locked)"
    if (-not $SafeTest) { Write-Host "[DONE] Finished with 1 error(s)"; exit 1 }
}

# --- 2/4 : selection des elements -------------------------------------------
Write-Host "[STEP] 2/4 Collecting files"
$items = @($CONFIG.Items)
if ($items.Count -eq 0) { Write-Host "[WARN] Nothing selected"; Write-Host "[DONE] Nothing exported"; exit 0 }

$staging = Join-Path $env:TEMP ("wt-export-" + [guid]::NewGuid().ToString('N'))
$toCopy  = @()   # @{ Src; Rel }
$totalSize = [long]0

foreach ($item in $items) {
    $isSecret = ($SECRET_ITEMS -contains $item)
    if ($isSecret -and $CONFIG.SecretMode -eq 'native') {
        Write-Host "[WARN] '$item' skipped - needs SecretMode 'raw' (native mode does not export secrets)"
        continue
    }
    if ($isSecret) {
        Write-Host "[WARN] '$item' will be copied as an ENCRYPTED store - it only restores on the same Windows account"
    }
    $paths = Get-ItemPaths $def $profileDir $item
    $found = $false
    foreach ($src in $paths) {
        if (-not (Test-Path -LiteralPath $src)) { continue }
        $found = $true
        if ($src -like "$profileDir*") { $rel = $src.Substring($profileDir.Length).TrimStart('\', '/') }
        elseif ($src -like "$($def.Root)*") { $rel = $src.Substring($def.Root.Length).TrimStart('\', '/') }
        else { $rel = Split-Path $src -Leaf }
        $sz = 0
        if (Test-Path -LiteralPath $src -PathType Leaf) { $sz = (Get-Item -LiteralPath $src).Length }
        else { $sz = [long]((Get-ChildItem -LiteralPath $src -Recurse -File -Force -EA SilentlyContinue | Measure-Object Length -Sum).Sum) }
        $totalSize += $sz
        $toCopy += @{ Src = $src; Rel = $rel; Secret = $isSecret }
        Write-Host "[INFO]   $item : $rel ($(Format-Size $sz))"
    }
    if (-not $found) { Write-Host "[INFO] '$item' : nothing found in this profile" }
}

if ($toCopy.Count -eq 0) { Write-Host "[WARN] No file to export"; Write-Host "[DONE] Nothing exported"; exit 0 }

if ($SafeTest) {
    Write-Host "[INFO] SafeTest - $($toCopy.Count) item(s), about $(Format-Size $totalSize) would be exported to $($CONFIG.ExportPath)"
    Write-Host "[DONE] SafeTest finished - nothing was exported"
    exit 0
}

# --- 3/4 : construction du paquet -------------------------------------------
Write-Host "[STEP] 3/4 Building the package"
try {
    New-Item -ItemType Directory -Path $staging -Force -ErrorAction Stop | Out-Null
    foreach ($f in $toCopy) {
        $dest = Join-Path $staging $f.Rel
        New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force -ErrorAction SilentlyContinue | Out-Null
        Copy-Item -LiteralPath $f.Src -Destination $dest -Recurse -Force -ErrorAction Stop
    }
    # Favoris Chromium -> HTML lisible
    if ($def.Kind -eq 'chromium' -and ($items -contains 'bookmarks')) {
        $bm = Join-Path $profileDir 'Bookmarks'
        if (Test-Path -LiteralPath $bm) {
            try { Convert-BookmarksToHtml $bm (Join-Path $staging 'bookmarks.html'); Write-Host "[OK]   Bookmarks also saved as bookmarks.html" }
            catch { Write-Host "[WARN] Could not render bookmarks.html: $($_.Exception.Message)" }
        }
    }
    # Manifeste
    $manifest = @{ browser = $CONFIG.Browser; kind = $def.Kind; items = $items; secretMode = $CONFIG.SecretMode
                   protection = $CONFIG.Protection; created = (Get-Date).ToString('s'); tool = 'WinTool 620' }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding UTF8
    Write-Host "[OK]   $($toCopy.Count) item(s) staged"
} catch {
    Write-Host "[ERR]  Could not build the package: $($_.Exception.Message)"
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[DONE] Finished with 1 error(s)"; exit 1
}

Write-Host "[CKPT] Files staged - safe to interrupt from here"

# --- 4/4 : compression et protection ----------------------------------------
Write-Host "[STEP] 4/4 Writing $($CONFIG.ExportPath)"
$parent = Split-Path $CONFIG.ExportPath -Parent
if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force -ErrorAction SilentlyContinue | Out-Null }

try {
    if ($CONFIG.Protection -eq 'none') {
        if (Test-Path -LiteralPath $CONFIG.ExportPath) { Remove-Item -LiteralPath $CONFIG.ExportPath -Force }
        Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $CONFIG.ExportPath -Force -ErrorAction Stop
        Write-Host "[OK]   Unencrypted package written"
    } else {
        $tmpZip = "$staging.zip"
        Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $tmpZip -Force -ErrorAction Stop
        $pass = Get-Passphrase
        if (-not $pass) { throw "no passphrase available" }
        Protect-File $tmpZip $CONFIG.ExportPath $pass
        Remove-Item -LiteralPath $tmpZip -Force -ErrorAction SilentlyContinue
        Write-Host "[OK]   Encrypted package written (AES-256)"
    }
} catch {
    Write-Host "[ERR]  Could not write the package: $($_.Exception.Message)"; $errors++
} finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}

if ($errors -gt 0) { Write-Host "[DONE] Finished with $errors error(s)"; exit 1 }
Write-Host "[INFO] Keep this package safe - it contains personal browser data"
Write-Host "[DONE] Browser data exported"
exit 0
