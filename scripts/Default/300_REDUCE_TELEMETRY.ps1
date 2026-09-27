## WINTOOL:START
## id            : 769bf6f5-1025-4fa4-a6dc-c126dd271a74
## lang          : en
## title         : Reduce telemetry
## desc          : Reduces the diagnostic data Windows sends to Microsoft
## category      : privacy
## icon          : shield-check
## tags          : telemetry, diagtrack, diagnostic data, ceip, privacy
## version       : 2.0
## admin         : true
## risk          : medium
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : true
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Mode      : [select] Action — turn the checked items off or on
##   disable : Turn the checked items off
##   enable  : Turn the checked items on
## Parts     : [multi]  What to change — pick one or more
##   policy  : Data collection policy — lowest level allowed by your Windows edition
##   service : Telemetry services — Connected User Experiences, WAP push
##   tasks   : Scheduled tasks — compatibility appraiser, improvement program
## SafeTest  : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title     : Protéger ma vie privée
## desc      : Réduit ce que Windows transmet à Microsoft
## Mode      : Action — désactiver ou activer les éléments cochés
##   disable : Désactiver les éléments cochés
##   enable  : Activer les éléments cochés
## Parts     : Quoi modifier — un ou plusieurs éléments
##   policy  : Règle de collecte — le niveau le plus bas permis par votre édition de Windows
##   service : Services de télémétrie — expériences utilisateur connectées, messages WAP
##   tasks   : Tâches planifiées — évaluation de compatibilité, programme d'amélioration
## SafeTest  : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode     = "disable"
    Parts    = @("policy", "service", "tasks")
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
# AllowTelemetry = 0 n'est respecte que par les editions Entreprise / Education.
# Famille et Pro le ramenent a 1 ("donnees requises") : c'est le minimum possible,
# on l'annonce clairement plutot que de pretendre a 0.
#
# Toute modification passe par Invoke-Change. En SafeTest, l'action n'est jamais
# executee ; hors SafeTest, Invoke-Change execute l'action telle quelle.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$Restore  = ($CONFIG.Mode -eq 'enable')
$errors   = 0

$PolicyPaths = @(
    'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection'
)

# Nom du service, type de demarrage par defaut de Windows.
$Services = @(
    @{ Name = 'DiagTrack';        Default = 'Automatic' },
    @{ Name = 'dmwappushservice'; Default = 'Manual' }
)

$Tasks = @(
    '\Microsoft\Windows\Application Experience\Microsoft Compatibility Appraiser',
    '\Microsoft\Windows\Application Experience\ProgramDataUpdater',
    '\Microsoft\Windows\Customer Experience Improvement Program\Consolidator',
    '\Microsoft\Windows\Customer Experience Improvement Program\UsbCeip',
    '\Microsoft\Windows\Autochk\Proxy'
)

