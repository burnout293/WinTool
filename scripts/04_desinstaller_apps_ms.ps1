## WINTOOL:START
## title    : Désinstaller apps Microsoft
## desc     : Supprime OneDrive, OneNote, Xbox, Copilot et bloque leur retour
## category : appli
## icon     : 🚫
## tags     : onedrive, xbox, copilot, cortana, onenote
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Désinstallation OneDrive / OneNote / Xbox / Copilot
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # --- OneDrive ---
    Desinstaller_OneDrive           = $true
    OneDrive_SupprimerDossier       = $true    # Supprime le dossier local OneDrive
    OneDrive_BloquerGPO             = $true    # Empêche la réinstallation via GPO
    OneDrive_SupprimerRaccourcis    = $true    # Nettoie l'explorateur

    # --- OneNote ---
    Desinstaller_OneNote            = $true
    OneNote_BloquerReinstall        = $true

    # --- Xbox ---
    Desinstaller_Xbox               = $true
    Xbox_DesactiverGameDVR          = $true    # Désactive l'overlay et capture Xbox
    Xbox_BloquerReinstall           = $true

    # --- Copilot / Cortana ---
    Desinstaller_Copilot            = $true
    Copilot_BloquerGPO              = $true    # Désactive via GPO registre

    # --- Access (Office standalone) ---
    Verifier_Access                 = $true    # Signale si Access est installé
}

# ==============================================================
# EXECUTION — ne pas modifier en dessous
# ==============================================================

