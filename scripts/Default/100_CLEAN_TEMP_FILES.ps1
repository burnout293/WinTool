## WINTOOL:START
## id            : b1ac0e0b-ef61-48b9-b609-9a900b1521fa
## lang          : en
## title         : Clean temporary files
## desc          : Deletes temporary files, error reports and crash dumps left behind by Windows and apps
## category      : cleaning
## icon          : broom
## tags          : temp, temporary, cache, dumps, disk space
## version       : 2.0
## admin         : true
## risk          : low
## duration      : medium
## reversible    : false
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Targets      : [multi]  What to clean — pick one or more
##   usertemp   : User temporary files — the TEMP folder of each user
##   wintemp    : Windows temporary files — C:\Windows\Temp
##   reports    : Error reports — reports queued for Microsoft
##   dumps      : Crash dumps — memory snapshots written after a crash
##   thumbnails : Thumbnail cache — rebuilt automatically by Explorer
##   deliveryopt : Update sharing cache — Delivery Optimization downloads
##   oldlogs    : Old setup and servicing logs — CBS, DISM, upgrade logs
## AllProfiles  : [bool]   All user accounts — otherwise only the current account
## MinAgeHours  : [number] Minimum file age — in hours, newer files are kept
## SafeTest     : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title        : Supprimer les fichiers temporaires
## desc         : Supprime les fichiers temporaires, rapports d'erreur et vidages laissés par Windows et les applications
## Targets      : Quoi nettoyer — un ou plusieurs éléments
##   usertemp   : Fichiers temporaires de l'utilisateur — le dossier TEMP de chaque compte
##   wintemp    : Fichiers temporaires de Windows — C:\Windows\Temp
##   reports    : Rapports d'erreur — rapports en attente d'envoi à Microsoft
##   dumps      : Vidages après plantage — copies de la mémoire écrites après un plantage
##   thumbnails : Cache des miniatures — reconstruit automatiquement par l'Explorateur
##   deliveryopt : Cache de partage des mises à jour — fichiers Delivery Optimization
##   oldlogs    : Anciens journaux d'installation et de maintenance — CBS, DISM, mise à niveau
## AllProfiles  : Tous les comptes — sinon uniquement le compte actuel
## MinAgeHours  : Ancienneté minimale — en heures, les fichiers plus récents sont conservés
## SafeTest     : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Targets     = @("usertemp", "wintemp", "reports", "dumps", "deliveryopt")
    AllProfiles = $false
    MinAgeHours = 24
    SafeTest    = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Code et sortie en anglais, commentaires en francais (docs/FORMAT_SCRIPT.md).
#
# SafeTest : les fichiers sont reellement listes et mesures (lecture seule), mais
# aucune suppression n'a lieu. Hors SafeTest, ce drapeau n'intervient nulle part
# ailleurs que dans le test "if ($SafeTest)" de Clear-Folder.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$errors   = 0
$freed    = [long]0
$cutoff   = (Get-Date).AddHours(-[double]$CONFIG.MinAgeHours)

function Format-Size {
    param([long] $Bytes)
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    return ('{0:N0} KB' -f ($Bytes / 1KB))
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal] $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Supprime les fichiers plus anciens que $cutoff, puis les dossiers vides.
# Un fichier verrouille (en cours d'utilisation) est ignore sans erreur.
function Clear-Folder {
    param([string] $Path, [string] $Label, [string] $Filter = '*', [switch] $TopOnly)

    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Host "[INFO] $($Label): not present, skipped"
        return
    }

    $files = @(Get-ChildItem -LiteralPath $Path -Filter $Filter -Recurse:(-not $TopOnly) -Force -File -ErrorAction SilentlyContinue |
               Where-Object { $_.LastWriteTime -lt $cutoff })
    $size = [long](($files | Measure-Object -Property Length -Sum).Sum)

    if ($files.Count -eq 0) {
        Write-Host "[OK]   $($Label): nothing to clean"
        return
    }

    if ($SafeTest) {
        Write-Host "[INFO] SafeTest - would delete $($files.Count) file(s), $(Format-Size $size) in $Label"
        $script:freed += $size
        Start-Sleep -Milliseconds 300
        return
    }

    $deleted = 0; $locked = 0; $freedHere = [long]0
    foreach ($f in $files) {
        try {
            Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
            $deleted++
            $freedHere += $f.Length
        } catch {
            $locked++
        }
    }

    # Dossiers vides, du plus profond au moins profond. Le dossier racine est conserve.
    if ($Filter -eq '*') {
        Get-ChildItem -LiteralPath $Path -Recurse -Force -Directory -ErrorAction SilentlyContinue |
            Sort-Object { $_.FullName.Length } -Descending |
            ForEach-Object {
                if (-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue)) {
                    Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
                }
            }
    }

    $script:freed += $freedHere
    Write-Host "[OK]   $($Label): $deleted file(s) deleted, $(Format-Size $freedHere) freed"
    if ($locked -gt 0) { Write-Host "[INFO] $($Label): $locked file(s) in use, left in place" }
}

