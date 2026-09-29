## WINTOOL:START
## id            : af01f2a0-1bd9-4c0d-83e2-8bc2108a835c
## lang          : en
## title         : Import browser data
## desc          : Restores a browser package made by WinTool - your current profile is backed up first
## category      : tools
## icon          : download
## tags          : browser, import, restore, bookmarks, migration, edge, chrome, firefox
## version       : 1.0
## admin         : false
## risk          : high
## duration      : medium
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Browser      : [select] Destination browser — the browser to import into
##   edge       : Microsoft Edge
##   chrome     : Google Chrome
##   brave      : Brave
##   opera      : Opera
##   firefox    : Mozilla Firefox
## PackagePath  : [string] Package file — full path of the .zip made by the export
## Items        : [multi]  What to restore — pick one or more
##   bookmarks  : Bookmarks
##   history    : History
##   cookies    : Cookies
##   sitedata   : Site data
##   permissions : Site permissions
##   passwords  : Saved passwords — only works on the same Windows account
##   payments   : Payment methods — only works on the same Windows account
##   addresses  : Addresses — only works on the same Windows account
## Protection   : [select] Package protection — must match the export
##   password   : Password — the package password, written in clear in the logs
##   keyfile    : Key file — the file used at export time
##   none       : None — the package is not encrypted
## Password     : [string] Package password — only for the password protection
## KeyFilePath  : [string] Key file — full path of the key file
## SafeTest     : [bool]   Safe test — lists what would be restored, changes nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title        : Importer les données du navigateur
## desc         : Restaure un paquet créé par WinTool - votre profil actuel est sauvegardé d'abord
## Browser      : Navigateur de destination — le navigateur où importer
##   edge       : Microsoft Edge
##   chrome     : Google Chrome
##   brave      : Brave
##   opera      : Opera
##   firefox    : Mozilla Firefox
## PackagePath  : Fichier du paquet — chemin complet du .zip créé par l'export
## Items        : Quoi restaurer — un ou plusieurs éléments
##   bookmarks  : Favoris
##   history    : Historique
##   cookies    : Cookies
##   sitedata   : Données de sites
##   permissions : Autorisations de sites
##   passwords  : Mots de passe enregistrés — ne marche que sur le même compte Windows
##   payments   : Moyens de paiement — ne marche que sur le même compte Windows
##   addresses  : Adresses — ne marche que sur le même compte Windows
## Protection   : Protection du paquet — doit correspondre à l'export
##   password   : Mot de passe — le mot de passe du paquet, écrit en clair dans les logs
##   keyfile    : Fichier clé — le fichier utilisé à l'export
##   none       : Aucune — le paquet n'est pas chiffré
## Password     : Mot de passe du paquet — seulement pour la protection par mot de passe
## KeyFilePath  : Fichier clé — chemin complet du fichier clé
## SafeTest     : Test sans risque — liste ce qui serait restauré, ne change rien
## WINTOOL:END

