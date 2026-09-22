## WINTOOL:START
## title    : Santé des disques SMART
## desc     : Vérifie l'état SMART des disques durs et SSD
## category : sante
## icon     : 💾
## tags     : smart, disque, hdd, ssd, santé, panne
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Vérification SMART des disques (santé hardware)
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # Afficher tous les disques détectés
    AfficherTousLesDisques  = $true

    # Seuils d'alerte (en % d'usure pour les SSD)
    Seuil_Alerte_Usure      = 80       # Alerte si usure SSD > 80%
    Seuil_Alerte_Temp       = 55       # Alerte si température > 55°C

    # Sauvegarder le rapport sur le Bureau
    SauvegarderRapport      = $true
    DossierRapport          = "$env:USERPROFILE\Desktop\WinTool_Rapports"

    # Afficher les attributs SMART détaillés (mode expert)
    AfficherSMARTDetaille   = $false
}

# ==============================================================
# EXECUTION
# ==============================================================

function Get-EtatSante {
    param([string]$Status)
    switch ($Status) {
        "OK"       { return @{ Texte = "Bon état"; Couleur = "Green" } }
        "Degraded" { return @{ Texte = "Dégradé — surveiller"; Couleur = "Yellow" } }
        "Error"    { return @{ Texte = "ERREUR — remplacer!"; Couleur = "Red" } }
        "Unknown"  { return @{ Texte = "Inconnu"; Couleur = "DarkGray" } }
        default    { return @{ Texte = $Status; Couleur = "White" } }
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Vérification SMART des disques" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host ""

$rapport = @()
$alertes = @()

# --- Récupération des disques via WMI ---
$disques = Get-WmiObject -Class Win32_DiskDrive -ErrorAction SilentlyContinue
$diskStatus = Get-WmiObject -Namespace root\wmi -Class MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue
$diskData   = Get-WmiObject -Namespace root\wmi -Class MSStorageDriver_FailurePredictData   -ErrorAction SilentlyContinue

if (!$disques) {
    Write-Host "[ERR] Impossible de lire les informations disques." -ForegroundColor Red
    exit 1
}

foreach ($disk in $disques) {
    $index = $disk.Index
    $modele = $disk.Model.Trim()
    $taille = [math]::Round($disk.Size / 1GB, 0)
    $interface = $disk.InterfaceType
    $serie = $disk.SerialNumber.Trim()

    # Type de disque (estimation)
    $type = if ($modele -match "SSD|NVMe|M\.2|KINGSTON|SAMSUNG|WD Blue|Crucial|Micron") { "SSD" }
            elseif ($disk.MediaType -eq "Fixed hard disk media") { "HDD" }
            else { "Disque" }

    Write-Host "[ Disque $index — $modele ]" -ForegroundColor Yellow
    Write-Host "  Type      : $type ($interface)" -ForegroundColor White
    Write-Host "  Capacité  : $taille Go" -ForegroundColor White
    Write-Host "  Série     : $serie" -ForegroundColor DarkGray

    # Statut SMART via WMI
    $smart = $diskStatus | Where-Object { $_.InstanceName -match "Disk$index" } | Select-Object -First 1
    if ($smart) {
        $predFailure = $smart.PredictFailure
        if ($predFailure) {
            Write-Host "  SMART     : PRÉDICTION DE PANNE DÉTECTÉE!" -ForegroundColor Red
            $alertes += "CRITIQUE : Panne prédite sur $modele"
        } else {
            Write-Host "  SMART     : Aucune panne prédite" -ForegroundColor Green
        }
    } else {
        Write-Host "  SMART     : Données non accessibles (driver ou interface)" -ForegroundColor DarkGray
    }

    # Statut global Windows
    $physDisk = Get-PhysicalDisk | Where-Object { $_.DeviceId -eq $index } -ErrorAction SilentlyContinue
    if ($physDisk) {
        $etat = Get-EtatSante $physDisk.HealthStatus
        Write-Host "  État      : $($etat.Texte)" -ForegroundColor $etat.Couleur

        # Usure SSD
        if ($physDisk.MediaType -eq "SSD" -and $physDisk.Usage -ne $null) {
            Write-Host "  Usure SSD : $($physDisk.Usage)%" -ForegroundColor $(if ($physDisk.Usage -gt $CONFIG.Seuil_Alerte_Usure) { "Red" } else { "Green" })
            if ($physDisk.Usage -gt $CONFIG.Seuil_Alerte_Usure) {
                $alertes += "ALERTE : Usure SSD élevée sur $modele ($($physDisk.Usage)%)"
            }
        }

        # Température
        if ($physDisk.Temperature) {
            $temp = $physDisk.Temperature
            Write-Host "  Temp.     : $temp °C" -ForegroundColor $(if ($temp -gt $CONFIG.Seuil_Alerte_Temp) { "Red" } else { "Green" })
            if ($temp -gt $CONFIG.Seuil_Alerte_Temp) {
                $alertes += "ALERTE : Température élevée sur $modele ($temp °C)"
            }
        }
    }

    # Partitions
    $partitions = Get-WmiObject -Query "ASSOCIATORS OF {Win32_DiskDrive.DeviceID='$($disk.DeviceID)'} WHERE AssocClass=Win32_DiskDriveToDiskPartition" -ErrorAction SilentlyContinue
    foreach ($part in $partitions) {
        $logicals = Get-WmiObject -Query "ASSOCIATORS OF {Win32_DiskPartition.DeviceID='$($part.DeviceID)'} WHERE AssocClass=Win32_LogicalDiskToPartition" -ErrorAction SilentlyContinue
        foreach ($logical in $logicals) {
            $libreGo = [math]::Round($logical.FreeSpace / 1GB, 1)
            $totalGo = [math]::Round($logical.Size / 1GB, 1)
            $pctLibre = if ($totalGo -gt 0) { [math]::Round(($libreGo / $totalGo) * 100, 0) } else { 0 }
            $couleur = if ($pctLibre -lt 10) { "Red" } elseif ($pctLibre -lt 20) { "Yellow" } else { "Green" }
            Write-Host "  $($logical.DeviceID)        : $libreGo Go libres / $totalGo Go ($pctLibre% libre)" -ForegroundColor $couleur
            if ($pctLibre -lt 10) {
                $alertes += "ALERTE : Disque $($logical.DeviceID) presque plein ($pctLibre% libre)"
            }
        }
    }

    Write-Host ""
    $rapport += "Disque $index — $modele — $type — $taille Go"
}

# --- Résumé des alertes ---
if ($alertes.Count -gt 0) {
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Red
    Write-Host "  ALERTES DÉTECTÉES :" -ForegroundColor Red
    foreach ($a in $alertes) {
        Write-Host "  ⚠ $a" -ForegroundColor Red
    }
    Write-Host ""
} else {
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "  Tous les disques semblent en bon état." -ForegroundColor Green
}

# --- Rapport ---
if ($CONFIG.SauvegarderRapport) {
    if (!(Test-Path $CONFIG.DossierRapport)) { New-Item -ItemType Directory -Path $CONFIG.DossierRapport -Force | Out-Null }
    $fichier = Join-Path $CONFIG.DossierRapport "rapport_disques_$(Get-Date -Format 'yyyy-MM-dd_HH-mm').txt"
    $contenu = "Rapport WinTool — Santé Disques`nDate : $(Get-Date -Format 'dd/MM/yyyy HH:mm')`n`n"
    $contenu += ($rapport -join "`n")
    if ($alertes.Count -gt 0) { $contenu += "`n`nALERTES :`n" + ($alertes -join "`n") }
    $contenu | Out-File $fichier -Encoding UTF8
    Write-Host "  Rapport sauvegardé : $fichier" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "[DONE] Vérification SMART terminée." -ForegroundColor Green
