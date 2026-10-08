## WINTOOL:START
## id            : 6c08ece0-709a-4210-aacb-eda594e8deee
## lang          : en
## title         : Free up disk space
## desc          : Removes temporary files, downloaded updates and browser caches
## category      : cleaning
## icon          : trash-2
## tags          : temp, cache, disk space, browsers
## version       : 1.0
## admin         : true
## risk          : low
## duration      : medium
## reversible    : false
## interruptible : true
## reboot        : false
## engine        : auto
## scan          : true
## view          : donut
## panels        : plan progress
## WINTOOL:END

## WINTOOL:OPTIONS
## Targets    : [multi] Temporary files
##   user     : [group:Junk] Your temporary files
##   windows  : [group:Junk] [show:expert] Windows temporary files
##   update   : [group:OldUpdates] Downloaded Windows updates
## RecycleBin : [bool] [group:Junk] Empty the recycle bin
## Browsers   : [items] [view:tree] Browser caches
## SafeTest   : [bool] Simulate — shows what would be done, changes nothing
## WINTOOL:END

## WINTOOL:REPORT
## Junk       : [group] Junk files — Temporary files and the recycle bin
## OldUpdates : [group] Old Windows updates — What Windows keeps after installing them
## Cache      : Cache
## FreeSpace  : Free space on drive C:
## UpdateNote : [note:warn] If an update is waiting to be installed, Windows will download it again.
## Untouched  : [note:info] Your passwords, bookmarks and history are not touched.
## WINTOOL:END

## WINTOOL:LANG fr
## title      : Faire de la place
## desc       : Supprime les fichiers temporaires, les mises à jour téléchargées et le cache des navigateurs
## Targets    : Fichiers temporaires
##   user     : Vos fichiers temporaires
##   windows  : Fichiers temporaires de Windows
##   update   : Mises à jour de Windows téléchargées
## RecycleBin : Vider la corbeille
## Browsers   : Cache des navigateurs
## SafeTest   : Simuler — montre ce qui serait fait, sans rien modifier
## Junk       : Fichiers inutiles — Fichiers temporaires et corbeille
## OldUpdates : Anciennes mises à jour de Windows — Ce que Windows garde après les avoir installées
## Cache      : Fichiers en cache
## FreeSpace  : Espace libre sur le disque C:
## UpdateNote : Si une mise à jour attend d'être installée, Windows la téléchargera de nouveau.
## Untouched  : Vos mots de passe, vos favoris et votre historique ne sont pas touchés.
## WINTOOL:END

# ==============================================================================
# Exemple de la norme d'analyse — PROPOSITION, pas encore la norme.
# Maquette : docs/mockups/analyse.html. Le validateur (tools/lint-scripts.ps1)
# ne connaît pas encore [items], [group:], [show:], [ITEM], [METRIC], [NOTE],
# [LOG] : il les signalera tant que la norme n'est pas écrite.
#
# Le script est lancé deux fois :
#   1. ANALYSE  — WinTool pose WINTOOL_MODE=scan. Le script mesure, décrit ce
#      qu'il a trouvé, et ne modifie RIEN.
#   2. ACTION   — WinTool relance le script sans WINTOOL_MODE, avec dans
#      WINTOOL_CONFIG ce que l'utilisateur a coché. Le script ne fait que ça.
#
# Seul, en double-clic, il agit avec ses valeurs par défaut ($CONFIG ci-dessous).
# ==============================================================================

$CONFIG = @{
    Targets    = @("user", "windows")
    RecycleBin = $false
    Browsers   = @()
    SafeTest   = $false
}
# Browsers est une liste [items] : ses éléments n'existent qu'après l'analyse.
# Sans WinTool, elle reste vide et le script ne touche à aucun navigateur.

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Ce que le script sait faire — utilisé par les deux passages
# ==============================================================================

$Folders = @{
    user    = $env:TEMP
    windows = Join-Path $env:SystemRoot 'Temp'
    update  = Join-Path $env:SystemRoot 'SoftwareDistribution\Download'
}

function Measure-Folder([string] $Path) {
    $m = Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
         Measure-Object -Property Length -Sum
    [pscustomobject]@{ Size = [long]$m.Sum; Count = [int]$m.Count }
}

function Get-RecycleBinItems {
    @((New-Object -ComObject Shell.Application).NameSpace(10).Items())
}