$CONFIG = @{
    Browser     = "edge"
    PackagePath = ""
    Items       = @("bookmarks")
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
# Restaure les fichiers du paquet 620 dans le profil cible. AVANT toute ecriture,
# sauvegarde les fichiers qui seront ecrases dans un zip de restauration (chemin
# annonce). Navigateur cible ferme requis.
# Secrets (raw) : ne se dechiffrent qu'avec DPAPI du meme compte Windows.
# SafeTest : liste ce qui serait restaure, n'ecrit rien.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$LOCAL    = $env:LOCALAPPDATA
$ROAM     = $env:APPDATA
$errors   = 0
$SECRET_ITEMS = @('passwords', 'payments', 'addresses')

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

# Dechiffre un paquet WTB1 (AES-256 PBKDF2) vers un zip temporaire.
function Unprotect-File {
    param([string] $InFile, [string] $OutFile, [string] $Pass)
    $all = [System.IO.File]::ReadAllBytes($InFile)
    $magic = [System.Text.Encoding]::ASCII.GetString($all, 0, 4)
    if ($magic -ne 'WTB1') { throw "not a WinTool encrypted package" }
    $salt = $all[4..19]; $iv = $all[20..35]
    $data = $all[36..($all.Length - 1)]
    $kdf = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($Pass, $salt, 200000)
    $key = $kdf.GetBytes(32)
    $aes = [System.Security.Cryptography.Aes]::Create()
    $aes.KeySize = 256; $aes.Key = $key; $aes.IV = $iv; $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'
    $plain = $aes.CreateDecryptor().TransformFinalBlock($data, 0, $data.Length)
    [System.IO.File]::WriteAllBytes($OutFile, $plain)
}

function Get-Passphrase {
    if ($CONFIG.Protection -eq 'keyfile') {
        if (-not (Test-Path -LiteralPath $CONFIG.KeyFilePath)) { return $null }
        return [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($CONFIG.KeyFilePath))
    }
    return "$($CONFIG.Password)"
}

# Chemins relatifs (dans le profil) attendus par item, cote Chromium/Firefox.
function Get-ItemRelPaths {
    param([string] $Kind, [string] $Item)
    if ($Kind -eq 'chromium') {
        switch ($Item) {
            'bookmarks'   { return @('Bookmarks') }
            'history'     { return @('History') }
            'cookies'     { return @('Network\Cookies') }
            'sitedata'    { return @('Local Storage', 'IndexedDB') }
            'permissions' { return @('Preferences') }
            'passwords'   { return @('Login Data') }
            'payments'    { return @('Web Data') }
            'addresses'   { return @('Web Data') }
        }
    } else {
        switch ($Item) {
            'bookmarks'   { return @('places.sqlite') }
            'history'     { return @('places.sqlite') }
            'cookies'     { return @('cookies.sqlite') }
            'sitedata'    { return @('storage', 'webappsstore.sqlite') }
            'permissions' { return @('permissions.sqlite') }
            'passwords'   { return @('logins.json', 'key4.db') }
            'payments'    { return @('autofill-profiles.json') }
            'addresses'   { return @('autofill-profiles.json') }
        }
    }
    return @()
}

# ==============================================================================

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - listing only, nothing is written" }

$def = Get-BrowserProfile $CONFIG.Browser
if (-not $def) { Write-Host "[ERR]  Unknown browser '$($CONFIG.Browser)'"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1 }
if (-not (Test-Path -LiteralPath "$($CONFIG.PackagePath)")) {
    Write-Host "[ERR]  Package not found: $($CONFIG.PackagePath)"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1
}
if ($CONFIG.Protection -eq 'password') {
    if (-not "$($CONFIG.Password)") { Write-Host "[ERR]  Password protection selected but no password given"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1 }
    Write-Host "[WARN] The package password is written in clear text in the logs, as configured"
}

$profileDir = Resolve-ProfileDir $def
if (-not $profileDir) { Write-Host "[ERR]  Destination profile not found for $($CONFIG.Browser)"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1 }

if (@(Get-Process -Name $def.Proc -ErrorAction SilentlyContinue).Count -gt 0) {
    Write-Host "[ERR]  $($CONFIG.Browser) is open - close it and run again (its files are locked)"
    if (-not $SafeTest) { Write-Host "[DONE] Finished with 1 error(s)"; exit 1 }
}

# --- 1/4 : ouverture du paquet ----------------------------------------------
Write-Host "[STEP] 1/4 Opening the package"
$work = Join-Path $env:TEMP ("wt-import-" + [guid]::NewGuid().ToString('N'))
$expanded = Join-Path $work 'pkg'
try {
    New-Item -ItemType Directory -Path $expanded -Force -ErrorAction Stop | Out-Null
    if ($CONFIG.Protection -eq 'none') {
        Expand-Archive -LiteralPath $CONFIG.PackagePath -DestinationPath $expanded -Force -ErrorAction Stop
    } else {
        $pass = Get-Passphrase
        if (-not $pass) { throw "no passphrase / key file available" }
        $tmpZip = Join-Path $work 'pkg.zip'
        Unprotect-File $CONFIG.PackagePath $tmpZip $pass
        Expand-Archive -LiteralPath $tmpZip -DestinationPath $expanded -Force -ErrorAction Stop
    }
    Write-Host "[OK]   Package opened"
} catch {
    Write-Host "[ERR]  Could not open the package (wrong password/key, or corrupt file): $($_.Exception.Message)"
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[DONE] Finished with 1 error(s)"; exit 1
}

# Manifeste : coherence du navigateur.
$manifestPath = Join-Path $expanded 'manifest.json'
if (Test-Path -LiteralPath $manifestPath) {
    $mf = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($mf.kind -and $mf.kind -ne $def.Kind) {
        Write-Host "[WARN] The package comes from a $($mf.kind) browser but you import into $($def.Kind) - most items will not match"
    }
}

# --- 2/4 : ce qui va etre restaure ------------------------------------------
Write-Host "[STEP] 2/4 Planning the restore"
$items = @($CONFIG.Items)
$plan  = @()   # @{ Rel; Src }
foreach ($item in $items) {
    if (($SECRET_ITEMS -contains $item)) {
        Write-Host "[WARN] '$item' only restores on the same Windows account it was exported from"
    }
    foreach ($rel in (Get-ItemRelPaths $def.Kind $item)) {
        $src = Join-Path $expanded $rel
        if (Test-Path -LiteralPath $src) { $plan += @{ Rel = $rel; Src = $src } }
        else { Write-Host "[INFO] '$item' : '$rel' not in the package" }
    }
}
$plan = $plan | Sort-Object { $_.Rel } -Unique
if ($plan.Count -eq 0) { Write-Host "[WARN] Nothing to restore"; Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue; Write-Host "[DONE] Nothing restored"; exit 0 }
foreach ($p in $plan) { Write-Host "[INFO]   will restore: $($p.Rel)" }

if ($SafeTest) {
    Write-Host "[INFO] SafeTest - $($plan.Count) item(s) would be restored into $profileDir"
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}

# --- 3/4 : sauvegarde du profil cible ---------------------------------------
Write-Host "[STEP] 3/4 Backing up the current profile"
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$pkgDir  = Split-Path $CONFIG.PackagePath -Parent
if (-not $pkgDir) { $pkgDir = $env:TEMP }
$restore = Join-Path $pkgDir "wintool-restore-$($CONFIG.Browser)-$stamp.zip"
$bakStage = Join-Path $work 'backup'
try {
    New-Item -ItemType Directory -Path $bakStage -Force -ErrorAction Stop | Out-Null
    $any = $false
    foreach ($p in $plan) {
        $cur = Join-Path $profileDir $p.Rel
        if (Test-Path -LiteralPath $cur) {
            $dest = Join-Path $bakStage $p.Rel
            New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force -ErrorAction SilentlyContinue | Out-Null
            Copy-Item -LiteralPath $cur -Destination $dest -Recurse -Force -ErrorAction SilentlyContinue
            $any = $true
        }
    }
    if ($any) {
        Compress-Archive -Path (Join-Path $bakStage '*') -DestinationPath $restore -Force -ErrorAction Stop
        Write-Host "[OK]   Backup saved: $restore"
    } else {
        Write-Host "[INFO] Nothing to back up (target files do not exist yet)"
    }
} catch {
    Write-Host "[ERR]  Backup failed, restore aborted for safety: $($_.Exception.Message)"
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[DONE] Finished with 1 error(s)"; exit 1
}
Write-Host "[CKPT] Backup complete - safe to interrupt from here"

# --- 4/4 : restauration -----------------------------------------------------
Write-Host "[STEP] 4/4 Restoring"
foreach ($p in $plan) {
    $dest = Join-Path $profileDir $p.Rel
    try {
        New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force -ErrorAction SilentlyContinue | Out-Null
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue }
        Copy-Item -LiteralPath $p.Src -Destination $dest -Recurse -Force -ErrorAction Stop
        Write-Host "[OK]   Restored: $($p.Rel)"
    } catch {
        Write-Host "[ERR]  Could not restore $($p.Rel): $($_.Exception.Message)"; $errors++
    }
}

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue

if ($errors -gt 0) {
    Write-Host "[WARN] Some items failed - your original files are in the backup zip above"
    Write-Host "[DONE] Finished with $errors error(s)"; exit 1
}
Write-Host "[INFO] Start $($CONFIG.Browser) to check the result"
Write-Host "[DONE] Browser data imported"
exit 0
