## WINTOOL:START
## id            : 3f3ff641-24dd-4aef-9479-ae110192963a
## lang          : en
## title         : Take control of Windows updates
## desc          : Decides when and how Windows updates - defer, delay restarts, exclude drivers, or stop auto-updates
## category      : tools
## icon          : settings
## tags          : windows update, defer, restart, active hours, drivers, policy
## version       : 1.0
## admin         : true
## risk          : medium
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Mode              : [select] Action — turn the checked controls on or off
##   enable          : Turn the checked controls on
##   disable         : Turn the checked controls off — back to the Windows defaults
## Items             : [multi]  Controls — pick one or more
##   notifydownload  : Ask before downloading — Windows notifies instead of auto-downloading
##   noautorestart   : No restart while signed in — never auto-restart with a user logged on
##   noforcedrestart : No forced restart — disable deadline-based automatic restarts
##   activehours     : Set active hours — no restarts during your working hours
##   deferfeature    : Delay feature updates — the big yearly upgrades
##   deferquality    : Delay monthly updates — the monthly quality/security updates
##   excludedrivers  : Keep my drivers — do not get drivers from Windows Update
##   pausep2p        : Do not share updates — turn off update sharing to other PCs
##   stopauto        : Stop automatic updates — you decide when to check (advanced)
## FeatureDeferDays  : [number] Feature update delay — in days, up to 365
## QualityDeferDays  : [number] Monthly update delay — in days, up to 30
## ActiveStart       : [number] Active hours start — 0 to 23
## ActiveEnd         : [number] Active hours end — 0 to 23
## SafeTest          : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title             : Reprendre le contrôle des mises à jour
## desc              : Décide quand et comment Windows se met à jour - reporter, retarder les redémarrages, exclure les pilotes, ou stopper l'auto-MAJ
## Mode              : Action — activer ou désactiver les contrôles cochés
##   enable          : Activer les contrôles cochés
##   disable         : Désactiver les contrôles cochés — retour aux réglages de Windows
## Items             : Contrôles — un ou plusieurs éléments
##   notifydownload  : Demander avant de télécharger — Windows prévient au lieu de télécharger seul
##   noautorestart   : Pas de redémarrage si connecté — jamais de redémarrage auto avec une session ouverte
##   noforcedrestart : Pas de redémarrage forcé — désactive les redémarrages automatiques à échéance
##   activehours     : Définir les heures d'activité — aucun redémarrage pendant vos heures de travail
##   deferfeature    : Retarder les mises à jour de fonctionnalités — les grosses mises à niveau annuelles
##   deferquality    : Retarder les mises à jour mensuelles — les mises à jour qualité/sécurité
##   excludedrivers  : Garder mes pilotes — ne pas recevoir les pilotes via Windows Update
##   pausep2p        : Ne pas partager les mises à jour — coupe le partage vers d'autres PC
##   stopauto        : Stopper les mises à jour automatiques — vous décidez quand chercher (avancé)
## FeatureDeferDays  : Report des fonctionnalités — en jours, jusqu'à 365
## QualityDeferDays  : Report des mises à jour mensuelles — en jours, jusqu'à 30
## ActiveStart       : Début des heures d'activité — 0 à 23
## ActiveEnd         : Fin des heures d'activité — 0 à 23
## SafeTest          : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode             = "enable"
    Items            = @("noautorestart", "noforcedrestart", "activehours", "excludedrivers")
    FeatureDeferDays = 180
    QualityDeferDays = 15
    ActiveStart      = 8
    ActiveEnd        = 20
    SafeTest         = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# Uniquement des strategies machine sous HKLM\SOFTWARE\Policies\Microsoft\Windows.
# "Activer" = poser les valeurs. "Desactiver" = les supprimer (retour au defaut
# Windows). Certaines valeurs dependent des nombres (report, heures d'activite).
#
# ATTENTION : "stopauto" (NoAutoUpdate) coupe les mises a jour de securite
# automatiques - on l'annonce clairement. Le but est de rendre le controle,
# le user choisit.
# SafeTest : les valeurs sont lues, rien n'est ecrit.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Enable   = ($CONFIG.Mode -ne 'disable')
$errors   = 0

$WU = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
$AU = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
$DO = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization'

function I { param($v, $lo, $hi, $def) $n = 0; if ([int]::TryParse("$v", [ref]$n)) { if ($n -lt $lo) { return $lo }; if ($n -gt $hi) { return $hi }; return $n }; return $def }

