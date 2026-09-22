## WINTOOL:START
## title    : Désactiver la veille
## desc     : Empêche Windows de se mettre en veille ou en hibernation
## category : performance
## icon     : 😴
## tags     : veille, hibernation, énergie, batterie
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Désactivation de la veille
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # Mettre à 0 = jamais (recommandé), sinon délai en minutes
    VeilleBranche_Min       = 0       # Veille sur secteur (AC)
    VeilleBatterie_Min      = 0       # Veille sur batterie (DC)
    VeilleProlongee_Min     = 0       # Mise en veille prolongée
    EcranBranche_Min        = 0       # Extinction écran sur secteur
    EcranBatterie_Min       = 0       # Extinction écran sur batterie

    # Désactiver l'hibernation complètement (supprime hiberfil.sys)
    DesactiverHibernation   = $true

    # Verrouiller via registre (résiste aux MAJ Windows)
    VerrouillerRegistre     = $true

    # Afficher un résumé des paramètres appliqués
    AfficherResume          = $true
}

# ==============================================================
# EXECUTION — ne pas modifier en dessous
# ==============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Désactivation de la veille" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan

# Appliquer via powercfg
powercfg /change standby-timeout-ac   $CONFIG.VeilleBranche_Min
powercfg /change standby-timeout-dc   $CONFIG.VeilleBatterie_Min
powercfg /change hibernate-timeout-ac $CONFIG.VeilleProlongee_Min
powercfg /change hibernate-timeout-dc $CONFIG.VeilleProlongee_Min
powercfg /change monitor-timeout-ac   $CONFIG.EcranBranche_Min
powercfg /change monitor-timeout-dc   $CONFIG.EcranBatterie_Min

if ($CONFIG.DesactiverHibernation) {
    powercfg /hibernate off
    Write-Host "[OK] Hibernation désactivée (hiberfil.sys supprimé)" -ForegroundColor Green
}

if ($CONFIG.VerrouillerRegistre) {
    $sleepGUID = "238C9FA8-0AAD-41ED-83F4-97BE242C8F20\29F6C1DB-86DA-48C5-9FDB-F2B67B1F44DA"
    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Power\PowerSettings\$sleepGUID"
    if (Test-Path $regPath) {
        Set-ItemProperty -Path $regPath -Name "ACSettingIndex" -Value 0 -ErrorAction SilentlyContinue
        Set-ItemProperty -Path $regPath -Name "DCSettingIndex" -Value 0 -ErrorAction SilentlyContinue
    }

    $policyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Power\PowerSettings\$sleepGUID"
    If (!(Test-Path $policyPath)) { New-Item -Path $policyPath -Force | Out-Null }
    Set-ItemProperty -Path $policyPath -Name "ACSettingIndex" -Value 0
    Set-ItemProperty -Path $policyPath -Name "DCSettingIndex" -Value 0
    Write-Host "[OK] Paramètres verrouillés dans le registre" -ForegroundColor Green
}

if ($CONFIG.AfficherResume) {
    Write-Host ""
    Write-Host "--- Résumé appliqué ---" -ForegroundColor DarkGray
    Write-Host "  Veille (secteur)     : $($CONFIG.VeilleBranche_Min) min"
    Write-Host "  Veille (batterie)    : $($CONFIG.VeilleBatterie_Min) min"
    Write-Host "  Écran (secteur)      : $($CONFIG.EcranBranche_Min) min"
    Write-Host "  Écran (batterie)     : $($CONFIG.EcranBatterie_Min) min"
    Write-Host "  Hibernation          : $(if ($CONFIG.DesactiverHibernation) { 'Désactivée' } else { 'Non modifiée' })"
}

Write-Host ""
Write-Host "[DONE] Veille désactivée avec succès." -ForegroundColor Green
