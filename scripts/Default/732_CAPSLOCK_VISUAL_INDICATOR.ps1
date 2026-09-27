## WINTOOL:START
## id            : 0271c99f-f54c-44bd-b4b4-030008be2f62
## lang          : en
## title         : Caps Lock indicator
## desc          : Shows when Caps Lock is on - a sound, an on-screen badge, or a small third-party app
## category      : customize
## icon          : keyboard
## tags          : caps lock, num lock, indicator, osd, toggle keys, accessibility
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
## Mode        : [select] Action — set the indicator up or remove it
##   enable    : Set up the indicator
##   disable   : Remove the indicator
## Method      : [select] How to show it — Windows has no built-in on-screen light
##   sound     : Beep — native Windows sound on Caps / Num / Scroll Lock, nothing installed
##   resident  : On-screen badge — a small WinTool helper that runs in the background and shows a badge
##   thirdparty : Third-party app — installs an open-source indicator (CapsLock Indicator) with winget
## WatchKeys   : [multi]  Keys to watch — badge method only
##   caps      : Caps Lock
##   num       : Num Lock
##   scroll    : Scroll Lock
## Position    : [select] Badge position — badge method only
##   bottom    : Bottom centre
##   topright  : Top right
##   center    : Centre of the screen
## DurationMs  : [number] Badge duration — how long the badge stays, in milliseconds
## PackageId   : [hidden] winget package id for the third-party method
## SafeTest    : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title       : Voyant Verr Maj
## desc        : Signale quand Verr Maj est actif - un son, une pastille à l'écran, ou une petite appli tierce
## Mode        : Action — installer le voyant ou le retirer
##   enable    : Installer le voyant
##   disable   : Retirer le voyant
## Method      : Comment l'afficher — Windows n'a pas de voyant à l'écran natif
##   sound     : Bip — son natif de Windows sur Verr Maj / Num / Défil, rien d'installé
##   resident  : Pastille à l'écran — un petit assistant WinTool en arrière-plan qui affiche une pastille
##   thirdparty : Appli tierce — installe un indicateur open-source (CapsLock Indicator) via winget
## WatchKeys   : Touches à surveiller — méthode pastille uniquement
##   caps      : Verr Maj
##   num       : Verr Num
##   scroll    : Arrêt défil
## Position    : Position de la pastille — méthode pastille uniquement
##   bottom    : En bas au centre
##   topright  : En haut à droite
##   center    : Au centre de l'écran
## DurationMs  : Durée de la pastille — combien de temps elle reste, en millisecondes
## PackageId   : Identifiant winget pour la méthode tierce
## SafeTest    : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode       = "enable"
    Method     = "sound"
    WatchKeys  = @("caps")
    Position   = "bottom"
    DurationMs = 1200
    PackageId  = "JonasKohl.CapsLockIndicator"
    SafeTest   = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# Windows n'a AUCUN voyant a l'ecran natif pour Verr Maj. Trois methodes :
#   sound      : active le son des touches bascule (ToggleKeys). 100% natif.
#   resident   : depose un assistant PowerShell dans %ProgramData%\WinTool et une
#                tache planifiee a l'ouverture de session. C'est le PREMIER script
#                "resident" du catalogue : quelque chose tourne en permanence.
#   thirdparty : installe un outil open-source via winget (surface de confiance).
#
# SafeTest : rien n'est active, ecrit, planifie ni installe - tout est annonce.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Enable   = ($CONFIG.Mode -ne 'disable')
$errors   = 0

$helperDir  = Join-Path $env:ProgramData 'WinTool'
$helperFile = Join-Path $helperDir 'capslock-osd.ps1'
$taskName   = 'WinTool-CapsLockIndicator'

function Get-WingetPath {
    $cmd = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $c = Get-ChildItem -Path (Join-Path $env:ProgramFiles 'WindowsApps') -Filter 'winget.exe' -Recurse -ErrorAction SilentlyContinue |
         Where-Object { $_.DirectoryName -like '*Microsoft.DesktopAppInstaller_*' } |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($c) { return $c.FullName }
    return $null
}

