## WINTOOL:START
## id            : f056a4ac-3742-4c2f-b73f-bf2541a22fd2
## lang          : en
## title         : Stop the "use Edge" nagging
## desc          : Stops Windows and Edge from pushing you to use Edge or make it the default browser
## category      : apps
## icon          : app-window
## tags          : edge, default browser, nag, prompts, import, banners
## version       : 1.0
## admin         : true
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Mode          : [select] Action — turn the checked items off or on
##   disable     : Turn the checked items off
##   enable      : Turn the checked items on — removes the policies, back to defaults
## Items         : [multi]  What to stop — pick one or more
##   defaultnag  : "Make Edge your default" prompts — banners and pop-ups asking to switch
##   importnag   : Forced import — the prompt to import data from another browser
##   restoretabs : Reopen tabs nagging — the "pick up where you left off" push
##   firstrunnag : First-launch pop-up — the full-screen Edge welcome on first run
##   startuppush : Startup boost and background push — Edge staying running to feel faster
##   searchnag   : Bing / Edge search nudges in Windows — pushes toward Edge from search
##   pindesktop  : Auto-pinning Edge — stops re-pinning Edge to the taskbar after updates
## SafeTest      : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title         : Stopper les incitations à utiliser Edge
## desc          : Empêche Windows et Edge de vous pousser à utiliser Edge ou à en faire le navigateur par défaut
## Mode          : Action — désactiver ou activer les éléments cochés
##   disable     : Désactiver les éléments cochés
##   enable      : Activer les éléments cochés — retire les stratégies, retour aux réglages
## Items         : Quoi stopper — un ou plusieurs éléments
##   defaultnag  : Invites « faire d'Edge le navigateur par défaut » — bannières et pop-ups
##   importnag   : Import forcé — l'invite d'import des données depuis un autre navigateur
##   restoretabs : Réouverture des onglets — l'incitation « reprendre là où vous en étiez »
##   firstrunnag : Pop-up de premier lancement — l'écran de bienvenue plein écran d'Edge
##   startuppush : Démarrage rapide et arrière-plan — Edge qui reste lancé pour paraître rapide
##   searchnag   : Incitations Bing / Edge dans Windows — la recherche qui pousse vers Edge
##   pindesktop  : Épinglage automatique d'Edge — évite le ré-épinglage à la barre après MAJ
## SafeTest      : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode     = "disable"
    Items    = @("defaultnag", "importnag", "restoretabs", "firstrunnag", "startuppush", "searchnag", "pindesktop")
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
# Deux familles de cles : strategies Edge (HKLM\...\Policies\Microsoft\Edge) et
# reglages Windows (HKLM/HKCU). Chaque valeur declare Scope (Machine|User),
# Path relatif a la ruche, Name, et Off (valeur qui coupe l'incitation).
# "Desactiver" = poser Off. "Activer" = supprimer la valeur (retour au defaut).
# SafeTest : les valeurs sont lues, rien n'est ecrit.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Disable  = ($CONFIG.Mode -ne 'enable')
$errors   = 0

$EDGE = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'

$Definitions = @{
    defaultnag = @{ Label = '"Make Edge default" prompts'; Values = @(
        @{ Path = $EDGE; Name = 'DefaultBrowserSettingEnabled'; Off = 0 }
    ) }
    importnag = @{ Label = 'Forced import'; Values = @(
        @{ Path = $EDGE; Name = 'AutoImportAtFirstRun'; Off = 4 },
        @{ Path = $EDGE; Name = 'ImportOnEachLaunch'; Off = 0 }
    ) }
    restoretabs = @{ Label = 'Reopen tabs nagging'; Values = @(
        @{ Path = $EDGE; Name = 'RestoreOnStartup'; Off = 5 }
    ) }
    firstrunnag = @{ Label = 'First-launch pop-up'; Values = @(
        @{ Path = $EDGE; Name = 'HideFirstRunExperience'; Off = 1 }
    ) }
    startuppush = @{ Label = 'Startup boost and background push'; Values = @(
        @{ Path = $EDGE; Name = 'StartupBoostEnabled'; Off = 0 },
        @{ Path = $EDGE; Name = 'BackgroundModeEnabled'; Off = 0 }
    ) }
    searchnag = @{ Label = 'Bing / Edge search nudges'; Values = @(
        @{ Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Search'; Name = 'BingSearchEnabled'; Off = 0 },
        @{ Path = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Explorer'; Name = 'DisableSearchBoxSuggestions'; Off = 1 }
    ) }
    pindesktop = @{ Label = 'Auto-pinning Edge'; Values = @(
        @{ Path = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Explorer'; Name = 'DisableEdgeDesktopShortcutCreation'; Off = 1 }
    ) }
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - settings are read, nothing is changed" }
if ($Disable) {
    Write-Host "[WARN] Some Edge settings will show 'Managed by your organization' - this is normal"
} else {
    Write-Host "[INFO] Removing the settings - back to Windows and Edge defaults"
}

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
        if ($Disable) {
            $current = (Get-ItemProperty -Path $v.Path -Name $v.Name -ErrorAction SilentlyContinue).($v.Name)
            if ($null -ne $current -and [int]$current -eq $v.Off) { Write-Host "[OK]   $($v.Name) already $($v.Off)"; continue }
            if ($SafeTest) { Write-Host "[INFO] SafeTest - would set $($v.Name) = $($v.Off)"; continue }
            try {
                if (-not (Test-Path $v.Path)) { New-Item -Path $v.Path -Force -ErrorAction Stop | Out-Null }
                Set-ItemProperty -Path $v.Path -Name $v.Name -Value $v.Off -Type DWord -ErrorAction Stop
                Write-Host "[OK]   $($v.Name) = $($v.Off)"
            } catch { Write-Host "[ERR]  $($v.Name): $($_.Exception.Message)"; $errors++ }
        } else {
            $exists = $null -ne (Get-ItemProperty -Path $v.Path -Name $v.Name -ErrorAction SilentlyContinue)
            if (-not $exists) { Write-Host "[OK]   $($v.Name) not set - nothing to remove"; continue }
            if ($SafeTest) { Write-Host "[INFO] SafeTest - would remove $($v.Name)"; continue }
            try {
                Remove-ItemProperty -Path $v.Path -Name $v.Name -ErrorAction Stop
                Write-Host "[OK]   $($v.Name) removed"
            } catch { Write-Host "[ERR]  $($v.Name): $($_.Exception.Message)"; $errors++ }
        }
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
if ($Disable) { Write-Host "[DONE] Edge nagging stopped" } else { Write-Host "[DONE] Edge prompt settings removed" }
exit 0
