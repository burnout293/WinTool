## WINTOOL:START
## title    : Configurer DNS
## desc     : Accélère la navigation avec un DNS rapide (Cloudflare, Google, Quad9)
## category : performance
## icon     : ⚡
## tags     : dns, cloudflare, google, réseau, vitesse
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Configuration DNS rapide
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # Choisir le serveur DNS à utiliser
    # Options : "Cloudflare", "Google", "Quad9", "OpenDNS", "Orange", "Personnalisé"
    ServeurDNS              = "Cloudflare"

    # DNS personnalisé (utilisé si ServeurDNS = "Personnalisé")
    DNS_Primaire            = "1.1.1.1"
    DNS_Secondaire          = "1.0.0.1"

    # Appliquer à toutes les interfaces réseau actives (Wi-Fi + Ethernet)
    ToutesLesInterfaces     = $true

    # Vider le cache DNS après changement (recommandé)
    ViderCacheDNS           = $true

    # Afficher un test de vitesse DNS basique après changement
    TesterDNS               = $true

    # Restaurer le DNS automatique DHCP (remet les paramètres d'origine)
    # Mettre à $true pour annuler tous les changements
    RestaurerDHCP           = $false
}

# ==============================================================
# TABLE DES SERVEURS DNS
# ==============================================================

$DNS_SERVERS = @{
    Cloudflare = @{ P = "1.1.1.1";      S = "1.0.0.1";      Desc = "Cloudflare — rapide et privé" }
    Google     = @{ P = "8.8.8.8";      S = "8.8.4.4";      Desc = "Google Public DNS — fiable" }
    Quad9      = @{ P = "9.9.9.9";      S = "149.112.112.112"; Desc = "Quad9 — sécurisé, bloque malwares" }
    OpenDNS    = @{ P = "208.67.222.222"; S = "208.67.220.220"; Desc = "OpenDNS (Cisco) — filtrage famille" }
    Orange     = @{ P = "80.10.246.2";  S = "81.253.149.2";  Desc = "Orange France — DNS opérateur" }
    Personnalisé = @{ P = $CONFIG.DNS_Primaire; S = $CONFIG.DNS_Secondaire; Desc = "DNS personnalisé" }
}

# ==============================================================
# EXECUTION
# ==============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Configuration DNS rapide" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host ""

if ($CONFIG.RestaurerDHCP) {
    Write-Host "[ Mode restauration DHCP ]" -ForegroundColor Yellow
    $interfaces = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
    foreach ($iface in $interfaces) {
        Set-DnsClientServerAddress -InterfaceIndex $iface.InterfaceIndex -ResetServerAddresses
        Write-Host "  [OK] $($iface.Name) — DNS remis en automatique (DHCP)" -ForegroundColor Green
    }
    if ($CONFIG.ViderCacheDNS) { Clear-DnsClientCache; Write-Host "  [OK] Cache DNS vidé" -ForegroundColor Green }
    Write-Host ""
    Write-Host "[DONE] DNS restauré au DHCP." -ForegroundColor Green
    exit 0
}

$server = $DNS_SERVERS[$CONFIG.ServeurDNS]
if (!$server) {
    Write-Host "[ERR] Serveur DNS '$($CONFIG.ServeurDNS)' inconnu." -ForegroundColor Red
    exit 1
}

Write-Host "  Serveur sélectionné : $($CONFIG.ServeurDNS)" -ForegroundColor White
Write-Host "  $($server.Desc)" -ForegroundColor DarkGray
Write-Host "  Primaire  : $($server.P)" -ForegroundColor DarkGray
Write-Host "  Secondaire: $($server.S)" -ForegroundColor DarkGray
Write-Host ""

# Sélectionner les interfaces
if ($CONFIG.ToutesLesInterfaces) {
    $interfaces = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.Virtual -eq $false }
} else {
    $interfaces = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.Virtual -eq $false } |
        Select-Object -First 1
}

if ($interfaces.Count -eq 0) {
    Write-Host "[ERR] Aucune interface réseau active trouvée." -ForegroundColor Red
    exit 1
}

foreach ($iface in $interfaces) {
    Write-Host "  Configuration de : $($iface.Name) ($($iface.InterfaceDescription))" -ForegroundColor Yellow
    try {
        Set-DnsClientServerAddress -InterfaceIndex $iface.InterfaceIndex `
            -ServerAddresses @($server.P, $server.S)
        Write-Host "  [OK] DNS appliqué" -ForegroundColor Green
    } catch {
        Write-Host "  [ERR] $($_)" -ForegroundColor Red
    }
}

if ($CONFIG.ViderCacheDNS) {
    Clear-DnsClientCache
    Write-Host ""
    Write-Host "  [OK] Cache DNS vidé" -ForegroundColor Green
}

if ($CONFIG.TesterDNS) {
    Write-Host ""
    Write-Host "[ Test DNS basique ]" -ForegroundColor Yellow
    $domaines = @("google.com", "youtube.com", "lemonde.fr")
    foreach ($d in $domaines) {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $null = [System.Net.Dns]::GetHostAddresses($d)
            $sw.Stop()
            Write-Host "  [OK] $d — $($sw.ElapsedMilliseconds) ms" -ForegroundColor Green
        } catch {
            $sw.Stop()
            Write-Host "  [ERR] $d — échec de résolution" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "  Pour annuler : mettre RestaurerDHCP = `$true et relancer" -ForegroundColor DarkGray
Write-Host ""
Write-Host "[DONE] DNS configuré avec succès." -ForegroundColor Green
