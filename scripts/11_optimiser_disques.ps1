## WINTOOL:START
## title    : Optimiser les disques
## desc     : Défragmente les HDD et envoie un TRIM aux SSD
## category : performance
## icon     : 🔧
## tags     : défrag, trim, ssd, hdd, optimisation, disque
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Optimisation des disques (HDD défrag / SSD TRIM)
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # Optimiser tous les volumes détectés automatiquement
    TousLesVolumes          = $true

    # Si TousLesVolumes = $false, spécifier les lettres à traiter
    VolumesSpecifiques      = @("C", "D")

    # Analyser avant d'optimiser (affiche le % de fragmentation)
    AnalyserAvant           = $true

    # Forcer l'optimisation même si Windows juge inutile
    ForceOptimisation       = $false

    # Exclure les volumes sur batterie
    ExclureSurBatterie      = $true

    # Afficher un résumé à la fin
    AfficherResume          = $true
}

# ==============================================================
# EXECUTION
# ==============================================================

function Get-TypeVolume {
    param([string]$Lettre)
    try {
        $disk = Get-PhysicalDisk | Where-Object {
            $partitions = Get-Partition -DiskNumber $_.DeviceId -ErrorAction SilentlyContinue
            $partitions | Where-Object { $_.DriveLetter -eq $Lettre[0] }
        } | Select-Object -First 1
        if ($disk) { return $disk.MediaType }
    } catch {}
    return "Unknown"
}

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Optimisation des disques" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  HDD : défragmentation | SSD/NVMe : TRIM" -ForegroundColor DarkGray
Write-Host ""

# Vérification batterie
if ($CONFIG.ExclureSurBatterie) {
    $batterie = Get-WmiObject -Class Win32_Battery -ErrorAction SilentlyContinue
    if ($batterie -and $batterie.BatteryStatus -eq 1) {
        Write-Host "[!] PC sur batterie — optimisation annulée (modifier ExclureSurBatterie pour forcer)." -ForegroundColor Yellow
        exit 0
    }
}

# Récupérer les volumes
if ($CONFIG.TousLesVolumes) {
    $volumes = Get-Volume | Where-Object {
        $_.DriveLetter -and $_.DriveType -eq 'Fixed' -and $_.FileSystemType -ne 'Unknown'
    }
} else {
    $volumes = $CONFIG.VolumesSpecifiques | ForEach-Object {
        Get-Volume -DriveLetter $_ -ErrorAction SilentlyContinue
    } | Where-Object { $_ }
}

if (!$volumes) {
    Write-Host "[ERR] Aucun volume trouvé." -ForegroundColor Red
    exit 1
}

$resultats = @()

foreach ($vol in $volumes) {
    $lettre = "$($vol.DriveLetter):"
    $label  = if ($vol.FileSystemLabel) { $vol.FileSystemLabel } else { "Sans nom" }
    $libreGo = [math]::Round($vol.SizeRemaining / 1GB, 1)
    $totalGo  = [math]::Round($vol.Size / 1GB, 1)

    Write-Host "[ Volume $lettre — $label ($libreGo Go libres / $totalGo Go) ]" -ForegroundColor Yellow

    # Détecter le type de disque
    $mediaType = Get-TypeVolume $lettre
    $isSSD = ($mediaType -eq "SSD" -or $mediaType -eq "Unspecified")
    $typeLabel = if ($isSSD) { "SSD/NVMe → TRIM" } else { "HDD → Défragmentation" }
    Write-Host "  Type détecté : $typeLabel" -ForegroundColor DarkGray

    if ($CONFIG.AnalyserAvant) {
        Write-Host "  Analyse en cours..." -ForegroundColor DarkGray
        $analyze = Optimize-Volume -DriveLetter $vol.DriveLetter -Analyze -ErrorAction SilentlyContinue
    }

    Write-Host "  Optimisation en cours..." -ForegroundColor DarkGray

    try {
        if ($CONFIG.ForceOptimisation) {
            Optimize-Volume -DriveLetter $vol.DriveLetter -ReTrim -Defrag -ErrorAction Stop
        } else {
            Optimize-Volume -DriveLetter $vol.DriveLetter -ErrorAction Stop
        }
        Write-Host "  [OK] $lettre optimisé" -ForegroundColor Green
        $resultats += @{ Volume = $lettre; Statut = "OK"; Type = $typeLabel }
    } catch {
        Write-Host "  [ERR] $lettre — $_" -ForegroundColor Red
        $resultats += @{ Volume = $lettre; Statut = "Erreur"; Type = $typeLabel }
    }

    Write-Host ""
}

if ($CONFIG.AfficherResume) {
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "  Résumé :" -ForegroundColor Cyan
    foreach ($r in $resultats) {
        $couleur = if ($r.Statut -eq "OK") { "Green" } else { "Red" }
        Write-Host "  $($r.Volume) — $($r.Type) — $($r.Statut)" -ForegroundColor $couleur
    }
}

Write-Host ""
Write-Host "[DONE] Optimisation disques terminée." -ForegroundColor Green
