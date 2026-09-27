## WINTOOL:START
## id            : 02fec307-3a3d-477c-9ea6-f322170e0d74
## lang          : en
## title         : Disable ad tracking
## desc          : Stops Windows from profiling you to show targeted ads and suggestions
## category      : privacy
## icon          : eye-off
## tags          : advertising id, ads, tracking, suggestions, tailored experiences
## version       : 2.0
## admin         : false
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Mode          : [select] Action — turn the checked items off or on
##   disable     : Turn the checked items off
##   enable      : Turn the checked items on
## Items         : [multi]  What to disable — pick one or more
##   adid        : Advertising ID — used by apps to show targeted ads
##   apptracking : App launch tracking — used to personalise Start and search
##   tailored    : Tailored experiences — tips and offers based on your diagnostic data
## SafeTest      : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title         : Désactiver la publicité ciblée
## desc          : Empêche Windows de vous profiler pour afficher des publicités et des suggestions
## Mode          : Action — désactiver ou activer les éléments cochés
##   disable     : Désactiver les éléments cochés
##   enable      : Activer les éléments cochés
## Items         : Quoi désactiver — un ou plusieurs éléments
##   adid        : Identifiant publicitaire — utilisé par les applications pour cibler les publicités
##   apptracking : Suivi des lancements d'applications — sert à personnaliser Démarrer et la recherche
##   tailored    : Expériences personnalisées — astuces et offres basées sur vos données de diagnostic
## SafeTest      : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode     = "disable"
    Items    = @("adid", "apptracking", "tailored")
    SafeTest = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# Reglages du compte courant (HKCU) : WinTool etant eleve, c'est le compte qui a
# accepte l'elevation. Chaque element = une liste de valeurs DWORD, avec la
# valeur "desactive" et la valeur d'origine de Windows.
# SafeTest : les valeurs sont lues, rien n'est ecrit.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Restore  = ($CONFIG.Mode -eq 'enable')
$errors   = 0

$Definitions = @{
    adid = @{ Label = 'Advertising ID'; Values = @(
        @{ Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo'; Name = 'Enabled'; Off = 0; Default = 1 }
    ) }
    apptracking = @{ Label = 'App launch tracking'; Values = @(
        @{ Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'; Name = 'Start_TrackProgs'; Off = 0; Default = 1 }
    ) }
    tailored = @{ Label = 'Tailored experiences'; Values = @(
        @{ Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Privacy'; Name = 'TailoredExperiencesWithDiagnosticDataEnabled'; Off = 0; Default = 1 }
    ) }
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - settings are read, nothing is changed" }

$items = @($CONFIG.Items)
if ($items.Count -eq 0) {
    Write-Host "[WARN] Nothing selected - nothing to do"
    Write-Host "[DONE] Nothing changed"
    exit 0
}

$step = 0
$total = $items.Count
foreach ($key in $items) {
    $step++
    $def = $Definitions[$key]
    if (-not $def) {
        Write-Host "[STEP] $step/$total Unknown item '$key'"
        Write-Host "[WARN] Unknown item '$key' - skipped"
        continue
    }
    Write-Host "[STEP] $step/$total $($def.Label)"

    foreach ($v in $def.Values) {
        if ($Restore) { $wanted = $v.Default } else { $wanted = $v.Off }
        $current = (Get-ItemProperty -Path $v.Path -Name $v.Name -ErrorAction SilentlyContinue).($v.Name)

        if ($null -ne $current -and [int]$current -eq $wanted) {
            Write-Host "[OK]   $($v.Name) already $wanted"
            continue
        }
        if ($SafeTest) {
            Write-Host "[INFO] SafeTest - would set $($v.Name) = $wanted (currently $(if ($null -eq $current) { 'not set' } else { $current }))"
            continue
        }
        try {
            if (-not (Test-Path $v.Path)) { New-Item -Path $v.Path -Force -ErrorAction Stop | Out-Null }
            Set-ItemProperty -Path $v.Path -Name $v.Name -Value $wanted -Type DWord -ErrorAction Stop
            Write-Host "[OK]   $($v.Name) = $wanted"
        } catch {
            Write-Host "[ERR]  $($v.Name): $($_.Exception.Message)"
            $errors++
        }
    }
}

if ($SafeTest) {
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}
if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}
if ($Restore) { Write-Host "[DONE] Ad tracking settings restored" } else { Write-Host "[DONE] Ad tracking disabled" }
exit 0
