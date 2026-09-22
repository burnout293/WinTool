## WINTOOL:START
## title    : Installer VCRedist
## desc     : Installe les librairies Visual C++ indispensables aux logiciels
## category : outillage
## icon     : 📦
## tags     : vcredist, visual c++, librairies, runtime
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Installation des Visual C++ Redistributables
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # Choisir quelles versions installer (true = oui, false = non)
    Installer_2015_2022_x64 = $true
    Installer_2015_2022_x86 = $true
    Installer_2013_x64      = $false
    Installer_2013_x86      = $false
    Installer_2012_x64      = $false
    Installer_2012_x86      = $false
    Installer_2010_x64      = $false
    Installer_2010_x86      = $false

    # Dossier temporaire de téléchargement
    DossierTemp             = "$env:TEMP\vcredist_install"

    # Supprimer les fichiers après installation
    NettoyerApres           = $true

    # Forcer la réinstallation même si déjà présent
    ForceReinstall          = $false
}

# ==============================================================
# EXECUTION — ne pas modifier en dessous
# ==============================================================

$packages = @()

if ($CONFIG.Installer_2015_2022_x64) { $packages += @{ Name="VCRedist 2015-2022 x64"; Url="https://aka.ms/vs/17/release/vc_redist.x64.exe" } }
if ($CONFIG.Installer_2015_2022_x86) { $packages += @{ Name="VCRedist 2015-2022 x86"; Url="https://aka.ms/vs/17/release/vc_redist.x86.exe" } }
if ($CONFIG.Installer_2013_x64)      { $packages += @{ Name="VCRedist 2013 x64";       Url="https://aka.ms/highdpimfc2013x64enu" } }
if ($CONFIG.Installer_2013_x86)      { $packages += @{ Name="VCRedist 2013 x86";       Url="https://aka.ms/highdpimfc2013x86enu" } }
if ($CONFIG.Installer_2012_x64)      { $packages += @{ Name="VCRedist 2012 x64";       Url="https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x64.exe" } }
if ($CONFIG.Installer_2012_x86)      { $packages += @{ Name="VCRedist 2012 x86";       Url="https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x86.exe" } }
if ($CONFIG.Installer_2010_x64)      { $packages += @{ Name="VCRedist 2010 x64";       Url="https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x64.exe" } }
if ($CONFIG.Installer_2010_x86)      { $packages += @{ Name="VCRedist 2010 x86";       Url="https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe" } }

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Installation VCRedist ($($packages.Count) paquet(s))" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan

if ($packages.Count -eq 0) {
    Write-Host "[INFO] Aucun paquet sélectionné dans la configuration." -ForegroundColor Yellow
    exit 0
}

New-Item -ItemType Directory -Force -Path $CONFIG.DossierTemp | Out-Null

foreach ($pkg in $packages) {
    $file = Join-Path $CONFIG.DossierTemp ($pkg.Name -replace '[^a-zA-Z0-9]','_' -replace '__','_') + ".exe"
    Write-Host ""
    Write-Host "  >> $($pkg.Name)" -ForegroundColor Yellow
    try {
        Invoke-WebRequest -Uri $pkg.Url -OutFile $file -UseBasicParsing
        $args = "/quiet /norestart"
        if ($CONFIG.ForceReinstall) { $args += " /force" }
        Start-Process -FilePath $file -ArgumentList $args -Wait
        Write-Host "  [OK] Installé" -ForegroundColor Green
    } catch {
        Write-Host "  [ERR] Échec : $_" -ForegroundColor Red
    }
}

if ($CONFIG.NettoyerApres) {
    Remove-Item -Path $CONFIG.DossierTemp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "[OK] Fichiers temporaires supprimés." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "[DONE] Installation VCRedist terminée." -ForegroundColor Green