function Remove-AppComplet {
    param([string]$Name, [bool]$BloquerReinstall = $true)
    $pkg = Get-AppxPackage -Name $Name -AllUsers -ErrorAction SilentlyContinue
    if ($pkg) {
        $pkg | Remove-AppxPackage -AllUsers -ErrorAction SilentlyContinue
        Write-Host "  [OK] $Name supprimé" -ForegroundColor Green
    } else {
        Write-Host "  [--] $Name déjà absent" -ForegroundColor DarkGray
    }
    if ($BloquerReinstall) {
        Get-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue |
            Where-Object DisplayName -EQ $Name |
            Remove-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue | Out-Null
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Désinstallation apps Microsoft ciblées" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan

# ---- ONEDRIVE -----------------------------------------------
if ($CONFIG.Desinstaller_OneDrive) {
    Write-Host ""
    Write-Host "[ OneDrive ]" -ForegroundColor Yellow
    Stop-Process -Name OneDrive -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    $setup = @(
        "$env:SystemRoot\SysWOW64\OneDriveSetup.exe"
        "$env:SystemRoot\System32\OneDriveSetup.exe"
        "$env:LOCALAPPDATA\Microsoft\OneDrive\OneDriveSetup.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($setup) {
        Start-Process $setup "/uninstall" -Wait
        Write-Host "  [OK] OneDrive désinstallé" -ForegroundColor Green
    } else {
        Write-Host "  [--] OneDrive setup non trouvé" -ForegroundColor DarkGray
    }

    if ($CONFIG.OneDrive_SupprimerDossier) {
        @(
            "$env:USERPROFILE\OneDrive"
            "$env:LOCALAPPDATA\Microsoft\OneDrive"
            "$env:PROGRAMDATA\Microsoft OneDrive"
        ) | ForEach-Object {
            if (Test-Path $_) {
                Remove-Item $_ -Recurse -Force -ErrorAction SilentlyContinue
                Write-Host "  [OK] Dossier supprimé : $_" -ForegroundColor Green
            }
        }
    }

    if ($CONFIG.OneDrive_BloquerGPO) {
        $p = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\OneDrive"
        If (!(Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
        Set-ItemProperty -Path $p -Name "DisableFileSyncNGSC" -Value 1
        Write-Host "  [OK] OneDrive bloqué via GPO" -ForegroundColor Green
    }

    if ($CONFIG.OneDrive_SupprimerRaccourcis) {
        $p = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace"
        $oneDriveGuid = "{018D5C66-4533-4307-9B53-224DE2ED1FE6}"
        if (Test-Path "$p\$oneDriveGuid") {
            Remove-Item "$p\$oneDriveGuid" -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "  [OK] Raccourci OneDrive retiré de l'explorateur" -ForegroundColor Green
        }
    }
}

# ---- ONENOTE ------------------------------------------------
if ($CONFIG.Desinstaller_OneNote) {
    Write-Host ""
    Write-Host "[ OneNote ]" -ForegroundColor Yellow
    Remove-AppComplet "Microsoft.Office.OneNote" $CONFIG.OneNote_BloquerReinstall
    Remove-AppComplet "Microsoft.MicrosoftOfficeHub" $CONFIG.OneNote_BloquerReinstall
}

# ---- XBOX ---------------------------------------------------
if ($CONFIG.Desinstaller_Xbox) {
    Write-Host ""
    Write-Host "[ Xbox ]" -ForegroundColor Yellow
    @(
        "Microsoft.XboxApp"
        "Microsoft.XboxGameOverlay"
        "Microsoft.XboxGamingOverlay"
        "Microsoft.XboxIdentityProvider"
        "Microsoft.XboxSpeechToTextOverlay"
        "Microsoft.Xbox.TCUI"
    ) | ForEach-Object { Remove-AppComplet $_ $CONFIG.Xbox_BloquerReinstall }

    if ($CONFIG.Xbox_DesactiverGameDVR) {
        $p = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR"
        If (!(Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
        Set-ItemProperty -Path $p -Name "AllowGameDVR" -Value 0
        Set-ItemProperty -Path "HKCU:\System\GameConfigStore" -Name "GameDVR_Enabled" -Value 0 -ErrorAction SilentlyContinue
        Write-Host "  [OK] Game DVR / Overlay Xbox désactivé" -ForegroundColor Green
    }
}

# ---- COPILOT / CORTANA --------------------------------------
if ($CONFIG.Desinstaller_Copilot) {
    Write-Host ""
    Write-Host "[ Copilot / Cortana ]" -ForegroundColor Yellow
    @(
        "Microsoft.Windows.Ai.Copilot.Provider"
        "Microsoft.Copilot"
        "Microsoft.549981C3F5F10"
        "MicrosoftWindows.Client.WebExperience"
    ) | ForEach-Object { Remove-AppComplet $_ $true }

    if ($CONFIG.Copilot_BloquerGPO) {
        $p = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot"
        If (!(Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
        Set-ItemProperty -Path $p -Name "TurnOffWindowsCopilot" -Value 1
        $p2 = "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot"
        If (!(Test-Path $p2)) { New-Item -Path $p2 -Force | Out-Null }
        Set-ItemProperty -Path $p2 -Name "TurnOffWindowsCopilot" -Value 1
        Write-Host "  [OK] Copilot bloqué via GPO (machine + utilisateur)" -ForegroundColor Green
    }
}

# ---- ACCESS -------------------------------------------------
if ($CONFIG.Verifier_Access) {
    Write-Host ""
    Write-Host "[ Access ]" -ForegroundColor Yellow
    $accessPaths = @(
        "${env:ProgramFiles}\Microsoft Office\root\Office16\MSACCESS.EXE"
        "${env:ProgramFiles(x86)}\Microsoft Office\root\Office16\MSACCESS.EXE"
    )
    $found = $accessPaths | Where-Object { Test-Path $_ }
    if ($found) {
        Write-Host "  [!] Access détecté — désinstallation via Paramètres > Applications > Microsoft Office" -ForegroundColor Red
        Write-Host "      Chemin : $($found[0])" -ForegroundColor DarkGray
    } else {
        Write-Host "  [OK] Access non présent" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "[DONE] Désinstallation terminée." -ForegroundColor Green
