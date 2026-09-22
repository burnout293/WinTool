## WINTOOL:START
## title    : Désactiver télémétrie
## desc     : Réduit les envois de données à Microsoft et coupe les services de collecte
## category : securite
## icon     : 🛡️
## tags     : télémétrie, vie privée, microsoft, données, collecte
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Désactivation de la télémétrie Windows
# ==============================================================
$CONFIG = @{
    NiveauTelemetrie        = 1
    Desactiver_Services     = $true
    Desactiver_Taches       = $true
    Bloquer_Serveurs        = $true
    Desactiver_PubID        = $true
    Desactiver_Activite     = $true
    Desactiver_Suggestions  = $true
    Desactiver_Frappe       = $true
    VerrouillerGPO          = $true
}
function Set-RegVal { param([string]$Path,[string]$Name,$Value,[string]$Type="DWord"); If(!(Test-Path $Path)){New-Item -Path $Path -Force|Out-Null}; Set-ItemProperty -Path $Path -Name $Name -Value $Value -Type $Type -ErrorAction SilentlyContinue }
function Disable-ServiceSafe { param([string]$Name,[string]$Label); $svc=Get-Service -Name $Name -ErrorAction SilentlyContinue; if($svc){Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue; Set-Service -Name $Name -StartupType Disabled -ErrorAction SilentlyContinue; Write-Host "  [OK] $Label" -ForegroundColor Green}else{Write-Host "  [--] $Label (absent)" -ForegroundColor DarkGray} }

Write-Host ""; Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Désactivation de la télémétrie Windows" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan; Write-Host ""

Write-Host "[ Niveau de télémétrie ]" -ForegroundColor Yellow
Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection" "AllowTelemetry" $CONFIG.NiveauTelemetrie
Set-RegVal "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection" "AllowTelemetry" $CONFIG.NiveauTelemetrie
Write-Host "  [OK] Niveau $($CONFIG.NiveauTelemetrie) appliqué" -ForegroundColor Green

if ($CONFIG.Desactiver_Services) {
    Write-Host ""; Write-Host "[ Services de collecte ]" -ForegroundColor Yellow
    Disable-ServiceSafe "DiagTrack" "Connected User Experiences & Telemetry"
    Disable-ServiceSafe "dmwappushservice" "WAP Push Message Routing"
    Disable-ServiceSafe "WerSvc" "Windows Error Reporting"
    Disable-ServiceSafe "WdiServiceHost" "Diagnostic Service Host"
}

if ($CONFIG.Desactiver_Taches) {
    Write-Host ""; Write-Host "[ Tâches planifiées ]" -ForegroundColor Yellow
    $taches = @(
        @{Path="\Microsoft\Windows\Application Experience\"; Name="Microsoft Compatibility Appraiser"}
        @{Path="\Microsoft\Windows\Customer Experience Improvement Program\"; Name="Consolidator"}
        @{Path="\Microsoft\Windows\Customer Experience Improvement Program\"; Name="UsbCeip"}
        @{Path="\Microsoft\Windows\Feedback\Siuf\"; Name="DmClient"}
        @{Path="\Microsoft\Windows\Windows Error Reporting\"; Name="QueueReporting"}
    )
    foreach ($t in $taches) {
        $task = Get-ScheduledTask -TaskPath $t.Path -TaskName $t.Name -ErrorAction SilentlyContinue
        if ($task) { Disable-ScheduledTask -TaskPath $t.Path -TaskName $t.Name -ErrorAction SilentlyContinue|Out-Null; Write-Host "  [OK] $($t.Name)" -ForegroundColor Green }
        else { Write-Host "  [--] $($t.Name) (absent)" -ForegroundColor DarkGray }
    }
}

if ($CONFIG.Bloquer_Serveurs) {
    Write-Host ""; Write-Host "[ Blocage serveurs télémétrie (hosts) ]" -ForegroundColor Yellow
    $hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
    $serveurs = @("vortex.data.microsoft.com","vortex-win.data.microsoft.com","telecommand.telemetry.microsoft.com","oca.telemetry.microsoft.com","sqm.telemetry.microsoft.com","watson.telemetry.microsoft.com","reports.wes.df.telemetry.microsoft.com","services.wes.df.telemetry.microsoft.com","watson.microsoft.com","activityonfleet.microsoft.com")
    $hostsContent = Get-Content $hostsPath -ErrorAction SilentlyContinue
    $ajoutés = 0
    foreach ($s in $serveurs) { $ligne = "0.0.0.0 $s"; if ($hostsContent -notcontains $ligne) { Add-Content $hostsPath "`n$ligne" -ErrorAction SilentlyContinue; $ajoutés++ } }
    Clear-DnsClientCache
    Write-Host "  [OK] $ajoutés serveur(s) bloqué(s) dans hosts" -ForegroundColor Green
}

if ($CONFIG.Desactiver_PubID) {
    Write-Host ""; Write-Host "[ ID publicitaire ]" -ForegroundColor Yellow
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo" "Enabled" 0
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\AdvertisingInfo" "DisabledByGroupPolicy" 1
    Write-Host "  [OK] ID publicitaire désactivé" -ForegroundColor Green
}

if ($CONFIG.Desactiver_Activite) {
    Write-Host ""; Write-Host "[ Historique d'activité ]" -ForegroundColor Yellow
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" "EnableActivityFeed" 0
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" "PublishUserActivities" 0
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" "UploadUserActivities" 0
    Write-Host "  [OK] Désactivé" -ForegroundColor Green
}

if ($CONFIG.Desactiver_Suggestions) {
    Write-Host ""; Write-Host "[ Suggestions et tips Windows ]" -ForegroundColor Yellow
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" "SubscribedContent-338389Enabled" 0
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" "SubscribedContent-338388Enabled" 0
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" "SoftLandingEnabled" 0
    Set-RegVal "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" "SystemPaneSuggestionsEnabled" 0
    Write-Host "  [OK] Suggestions désactivées" -ForegroundColor Green
}

if ($CONFIG.Desactiver_Frappe) {
    Write-Host ""; Write-Host "[ Collecte frappe (Inking & Typing) ]" -ForegroundColor Yellow
    Set-RegVal "HKCU:\Software\Microsoft\InputPersonalization" "RestrictImplicitInkCollection" 1
    Set-RegVal "HKCU:\Software\Microsoft\InputPersonalization" "RestrictImplicitTextCollection" 1
    Set-RegVal "HKCU:\Software\Microsoft\InputPersonalization\TrainedDataStore" "HarvestContacts" 0
    Write-Host "  [OK] Collecte de frappe désactivée" -ForegroundColor Green
}

if ($CONFIG.VerrouillerGPO) {
    Write-Host ""; Write-Host "[ Verrouillage GPO ]" -ForegroundColor Yellow
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection" "AllowTelemetry" $CONFIG.NiveauTelemetrie
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection" "LimitDiagnosticLogCollection" 1
    Set-RegVal "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection" "DisableOneSettingsDownloads" 1
    Write-Host "  [OK] Verrouillé via GPO" -ForegroundColor Green
}

Write-Host ""; Write-Host "  Un redémarrage peut être nécessaire." -ForegroundColor DarkGray
Write-Host "[DONE] Télémétrie désactivée." -ForegroundColor Green
