## WINTOOL:START
## title    : Vérification système SFC
## desc     : Lance SFC et DISM pour détecter et réparer les fichiers Windows corrompus
## category : sante
## icon     : 🔍
## tags     : sfc, dism, réparation, corruption, système
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Vérification et réparation des fichiers système
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # Lancer SFC (System File Checker)
    # Vérifie et répare les fichiers Windows corrompus
    Lancer_SFC              = $true

    # Lancer DISM (Deployment Image Servicing)
    # Répare l'image Windows elle-même (plus profond que SFC)
    Lancer_DISM             = $true

    # Ordre d'exécution recommandé : DISM d'abord, puis SFC
    DISM_Avant_SFC          = $true

    # Vérifier l'état du store Windows Update (DISM CheckHealth)
    DISM_CheckHealth        = $true

    # Tenter une réparation automatique si corruption détectée
    DISM_RestoreHealth      = $true

    # Sauvegarder le rapport SFC dans un fichier texte
    SauvegarderRapport      = $true
    DossierRapport          = "$env:USERPROFILE\Desktop\WinTool_Rapports"

    # Afficher un résumé à la fin
    AfficherResume          = $true
}

# ==============================================================
# EXECUTION
# ==============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Vérification et réparation système" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Cette opération peut prendre 10 à 30 minutes." -ForegroundColor DarkGray
Write-Host ""

$resultats = @{}
$debut = Get-Date

if ($CONFIG.SauvegarderRapport) {
    if (!(Test-Path $CONFIG.DossierRapport)) {
        New-Item -ItemType Directory -Path $CONFIG.DossierRapport -Force | Out-Null
    }
}

# --- DISM ---
if ($CONFIG.Lancer_DISM -and $CONFIG.DISM_Avant_SFC) {

    if ($CONFIG.DISM_CheckHealth) {
        Write-Host "[ DISM — Vérification rapide de l'image ]" -ForegroundColor Yellow
        Write-Host "  En cours..." -ForegroundColor DarkGray
        $output = & dism /Online /Cleanup-Image /CheckHealth 2>&1
        $resultats['DISM_Check'] = $output -join "`n"

        if ($output -match "No component store corruption detected") {
            Write-Host "  [OK] Aucune corruption détectée" -ForegroundColor Green
        } elseif ($output -match "The component store is repairable") {
            Write-Host "  [!] Corruption détectée — réparation nécessaire" -ForegroundColor Yellow
        } else {
            Write-Host "  [?] Résultat indéterminé" -ForegroundColor DarkGray
        }
        Write-Host ""
    }

    if ($CONFIG.DISM_RestoreHealth) {
        Write-Host "[ DISM — Réparation de l'image Windows ]" -ForegroundColor Yellow
        Write-Host "  En cours (peut durer 10-20 min, téléchargement possible)..." -ForegroundColor DarkGray
        $output = & dism /Online /Cleanup-Image /RestoreHealth 2>&1
        $resultats['DISM_Restore'] = $output -join "`n"

        if ($output -match "The restore operation completed successfully") {
            Write-Host "  [OK] Image Windows réparée avec succès" -ForegroundColor Green
        } elseif ($output -match "The operation completed successfully") {
            Write-Host "  [OK] Opération terminée avec succès" -ForegroundColor Green
        } else {
            Write-Host "  [!] Vérifier le rapport pour les détails" -ForegroundColor Yellow
        }
        Write-Host ""
    }
}

# --- SFC ---
if ($CONFIG.Lancer_SFC) {
    Write-Host "[ SFC — Vérification des fichiers système ]" -ForegroundColor Yellow
    Write-Host "  En cours (5 à 15 minutes)..." -ForegroundColor DarkGray

    $sfcOutput = & sfc /scannow 2>&1
    $resultats['SFC'] = $sfcOutput -join "`n"

    if ($sfcOutput -match "did not find any integrity violations") {
        Write-Host "  [OK] Aucun fichier corrompu détecté" -ForegroundColor Green
    } elseif ($sfcOutput -match "found corrupt files and successfully repaired") {
        Write-Host "  [OK] Fichiers corrompus réparés avec succès" -ForegroundColor Green
    } elseif ($sfcOutput -match "found corrupt files but was unable to fix") {
        Write-Host "  [!] Fichiers corrompus détectés mais non réparés — relancer après DISM" -ForegroundColor Red
    } else {
        Write-Host "  [?] Résultat indéterminé — voir rapport" -ForegroundColor Yellow
    }
    Write-Host ""
}

# --- DISM après SFC si demandé ---
if ($CONFIG.Lancer_DISM -and !$CONFIG.DISM_Avant_SFC -and $CONFIG.DISM_RestoreHealth) {
    Write-Host "[ DISM — Réparation de l'image Windows ]" -ForegroundColor Yellow
    Write-Host "  En cours..." -ForegroundColor DarkGray
    $output = & dism /Online /Cleanup-Image /RestoreHealth 2>&1
    $resultats['DISM_Restore'] = $output -join "`n"
    Write-Host "  [OK] Terminé" -ForegroundColor Green
    Write-Host ""
}

# --- Sauvegarde rapport ---
if ($CONFIG.SauvegarderRapport) {
    $fichier = Join-Path $CONFIG.DossierRapport "rapport_systeme_$(Get-Date -Format 'yyyy-MM-dd_HH-mm').txt"
    $contenu = @"
Rapport WinTool — Vérification Système
Date : $(Get-Date -Format 'dd/MM/yyyy HH:mm')
Durée : $([math]::Round(((Get-Date) - $debut).TotalMinutes, 1)) minutes
========================================

"@
    foreach ($key in $resultats.Keys) {
        $contenu += "`n=== $key ===`n$($resultats[$key])`n"
    }
    $contenu | Out-File $fichier -Encoding UTF8
    Write-Host "  [OK] Rapport sauvegardé : $fichier" -ForegroundColor DarkGray
}

if ($CONFIG.AfficherResume) {
    $duree = [math]::Round(((Get-Date) - $debut).TotalMinutes, 1)
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "  Durée totale : $duree minutes" -ForegroundColor Cyan
    Write-Host "  Un redémarrage est recommandé après la réparation." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "[DONE] Vérification système terminée." -ForegroundColor Green