# --- Contenu de l'assistant resident (methode "resident") -------------------
# Genere a partir des touches / position / duree choisies.
function Build-HelperScript {
    $vkMap = @{ caps = 0x14; num = 0x90; scroll = 0x91 }
    $names = @{ caps = 'CAPS LOCK'; num = 'NUM LOCK'; scroll = 'SCROLL LOCK' }
    $keys  = @($CONFIG.WatchKeys) | Where-Object { $vkMap.ContainsKey($_) }
    if ($keys.Count -eq 0) { $keys = @('caps') }
    $entries = ($keys | ForEach-Object { "@{Name='$($names[$_])';VK=$($vkMap[$_])}" }) -join ','
    $dur = [int]$CONFIG.DurationMs; if ($dur -lt 300) { $dur = 300 }; if ($dur -gt 10000) { $dur = 10000 }

    return @"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;using System.Runtime.InteropServices;
public class WTKey { [DllImport("user32.dll")] public static extern short GetKeyState(int k); }
'@
`$keys = @($entries)
`$pos = '$($CONFIG.Position)'
`$dur = $dur
`$state = @{}
foreach (`$k in `$keys) { `$state[`$k.Name] = ([WTKey]::GetKeyState(`$k.VK) -band 1) }

`$form = New-Object System.Windows.Forms.Form
`$form.FormBorderStyle = 'None'; `$form.TopMost = `$true; `$form.ShowInTaskbar = `$false
`$form.StartPosition = 'Manual'; `$form.BackColor = [System.Drawing.Color]::FromArgb(20,20,20)
`$form.Opacity = 0.85; `$form.Size = New-Object System.Drawing.Size(240,64)
`$lbl = New-Object System.Windows.Forms.Label
`$lbl.Dock = 'Fill'; `$lbl.ForeColor = 'White'; `$lbl.TextAlign = 'MiddleCenter'
`$lbl.Font = New-Object System.Drawing.Font('Segoe UI',14,[System.Drawing.FontStyle]::Bold)
`$form.Controls.Add(`$lbl)

`$hide = New-Object System.Windows.Forms.Timer
`$hide.Interval = `$dur
`$hide.Add_Tick({ `$form.Hide(); `$hide.Stop() })

function Show-Badge(`$text) {
    `$lbl.Text = `$text
    `$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    switch (`$pos) {
        'topright' { `$x = `$wa.Right - `$form.Width - 24; `$y = `$wa.Top + 24 }
        'center'   { `$x = `$wa.Left + (`$wa.Width - `$form.Width)/2; `$y = `$wa.Top + (`$wa.Height - `$form.Height)/2 }
        default    { `$x = `$wa.Left + (`$wa.Width - `$form.Width)/2; `$y = `$wa.Bottom - `$form.Height - 60 }
    }
    `$form.Location = New-Object System.Drawing.Point([int]`$x,[int]`$y)
    `$form.Show(); `$form.BringToFront()
    `$hide.Stop(); `$hide.Start()
}

`$poll = New-Object System.Windows.Forms.Timer
`$poll.Interval = 200
`$poll.Add_Tick({
    foreach (`$k in `$keys) {
        `$s = ([WTKey]::GetKeyState(`$k.VK) -band 1)
        if (`$s -ne `$state[`$k.Name]) {
            `$state[`$k.Name] = `$s
            if (`$s -eq 1) { Show-Badge "`$(`$k.Name) : ON" } else { Show-Badge "`$(`$k.Name) : OFF" }
        }
    }
})
`$poll.Start()
[System.Windows.Forms.Application]::Run()
"@
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - nothing is enabled, written, scheduled or installed" }
Write-Host "[INFO] Method: $($CONFIG.Method)"

switch ("$($CONFIG.Method)") {

    # --- 1) SON NATIF --------------------------------------------------------
    'sound' {
        Write-Host "[STEP] 1/1 Toggle-key sound"
        $tk = 'HKCU:\Control Panel\Accessibility\ToggleKeys'
        if ($Enable) { $flags = '63' } else { $flags = '62' }   # 63 = on, 62 = available/off
        if ($SafeTest) {
            Write-Host "[INFO] SafeTest - would set ToggleKeys Flags = $flags"
        } else {
            try {
                if (-not (Test-Path $tk)) { New-Item -Path $tk -Force -ErrorAction Stop | Out-Null }
                Set-ItemProperty -Path $tk -Name 'Flags' -Value $flags -Type String -ErrorAction Stop
                if ($Enable) { Write-Host "[OK]   Toggle-key sound enabled - Windows beeps on Caps/Num/Scroll Lock" }
                else         { Write-Host "[OK]   Toggle-key sound disabled" }
            } catch { Write-Host "[ERR]  $($_.Exception.Message)"; $errors++ }
        }
    }

    # --- 2) PASTILLE RESIDENTE ----------------------------------------------
    'resident' {
        if ($Enable) {
            Write-Host "[WARN] This installs a background helper that runs at every logon - the first resident WinTool script"
            Write-Host "[STEP] 1/3 Writing the helper"
            if ($SafeTest) {
                Write-Host "[INFO] SafeTest - would write $helperFile"
            } else {
                try {
                    if (-not (Test-Path $helperDir)) { New-Item -Path $helperDir -ItemType Directory -Force -ErrorAction Stop | Out-Null }
                    Build-HelperScript | Set-Content -LiteralPath $helperFile -Encoding UTF8 -ErrorAction Stop
                    Write-Host "[OK]   Helper written to $helperFile"
                } catch { Write-Host "[ERR]  Could not write helper: $($_.Exception.Message)"; $errors++ }
            }

            Write-Host "[STEP] 2/3 Scheduling it at logon"
            if ($SafeTest) {
                Write-Host "[INFO] SafeTest - would register task $taskName for the current user at logon"
            } else {
                try {
                    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$helperFile`""
                    $trigger = New-ScheduledTaskTrigger -AtLogOn
                    $me      = "$env:USERDOMAIN\$env:USERNAME"
                    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
                    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
                    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
                    Write-Host "[OK]   Logon task created ($taskName)"
                } catch { Write-Host "[ERR]  Could not create task: $($_.Exception.Message)"; $errors++ }
            }

            Write-Host "[STEP] 3/3 Starting it now"
            if ($SafeTest) {
                Write-Host "[INFO] SafeTest - would start the helper now"
            } elseif ($errors -eq 0) {
                Start-Process powershell.exe -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$helperFile`"" -ErrorAction SilentlyContinue
                Write-Host "[OK]   Indicator running"
            }
        } else {
            Write-Host "[STEP] 1/2 Removing the logon task"
            if ($SafeTest) { Write-Host "[INFO] SafeTest - would remove task $taskName and stop the helper" }
            else {
                Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
                # Arrete l'assistant en cours (fenetre cachee) sans tuer les autres PowerShell.
                Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
                    Where-Object { $_.CommandLine -like "*capslock-osd.ps1*" } |
                    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
                Write-Host "[OK]   Task removed and helper stopped"
            }
            Write-Host "[STEP] 2/2 Removing the helper file"
            if ($SafeTest) { Write-Host "[INFO] SafeTest - would delete $helperFile" }
            else { Remove-Item -LiteralPath $helperFile -Force -ErrorAction SilentlyContinue; Write-Host "[OK]   Helper removed" }
        }
    }

    # --- 3) OUTIL TIERS (winget) --------------------------------------------
    'thirdparty' {
        $pkg = "$($CONFIG.PackageId)"
        $winget = Get-WingetPath
        if (-not $winget) {
            if ($SafeTest) { Write-Host "[WARN] winget not found - install 'App Installer' from the Microsoft Store"; break }
            Write-Host "[ERR]  winget is not installed - install 'App Installer' from the Microsoft Store"
            $errors++; break
        }
        if ($Enable) {
            Write-Host "[STEP] 1/1 Installing $pkg with winget"
            if ($SafeTest) { Write-Host "[INFO] SafeTest - would run winget install $pkg" }
            else {
                & $winget install --id $pkg --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) { Write-Host "[OK]   $pkg installed - open it once to enable 'start with Windows'" }
                else { Write-Host "[ERR]  winget could not install $pkg (code $LASTEXITCODE)"; $errors++ }
            }
        } else {
            Write-Host "[STEP] 1/1 Uninstalling $pkg with winget"
            if ($SafeTest) { Write-Host "[INFO] SafeTest - would run winget uninstall $pkg" }
            else {
                & $winget uninstall --id $pkg --exact --silent --disable-interactivity 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) { Write-Host "[OK]   $pkg uninstalled" }
                else { Write-Host "[WARN] $pkg was not uninstalled (code $LASTEXITCODE) - it may not be installed" }
            }
        }
    }

    default {
        Write-Host "[ERR]  Unknown method '$($CONFIG.Method)'"
        $errors++
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
Write-Host "[DONE] Caps Lock indicator updated"
exit 0