# Les caches de navigateurs. Chaque cache reçoit un Id STABLE, calculé à partir
# de ce qui ne bouge pas entre l'analyse et l'action : le navigateur et le profil.
# WinTool ne renverra que des Id ; c'est cette même fonction, rappelée à l'action,
# qui retrouvera les chemins. Un Id reçu ne sert jamais à fabriquer un chemin.
$Browsers = @(
    @{ Id = 'chrome';  Name = 'Google Chrome';   Process = 'chrome';  Cache = 'Cache';  Root = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data' }
    @{ Id = 'edge';    Name = 'Microsoft Edge';  Process = 'msedge';  Cache = 'Cache';  Root = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data' }
    @{ Id = 'brave';   Name = 'Brave';           Process = 'brave';   Cache = 'Cache';  Root = Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\User Data' }
    @{ Id = 'firefox'; Name = 'Mozilla Firefox'; Process = 'firefox'; Cache = 'cache2'; Root = Join-Path $env:LOCALAPPDATA 'Mozilla\Firefox\Profiles' }
)

function Get-BrowserCaches {
    foreach ($b in $Browsers) {
        if (-not (Test-Path -LiteralPath $b.Root)) { continue }
        $open = [bool](Get-Process -Name $b.Process -ErrorAction SilentlyContinue)
        foreach ($dir in Get-ChildItem -LiteralPath $b.Root -Directory -ErrorAction SilentlyContinue) {
            $path = Join-Path $dir.FullName $b.Cache
            if (-not (Test-Path -LiteralPath $path)) { continue }
            # Firefox préfixe ses profils d'un code (« me5fmut4.default-release ») :
            # on n'affiche que la fin. Un vrai script lirait le nom choisi par
            # l'utilisateur (Local State pour Chrome et Edge, profiles.ini pour Firefox).
            $shown = if ($b.Id -eq 'firefox') { ($dir.Name -split '\.', 2)[-1] } else { $dir.Name }
            [pscustomobject]@{
                Id      = "$($b.Id)-$($dir.Name -replace '[^\w.-]', '-')"
                Browser = $b
                Profile = $shown
                Path    = $path
                Open    = $open
            }
        }
    }
}

# ==============================================================================
# 1. ANALYSE — on mesure, on décrit, on ne modifie RIEN
# ==============================================================================
# Tout ce bloc est en lecture seule. WinTool ne peut pas le vérifier : c'est une
# promesse de l'auteur, et l'utilisateur coche sur la foi de ce qu'elle rapporte.
# Le script n'écrit jamais de phrase : des nombres, des noms, des jetons. Les
# mots viennent de l'entête (REPORT, LANG), déjà traduite.

if ($env:WINTOOL_MODE -eq 'scan') {

    # --- Des choix mesurés : une ligne [FIND] par choix de Targets ---
    Write-Output "[STEP] 1/3 Measuring temporary folders"
    foreach ($t in 'user', 'windows') {
        $m = Measure-Folder $Folders[$t]
        Write-Output "[FIND] Targets.$t size=$($m.Size) count=$($m.Count)"
    }

    # --- Une case simple, mesurée ---
    $bin = Get-RecycleBinItems
    $binSize = [long]($bin | Measure-Object -Property Size -Sum).Sum
    Write-Output "[FIND] RecycleBin size=$binSize count=$($bin.Count)"

    # --- Gros, mais peut encore servir : montré, PAS coché, avec sa note ---
    Write-Output "[STEP] 2/3 Measuring downloaded Windows updates"
    $m = Measure-Folder $Folders.update
    Write-Output "[FIND] Targets.update size=$($m.Size) count=$($m.Count) checked=false"
    Write-Output "[NOTE] UpdateNote Targets.update"

    # --- Une arborescence : un parent par navigateur, un enfant par profil ---
    Write-Output "[STEP] 3/3 Looking for browser caches"
    $seen = @{}
    foreach ($c in Get-BrowserCaches) {
        # Navigateur ouvert : visible, mais pas cochable, avec la raison.
        $lock = if ($c.Open) { ' locked=open' } else { '' }
        if (-not $seen[$c.Browser.Id]) {
            $seen[$c.Browser.Id] = $true
            Write-Output "[ITEM] Browsers id=$($c.Browser.Id) name=""$($c.Browser.Name)"" kind=browser$lock"
        }
        $m = Measure-Folder $c.Path
        # Un cache minuscule encombre le résumé d'un débutant : Expert seulement.
        # Il garde sa case, et suit celle de son navigateur.
        $show = if ($m.Size -lt 1MB) { ' show=expert' } else { '' }
        # label= dit ce que c'est (traduit), name= lequel : « Fichiers en cache — Default ».
        Write-Output "[ITEM] Browsers id=$($c.Id) parent=$($c.Browser.Id) kind=folder label=Cache name=""$($c.Profile)"" path=""$($c.Path)"" size=$($m.Size)$lock$show"
        # Une ligne de journal, rangée dans le canal « Browsers » (Expert seulement).
        Write-Output "[LOG] Browsers $($c.Browser.Name) / $($c.Profile): $($m.Count) files"
    }
    # Une note pour le débutant, inutile à l'Expert qui voit la liste exacte.
    Write-Output "[NOTE] Untouched Browsers show=simple"

    # --- Une mesure sans case : l'espace libre, pour situer le reste ---
    $drive = Get-PSDrive -Name C
    $pct = [math]::Round(100 * $drive.Free / ($drive.Used + $drive.Free))
    $health = if ($pct -lt 10) { 'crit' } elseif ($pct -lt 20) { 'warn' } else { 'ok' }
    Write-Output "[METRIC] FreeSpace value=$pct unit=pct health=$health max=100"

    exit 0
}

# ==============================================================================
# 2. ACTION — uniquement ce que l'utilisateur a coché
# ==============================================================================
# WinTool a posé dans WINTOOL_CONFIG, et l'override a versé dans $CONFIG :
#   Targets    = les choix cochés, par exemple @("user", "update")
#   RecycleBin = $true ou $false
#   Browsers   = les Id cochés, par exemple @("chrome-Default", "firefox-abcd.default")
# Une valeur reçue ne sert que de CLÉ dans les tables du script, et seulement si
# elle y figure : $Folders['inconnu'] vaut $null, et "$null\*" viserait la racine.

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$targets  = @($CONFIG.Targets | Where-Object { $Folders.ContainsKey("$_") })
$doBin    = ("$($CONFIG.RecycleBin)" -eq 'True')
$wanted   = @($CONFIG.Browsers | ForEach-Object { "$_" })
$caches   = @(Get-BrowserCaches | Where-Object { $wanted -contains $_.Id })
$total    = $targets.Count + [int]$doBin + [int]($caches.Count -gt 0)
$step     = 0
$freed    = [long]0

function Remove-FolderContent([string] $Path) {
    $n = [long]0
    foreach ($f in Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue) {
        if ($SafeTest) { $n += $f.Length; continue }
        try {
            Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
            $n += $f.Length
        } catch {
            # Fichier ouvert par un programme : on le laisse, c'est normal.
        }
    }
    $n
}

foreach ($t in $targets) {
    $step++
    Write-Output "[STEP] $step/$total Cleaning $t"
    $stopped = $false
    if ($t -eq 'update' -and -not $SafeTest) {
        # Windows Update garde ses fichiers ouverts : on l'arrête le temps du ménage.
        Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue
        $stopped = $true
    }
    $freed += Remove-FolderContent $Folders[$t]
    if ($stopped) { Start-Service -Name wuauserv -ErrorAction SilentlyContinue }
}

if ($doBin) {
    $step++
    Write-Output "[STEP] $step/$total Emptying the recycle bin"
    $freed += [long](Get-RecycleBinItems | Measure-Object -Property Size -Sum).Sum
    if (-not $SafeTest) { Clear-RecycleBin -Force -ErrorAction SilentlyContinue }
}

if ($caches.Count) {
    $step++
    Write-Output "[STEP] $step/$total Clearing browser caches"
    foreach ($c in $caches) {
        # Le navigateur a pu être ouvert depuis l'analyse : on revérifie.
        if (Get-Process -Name $c.Browser.Process -ErrorAction SilentlyContinue) {
            Write-Output "[WARN] $($c.Browser.Name) is open - cache left in place"
            continue
        }
        $freed += Remove-FolderContent $c.Path
        Write-Output "[LOG] Browsers Cleared $($c.Browser.Name) / $($c.Profile)"
    }
}

# Ce qui a vraiment été libéré : le bilan l'affiche, l'historique le garde.
Write-Output "[FREED] $freed"
Write-Output "[DONE] Disk space freed"
exit 0
