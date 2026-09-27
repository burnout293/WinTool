## WINTOOL:START
## id            : 3ee76dcd-7367-4a49-9a16-d3a6a2f29b71
## lang          : en
## title         : Bring back the full right-click menu
## desc          : Restores the classic Windows 10 right-click menu instead of the shortened Windows 11 one
## category      : customize
## icon          : layout-grid
## tags          : context menu, right-click, windows 11, classic, explorer
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
## Mode            : [select] Action — which right-click menu to use
##   classic       : Use the full classic menu (Windows 10 style)
##   modern        : Use the short modern menu (Windows 11 default)
## RestartExplorer : [bool]   Apply immediately — restarts the Explorer so the change shows at once
## SafeTest        : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title           : Retrouver le clic droit complet
## desc            : Rétablit le menu clic droit classique de Windows 10 au lieu du menu raccourci de Windows 11
## Mode            : Action — quel menu clic droit utiliser
##   classic       : Utiliser le menu complet classique (style Windows 10)
##   modern        : Utiliser le menu court moderne (défaut de Windows 11)
## RestartExplorer : Appliquer tout de suite — redémarre l'Explorateur pour un effet immédiat
## SafeTest        : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode            = "classic"
    RestartExplorer = $true
    SafeTest        = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# Le menu classique s'obtient en creant une cle CLSID vide avec un sous-cle
# InprocServer32 SANS valeur (default vide). "modern" = supprimer la cle.
# Reglage du compte courant (HKCU). SafeTest : lecture seule.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Classic  = ($CONFIG.Mode -ne 'modern')
$key      = 'HKCU:\Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}'
$inproc   = "$key\InprocServer32"

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - the setting is read, nothing is changed" }

Write-Host "[STEP] 1/2 Right-click menu"
$exists = Test-Path $inproc

if ($Classic) {
    if ($exists) {
        Write-Host "[OK]   Classic menu already active"
    } elseif ($SafeTest) {
        Write-Host "[INFO] SafeTest - would create the classic-menu key (empty InprocServer32)"
    } else {
        try {
            New-Item -Path $inproc -Force -ErrorAction Stop | Out-Null
            Set-ItemProperty -Path $inproc -Name '(default)' -Value '' -ErrorAction Stop
            Write-Host "[OK]   Classic right-click menu enabled"
        } catch { Write-Host "[ERR]  $($_.Exception.Message)"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1 }
    }
} else {
    if (-not $exists) {
        Write-Host "[OK]   Modern menu already active"
    } elseif ($SafeTest) {
        Write-Host "[INFO] SafeTest - would remove the classic-menu key"
    } else {
        try {
            Remove-Item -Path $key -Recurse -Force -ErrorAction Stop
            Write-Host "[OK]   Modern right-click menu restored"
        } catch { Write-Host "[ERR]  $($_.Exception.Message)"; Write-Host "[DONE] Finished with 1 error(s)"; exit 1 }
    }
}

Write-Host "[STEP] 2/2 Applying"
if ($SafeTest) {
    if ($CONFIG.RestartExplorer) { Write-Host "[INFO] SafeTest - would restart Explorer" }
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}
if ($CONFIG.RestartExplorer) {
    Write-Host "[INFO] Restarting Explorer"
    Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }
} else {
    Write-Host "[INFO] Sign out and back in for the change to take effect"
}
Write-Host "[DONE] Right-click menu updated"
exit 0
