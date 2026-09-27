## WINTOOL:START
## id            : 02a64eeb-44ae-4e3c-8de0-d135a4275a4e
## lang          : en
## title         : Turn off accidental accessibility shortcuts
## desc          : Stops the pop-ups that appear when you press Shift or Num Lock repeatedly by accident
## category      : customize
## icon          : keyboard
## tags          : sticky keys, filter keys, toggle keys, accessibility, prompt
## version       : 1.0
## admin         : false
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Mode         : [select] Action — turn the checked items off or on
##   disable    : Turn the checked items off
##   enable     : Turn the checked items on — the Windows defaults
## Items        : [multi]  Which shortcuts to disable — pick one or more
##   sticky     : Sticky Keys — the prompt after pressing Shift five times
##   filter     : Filter Keys — the prompt after holding right Shift for 8 seconds
##   toggle     : Toggle Keys — the prompt after holding Num Lock for 5 seconds
## FullyDisable : [bool]   Also disable the feature itself — not just the shortcut and prompt
## SafeTest     : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title        : Désactiver les raccourcis d'accessibilité accidentels
## desc         : Stoppe les pop-ups qui apparaissent quand on appuie plusieurs fois sur Maj ou Verr Num par accident
## Mode         : Action — désactiver ou activer les éléments cochés
##   disable    : Désactiver les éléments cochés
##   enable     : Activer les éléments cochés — les réglages de Windows
## Items        : Quels raccourcis désactiver — un ou plusieurs
##   sticky     : Touches rémanentes — l'invite après cinq appuis sur Maj
##   filter     : Touches filtres — l'invite après 8 secondes sur la Maj droite
##   toggle     : Touches bascule — l'invite après 5 secondes sur Verr Num
## FullyDisable : Désactiver aussi la fonction elle-même — pas seulement le raccourci et l'invite
## SafeTest     : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode         = "disable"
    Items        = @("sticky", "filter", "toggle")
    FullyDisable = $false
    SafeTest     = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# Le champ "Flags" (REG_SZ) encode la configuration de chaque fonction :
#   bit 1 = fonction active, bit 2 = disponible, bit 4 = raccourci clavier actif.
# "Shortcut" retire le raccourci (et l'invite) ; "Full" retire aussi la
# disponibilite. "Default" = valeur d'origine de Windows.
# SafeTest : les valeurs sont lues, rien n'est ecrit.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Disable  = ($CONFIG.Mode -ne 'enable')
$Full     = ("$($CONFIG.FullyDisable)" -eq 'True')

$Definitions = @{
    sticky = @{ Label = 'Sticky Keys'; Path = 'HKCU:\Control Panel\Accessibility\StickyKeys';       Default = '510'; Shortcut = '506'; Full = '504' }
    filter = @{ Label = 'Filter Keys'; Path = 'HKCU:\Control Panel\Accessibility\Keyboard Response'; Default = '126'; Shortcut = '122'; Full = '120' }
    toggle = @{ Label = 'Toggle Keys'; Path = 'HKCU:\Control Panel\Accessibility\ToggleKeys';        Default = '62';  Shortcut = '58';  Full = '56'  }
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - settings are read, nothing is changed" }

$items = @($CONFIG.Items)
if ($items.Count -eq 0) {
    Write-Host "[WARN] Nothing selected - nothing to do"
    Write-Host "[DONE] Nothing changed"
    exit 0
}

$step  = 0
$total = $items.Count
$errors = 0
foreach ($key in $items) {
    $step++
    $def = $Definitions[$key]
    if (-not $def) {
        Write-Host "[STEP] $step/$total Unknown item '$key'"
        Write-Host "[WARN] Unknown item '$key' - skipped"
        continue
    }
    Write-Host "[STEP] $step/$total $($def.Label)"

    if ($Disable) { if ($Full) { $wanted = $def.Full } else { $wanted = $def.Shortcut } } else { $wanted = $def.Default }
    $current = (Get-ItemProperty -Path $def.Path -Name 'Flags' -ErrorAction SilentlyContinue).Flags

    if ("$current" -eq "$wanted") { Write-Host "[OK]   Flags already $wanted"; continue }
    if ($SafeTest) {
        Write-Host "[INFO] SafeTest - would set Flags = $wanted (currently $(if ($null -eq $current) { 'not set' } else { $current }))"
        continue
    }
    try {
        if (-not (Test-Path $def.Path)) { New-Item -Path $def.Path -Force -ErrorAction Stop | Out-Null }
        Set-ItemProperty -Path $def.Path -Name 'Flags' -Value "$wanted" -Type String -ErrorAction Stop
        Write-Host "[OK]   Flags = $wanted"
    } catch { Write-Host "[ERR]  $($def.Label): $($_.Exception.Message)"; $errors++ }
}

if ($SafeTest) {
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}
if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}
Write-Host "[INFO] Sign out and back in for the change to fully take effect"
Write-Host "[DONE] Accessibility shortcuts updated"
exit 0
