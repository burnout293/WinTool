## WINTOOL:START
## id            : 6df6b03f-0bcc-4d97-a397-5d70383b0e89
## lang          : en
## title         : Improve the taskbar and search
## desc          : Cleans up the taskbar and the Start search - hides what you do not use and stops web results
## category      : customize
## icon          : layout-grid
## tags          : taskbar, search, bing, widgets, task view, copilot, chat, alignment
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
## Mode            : [select] Action — apply the clean-up or restore the Windows defaults
##   apply         : Apply the clean-up
##   restore       : Restore the Windows defaults
## Items           : [multi]  What to change — pick one or more
##   websearch     : No web results in search — stops Bing results in Start search
##   hidesearchbox : Hide the search box — removes the search field from the taskbar
##   taskview      : Hide the Task View button
##   widgets       : Hide Widgets — the news and weather button
##   chat          : Hide Chat — the Meet Now / Teams chat button
##   copilot       : Hide Copilot — removes the Copilot button
##   leftalign     : Align the taskbar to the left — Windows 11 style back to classic
## RestartExplorer : [bool]   Apply immediately — restarts the Explorer so changes show at once
## SafeTest        : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title           : Améliorer la barre des tâches et la recherche
## desc            : Épure la barre des tâches et la recherche de Démarrer - masque l'inutile et coupe les résultats web
## Mode            : Action — appliquer le nettoyage ou rétablir les réglages de Windows
##   apply         : Appliquer le nettoyage
##   restore       : Rétablir les réglages de Windows
## Items           : Quoi modifier — un ou plusieurs éléments
##   websearch     : Pas de résultats web dans la recherche — coupe les résultats Bing dans Démarrer
##   hidesearchbox : Masquer la zone de recherche — retire le champ de recherche de la barre des tâches
##   taskview      : Masquer le bouton Vue des tâches
##   widgets       : Masquer les Widgets — le bouton actualités et météo
##   chat          : Masquer Chat — le bouton Discussion / Teams
##   copilot       : Masquer Copilot — retire le bouton Copilot
##   leftalign     : Aligner la barre des tâches à gauche — retour au style classique sous Windows 11
## RestartExplorer : Appliquer tout de suite — redémarre l'Explorateur pour un effet immédiat
## SafeTest        : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode            = "apply"
    Items           = @("websearch", "hidesearchbox", "taskview", "widgets", "chat", "copilot", "leftalign")
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
# Reglages du compte courant (HKCU). Chaque valeur declare Off (valeur voulue)
# et Default (valeur d'origine Windows) ; Default = $null signifie "supprimer la
# valeur" au restore (cas des cles de strategie qui n'existent pas par defaut).
# SafeTest : les valeurs sont lues, rien n'est ecrit ni redemarre.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Restore  = ($CONFIG.Mode -eq 'restore')
$errors   = 0
$changed  = $false

$adv    = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
$search = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Search'
$polExp = 'HKCU:\Software\Policies\Microsoft\Windows\Explorer'
$polCop = 'HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot'

$Definitions = @{
    websearch = @{ Label = 'No web results in search'; Values = @(
        @{ Path = $search; Name = 'BingSearchEnabled';        Off = 0; Default = 1 },
        @{ Path = $polExp; Name = 'DisableSearchBoxSuggestions'; Off = 1; Default = $null }
    ) }
    hidesearchbox = @{ Label = 'Hide the search box'; Values = @(
        @{ Path = $search; Name = 'SearchboxTaskbarMode'; Off = 0; Default = 3 }
    ) }
    taskview = @{ Label = 'Hide the Task View button'; Values = @(
        @{ Path = $adv; Name = 'ShowTaskViewButton'; Off = 0; Default = 1 }
    ) }
    widgets = @{ Label = 'Hide Widgets'; Values = @(
        @{ Path = $adv; Name = 'TaskbarDa'; Off = 0; Default = 1 }
    ) }
    chat = @{ Label = 'Hide Chat'; Values = @(
        @{ Path = $adv; Name = 'TaskbarMn'; Off = 0; Default = 1 }
    ) }
    copilot = @{ Label = 'Hide Copilot'; Values = @(
        @{ Path = $adv;    Name = 'ShowCopilotButton';    Off = 0; Default = 1 },
        @{ Path = $polCop; Name = 'TurnOffWindowsCopilot'; Off = 1; Default = $null }
    ) }
    leftalign = @{ Label = 'Align the taskbar to the left'; Values = @(
        @{ Path = $adv; Name = 'TaskbarAl'; Off = 0; Default = 1 }
    ) }
}

# Applique une valeur (apply -> Off, restore -> Default ; $null = supprimer).
function Set-Value {
    param($V)
    if ($Restore) { $wanted = $V.Default } else { $wanted = $V.Off }

    if ($null -eq $wanted) {
        # Restore d'une cle de strategie : on la supprime.
        $exists = $null -ne (Get-ItemProperty -Path $V.Path -Name $V.Name -ErrorAction SilentlyContinue)
        if (-not $exists) { Write-Host "[OK]   $($V.Name) not set - nothing to remove"; return }
        if ($SafeTest) { Write-Host "[INFO] SafeTest - would remove $($V.Name)"; return }
        try {
            Remove-ItemProperty -Path $V.Path -Name $V.Name -ErrorAction Stop
            Write-Host "[OK]   $($V.Name) removed"; $script:changed = $true
        } catch { Write-Host "[ERR]  $($V.Name): $($_.Exception.Message)"; $script:errors++ }
        return
    }

    $current = (Get-ItemProperty -Path $V.Path -Name $V.Name -ErrorAction SilentlyContinue).($V.Name)
    if ($null -ne $current -and [int]$current -eq $wanted) { Write-Host "[OK]   $($V.Name) already $wanted"; return }
    if ($SafeTest) {
        Write-Host "[INFO] SafeTest - would set $($V.Name) = $wanted (currently $(if ($null -eq $current) { 'not set' } else { $current }))"
        return
    }
    try {
        if (-not (Test-Path $V.Path)) { New-Item -Path $V.Path -Force -ErrorAction Stop | Out-Null }
        Set-ItemProperty -Path $V.Path -Name $V.Name -Value $wanted -Type DWord -ErrorAction Stop
        Write-Host "[OK]   $($V.Name) = $wanted"; $script:changed = $true
    } catch { Write-Host "[ERR]  $($V.Name): $($_.Exception.Message)"; $script:errors++ }
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - settings are read, nothing is changed" }
if ($Restore)  { Write-Host "[INFO] Restoring the Windows taskbar and search defaults" }

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
    foreach ($v in $def.Values) { Set-Value $v }
}

# Redemarrage de l'Explorateur pour un effet immediat (barre des taches).
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
if (-not $changed) { Write-Host "[INFO] Everything was already as requested" }
Write-Host "[DONE] Taskbar and search updated"
exit 0
