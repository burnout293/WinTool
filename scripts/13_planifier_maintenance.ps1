## WINTOOL:START
## title    : Maintenance mensuelle auto
## desc     : Crée une tâche planifiée pour la maintenance automatique chaque mois
## category : outillage
## icon     : 📅
## tags     : planificateur, automatique, mensuel, maintenance
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Planificateur de maintenance automatique mensuelle
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # Dossier contenant les scripts WinTool
    # Laisser vide pour détecter automatiquement
    DossierScripts          = ""

    # --- Planification ---
    JourDuMois              = 1        # Quel jour du mois (1 = 1er du mois)
    Heure                   = "04:00"  # Heure d'exécution (format HH:MM)
    SeulementSiBranche      = $true    # N'exécuter que si le PC est branché au secteur

    # --- Scripts à inclure dans la maintenance automatique ---
    Auto_Veille             = $false   # Déjà fait une fois, inutile de répéter
    Auto_VCRedist           = $false   # Idem
    Auto_Bloatware          = $false   # Idem
    Auto_AppsMicrosoft      = $false   # Idem
    Auto_NettoyageTemp      = $true    # Nettoyage mensuel fichiers temp
    Auto_CacheNavigateurs   = $true    # Nettoyage mensuel cache
    Auto_DNS                = $false   # DNS déjà configuré, pas besoin de répéter
    Auto_Telemetrie         = $true    # Revérifier après MAJ
    Auto_SFC                = $false   # Long, à faire manuellement
    Auto_SMART              = $true    # Vérification disque mensuelle
    Auto_Defrag             = $true    # Optimisation disques
    Auto_Notifications      = $false   # Déjà fait

    # --- Gestion des tâches ---
    # Supprimer la tâche existante avant de recréer
    RemplacerSiExiste       = $true

    # Nom de la tâche dans le planificateur Windows
    NomTache                = "WinTool_Maintenance_Mensuelle"

    # Afficher un récap de ce qui sera planifié
    AfficherRecap           = $true
}

# ==============================================================
# EXECUTION
# ==============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Planificateur de maintenance mensuelle" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host ""

# Détecter le dossier scripts
$dossierScripts = $CONFIG.DossierScripts
if (!$dossierScripts -or !(Test-Path $dossierScripts)) {
    $dossierScripts = Join-Path $PSScriptRoot ""
    if (!(Test-Path $dossierScripts)) {
        Write-Host "[ERR] Dossier scripts introuvable : $dossierScripts" -ForegroundColor Red
        exit 1
    }
}

# Mapping scripts
$scriptMap = @{
    Auto_NettoyageTemp    = "05_nettoyer_fichiers_temp.ps1"
    Auto_CacheNavigateurs = "06_nettoyer_cache_navigateurs.ps1"
    Auto_Telemetrie       = "08_desactiver_telemetrie.ps1"
    Auto_SMART            = "10_verifier_smart_disques.ps1"
    Auto_Defrag           = "11_optimiser_disques.ps1"
    Auto_Veille           = "01_desactiver_veille.ps1"
    Auto_VCRedist         = "02_installer_vcredist.ps1"
    Auto_Bloatware        = "03_supprimer_bloatwares.ps1"
    Auto_AppsMicrosoft    = "04_desinstaller_apps_ms.ps1"
    Auto_DNS              = "07_configurer_dns.ps1"
    Auto_SFC              = "09_verifier_systeme_sfc.ps1"
    Auto_Notifications    = "12_desactiver_notifications.ps1"
}

# Construire la liste des scripts à exécuter
$scriptsAExecuter = @()
foreach ($key in $scriptMap.Keys) {
    if ($CONFIG[$key] -eq $true) {
        $chemin = Join-Path $dossierScripts $scriptMap[$key]
        if (Test-Path $chemin) {
            $scriptsAExecuter += $chemin
        } else {
            Write-Host "  [!] Script introuvable, ignoré : $($scriptMap[$key])" -ForegroundColor Yellow
        }
    }
}

if ($scriptsAExecuter.Count -eq 0) {
    Write-Host "[!] Aucun script sélectionné pour la maintenance automatique." -ForegroundColor Yellow
    Write-Host "    Activez au moins un Auto_* dans la configuration." -ForegroundColor DarkGray
    exit 0
}

if ($CONFIG.AfficherRecap) {
    Write-Host "[ Scripts planifiés ]" -ForegroundColor Yellow
    $scriptsAExecuter | ForEach-Object { Write-Host "  + $(Split-Path $_ -Leaf)" -ForegroundColor White }
    Write-Host ""
    Write-Host "[ Planification ]" -ForegroundColor Yellow
    Write-Host "  Jour      : Le $($CONFIG.JourDuMois) de chaque mois" -ForegroundColor White
    Write-Host "  Heure     : $($CONFIG.Heure)" -ForegroundColor White
    Write-Host "  Condition : $(if($CONFIG.SeulementSiBranche){'Uniquement si branché au secteur'}else{'Toujours'})" -ForegroundColor White
    Write-Host ""
}

# Construire la commande PowerShell qui enchaîne les scripts
$commandeScripts = ($scriptsAExecuter | ForEach-Object { "& '$_'" }) -join "; "
$commandeComplète = "PowerShell -NoProfile -ExecutionPolicy Bypass -Command `"$commandeScripts`""

# Créer le trigger mensuel
$trigger = New-ScheduledTaskTrigger -Monthly -DaysOfMonth $CONFIG.JourDuMois -At $CONFIG.Heure

# Créer l'action
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$commandeScripts`""

# Paramètres
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfIdle `
    -IdleDuration (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

if ($CONFIG.SeulementSiBranche) {
    $settings.DisallowStartIfOnBatteries = $true
    $settings.StopIfGoingOnBatteries     = $true
}

# Supprimer si déjà existante
if ($CONFIG.RemplacerSiExiste) {
    Unregister-ScheduledTask -TaskName $CONFIG.NomTache -Confirm:$false -ErrorAction SilentlyContinue
}

# Enregistrer la tâche
try {
    Register-ScheduledTask `
        -TaskName $CONFIG.NomTache `
        -Trigger $trigger `
        -Action $action `
        -Settings $settings `
        -RunLevel Highest `
        -Force `
        -ErrorAction Stop | Out-Null

    Write-Host "  [OK] Tâche planifiée créée : $($CONFIG.NomTache)" -ForegroundColor Green
    Write-Host ""
    Write-Host "  La maintenance s'exécutera automatiquement le $($CONFIG.JourDuMois) de chaque mois à $($CONFIG.Heure)." -ForegroundColor Cyan
    Write-Host "  Visible dans : Planificateur de tâches Windows > Bibliothèque" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Pour désactiver : Planificateur de tâches > '$($CONFIG.NomTache)' > Désactiver" -ForegroundColor DarkGray
} catch {
    Write-Host "  [ERR] Impossible de créer la tâche : $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[DONE] Maintenance mensuelle planifiée." -ForegroundColor Green
