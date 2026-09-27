## WINTOOL:START
## id            : b6da96ca-070c-44b5-83e0-4a0cfcf764d5
## lang          : en
## title         : Bring back the simple volume bar
## desc          : Replaces the large modern media panel with the old, discreet volume bar
## category      : customize
## icon          : monitor
## tags          : volume, media, flyout, mtc, osd
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
## Mode            : [select] Action — which volume indicator to use
##   disable       : Use the old simple volume bar
##   enable        : Use the modern media panel — the Windows default
## RestartExplorer : [bool]   Apply immediately — restarts the Explorer so the change shows at once
## SafeTest        : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title           : Revenir au volume simple
## desc            : Remplace le gros panneau média moderne par l'ancien bandeau de volume discret
## Mode            : Action — quel indicateur de volume utiliser
##   disable       : Utiliser l'ancien bandeau de volume simple
##   enable        : Utiliser le panneau média moderne — le défaut de Windows
## RestartExplorer : Appliquer tout de suite — redémarre l'Explorateur pour un effet immédiat
## SafeTest        : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode            = "disable"
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
# EnableMtcUvc (DWORD) sous ...\MTCUVC : 0 = ancien bandeau simple, 1 = panneau
# media moderne. "disable" (bandeau simple) = 0. Reglage compte courant (HKCU).
# Fonctionne surtout sur Windows 10 et les premieres versions de Windows 11.
# SafeTest : lecture seule.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Simple   = ($CONFIG.Mode -ne 'enable')
$path     = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\MTCUVC'

if ($Simple) { $wanted = 0 } else { $wanted = 1 }

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - the setting is read, nothing is changed" }

Write-Host "[STEP] 1/2 Volume indicator"
$current = (Get-ItemProperty -Path $path -Name 'EnableMtcUvc' -ErrorAction SilentlyContinue).EnableMtcUvc

if ($null -ne $current -and [int]$current -eq $wanted) {
    Write-Host "[OK]   Already set as requested (EnableMtcUvc = $wanted)"
} elseif ($SafeTest) {
    Write-Host "[INFO] SafeTest - would set EnableMtcUvc = $wanted (currently $(if ($null -eq $current) { 'not set' } else { $current }))"
} else {
    try {
        if (-not (Test-Path $path)) { New-Item -Path $path -Force -ErrorAction Stop | Out-Null }
        Set-ItemProperty -Path $path -Name 'EnableMtcUvc' -Value $wanted -Type DWord -ErrorAction Stop
        if ($Simple) { Write-Host "[OK]   Old simple volume bar enabled" } else { Write-Host "[OK]   Modern media panel restored" }
    } catch { Write-Host "[ERR]  $($_.Exception.Message)"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1 }
}

Write-Host "[STEP] 2/2 Applying"
if ($SafeTest) {
    if ($CONFIG.RestartExplorer) { Write-Host "[INFO] SafeTest - would restart Explorer" }
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}
if ($CONFIG.RestartExplorer) {
    Write-Host "[INFO] Restarting Explorer"
    Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }
} else {
    Write-Host "[INFO] Sign out and back in for the change to take effect"
}
Write-Host "[DONE] Volume indicator updated"
exit 0
