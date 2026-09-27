## WINTOOL:START
## id            : 0e87babc-b38e-4668-af4b-2168879f708f
## lang          : en
## title         : Disable fast startup
## desc          : Makes shutdown a real shutdown - fixes many update and driver issues
## category      : performance
## icon          : power
## tags          : fast startup, hiberboot, shutdown, boot
## version       : 2.0
## admin         : true
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Mode      : [select] Action — turn fast startup off or on
##   disable : Disable fast startup
##   enable  : Enable fast startup — the Windows default
## SafeTest  : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title     : Désactiver le démarrage rapide
## desc      : Fait de l'arrêt un vrai arrêt - corrige de nombreux problèmes de mises à jour et de pilotes
## Mode      : Action — désactiver ou activer le démarrage rapide
##   disable : Désactiver le démarrage rapide
##   enable  : Activer le démarrage rapide — le réglage de Windows
## SafeTest  : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode     = "disable"
    SafeTest = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# Le demarrage rapide (HiberbootEnabled) repose sur l'hibernation : si celle-ci
# est desactivee, il est deja inactif dans les faits. On l'indique sans echouer.
# Prise en compte au prochain arret, pas besoin de redemarrer.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$regPath  = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
$regName  = 'HiberbootEnabled'

if ($CONFIG.Mode -eq 'enable') { $wanted = 1; $label = 'enabled' } else { $wanted = 0; $label = 'disabled' }

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - the setting is read, nothing is changed" }

# --- 1/2 : etat actuel ------------------------------------------------------
Write-Host "[STEP] 1/2 Reading the current state"

$current = (Get-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue).$regName
if ($null -eq $current) {
    Write-Host "[INFO] Fast startup: not configured (Windows default = enabled)"
} elseif ([int]$current -eq 1) {
    Write-Host "[INFO] Fast startup: currently enabled"
} else {
    Write-Host "[INFO] Fast startup: currently disabled"
}

$hiberFile = Join-Path $env:SystemDrive 'hiberfil.sys'
if (-not (Test-Path -LiteralPath $hiberFile)) {
    Write-Host "[INFO] Hibernation is off - fast startup has no effect until it is turned back on"
}

# --- 2/2 : application ------------------------------------------------------
Write-Host "[STEP] 2/2 Setting fast startup to $label"

if ($null -ne $current -and [int]$current -eq $wanted) {
    Write-Host "[OK]   Already $label - nothing to change"
    Write-Host "[DONE] Fast startup already $label"
    exit 0
}

if ($SafeTest) {
    Write-Host "[INFO] SafeTest - would set $regName = $wanted"
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}

try {
    Set-ItemProperty -Path $regPath -Name $regName -Value $wanted -Type DWord -ErrorAction Stop
    Write-Host "[OK]   Fast startup $label - takes effect at the next shutdown"
} catch {
    Write-Host "[ERR]  Could not change the setting: $($_.Exception.Message)"
    Write-Host "[DONE] Finished with 1 error(s)"
    exit 1
}

Write-Host "[DONE] Fast startup $label"
exit 0
