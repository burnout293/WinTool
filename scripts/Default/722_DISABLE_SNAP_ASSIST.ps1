## WINTOOL:START
## id            : f58c6f58-da60-4281-a03b-775e0b3c86d5
## lang          : en
## title         : Control window snapping
## desc          : Turns off the snap suggestions and layouts that appear when you move or resize windows
## category      : customize
## icon          : layout-grid
## tags          : snap, snap assist, layouts, windows, docking
## version       : 1.0
## admin         : false
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Mode            : [select] Action — turn the checked items off or on
##   disable       : Turn the checked items off
##   enable        : Turn the checked items on — the Windows defaults
## Items           : [multi]  What to turn off — pick one or more
##   assist        : Snap suggestions — the other-windows picker shown after you snap one
##   flyout        : Snap layouts flyout — the grid shown when hovering the maximize button
##   bar           : Snap bar — the layout bar at the top of the screen when dragging
##   fill          : Auto-fill — suggesting to fill the remaining space
##   jointresize   : Joint resize — resizing two snapped windows together
##   allsnap       : All snapping — turns off window snapping entirely
## RestartExplorer : [bool]   Apply immediately — restarts the Explorer so changes show at once
## SafeTest        : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title           : Maîtriser l'ancrage des fenêtres
## desc            : Désactive les suggestions et dispositions d'ancrage qui apparaissent en déplaçant ou redimensionnant les fenêtres
## Mode            : Action — désactiver ou activer les éléments cochés
##   disable       : Désactiver les éléments cochés
##   enable         : Activer les éléments cochés — les réglages de Windows
## Items           : Quoi désactiver — un ou plusieurs éléments
##   assist        : Suggestions d'ancrage — le sélecteur d'autres fenêtres après un ancrage
##   flyout        : Menu des dispositions — la grille au survol du bouton agrandir
##   bar           : Barre d'ancrage — la barre de dispositions en haut de l'écran au glisser
##   fill          : Remplissage auto — la proposition de remplir l'espace restant
##   jointresize   : Redimensionnement conjoint — redimensionner deux fenêtres ancrées ensemble
##   allsnap       : Tout l'ancrage — désactive complètement l'ancrage des fenêtres
## RestartExplorer : Appliquer tout de suite — redémarre l'Explorateur pour un effet immédiat
## SafeTest        : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode            = "disable"
    Items           = @("assist", "flyout", "bar")
    RestartExplorer = $true
    SafeTest        = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# La plupart des reglages sont des DWORD sous Explorer\Advanced (0 = off, 1 = on).
# "allsnap" est un REG_SZ "WindowArrangementActive" sous Control Panel\Desktop.
# "disable" -> Off, "enable" -> Default. SafeTest : lecture seule.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Disable  = ($CONFIG.Mode -ne 'enable')
$errors   = 0
$changed  = $false

$adv = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
$dsk = 'HKCU:\Control Panel\Desktop'

$Definitions = @{
    assist      = @{ Label = 'Snap suggestions'; Path = $adv; Name = 'SnapAssist';             Type = 'DWord';  Off = 0;   Default = 1 }
    flyout      = @{ Label = 'Snap layouts flyout'; Path = $adv; Name = 'EnableSnapAssistFlyout'; Type = 'DWord';  Off = 0;   Default = 1 }
    bar         = @{ Label = 'Snap bar'; Path = $adv; Name = 'EnableSnapBar';                   Type = 'DWord';  Off = 0;   Default = 1 }
    fill        = @{ Label = 'Auto-fill'; Path = $adv; Name = 'SnapFill';                       Type = 'DWord';  Off = 0;   Default = 1 }
    jointresize = @{ Label = 'Joint resize'; Path = $adv; Name = 'JointResize';                 Type = 'DWord';  Off = 0;   Default = 1 }
    allsnap     = @{ Label = 'All snapping'; Path = $dsk; Name = 'WindowArrangementActive';     Type = 'String'; Off = '0'; Default = '1' }
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - settings are read, nothing is changed" }

$items = @($CONFIG.Items)
if ($items.Count -eq 0) {
    Write-Host "[WARN] Nothing selected - nothing to do"
    Write-Host "[DONE] Nothing changed"
    exit 0
}

$step  = 0
$total = $items.Count
foreach ($key in $items) {
    $step++
    $def = $Definitions[$key]
    if (-not $def) {
        Write-Host "[STEP] $step/$total Unknown item '$key'"
        Write-Host "[WARN] Unknown item '$key' - skipped"
        continue
    }
    Write-Host "[STEP] $step/$total $($def.Label)"

    if ($Disable) { $wanted = $def.Off } else { $wanted = $def.Default }
    $current = (Get-ItemProperty -Path $def.Path -Name $def.Name -ErrorAction SilentlyContinue).($def.Name)

    if ($null -ne $current -and "$current" -eq "$wanted") { Write-Host "[OK]   $($def.Name) already $wanted"; continue }
    if ($SafeTest) { Write-Host "[INFO] SafeTest - would set $($def.Name) = $wanted (currently $(if ($null -eq $current) { 'not set' } else { $current }))"; continue }
    try {
        if (-not (Test-Path $def.Path)) { New-Item -Path $def.Path -Force -ErrorAction Stop | Out-Null }
        Set-ItemProperty -Path $def.Path -Name $def.Name -Value $wanted -Type $def.Type -ErrorAction Stop
        Write-Host "[OK]   $($def.Name) = $wanted"; $changed = $true
    } catch { Write-Host "[ERR]  $($def.Name): $($_.Exception.Message)"; $errors++ }
}

if ($CONFIG.RestartExplorer -and $changed -and -not $SafeTest) {
    Write-Host "[INFO] Restarting Explorer to apply the changes"
    Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }
} elseif ($SafeTest -and $CONFIG.RestartExplorer) {
    Write-Host "[INFO] SafeTest - would restart Explorer to apply the changes"
}

if ($SafeTest) {
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}
if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}
Write-Host "[DONE] Window snapping updated"
exit 0
