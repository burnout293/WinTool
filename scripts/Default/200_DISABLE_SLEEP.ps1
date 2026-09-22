## WINTOOL:START
## id            : 985863a2-4150-4790-90b5-fdb31feee22b
## lang          : fr
## title         : Désactiver la veille
## desc          : Empêche Windows de se mettre en veille ou en hibernation
## category      : performance
## icon          : moon
## tags          : veille, hibernation, énergie, batterie
## version       : 2.0
## admin         : true
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:LANG en
## title                 : Disable sleep
## desc                  : Prevents Windows from sleeping or hibernating
## VeilleBranche_Min     : Sleep on AC power — 0 = never
## VeilleBatterie_Min    : Sleep on battery — 0 = never
## VeilleProlongee_Min   : Hibernate after — 0 = never
## EcranBranche_Min      : Turn off screen on AC power — 0 = never
## EcranBatterie_Min     : Turn off screen on battery — 0 = never
## DesactiverHibernation : Remove hibernation — deletes hiberfil.sys, frees several GB
## VerrouillerRegistre   : Lock settings in the registry — survives Windows updates
## AfficherResume        : Print a summary when finished
## WINTOOL:END

$CONFIG = @{
    VeilleBranche_Min     = 0      # [number] Veille sur secteur — 0 = jamais
    VeilleBatterie_Min    = 0      # [number] Veille sur batterie — 0 = jamais
    VeilleProlongee_Min   = 0      # [number] Mise en veille prolongée — 0 = jamais
    EcranBranche_Min      = 0      # [number] Extinction de l'écran sur secteur — 0 = jamais
    EcranBatterie_Min     = 0      # [number] Extinction de l'écran sur batterie — 0 = jamais
    DesactiverHibernation = $true  # [bool]   Supprimer l'hibernation — efface hiberfil.sys, libère plusieurs Go
    VerrouillerRegistre   = $true  # [hidden] Verrouiller dans le registre — résiste aux mises à jour Windows
    AfficherResume        = $true  # [hidden] Afficher un résumé en fin d'exécution
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    (Get-Content $env:WINTOOL_CONFIG -Raw | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Exécution — la sortie est en anglais (SPECIFICATION.md §10)
# ==============================================================================

$erreurs = 0

function Invoke-Powercfg {
    param([string] $Argument, [string] $Libelle)

    powercfg $Argument.Split(' ') 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK]   $Libelle"
    } else {
        Write-Host "[ERR]  $Libelle (powercfg exit code $LASTEXITCODE)"
        $script:erreurs++
    }
}

Write-Host "[INFO] Disabling sleep and hibernation"

# --- 1/3 ------------------------------------------------------------------
Write-Host "[STEP] 1/3 Applying power timeouts"

Invoke-Powercfg "/change standby-timeout-ac $($CONFIG.VeilleBranche_Min)"     "Sleep on AC power: $($CONFIG.VeilleBranche_Min) min"
Invoke-Powercfg "/change standby-timeout-dc $($CONFIG.VeilleBatterie_Min)"    "Sleep on battery: $($CONFIG.VeilleBatterie_Min) min"
Invoke-Powercfg "/change hibernate-timeout-ac $($CONFIG.VeilleProlongee_Min)" "Hibernate on AC power: $($CONFIG.VeilleProlongee_Min) min"
Invoke-Powercfg "/change hibernate-timeout-dc $($CONFIG.VeilleProlongee_Min)" "Hibernate on battery: $($CONFIG.VeilleProlongee_Min) min"
Invoke-Powercfg "/change monitor-timeout-ac $($CONFIG.EcranBranche_Min)"      "Screen off on AC power: $($CONFIG.EcranBranche_Min) min"
Invoke-Powercfg "/change monitor-timeout-dc $($CONFIG.EcranBatterie_Min)"     "Screen off on battery: $($CONFIG.EcranBatterie_Min) min"

# --- 2/3 ------------------------------------------------------------------
Write-Host "[STEP] 2/3 Hibernation"

if ($CONFIG.DesactiverHibernation) {
    powercfg /hibernate off 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK]   Hibernation disabled - hiberfil.sys removed"
    } else {
        Write-Host "[WARN] Could not disable hibernation (exit code $LASTEXITCODE) - not blocking"
    }
} else {
    Write-Host "[INFO] Hibernation left unchanged"
}

# --- 3/3 ------------------------------------------------------------------
Write-Host "[STEP] 3/3 Registry lock"

if ($CONFIG.VerrouillerRegistre) {
    $guidVeille = '238C9FA8-0AAD-41ED-83F4-97BE242C8F20\29F6C1DB-86DA-48C5-9FDB-F2B67B1F44DA'
    $cheminStrategie = "HKLM:\SOFTWARE\Policies\Microsoft\Power\PowerSettings\$guidVeille"

    try {
        if (-not (Test-Path $cheminStrategie)) {
            New-Item -Path $cheminStrategie -Force -ErrorAction Stop | Out-Null
        }
        Set-ItemProperty -Path $cheminStrategie -Name 'ACSettingIndex' -Value 0 -Type DWord -ErrorAction Stop
        Set-ItemProperty -Path $cheminStrategie -Name 'DCSettingIndex' -Value 0 -Type DWord -ErrorAction Stop
        Write-Host "[OK]   Settings locked in the registry"
    } catch {
        Write-Host "[ERR]  Registry lock failed: $($_.Exception.Message)"
        $erreurs++
    }
} else {
    Write-Host "[INFO] Registry lock skipped"
}

# --- Bilan ----------------------------------------------------------------
if ($CONFIG.AfficherResume) {
    Write-Host "[INFO] Summary"
    Write-Host "[INFO]   Sleep on AC / battery : $($CONFIG.VeilleBranche_Min) / $($CONFIG.VeilleBatterie_Min) min"
    Write-Host "[INFO]   Screen off AC / battery : $($CONFIG.EcranBranche_Min) / $($CONFIG.EcranBatterie_Min) min"
    if ($CONFIG.DesactiverHibernation) { $etatHib = 'disabled' } else { $etatHib = 'unchanged' }
    Write-Host "[INFO]   Hibernation : $etatHib"
}

if ($erreurs -gt 0) {
    Write-Host "[DONE] Finished with $erreurs error(s)"
    exit 1
}

Write-Host "[DONE] Sleep disabled successfully"
exit 0
