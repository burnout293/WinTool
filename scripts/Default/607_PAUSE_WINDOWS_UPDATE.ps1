## WINTOOL:START
## id            : 7dd0f2a8-ccf3-47c4-a139-89cc8dd31a53
## lang          : en
## title         : Pause Windows updates
## desc          : Pauses Windows updates for as long as you want - can go beyond the official 35-day limit
## category      : tools
## icon          : calendar-clock
## tags          : windows update, pause, defer, updates
## version       : 1.0
## admin         : true
## risk          : medium
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Duration    : [select] How long to pause — resume, a fixed time, or indefinitely
##   resume    : Resume now — cancel the pause and any keep-alive task
##   d7        : 7 days
##   d14       : 14 days
##   d35       : 35 days — the official Windows maximum
##   m2        : 2 months — kept alive past the official limit
##   m6        : 6 months — kept alive past the official limit
##   m12       : 12 months — kept alive past the official limit
##   infinite  : Indefinitely — renewed every day until you resume
## SafeTest    : [bool] Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title       : Mettre en pause les mises à jour
## desc        : Met les mises à jour de Windows en pause aussi longtemps que voulu - peut dépasser la limite officielle de 35 jours
## Duration    : Durée de la pause — reprendre, une durée fixe, ou indéfiniment
##   resume    : Reprendre maintenant — annule la pause et la tâche de maintien
##   d7        : 7 jours
##   d14       : 14 jours
##   d35       : 35 jours — le maximum officiel de Windows
##   m2        : 2 mois — maintenu au-delà de la limite officielle
##   m6        : 6 mois — maintenu au-delà de la limite officielle
##   m12       : 12 mois — maintenu au-delà de la limite officielle
##   infinite  : Indéfiniment — renouvelé chaque jour jusqu'à ce que vous repreniez
## SafeTest    : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Duration = "d35"
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
# Windows plafonne la pause a 35 jours. Pour aller au-dela, on "filoute" : on
# pose une pause de 35 jours ET on cree une tache planifiee quotidienne qui
# re-decale la fenetre (+35 j a partir d'aujourd'hui) tant que la date cible
# n'est pas atteinte. Pour "infinite", il n'y a pas de date cible : la tache
# renouvelle sans fin jusqu'a "resume".
#
# ATTENTION honnetete : cette limite "infinie" n'est pas garantie. Une grosse
# mise a jour de Windows, une strategie d'entreprise ou un changement Microsoft
# peut supprimer la tache ou ignorer la pause. On l'annonce au user.
#
# Etat conserve dans HKLM:\SOFTWARE\WinTool\UpdatePause (marqueur "PauseUntil").
# SafeTest : tout est seulement annonce, rien n'est ecrit ni planifie.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$UX       = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
$MARK     = 'HKLM:\SOFTWARE\WinTool\UpdatePause'
$TASK     = 'WinTool-KeepUpdatesPaused'

