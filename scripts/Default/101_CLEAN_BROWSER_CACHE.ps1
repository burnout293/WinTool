## WINTOOL:START
## id            : 79649b36-5fc6-41e8-8c9a-47a344461e0f
## lang          : en
## title         : Clear browser data
## desc          : Frees space and cleans browsing data - bookmarks and saved passwords are never touched
## category      : cleaning
## icon          : globe
## tags          : browser, cache, cookies, history, edge, chrome, firefox, brave, opera
## version       : 3.0
## admin         : false
## risk          : medium
## duration      : fast
## reversible    : false
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Browsers      : [multi]  Browsers — pick one or more
##   edge        : Microsoft Edge
##   chrome      : Google Chrome
##   firefox     : Mozilla Firefox
##   brave       : Brave
##   opera       : Opera
## Items         : [multi]  What to clear — bookmarks and passwords are never included
##   cache       : Cache — temporary web files, always safe to clear
##   cookies     : Cookies — you will be signed out of websites
##   history     : History — browsing and download history (not Firefox, see note)
##   sitedata    : Site data — local storage and databases kept by websites
## CloseBrowsers : [bool]   Close open browsers — required to clear anything, an open browser is skipped otherwise
## SafeTest      : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title         : Nettoyer les données des navigateurs
## desc          : Libère de la place et nettoie les données de navigation - vos favoris et mots de passe ne sont jamais touchés
## Browsers      : Navigateurs — un ou plusieurs
##   edge        : Microsoft Edge
##   chrome      : Google Chrome
##   firefox     : Mozilla Firefox
##   brave       : Brave
##   opera       : Opera
## Items         : Quoi nettoyer — les favoris et mots de passe ne sont jamais inclus
##   cache       : Cache — fichiers web temporaires, toujours sans risque
##   cookies     : Cookies — vous serez déconnecté des sites
##   history     : Historique — navigation et téléchargements (pas Firefox, voir la note)
##   sitedata    : Données de sites — stockage local et bases gardées par les sites
## CloseBrowsers : Fermer les navigateurs ouverts — nécessaire pour nettoyer, sinon un navigateur ouvert est ignoré
## SafeTest      : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Browsers      = @("edge", "chrome", "firefox", "brave", "opera")
    Items         = @("cache")
    CloseBrowsers = $false
    SafeTest      = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# JAMAIS de favoris ni de mots de passe : on ne touche ni "Bookmarks",
# ni "Login Data", ni "key4.db"/"logins.json".
#
# Historique navigation + telechargements = fusionnes : sous Chromium ils vivent
# dans le meme fichier "History". Sous Firefox, ils vivent dans places.sqlite,
# QUI CONTIENT AUSSI LES FAVORIS : l'historique Firefox est donc volontairement
# ignore (WARN), pour ne jamais risquer d'effacer un favori.
#
# Tout element autre que le cache exige un navigateur ferme : ces fichiers sont
# verrouilles a chaud. Un navigateur ouvert est ignore sauf si CloseBrowsers.
# SafeTest : tout est mesure (lecture seule), rien n'est ferme ni supprime.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')

$LOCAL = $env:LOCALAPPDATA
$ROAM  = $env:APPDATA

# Dossiers de cache Chromium relatifs a la racine d'un profil.
$ChromiumCache = @('Cache', 'Code Cache', 'GPUCache', 'Service Worker\CacheStorage', 'Service Worker\ScriptCache')

$BrowserDefs = @{
    edge    = @{ Name = 'Microsoft Edge';  Process = 'msedge'; Kind = 'chromium'; Root = (Join-Path $LOCAL 'Microsoft\Edge\User Data') }
    chrome  = @{ Name = 'Google Chrome';   Process = 'chrome'; Kind = 'chromium'; Root = (Join-Path $LOCAL 'Google\Chrome\User Data') }
    brave   = @{ Name = 'Brave';           Process = 'brave';  Kind = 'chromium'; Root = (Join-Path $LOCAL 'BraveSoftware\Brave-Browser\User Data') }
    opera   = @{ Name = 'Opera';           Process = 'opera';  Kind = 'opera';    Root = (Join-Path $ROAM 'Opera Software\Opera Stable') }
    firefox = @{ Name = 'Mozilla Firefox'; Process = 'firefox'; Kind = 'firefox'; Root = (Join-Path $ROAM 'Mozilla\Firefox\Profiles'); CacheRoot = (Join-Path $LOCAL 'Mozilla\Firefox\Profiles') }
}

function Format-Size {
    param([long] $Bytes)
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    return ('{0:N0} KB' -f ($Bytes / 1KB))
}

# Profils Chromium : Default, Profile N, Guest Profile.
function Get-ChromiumProfiles {
    param([string] $Root)
    if (-not (Test-Path -LiteralPath $Root)) { return @() }
    return @(Get-ChildItem -LiteralPath $Root -Directory -Force -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' -or $_.Name -eq 'Guest Profile' } |
             ForEach-Object { $_.FullName })
}

