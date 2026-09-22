## WINTOOL:START
## title    : Nettoyage fichiers temp
## desc     : Vide les dossiers temporaires, le cache Windows Update et la corbeille
## category : nettoyage
## icon     : 🧹
## tags     : temp, temporaires, corbeille, cache, espace disque
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Nettoyage des fichiers temporaires
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # Dossiers temporaires utilisateur
    Vider_TEMP_User         = $true    # %TEMP% de l'utilisateur courant
    Vider_TEMP_Windows      = $true    # C:\Windows\Temp
    Vider_Prefetch          = $true    # C:\Windows\Prefetch
    Vider_Cache_WindowsUpdate = $true  # C:\Windows\SoftwareDistribution\Download
    Vider_Corbeille         = $true    # Corbeille de tous les lecteurs
    Vider_MiniDumps         = $true    # C:\Windows\Minidump (crashs)
    Vider_ErrorReports      = $true    # Rapports d'erreurs Windows
    Vider_ThumbCache        = $true    # Cache des miniatures (explorer)

    # Nettoyer également pour tous les profils utilisateurs
    # (nécessite admin, ignoré si insuffisant)
    TousLesProfils          = $false

    # Afficher la taille libérée
    AfficherEspaceLiberé    = $true

    # Simuler seulement (aucun fichier supprimé)
    SimulationUniquement    = $false
}

# ==============================================================
# EXECUTION
# ==============================================================

function Get-TailleRepertoire {
    param([string]$Path)
    if (!(Test-Path $Path)) { return 0 }
    try {
        return (Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum
    } catch { return 0 }
}

function Remove-Contenu {
    param([string]$Path, [string]$Label)
    if (!(Test-Path $Path)) {
        Write-Host "  [--] $Label (dossier absent)" -ForegroundColor DarkGray
        return 0
    }
    $avant = Get-TailleRepertoire $Path
    if (!$CONFIG.SimulationUniquement) {
        Get-ChildItem -Path $Path -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
    $apres = Get-TailleRepertoire $Path
    $liberé = $avant - $apres
    $label2 = if ($CONFIG.SimulationUniquement) { "[SIM]" } else { "[OK]" }
    Write-Host "  $label2 $Label — $(Format-Octets $liberé) libérés" -ForegroundColor Green
    return $liberé
}

function Format-Octets {
    param([long]$Octets)
    if ($Octets -ge 1GB) { return "{0:N1} Go" -f ($Octets / 1GB) }
    if ($Octets -ge 1MB) { return "{0:N1} Mo" -f ($Octets / 1MB) }
    if ($Octets -ge 1KB) { return "{0:N1} Ko" -f ($Octets / 1KB) }
    return "$Octets octets"
}

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Nettoyage des fichiers temporaires" -ForegroundColor Cyan
if ($CONFIG.SimulationUniquement) {
    Write-Host "  MODE SIMULATION — aucun fichier supprimé" -ForegroundColor Yellow
}
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host ""

$totalLibéré = 0

if ($CONFIG.Vider_TEMP_User) {
    $totalLibéré += Remove-Contenu $env:TEMP "Temp utilisateur (%TEMP%)"
}

if ($CONFIG.Vider_TEMP_Windows) {
    $totalLibéré += Remove-Contenu "$env:SystemRoot\Temp" "Temp Windows"
}

if ($CONFIG.Vider_Prefetch) {
    $totalLibéré += Remove-Contenu "$env:SystemRoot\Prefetch" "Prefetch"
}

if ($CONFIG.Vider_Cache_WindowsUpdate) {
    $wuPath = "$env:SystemRoot\SoftwareDistribution\Download"
    Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue
    $totalLibéré += Remove-Contenu $wuPath "Cache Windows Update"
    Start-Service -Name wuauserv -ErrorAction SilentlyContinue
}

if ($CONFIG.Vider_MiniDumps) {
    $totalLibéré += Remove-Contenu "$env:SystemRoot\Minidump" "Minidumps (crashs)"
}

if ($CONFIG.Vider_ErrorReports) {
    $totalLibéré += Remove-Contenu "$env:LOCALAPPDATA\Microsoft\Windows\WER\ReportArchive" "Rapports d'erreurs (archive)"
    $totalLibéré += Remove-Contenu "$env:LOCALAPPDATA\Microsoft\Windows\WER\ReportQueue"  "Rapports d'erreurs (queue)"
}

if ($CONFIG.Vider_ThumbCache) {
    $thumbPath = "$env:LOCALAPPDATA\Microsoft\Windows\Explorer"
    if (Test-Path $thumbPath) {
        $avant = 0
        Get-ChildItem "$thumbPath\thumbcache_*.db" -ErrorAction SilentlyContinue | ForEach-Object {
            $avant += $_.Length
            if (!$CONFIG.SimulationUniquement) {
                Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
            }
        }
        $totalLibéré += $avant
        Write-Host "  $(if($CONFIG.SimulationUniquement){'[SIM]'}else{'[OK]'}) Cache miniatures — $(Format-Octets $avant) libérés" -ForegroundColor Green
    }
}

if ($CONFIG.Vider_Corbeille) {
    if (!$CONFIG.SimulationUniquement) {
        Clear-RecycleBin -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  $(if($CONFIG.SimulationUniquement){'[SIM]'}else{'[OK]'}) Corbeille vidée" -ForegroundColor Green
}

if ($CONFIG.TousLesProfils) {
    $profils = Get-ChildItem "C:\Users" -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin @('Public','Default','Default User') }
    foreach ($profil in $profils) {
        $tempPath = Join-Path $profil.FullName "AppData\Local\Temp"
        $totalLibéré += Remove-Contenu $tempPath "Temp — $($profil.Name)"
    }
}

Write-Host ""
if ($CONFIG.AfficherEspaceLiberé) {
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "  Espace total libéré : $(Format-Octets $totalLibéré)" -ForegroundColor Cyan
}
Write-Host "[DONE] Nettoyage terminé." -ForegroundColor Green
