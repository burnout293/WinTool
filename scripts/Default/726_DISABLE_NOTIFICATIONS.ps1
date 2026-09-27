## WINTOOL:START
## id            : 55021bbb-23bc-48a3-8cf1-462c08a82134
## lang          : en
## title         : Reduce notifications
## desc          : Turns off the notifications and tips Windows shows, one type at a time
## category      : customize
## icon          : bell-off
## tags          : notifications, toasts, tips, lock screen, banners
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
## Mode        : [select] Action — turn the checked items off or on
##   disable   : Turn the checked items off
##   enable    : Turn the checked items on — the Windows defaults
## Items       : [multi]  Which notifications to turn off — pick one or more
##   all       : All app notifications — the master notification switch
##   banners   : Banners and sounds — the pop-up toasts and their sound
##   lockscreen : Notifications on the lock screen
##   reminders : Reminders and incoming calls on the lock screen
##   tips      : Tips and suggestions about Windows
##   welcome   : Welcome and "what's new" after updates
##   suggested : Suggested content in the notification settings
## SafeTest    : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title       : Réduire les notifications
## desc        : Désactive les notifications et astuces que Windows affiche, type par type
## Mode        : Action — désactiver ou activer les éléments cochés
##   disable   : Désactiver les éléments cochés
##   enable    : Activer les éléments cochés — les réglages de Windows
## Items       : Quelles notifications désactiver — une ou plusieurs
##   all       : Toutes les notifications d'applications — l'interrupteur principal
##   banners   : Bannières et sons — les pop-ups et leur son
##   lockscreen : Notifications sur l'écran de verrouillage
##   reminders : Rappels et appels entrants sur l'écran de verrouillage
##   tips      : Astuces et suggestions sur Windows
##   welcome   : Bienvenue et « nouveautés » après les mises à jour
##   suggested : Contenu suggéré dans les réglages de notifications
## SafeTest    : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode     = "disable"
    Items    = @("banners", "tips", "welcome", "suggested")
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
# Reglages du compte courant (HKCU). Chaque element = valeurs DWORD {Off, Default}.
# "all" est l'interrupteur maitre (ToastEnabled) ; les autres ciblent un type
# precis, tous decochables independamment (pas d'interrupteur maitre impose).
# SafeTest : les valeurs sont lues, rien n'est ecrit.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Disable  = ($CONFIG.Mode -ne 'enable')
$errors   = 0

$push = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications'
$noti = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
$cdm  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'

$Definitions = @{
    all        = @{ Label = 'All app notifications'; Values = @(
        @{ Path = $push; Name = 'ToastEnabled'; Off = 0; Default = 1 }
    ) }
    banners    = @{ Label = 'Banners and sounds'; Values = @(
        @{ Path = $noti; Name = 'NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK'; Off = 0; Default = 1 },
        @{ Path = $noti; Name = 'NOC_GLOBAL_SETTING_ALLOW_CRITICAL_TOASTS_ABOVE_LOCK'; Off = 0; Default = 1 }
    ) }
    lockscreen = @{ Label = 'Lock screen notifications'; Values = @(
        @{ Path = $push; Name = 'LockScreenToastEnabled'; Off = 0; Default = 1 }
    ) }
    reminders  = @{ Label = 'Reminders and calls on lock screen'; Values = @(
        @{ Path = $noti; Name = 'NOC_GLOBAL_SETTING_ALLOW_NOTIFICATION_SOUND'; Off = 0; Default = 1 }
    ) }
    tips       = @{ Label = 'Tips and suggestions'; Values = @(
        @{ Path = $cdm; Name = 'SubscribedContent-338389Enabled'; Off = 0; Default = 1 }
    ) }
    welcome    = @{ Label = 'Welcome and what''s new'; Values = @(
        @{ Path = $cdm; Name = 'SubscribedContent-310093Enabled'; Off = 0; Default = 1 }
    ) }
    suggested  = @{ Label = 'Suggested content'; Values = @(
        @{ Path = $cdm; Name = 'SubscribedContent-338393Enabled'; Off = 0; Default = 1 }
    ) }
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

    foreach ($v in $def.Values) {
        if ($Disable) { $wanted = $v.Off } else { $wanted = $v.Default }
        $current = (Get-ItemProperty -Path $v.Path -Name $v.Name -ErrorAction SilentlyContinue).($v.Name)
        if ($null -ne $current -and [int]$current -eq $wanted) { Write-Host "[OK]   $($v.Name) already $wanted"; continue }
        if ($SafeTest) { Write-Host "[INFO] SafeTest - would set $($v.Name) = $wanted (currently $(if ($null -eq $current) { 'not set' } else { $current }))"; continue }
        try {
            if (-not (Test-Path $v.Path)) { New-Item -Path $v.Path -Force -ErrorAction Stop | Out-Null }
            Set-ItemProperty -Path $v.Path -Name $v.Name -Value $wanted -Type DWord -ErrorAction Stop
            Write-Host "[OK]   $($v.Name) = $wanted"
        } catch { Write-Host "[ERR]  $($v.Name): $($_.Exception.Message)"; $errors++ }
    }
}

if ($SafeTest) {
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}
if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}
Write-Host "[DONE] Notifications updated"
exit 0