# Renvoie la liste des chemins (fichiers ou dossiers) a supprimer pour un
# navigateur et un element donnes. Rien pour un couple non pris en charge.
function Get-Targets {
    param($Def, [string] $Item)
    $paths = @()

    switch ($Def.Kind) {
        { $_ -in 'chromium', 'opera' } {
            if ($Def.Kind -eq 'opera') { $profiles = @($Def.Root) } else { $profiles = Get-ChromiumProfiles $Def.Root }
            foreach ($p in $profiles) {
                switch ($Item) {
                    'cache' {
                        foreach ($c in $ChromiumCache) { $paths += (Join-Path $p $c) }
                        if ($Def.Kind -eq 'chromium') {
                            $paths += (Join-Path $Def.Root 'ShaderCache')
                            $paths += (Join-Path $Def.Root 'GrShaderCache')
                        }
                    }
                    'cookies'  { $paths += (Join-Path $p 'Network\Cookies'); $paths += (Join-Path $p 'Network\Cookies-journal') }
                    'history'  { $paths += (Join-Path $p 'History'); $paths += (Join-Path $p 'History-journal'); $paths += (Join-Path $p 'Top Sites') }
                    'sitedata' { $paths += (Join-Path $p 'Local Storage'); $paths += (Join-Path $p 'Session Storage'); $paths += (Join-Path $p 'IndexedDB') }
                }
            }
        }
        'firefox' {
            # Historique Firefox non pris en charge : places.sqlite porte aussi les favoris.
            if ($Item -eq 'history') { return @('__FIREFOX_HISTORY__') }
            $dataProfiles = @()
            if (Test-Path -LiteralPath $Def.Root) {
                $dataProfiles = @(Get-ChildItem -LiteralPath $Def.Root -Directory -Force -ErrorAction SilentlyContinue)
            }
            foreach ($p in $dataProfiles) {
                switch ($Item) {
                    'cache' {
                        $cacheProfile = Join-Path $Def.CacheRoot $p.Name
                        foreach ($c in @('cache2', 'startupCache', 'thumbnails')) { $paths += (Join-Path $cacheProfile $c) }
                    }
                    'cookies'  { foreach ($f in @('cookies.sqlite', 'cookies.sqlite-wal', 'cookies.sqlite-shm')) { $paths += (Join-Path $p.FullName $f) } }
                    'sitedata' { $paths += (Join-Path $p.FullName 'storage\default'); $paths += (Join-Path $p.FullName 'webappsstore.sqlite') }
                }
            }
        }
    }
    return @($paths | Where-Object { $_ -eq '__FIREFOX_HISTORY__' -or (Test-Path -LiteralPath $_) })
}

# Supprime un chemin (fichier ou dossier). Renvoie les octets liberes ; en
# SafeTest, la taille qui le serait.
function Remove-Target {
    param([string] $Path)
    $size = [long]0
    if (Test-Path -LiteralPath $Path -PathType Container) {
        $size = [long]((Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
                        Measure-Object -Property Length -Sum).Sum)
    } elseif (Test-Path -LiteralPath $Path) {
        $size = [long]((Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue).Length)
    }
    if ($SafeTest) { return $size }

    try {
        if (Test-Path -LiteralPath $Path -PathType Container) {
            # Videe le contenu, garde le dossier (recree par le navigateur).
            Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue |
                Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        } else {
            Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
        }
        return $size
    } catch {
        return [long]0
    }
}

# ==============================================================================

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - data is measured, nothing is closed or deleted" }

$browsers = @($CONFIG.Browsers)
$items    = @($CONFIG.Items)
if ($browsers.Count -eq 0 -or $items.Count -eq 0) {
    Write-Host "[WARN] Select at least one browser and one item - nothing to do"
    Write-Host "[DONE] Nothing cleaned"
    exit 0
}

$freed = [long]0
$step  = 0
$total = $browsers.Count
foreach ($key in $browsers) {
    $step++
    $def = $BrowserDefs[$key]
    if (-not $def) {
        Write-Host "[STEP] $step/$total Unknown browser '$key'"
        Write-Host "[WARN] Unknown browser '$key' - skipped"
        continue
    }
    Write-Host "[STEP] $step/$total $($def.Name)"

    if (-not (Test-Path -LiteralPath $def.Root)) {
        Write-Host "[INFO] Not installed - skipped"
        continue
    }

    # Verrouillage : un navigateur ouvert empeche toute suppression fiable.
    $running = @(Get-Process -Name $def.Process -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        if (-not $CONFIG.CloseBrowsers) {
            Write-Host "[WARN] $($def.Name) is open - skipped (enable 'Close open browsers' to include it)"
            continue
        }
        if ($SafeTest) {
            Write-Host "[INFO] SafeTest - would close $($def.Name) ($($running.Count) process(es))"
        } else {
            Write-Host "[INFO] Closing $($def.Name)"
            $running | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
    }

    $browserFreed = [long]0
    foreach ($item in $items) {
        $targets = Get-Targets $def $item
        if ($targets -contains '__FIREFOX_HISTORY__') {
            Write-Host "[WARN] History is not cleared on Firefox - it shares a file with your bookmarks, which are protected"
            continue
        }
        if ($targets.Count -eq 0) { continue }

        $itemFreed = [long]0
        foreach ($t in $targets) { $itemFreed += Remove-Target $t }
        $browserFreed += $itemFreed

        if ($SafeTest) {
            Write-Host "[INFO] SafeTest - $item : would free $(Format-Size $itemFreed)"
        } else {
            Write-Host "[OK]   $item cleared ($(Format-Size $itemFreed))"
        }
    }

    $freed += $browserFreed
    if (-not $SafeTest) { Write-Host "[OK]   $($def.Name): $(Format-Size $browserFreed) freed in total" }
}

if ($SafeTest) {
    Write-Host "[INFO] SafeTest - about $(Format-Size $freed) could be freed"
    Write-Host "[DONE] SafeTest finished - nothing was deleted"
    exit 0
}
Write-Host "[INFO] Total freed: $(Format-Size $freed)"
Write-Host "[DONE] Browser data cleaned"
exit 0
