## WINTOOL:START
## id            : e1dac918-8b3b-4e15-9a6a-b02f51049a67
## lang          : en
## title         : Declutter Microsoft Edge
## desc          : Turns off the sidebar, Copilot, shopping and news clutter in Edge, using managed-browser policies
## category      : apps
## icon          : app-window
## tags          : edge, sidebar, copilot, shopping, msn, new tab, policy
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
##   enable      : Turn the checked items on — removes the policies, back to Edge defaults
## Items         : [multi]  What to declutter — pick one or more
##   sidebar     : Sidebar — the panel and its Discover / Copilot button on the right
##   copilot     : Copilot — the Copilot and Bing chat buttons
##   shopping    : Shopping — price comparison, coupons and buy-now-pay-later
##   collections : Collections — the Collections button
##   msncontent  : MSN new tab content — news feed, ads and backgrounds on the new tab page
##   feedback    : Feedback and surveys — "send feedback" and satisfaction prompts
##   firstrun    : First-run and welcome pages — the setup pages shown on first launch
##   recommend   : Recommendations — Edge tips, promos and "recommended" nudges
##   games       : Games menu and Edge bar — the games and eDrop entry points
## SafeTest      : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title         : Épurer Microsoft Edge
## desc          : Désactive la barre latérale, Copilot, les achats et les actualités dans Edge, via des stratégies de navigateur géré
## Mode          : Action — désactiver ou activer les éléments cochés
##   disable     : Désactiver les éléments cochés
##   enable      : Activer les éléments cochés — retire les stratégies, retour aux réglages d'Edge
## Items         : Quoi épurer — un ou plusieurs éléments
##   sidebar     : Barre latérale — le panneau et son bouton Discover / Copilot à droite
##   copilot     : Copilot — les boutons Copilot et chat Bing
##   shopping    : Achats — comparateur de prix, coupons et paiement en plusieurs fois
##   collections : Collections — le bouton Collections
##   msncontent  : Contenu du nouvel onglet MSN — actualités, publicités et arrière-plans
##   feedback    : Commentaires et enquêtes — « envoyer un commentaire » et invites de satisfaction
##   firstrun    : Pages de premier lancement — les pages de configuration au premier démarrage
##   recommend   : Recommandations — astuces, promos et incitations « recommandé » d'Edge
##   games       : Menu Jeux et barre Edge — les points d'entrée jeux et eDrop
## SafeTest      : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode     = "disable"
    Items    = @("sidebar", "copilot", "shopping", "collections", "msncontent", "feedback", "firstrun", "recommend", "games")
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
# Uniquement par strategies machine (HKLM\SOFTWARE\Policies\Microsoft\Edge) :
# mecanisme officiel, propre a desinstaller, aucun profil touche. Effet de bord
# assume : Edge affichera "gere par votre organisation".
# "Desactiver" = poser la valeur qui coupe la nuisance. "Activer" = SUPPRIMER la
# valeur (retour au defaut Edge), on ne force jamais la nuisance a revenir.
# SafeTest : les strategies sont lues, rien n'est ecrit.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Disable  = ($CONFIG.Mode -ne 'enable')
$errors   = 0
$edge     = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'

# Chaque element : liste de valeurs {Name, Off}. Off = valeur qui coupe.
$Definitions = @{
    sidebar = @{ Label = 'Sidebar'; Values = @(
        @{ Name = 'HubsSidebarEnabled'; Off = 0 },
        @{ Name = 'StandaloneHubsSidebarEnabled'; Off = 0 }
    ) }
    copilot = @{ Label = 'Copilot'; Values = @(
        @{ Name = 'CopilotCDPPageContext'; Off = 0 },
        @{ Name = 'CopilotPageContext'; Off = 0 },
        @{ Name = 'DiscoverEnabled'; Off = 0 }
    ) }
    shopping = @{ Label = 'Shopping'; Values = @(
        @{ Name = 'EdgeShoppingAssistantEnabled'; Off = 0 },
        @{ Name = 'ShowMicrosoftRewards'; Off = 0 }
    ) }
    collections = @{ Label = 'Collections'; Values = @(
        @{ Name = 'EdgeCollectionsEnabled'; Off = 0 }
    ) }
    msncontent = @{ Label = 'MSN new tab content'; Values = @(
        @{ Name = 'NewTabPageContentEnabled'; Off = 0 },
        @{ Name = 'NewTabPageAllowedBackgroundTypes'; Off = 3 },
        @{ Name = 'NewTabPageHideDefaultTopSites'; Off = 1 }
    ) }
    feedback = @{ Label = 'Feedback and surveys'; Values = @(
        @{ Name = 'UserFeedbackAllowed'; Off = 0 },
        @{ Name = 'SurfGameEnabled'; Off = 0 }
    ) }
    firstrun = @{ Label = 'First-run and welcome pages'; Values = @(
        @{ Name = 'HideFirstRunExperience'; Off = 1 },
        @{ Name = 'ShowRecommendationsEnabled'; Off = 0 }
    ) }
    recommend = @{ Label = 'Recommendations'; Values = @(
        @{ Name = 'ShowRecommendationsEnabled'; Off = 0 },
        @{ Name = 'SpotlightExperiencesAndRecommendationsEnabled'; Off = 0 }
    ) }
    games = @{ Label = 'Games menu and Edge bar'; Values = @(
        @{ Name = 'GamesMenuEnabled'; Off = 0 },
        @{ Name = 'WebWidgetAllowed'; Off = 0 }
    ) }
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - policies are read, nothing is changed" }
if ($Disable) {
    Write-Host "[WARN] Edge will show 'Managed by your organization' - this is normal, it is how the setting is enforced"
} else {
    Write-Host "[INFO] Removing the policies - Edge goes back to its own defaults"
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
            $current = (Get-ItemProperty -Path $edge -Name $v.Name -ErrorAction SilentlyContinue).($v.Name)
            if ($null -ne $current -and [int]$current -eq $v.Off) { Write-Host "[OK]   $($v.Name) already $($v.Off)"; continue }
            if ($SafeTest) { Write-Host "[INFO] SafeTest - would set $($v.Name) = $($v.Off)"; continue }
            try {
                if (-not (Test-Path $edge)) { New-Item -Path $edge -Force -ErrorAction Stop | Out-Null }
                Set-ItemProperty -Path $edge -Name $v.Name -Value $v.Off -Type DWord -ErrorAction Stop
                Write-Host "[OK]   $($v.Name) = $($v.Off)"
            } catch { Write-Host "[ERR]  $($v.Name): $($_.Exception.Message)"; $errors++ }
        } else {
            $exists = $null -ne (Get-ItemProperty -Path $edge -Name $v.Name -ErrorAction SilentlyContinue)
            if (-not $exists) { Write-Host "[OK]   $($v.Name) not set - nothing to remove"; continue }
            if ($SafeTest) { Write-Host "[INFO] SafeTest - would remove $($v.Name)"; continue }
            try {
                Remove-ItemProperty -Path $edge -Name $v.Name -ErrorAction Stop
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
if ($Disable) { Write-Host "[DONE] Edge decluttered" } else { Write-Host "[DONE] Edge policies removed" }
exit 0
