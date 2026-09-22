## WINTOOL:START
## title    : Désactiver notifications
## desc     : Supprime les publicités, suggestions et notifications inutiles Windows
## category : securite
## icon     : 🔕
## tags     : notifications, publicités, spotlight, suggestions, confort
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Désactivation des notifications parasites
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # Notifications système Windows
    Desactiver_TipsAstuces          = $true   # "Conseils et astuces Windows"
    Desactiver_SuggestionsStart     = $true   # Suggestions dans le menu Démarrer
    Desactiver_SuggestionsEcranVerr = $true   # Contenu sur l'écran de verrouillage
    Desactiver_WelcomeExperience    = $true   # Écran "Bienvenue" après MAJ
    Desactiver_ActionCenter         = $false  # Centre de notifications (garder pour sécurité)
    Desactiver_BadgesTaskbar        = $false  # Badges sur icônes barre des tâches

    # Notifications des apps
    Desactiver_NotifAppsStore       = $true   # Apps du Microsoft Store
    Desactiver_NotifSecurite        = $false  # NE PAS désactiver — important!
    Desactiver_NotifMicrosoftAccount= $true   # "Finalisez votre compte Microsoft"

    # Sons de notification
    Desactiver_Sons                 = $false  # Sons système (désactiver si souhaité)

    # Écran de verrouillage
    Desactiver_SpotlightPublicite   = $true   # Windows Spotlight / pubs sur verrou
    Desactiver_InfoVerrouillage     = $true   # Infos météo, actualités sur verrou

    # Barre des tâches
    Desactiver_WidgetsTaskbar       = $true   # Widget météo/actus dans la barre
    Desactiver_BoutonCopilot        = $true   # Bouton Copilot dans la barre

    # Verrouiller via GPO (résiste aux MAJ)
    VerrouillerGPO                  = $true
}

# ==============================================================
# EXECUTION
# ==============================================================

function Set-RegVal {
    param([string]$Path, [string]$Name, $Value, [string]$Type = "DWord")
    If (!(Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
    Set-ItemProperty -Path $Path -Name $Name -Value $Value -Type $Type -ErrorAction SilentlyContinue
    Write-Host "  [OK] $Name" -ForegroundColor Green
}

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Désactivation des notifications parasites" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host ""

$cdm = "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"
$notif = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings"
$explorer = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"

# --- Tips & astuces ---
if ($CONFIG.Desactiver_TipsAstuces) {
    Write-Host "[ Conseils et astuces ]" -ForegroundColor Yellow
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" "SoftLandingEnabled" 0
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" "SubscribedContent-338389Enabled" 0
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" "SubscribedContent-310093Enabled" 0
}

# --- Suggestions démarrer ---
if ($CONFIG.Desactiver_SuggestionsStart) {
    Write-Host ""; Write-Host "[ Suggestions menu Démarrer ]" -ForegroundColor Yellow
    Set-RegVal $cdm "SystemPaneSuggestionsEnabled" 0
    Set-RegVal $cdm "SubscribedContent-338388Enabled" 0
    Set-RegVal $cdm "OemPreInstalledAppsEnabled" 0
    Set-RegVal $cdm "PreInstalledAppsEnabled" 0
    Set-RegVal $cdm "PreInstalledAppsEverEnabled" 0
    Set-RegVal "HKCU:\Software\Policies\Microsoft\Windows\Explorer" "HideRecentlyAddedApps" 1
}

# --- Écran de verrouillage suggestions ---
if ($CONFIG.Desactiver_SuggestionsEcranVerr) {
    Write-Host ""; Write-Host "[ Suggestions écran de verrouillage ]" -ForegroundColor Yellow
    Set-RegVal $cdm "RotatingLockScreenEnabled" 0
    Set-RegVal $cdm "RotatingLockScreenOverlayEnabled" 0
    Set-RegVal $cdm "SubscribedContent-338387Enabled" 0
}

# --- Expérience de bienvenue ---
if ($CONFIG.Desactiver_WelcomeExperience) {
    Write-Host ""; Write-Host "[ Écran de bienvenue après MAJ ]" -ForegroundColor Yellow
    Set-RegVal $cdm "SubscribedContent-310093Enabled" 0
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\UserProfileEngagement" "ScoobeSystemSettingEnabled" 0
}

# --- Compte Microsoft ---
if ($CONFIG.Desactiver_NotifMicrosoftAccount) {
    Write-Host ""; Write-Host "[ Notifications compte Microsoft ]" -ForegroundColor Yellow
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\SystemSettings\AccountNotifications" "EnableAccountNotifications" 0
}

# --- Spotlight / pubs écran verrou ---
if ($CONFIG.Desactiver_SpotlightPublicite) {
    Write-Host ""; Write-Host "[ Windows Spotlight et publicités ]" -ForegroundColor Yellow
    Set-RegVal $cdm "ContentDeliveryAllowed" 0
    Set-RegVal $cdm "FeatureManagementEnabled" 0
    Set-RegVal $cdm "RemediationRequired" 0
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent" "DisableWindowsSpotlightFeatures" 1
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent" "DisableWindowsConsumerFeatures" 1
}

# --- Infos verrou (météo, actus) ---
if ($CONFIG.Desactiver_InfoVerrouillage) {
    Write-Host ""; Write-Host "[ Infos météo / actus sur l'écran de verrou ]" -ForegroundColor Yellow
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" "DisableLockScreenAppNotifications" 1
}

# --- Widgets barre des tâches ---
if ($CONFIG.Desactiver_WidgetsTaskbar) {
    Write-Host ""; Write-Host "[ Widget météo/actus dans la barre ]" -ForegroundColor Yellow
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" "TaskbarDa" 0
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Dsh" "AllowNewsAndInterests" 0
}

# --- Bouton Copilot barre des tâches ---
if ($CONFIG.Desactiver_BoutonCopilot) {
    Write-Host ""; Write-Host "[ Bouton Copilot barre des tâches ]" -ForegroundColor Yellow
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" "ShowCopilotButton" 0
}

# --- Sons ---
if ($CONFIG.Desactiver_Sons) {
    Write-Host ""; Write-Host "[ Sons de notification ]" -ForegroundColor Yellow
    Set-RegVal "HKCU:\AppEvents\Schemes" "(Default)" ".None" "String"
    Write-Host "  [OK] Sons système désactivés" -ForegroundColor Green
}

# --- GPO ---
if ($CONFIG.VerrouillerGPO) {
    Write-Host ""; Write-Host "[ Verrouillage GPO ]" -ForegroundColor Yellow
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent" "DisableSoftLanding" 1
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent" "DisableWindowsConsumerFeatures" 1
    Write-Host "  [OK] Verrouillé" -ForegroundColor Green
}

# Redémarrer l'explorateur pour appliquer les changements visuels
Write-Host ""
Write-Host "  Redémarrage de l'Explorateur Windows pour appliquer les changements..." -ForegroundColor DarkGray
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Start-Process explorer

Write-Host ""
Write-Host "[DONE] Notifications parasites désactivées." -ForegroundColor Green