function Get-IsoDate { param([datetime] $D) return $D.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") }

# Ecrit une fenetre de pause start..end dans le registre Windows Update.
function Write-PauseWindow {
    param([datetime] $Start, [datetime] $End)
    $s = Get-IsoDate $Start
    $e = Get-IsoDate $End
    if (-not (Test-Path $UX)) { New-Item -Path $UX -Force -ErrorAction Stop | Out-Null }
    Set-ItemProperty -Path $UX -Name 'PauseUpdatesStartTime'        -Value $s -Type String
    Set-ItemProperty -Path $UX -Name 'PauseUpdatesExpiryTime'       -Value $e -Type String
    Set-ItemProperty -Path $UX -Name 'PauseFeatureUpdatesStartTime' -Value $s -Type String
    Set-ItemProperty -Path $UX -Name 'PauseFeatureUpdatesEndTime'   -Value $e -Type String
    Set-ItemProperty -Path $UX -Name 'PauseQualityUpdatesStartTime' -Value $s -Type String
    Set-ItemProperty -Path $UX -Name 'PauseQualityUpdatesEndTime'   -Value $e -Type String
}

function Clear-PauseWindow {
    foreach ($n in 'PauseUpdatesStartTime','PauseUpdatesExpiryTime','PauseFeatureUpdatesStartTime',
                   'PauseFeatureUpdatesEndTime','PauseQualityUpdatesStartTime','PauseQualityUpdatesEndTime') {
        Remove-ItemProperty -Path $UX -Name $n -ErrorAction SilentlyContinue
    }
}

# Tache quotidienne : re-applique une pause de 35 j, ou reprend si la cible est
# atteinte. La commande est inline (aucun fichier d'aide depose).
function Register-KeepAliveTask {
    $cmd = @'
$UX="HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings";$M="HKLM:\SOFTWARE\WinTool\UpdatePause";
$t=(Get-ItemProperty -Path $M -Name PauseUntil -EA SilentlyContinue).PauseUntil;
$now=Get-Date;$stop=$false;
if($t -and $t -ne "infinite"){ try{ if($now -gt [datetime]::Parse($t)){$stop=$true} }catch{} }
if($stop){ foreach($n in "PauseUpdatesStartTime","PauseUpdatesExpiryTime","PauseFeatureUpdatesStartTime","PauseFeatureUpdatesEndTime","PauseQualityUpdatesStartTime","PauseQualityUpdatesEndTime"){Remove-ItemProperty -Path $UX -Name $n -EA SilentlyContinue}; Unregister-ScheduledTask -TaskName "WinTool-KeepUpdatesPaused" -Confirm:$false -EA SilentlyContinue; exit }
$s=$now.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ");$e=$now.AddDays(35).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ");
Set-ItemProperty -Path $UX -Name PauseUpdatesStartTime -Value $s;Set-ItemProperty -Path $UX -Name PauseUpdatesExpiryTime -Value $e;
Set-ItemProperty -Path $UX -Name PauseFeatureUpdatesStartTime -Value $s;Set-ItemProperty -Path $UX -Name PauseFeatureUpdatesEndTime -Value $e;
Set-ItemProperty -Path $UX -Name PauseQualityUpdatesStartTime -Value $s;Set-ItemProperty -Path $UX -Name PauseQualityUpdatesEndTime -Value $e;
'@
    $bytes   = [System.Text.Encoding]::Unicode.GetBytes($cmd)
    $encoded = [Convert]::ToBase64String($bytes)
    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $encoded"
    $trigger1 = New-ScheduledTaskTrigger -Daily -At 9am
    $trigger2 = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName $TASK -Action $action -Trigger @($trigger1, $trigger2) `
        -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
}

function Unregister-KeepAliveTask {
    Unregister-ScheduledTask -TaskName $TASK -Confirm:$false -ErrorAction SilentlyContinue
}

# --- Resolution de la duree choisie -----------------------------------------
$durations = @{ d7 = 7; d14 = 14; d35 = 35; m2 = 60; m6 = 182; m12 = 365 }
$choice    = "$($CONFIG.Duration)"

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - nothing is paused, scheduled or written" }

# --- RESUME -----------------------------------------------------------------
if ($choice -eq 'resume') {
    Write-Host "[STEP] 1/2 Removing the keep-alive task"
    if ($SafeTest) { Write-Host "[INFO] SafeTest - would remove task $TASK" } else { Unregister-KeepAliveTask; Write-Host "[OK]   Keep-alive task removed" }

    Write-Host "[STEP] 2/2 Resuming updates"
    if ($SafeTest) {
        Write-Host "[INFO] SafeTest - would clear the pause and resume updates"
        Write-Host "[DONE] SafeTest finished - nothing was changed"
        exit 0
    }
    if (Test-Path $UX) { Clear-PauseWindow }
    Remove-Item -Path $MARK -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[OK]   Updates resumed"
    Write-Host "[DONE] Windows updates resumed"
    exit 0
}

if (-not $durations.ContainsKey($choice) -and $choice -ne 'infinite') {
    Write-Host "[ERR]  Unknown duration '$choice'"
    Write-Host "[DONE] Finished with 1 error(s)"
    exit 1
}

$now      = Get-Date
$infinite = ($choice -eq 'infinite')
$beyond   = $infinite -or ($durations[$choice] -gt 35)

# --- 1/3 : pause immediate --------------------------------------------------
Write-Host "[STEP] 1/3 Pausing updates"
$windowEnd = if ($beyond) { $now.AddDays(35) } else { $now.AddDays($durations[$choice]) }

if ($SafeTest) {
    Write-Host "[INFO] SafeTest - would pause updates until $(Get-IsoDate $windowEnd)"
} else {
    Write-PauseWindow -Start $now -End $windowEnd
    Write-Host "[OK]   Updates paused until $(Get-IsoDate $windowEnd)"
}

# --- 2/3 : cible et maintien ------------------------------------------------
Write-Host "[STEP] 2/3 Keep-alive"
if ($beyond) {
    if ($infinite) { $target = 'infinite'; $human = 'indefinitely' }
    else           { $target = Get-IsoDate $now.AddDays($durations[$choice]); $human = "$($durations[$choice]) days" }

    Write-Host "[WARN] This goes past the official 35-day limit ($human). Windows keeps a hidden 35-day cap,"
    Write-Host "[WARN] so a daily task will renew the pause. A major Windows update may still remove it - not guaranteed."

    if ($SafeTest) {
        Write-Host "[INFO] SafeTest - would set target '$target' and create the daily task $TASK"
    } else {
        if (-not (Test-Path $MARK)) { New-Item -Path $MARK -Force -ErrorAction SilentlyContinue | Out-Null }
        Set-ItemProperty -Path $MARK -Name 'PauseUntil' -Value $target -Type String
        try {
            Register-KeepAliveTask
            Write-Host "[OK]   Daily keep-alive task created ($TASK)"
        } catch {
            Write-Host "[ERR]  Could not create the keep-alive task: $($_.Exception.Message)"
            Write-Host "[WARN] The pause is still set, but only for 35 days"
        }
    }
} else {
    Write-Host "[INFO] Within the official limit - no keep-alive task needed"
    if (-not $SafeTest) { Unregister-KeepAliveTask; Remove-Item -Path $MARK -Recurse -Force -ErrorAction SilentlyContinue }
}

# --- 3/3 : bilan ------------------------------------------------------------
Write-Host "[STEP] 3/3 Done"
if ($SafeTest) {
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}
Write-Host "[INFO] Open Settings > Windows Update to see the pause"
Write-Host "[DONE] Windows updates paused"
exit 0