# Profils a traiter : le compte courant, ou tous les profils reels de C:\Users.
function Get-ProfileRoots {
    if ($CONFIG.AllProfiles) {
        $usersRoot = Split-Path $env:USERPROFILE -Parent
        return @(Get-ChildItem -LiteralPath $usersRoot -Directory -Force -ErrorAction SilentlyContinue |
                 Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'AppData\Local') } |
                 ForEach-Object { Join-Path $_.FullName 'AppData\Local' })
    }
    return @($env:LOCALAPPDATA)
}

# ==============================================================================

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - files are measured, nothing is deleted" }
if (-not (Test-Admin)) {
    Write-Host "[WARN] Not running as administrator - system folders may be skipped"
}

$targets = @($CONFIG.Targets)
if ($targets.Count -eq 0) {
    Write-Host "[WARN] No target selected - nothing to do"
    Write-Host "[DONE] Nothing cleaned"
    exit 0
}

Write-Host "[INFO] Keeping files newer than $($CONFIG.MinAgeHours) hour(s)"
$step = 0
$total = $targets.Count

foreach ($target in $targets) {
    $step++
    switch ($target) {
        'usertemp' {
            Write-Host "[STEP] $step/$total User temporary files"
            if ($CONFIG.AllProfiles) {
                foreach ($root in Get-ProfileRoots) { Clear-Folder (Join-Path $root 'Temp') "Temp ($root)" }
            } else {
                Clear-Folder $env:TEMP 'User temp'
            }
        }
        'wintemp' {
            Write-Host "[STEP] $step/$total Windows temporary files"
            Clear-Folder (Join-Path $env:SystemRoot 'Temp') 'Windows temp'
        }
        'reports' {
            Write-Host "[STEP] $step/$total Error reports"
            Clear-Folder (Join-Path $env:ProgramData 'Microsoft\Windows\WER\ReportArchive') 'Archived reports'
            Clear-Folder (Join-Path $env:ProgramData 'Microsoft\Windows\WER\ReportQueue')   'Queued reports'
            foreach ($root in Get-ProfileRoots) { Clear-Folder (Join-Path $root 'Microsoft\Windows\WER') "User reports ($root)" }
        }
        'dumps' {
            Write-Host "[STEP] $step/$total Crash dumps"
            Clear-Folder (Join-Path $env:SystemRoot 'Minidump') 'Minidumps'
            Clear-Folder $env:SystemRoot 'Full memory dump' 'MEMORY.DMP' -TopOnly
            foreach ($root in Get-ProfileRoots) { Clear-Folder (Join-Path $root 'CrashDumps') "App crash dumps ($root)" }
        }
        'thumbnails' {
            Write-Host "[STEP] $step/$total Thumbnail cache"
            foreach ($root in Get-ProfileRoots) {
                Clear-Folder (Join-Path $root 'Microsoft\Windows\Explorer') "Thumbnails ($root)" 'thumbcache_*.db' -TopOnly
            }
        }
        'deliveryopt' {
            Write-Host "[STEP] $step/$total Update sharing cache (Delivery Optimization)"
            # Cmdlet native quand elle existe (Win 10/11), sinon suppression du dossier de cache.
            if (Get-Command Delete-DeliveryOptimizationCache -ErrorAction SilentlyContinue) {
                if ($SafeTest) {
                    Write-Host "[INFO] SafeTest - would run Delete-DeliveryOptimizationCache -Force"
                } else {
                    try {
                        Delete-DeliveryOptimizationCache -Force -ErrorAction Stop
                        Write-Host "[OK]   Delivery Optimization cache cleared"
                    } catch {
                        Write-Host "[WARN] Could not clear Delivery Optimization cache: $($_.Exception.Message)"
                    }
                }
            } else {
                Clear-Folder (Join-Path $env:SystemRoot 'ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache') 'Delivery Optimization'
            }
        }
        'oldlogs' {
            Write-Host "[STEP] $step/$total Old setup and servicing logs"
            Clear-Folder (Join-Path $env:SystemRoot 'Logs\CBS')  'CBS logs'  '*.log'
            Clear-Folder (Join-Path $env:SystemRoot 'Logs\DISM') 'DISM logs' '*.log'
            Clear-Folder (Join-Path $env:SystemRoot 'Panther')    'Setup logs (Panther)'
            Clear-Folder (Join-Path $env:SystemDrive '$WINDOWS.~BT\Sources\Panther') 'Upgrade logs'
        }
        default {
            Write-Host "[WARN] Unknown target '$target' - skipped"
        }
    }
}

# ==============================================================================

if ($SafeTest) {
    Write-Host "[INFO] SafeTest - about $(Format-Size $freed) could be freed"
    Write-Host "[DONE] SafeTest finished - nothing was deleted"
    exit 0
}

Write-Host "[INFO] Total freed: $(Format-Size $freed)"
if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}
Write-Host "[DONE] Temporary files cleaned"
exit 0
