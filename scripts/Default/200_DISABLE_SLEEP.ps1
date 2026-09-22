## WINTOOL:START
## id            : 985863a2-4150-4790-90b5-fdb31feee22b
## lang          : en
## title         : Disable sleep
## desc          : Prevents Windows from sleeping or hibernating
## category      : performance
## icon          : moon
## tags          : sleep, hibernation, power, battery
## version       : 2.0
## admin         : true
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## SleepOnAC_Min          : [number] Sleep on AC power — 0 = never
## SleepOnBattery_Min     : [number] Sleep on battery — 0 = never
## HibernateAfter_Min     : [number] Hibernate after — 0 = never
## ScreenOffOnAC_Min      : [number] Turn off screen on AC power — 0 = never
## ScreenOffOnBattery_Min : [number] Turn off screen on battery — 0 = never
## RemoveHibernation      : [bool]   Remove hibernation — deletes hiberfil.sys, frees several GB
## LockInRegistry         : [hidden] Lock settings in the registry — survives Windows updates
## PrintSummary           : [hidden] Print a summary when finished
## WINTOOL:END

## WINTOOL:LANG fr
## title                  : Désactiver la veille
## desc                   : Empêche Windows de se mettre en veille ou en hibernation
## SleepOnAC_Min          : Veille sur secteur — 0 = jamais
## SleepOnBattery_Min     : Veille sur batterie — 0 = jamais
## HibernateAfter_Min     : Mise en veille prolongée — 0 = jamais
## ScreenOffOnAC_Min      : Extinction de l'écran sur secteur — 0 = jamais
## ScreenOffOnBattery_Min : Extinction de l'écran sur batterie — 0 = jamais
## RemoveHibernation      : Supprimer l'hibernation — efface hiberfil.sys, libère plusieurs Go
## LockInRegistry         : Verrouiller dans le registre — résiste aux mises à jour Windows
## PrintSummary           : Afficher un résumé en fin d'exécution
## WINTOOL:END

$CONFIG = @{
    SleepOnAC_Min          = 0
    SleepOnBattery_Min     = 0
    HibernateAfter_Min     = 0
    ScreenOffOnAC_Min      = 0
    ScreenOffOnBattery_Min = 0
    RemoveHibernation      = $true
    LockInRegistry         = $true
    PrintSummary           = $true
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    (Get-Content $env:WINTOOL_CONFIG -Raw | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en français (docs/FORMAT_SCRIPT.md).
# ==============================================================================

$errors = 0

function Invoke-Powercfg {
    param([string] $Arguments, [string] $Label)

    powercfg $Arguments.Split(' ') 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK]   $Label"
    } else {
        Write-Host "[ERR]  $Label (powercfg exit code $LASTEXITCODE)"
        $script:errors++
    }
}

Write-Host "[INFO] Disabling sleep and hibernation"

# --- 1/3 : delais d'inactivite -------------------------------------------
Write-Host "[STEP] 1/3 Applying power timeouts"

Invoke-Powercfg "/change standby-timeout-ac $($CONFIG.SleepOnAC_Min)"          "Sleep on AC power: $($CONFIG.SleepOnAC_Min) min"
Invoke-Powercfg "/change standby-timeout-dc $($CONFIG.SleepOnBattery_Min)"     "Sleep on battery: $($CONFIG.SleepOnBattery_Min) min"
Invoke-Powercfg "/change hibernate-timeout-ac $($CONFIG.HibernateAfter_Min)"   "Hibernate on AC power: $($CONFIG.HibernateAfter_Min) min"
Invoke-Powercfg "/change hibernate-timeout-dc $($CONFIG.HibernateAfter_Min)"   "Hibernate on battery: $($CONFIG.HibernateAfter_Min) min"
Invoke-Powercfg "/change monitor-timeout-ac $($CONFIG.ScreenOffOnAC_Min)"      "Screen off on AC power: $($CONFIG.ScreenOffOnAC_Min) min"
Invoke-Powercfg "/change monitor-timeout-dc $($CONFIG.ScreenOffOnBattery_Min)" "Screen off on battery: $($CONFIG.ScreenOffOnBattery_Min) min"

# --- 2/3 : hibernation ----------------------------------------------------
Write-Host "[STEP] 2/3 Hibernation"

if ($CONFIG.RemoveHibernation) {
    powercfg /hibernate off 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK]   Hibernation disabled - hiberfil.sys removed"
    } else {
        # Echec non bloquant : l'hibernation peut deja etre desactivee par une strategie.
        Write-Host "[WARN] Could not disable hibernation (exit code $LASTEXITCODE) - not blocking"
    }
} else {
    Write-Host "[INFO] Hibernation left unchanged"
}

# --- 3/3 : verrouillage registre ------------------------------------------
Write-Host "[STEP] 3/3 Registry lock"

if ($CONFIG.LockInRegistry) {
    # GUID du sous-groupe « Veille » puis du parametre « Mise en veille apres ».
    $sleepGuid  = '238C9FA8-0AAD-41ED-83F4-97BE242C8F20\29F6C1DB-86DA-48C5-9FDB-F2B67B1F44DA'
    $policyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Power\PowerSettings\$sleepGuid"

    try {
        if (-not (Test-Path $policyPath)) {
            New-Item -Path $policyPath -Force -ErrorAction Stop | Out-Null
        }
        Set-ItemProperty -Path $policyPath -Name 'ACSettingIndex' -Value 0 -Type DWord -ErrorAction Stop
        Set-ItemProperty -Path $policyPath -Name 'DCSettingIndex' -Value 0 -Type DWord -ErrorAction Stop
        Write-Host "[OK]   Settings locked in the registry"
    } catch {
        Write-Host "[ERR]  Registry lock failed: $($_.Exception.Message)"
        $errors++
    }
} else {
    Write-Host "[INFO] Registry lock skipped"
}

# --- Bilan ----------------------------------------------------------------
if ($CONFIG.PrintSummary) {
    if ($CONFIG.RemoveHibernation) { $hibernationState = 'disabled' } else { $hibernationState = 'unchanged' }
    Write-Host "[INFO] Summary"
    Write-Host "[INFO]   Sleep on AC / battery: $($CONFIG.SleepOnAC_Min) / $($CONFIG.SleepOnBattery_Min) min"
    Write-Host "[INFO]   Screen off on AC / battery: $($CONFIG.ScreenOffOnAC_Min) / $($CONFIG.ScreenOffOnBattery_Min) min"
    Write-Host "[INFO]   Hibernation: $hibernationState"
}

if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}

Write-Host "[DONE] Sleep disabled successfully"
exit 0