# Chaque item -> liste de valeurs {Path, Name, On}. On calcule On au moment voulu
# pour injecter les nombres de config.
function Get-ItemValues {
    param([string] $Key)
    switch ($Key) {
        'notifydownload'  { return @(@{ Path = $AU; Name = 'NoAutoUpdate'; On = 0 }, @{ Path = $AU; Name = 'AUOptions'; On = 2 }) }
        'noautorestart'   { return @(@{ Path = $AU; Name = 'NoAutoRebootWithLoggedOnUsers'; On = 1 }) }
        'noforcedrestart' { return @(@{ Path = $AU; Name = 'AutoRestartDeadlinePeriodInDays'; On = 0 }, @{ Path = $WU; Name = 'SetAutoRestartDeadline'; On = 0 }) }
        'activehours'     { return @(@{ Path = $WU; Name = 'SetActiveHours'; On = 1 },
                                     @{ Path = $WU; Name = 'ActiveHoursStart'; On = (I $CONFIG.ActiveStart 0 23 8) },
                                     @{ Path = $WU; Name = 'ActiveHoursEnd';   On = (I $CONFIG.ActiveEnd   0 23 20) }) }
        'deferfeature'    { return @(@{ Path = $WU; Name = 'DeferFeatureUpdates'; On = 1 },
                                     @{ Path = $WU; Name = 'DeferFeatureUpdatesPeriodInDays'; On = (I $CONFIG.FeatureDeferDays 0 365 180) }) }
        'deferquality'    { return @(@{ Path = $WU; Name = 'DeferQualityUpdates'; On = 1 },
                                     @{ Path = $WU; Name = 'DeferQualityUpdatesPeriodInDays'; On = (I $CONFIG.QualityDeferDays 0 30 15) }) }
        'excludedrivers'  { return @(@{ Path = $WU; Name = 'ExcludeWUDriversInQualityUpdate'; On = 1 }) }
        'pausep2p'        { return @(@{ Path = $DO; Name = 'DODownloadMode'; On = 0 }) }
        'stopauto'        { return @(@{ Path = $AU; Name = 'NoAutoUpdate'; On = 1 }) }
        default           { return @() }
    }
}

$Labels = @{
    notifydownload = 'Ask before downloading'; noautorestart = 'No restart while signed in'
    noforcedrestart = 'No forced restart'; activehours = 'Set active hours'
    deferfeature = 'Delay feature updates'; deferquality = 'Delay monthly updates'
    excludedrivers = 'Keep my drivers'; pausep2p = 'Do not share updates'; stopauto = 'Stop automatic updates'
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - policies are read, nothing is changed" }

$items = @($CONFIG.Items)
if ($items.Count -eq 0) {
    Write-Host "[WARN] Nothing selected - nothing to do"
    Write-Host "[DONE] Nothing changed"
    exit 0
}
if ($Enable -and ($items -contains 'stopauto')) {
    Write-Host "[WARN] 'Stop automatic updates' turns off automatic security updates - you will need to check for updates yourself"
}

$step  = 0
$total = $items.Count
foreach ($key in $items) {
    $step++
    $vals = Get-ItemValues $key
    if ($vals.Count -eq 0) {
        Write-Host "[STEP] $step/$total Unknown control '$key'"
        Write-Host "[WARN] Unknown control '$key' - skipped"
        continue
    }
    Write-Host "[STEP] $step/$total $($Labels[$key])"

    foreach ($v in $vals) {
        if ($Enable) {
            $current = (Get-ItemProperty -Path $v.Path -Name $v.Name -ErrorAction SilentlyContinue).($v.Name)
            if ($null -ne $current -and [int]$current -eq [int]$v.On) { Write-Host "[OK]   $($v.Name) already $($v.On)"; continue }
            if ($SafeTest) { Write-Host "[INFO] SafeTest - would set $($v.Name) = $($v.On)"; continue }
            try {
                if (-not (Test-Path $v.Path)) { New-Item -Path $v.Path -Force -ErrorAction Stop | Out-Null }
                Set-ItemProperty -Path $v.Path -Name $v.Name -Value ([int]$v.On) -Type DWord -ErrorAction Stop
                Write-Host "[OK]   $($v.Name) = $($v.On)"
            } catch { Write-Host "[ERR]  $($v.Name): $($_.Exception.Message)"; $errors++ }
        } else {
            $exists = $null -ne (Get-ItemProperty -Path $v.Path -Name $v.Name -ErrorAction SilentlyContinue)
            if (-not $exists) { Write-Host "[OK]   $($v.Name) not set - nothing to remove"; continue }
            if ($SafeTest) { Write-Host "[INFO] SafeTest - would remove $($v.Name)"; continue }
            try {
                Remove-ItemProperty -Path $v.Path -Name $v.Name -ErrorAction Stop
                Write-Host "[OK]   $($v.Name) removed"
            } catch { Write-Host "[ERR]  $($v.Name): $($_.Exception.Message)"; $errors++ }
        }
    }
}

if (-not $SafeTest) {
    # Rafraichit la strategie pour un effet immediat (echec sans gravite).
    & gpupdate.exe /target:computer /force 2>&1 | Out-Null
}

if ($SafeTest) {
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}
if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}
Write-Host "[INFO] Open Settings > Windows Update to see the new behaviour"
if ($Enable) { Write-Host "[DONE] Update controls applied" } else { Write-Host "[DONE] Update controls removed" }
exit 0
