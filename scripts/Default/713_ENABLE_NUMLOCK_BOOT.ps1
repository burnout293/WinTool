## WINTOOL:START
## id            : 64e0d248-f52c-4ba6-be04-29bb80248251
## lang          : en
## title         : Num Lock on at startup
## desc          : Turns the number pad on automatically at the sign-in screen and after login
## category      : customize
## icon          : keyboard
## tags          : num lock, numlock, keyboard, startup, boot, login
## version       : 1.0
## admin         : true
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Mode              : [select] Action — turn Num Lock at startup on or off
##   enable          : Turn Num Lock on at startup
##   disable         : Do not force Num Lock at startup — the Windows default
## Scopes            : [multi]  Where to apply — pick one or more
##   signin          : Sign-in screen — before anyone logs in
##   currentuser     : Your account — after you log in
## DisableFastStartup : [bool]  Also disable fast startup — makes the setting reliable, it can otherwise be ignored
## SafeTest          : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title             : Verr Num activé au démarrage
## desc              : Active automatiquement le pavé numérique à l'écran de connexion et après ouverture de session
## Mode              : Action — activer ou désactiver le Verr Num au démarrage
##   enable          : Activer le Verr Num au démarrage
##   disable         : Ne pas forcer le Verr Num au démarrage — le réglage de Windows
## Scopes            : Où appliquer — un ou plusieurs
##   signin          : Écran de connexion — avant toute ouverture de session
##   currentuser     : Votre compte — après ouverture de session
## DisableFastStartup : Désactiver aussi le démarrage rapide — rend le réglage fiable, sinon il peut être ignoré
## SafeTest          : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode               = "enable"
    Scopes             = @("signin", "currentuser")
    DisableFastStartup = $true
    SafeTest           = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# InitialKeyboardIndicators (REG_SZ) : "2" = Verr Num actif, "0" = inactif.
#   - ecran de connexion : ruche HKEY_USERS\.DEFAULT
#   - compte courant     : HKCU
# Le demarrage rapide restaure l'etat precedent et peut ignorer ce reglage :
# option pour le desactiver (comme 205, mais autonome ici).
# SafeTest : les valeurs sont lues, rien n'est ecrit.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Enable   = ($CONFIG.Mode -ne 'disable')
$errors   = 0

if ($Enable) { $wanted = '2' } else { $wanted = '0' }

$scopeDefs = @{
    signin      = @{ Label = 'Sign-in screen'; Path = 'Registry::HKEY_USERS\.DEFAULT\Control Panel\Keyboard' }
    currentuser = @{ Label = 'Your account';   Path = 'HKCU:\Control Panel\Keyboard' }
}

function Set-Indicator {
    param([string] $Label, [string] $Path)
    $current = (Get-ItemProperty -Path $Path -Name 'InitialKeyboardIndicators' -ErrorAction SilentlyContinue).InitialKeyboardIndicators
    if ("$current" -eq "$wanted") { Write-Host "[OK]   $($Label): already $wanted"; return }
    if ($SafeTest) { Write-Host "[INFO] SafeTest - would set $Label InitialKeyboardIndicators = $wanted (currently $(if ($null -eq $current) { 'not set' } else { $current }))"; return }
    try {
        if (-not (Test-Path $Path)) { New-Item -Path $Path -Force -ErrorAction Stop | Out-Null }
        Set-ItemProperty -Path $Path -Name 'InitialKeyboardIndicators' -Value "$wanted" -Type String -ErrorAction Stop
        Write-Host "[OK]   $($Label): set to $wanted"
    } catch { Write-Host "[ERR]  $($Label): $($_.Exception.Message)"; $script:errors++ }
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - settings are read, nothing is changed" }

$scopes = @($CONFIG.Scopes)
if ($scopes.Count -eq 0) {
    Write-Host "[WARN] No scope selected - nothing to do"
    Write-Host "[DONE] Nothing changed"
    exit 0
}

$total = $scopes.Count + $(if ($CONFIG.DisableFastStartup) { 1 } else { 0 })
$step  = 0
foreach ($key in $scopes) {
    $step++
    $def = $scopeDefs[$key]
    if (-not $def) {
        Write-Host "[STEP] $step/$total Unknown scope '$key'"
        Write-Host "[WARN] Unknown scope '$key' - skipped"
        continue
    }
    Write-Host "[STEP] $step/$total $($def.Label)"
    Set-Indicator $def.Label $def.Path
}

if ($CONFIG.DisableFastStartup) {
    $step++
    Write-Host "[STEP] $step/$total Fast startup"
    $fsPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
    $cur = (Get-ItemProperty -Path $fsPath -Name 'HiberbootEnabled' -ErrorAction SilentlyContinue).HiberbootEnabled
    if ($null -ne $cur -and [int]$cur -eq 0) {
        Write-Host "[OK]   Fast startup already disabled"
    } elseif ($SafeTest) {
        Write-Host "[INFO] SafeTest - would disable fast startup (HiberbootEnabled = 0)"
    } else {
        try {
            Set-ItemProperty -Path $fsPath -Name 'HiberbootEnabled' -Value 0 -Type DWord -ErrorAction Stop
            Write-Host "[OK]   Fast startup disabled - Num Lock will stick reliably"
        } catch { Write-Host "[ERR]  Fast startup: $($_.Exception.Message)"; $errors++ }
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
Write-Host "[DONE] Num Lock at startup updated"
exit 0