function Invoke-Change {
    param([string] $What, [scriptblock] $Action)
    if ($SafeTest) {
        Write-Host "[INFO] SafeTest - would $What"
        Start-Sleep -Milliseconds 150
        return
    }
    & $Action
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - settings are read, nothing is changed" }
if ($Restore)  { Write-Host "[INFO] Restoring Windows default telemetry settings" }

$edition = (Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
Write-Host "[INFO] Edition: $edition"
$isEnterprise = ($edition -match 'Enterprise|Education|Entreprise')

$parts = @($CONFIG.Parts)
$step  = 0
$total = $parts.Count
if ($total -eq 0) {
    Write-Host "[WARN] Nothing selected - nothing to do"
    Write-Host "[DONE] Nothing changed"
    exit 0
}

foreach ($part in $parts) {
    $step++
    switch ($part) {

        'policy' {
            Write-Host "[STEP] $step/$total Data collection policy"
            if (-not $Restore -and -not $isEnterprise) {
                Write-Host "[INFO] This edition cannot go below 'Required diagnostic data' - that level will be applied"
            }
            foreach ($path in $PolicyPaths) {
                try {
                    if ($Restore) {
                        $exists = $null -ne (Get-ItemProperty -Path $path -Name 'AllowTelemetry' -ErrorAction SilentlyContinue)
                        if (-not $exists) { Write-Host "[OK]   Not set in $path"; continue }
                        Invoke-Change "remove AllowTelemetry from $path" {
                            Remove-ItemProperty -Path $path -Name 'AllowTelemetry' -ErrorAction Stop
                        }
                        if (-not $SafeTest) { Write-Host "[OK]   AllowTelemetry removed from $path" }
                    } else {
                        Invoke-Change "set AllowTelemetry = 0 in $path" {
                            if (-not (Test-Path $path)) { New-Item -Path $path -Force -ErrorAction Stop | Out-Null }
                            Set-ItemProperty -Path $path -Name 'AllowTelemetry' -Value 0 -Type DWord -ErrorAction Stop
                        }
                        if (-not $SafeTest) { Write-Host "[OK]   AllowTelemetry = 0 in $path" }
                    }
                } catch {
                    Write-Host "[ERR]  $($path): $($_.Exception.Message)"
                    $errors++
                }
            }
        }

        'service' {
            Write-Host "[STEP] $step/$total Telemetry services"
            foreach ($svc in $Services) {
                $s = Get-Service -Name $svc.Name -ErrorAction SilentlyContinue
                if (-not $s) { Write-Host "[INFO] Service $($svc.Name) not present - skipped"; continue }
                try {
                    if ($Restore) {
                        Invoke-Change "set service $($svc.Name) to $($svc.Default)" {
                            Set-Service -Name $svc.Name -StartupType $svc.Default -ErrorAction Stop
                            if ($svc.Default -eq 'Automatic') { Start-Service -Name $svc.Name -ErrorAction SilentlyContinue }
                        }
                        if (-not $SafeTest) { Write-Host "[OK]   $($svc.Name) set to $($svc.Default)" }
                    } else {
                        Invoke-Change "stop and disable service $($svc.Name) (currently $($s.Status))" {
                            Stop-Service -Name $svc.Name -Force -ErrorAction SilentlyContinue
                            Set-Service -Name $svc.Name -StartupType Disabled -ErrorAction Stop
                        }
                        if (-not $SafeTest) { Write-Host "[OK]   $($svc.Name) stopped and disabled" }
                    }
                } catch {
                    Write-Host "[ERR]  $($svc.Name): $($_.Exception.Message)"
                    $errors++
                }
            }
        }

        'tasks' {
            Write-Host "[STEP] $step/$total Scheduled tasks"
            foreach ($full in $Tasks) {
                $taskPath = $full.Substring(0, $full.LastIndexOf('\') + 1)
                $taskName = $full.Substring($full.LastIndexOf('\') + 1)
                $t = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue
                if (-not $t) { Write-Host "[INFO] Task $taskName not present - skipped"; continue }
                try {
                    if ($Restore) {
                        Invoke-Change "enable task $taskName" {
                            Enable-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction Stop | Out-Null
                        }
                        if (-not $SafeTest) { Write-Host "[OK]   Task enabled: $taskName" }
                    } else {
                        Invoke-Change "disable task $taskName" {
                            Disable-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction Stop | Out-Null
                        }
                        if (-not $SafeTest) { Write-Host "[OK]   Task disabled: $taskName" }
                    }
                } catch {
                    Write-Host "[ERR]  $($taskName): $($_.Exception.Message)"
                    $errors++
                }
            }
        }

        default {
            Write-Host "[STEP] $step/$total Unknown part '$part'"
            Write-Host "[WARN] Unknown part '$part' - skipped"
        }
    }
}

if ($SafeTest) {
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}

Write-Host "[REBOOT] Restart the PC to fully apply the telemetry settings"
if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}
Write-Host "[DONE] Telemetry settings updated"
exit 0
