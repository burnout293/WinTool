## WINTOOL:START
## id            : 1e8ba83e-a871-4401-8304-df96f542bf8c
## lang          : en
## title         : Use a faster DNS
## desc          : Speeds up browsing by using a faster service to find websites
## category      : performance
## icon          : zap
## tags          : dns, network, internet, cloudflare, google, quad9, adguard
## version       : 2.0
## admin         : true
## risk          : medium
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## Mode         : [select] Action — use a DNS provider or go back to automatic
##   apply      : Use the chosen DNS provider
##   restore    : Go back to the automatic DNS of your internet box
## DnsProvider  : [select] DNS provider — the service that resolves website addresses
##   cloudflare : Cloudflare — 1.1.1.1, fastest on most connections
##   google     : Google — 8.8.8.8, very reliable
##   quad9      : Quad9 — 9.9.9.9, blocks known malicious domains
##   adguard    : AdGuard — 94.140.14.14, blocks ads and trackers
##   adguardfam : AdGuard Family — 94.140.14.15, also blocks adult content
##   opendns    : OpenDNS — 208.67.222.222, long-standing and reliable
##   opendnsfam : OpenDNS FamilyShield — 208.67.222.123, blocks adult content
##   mullvad    : Mullvad — 194.242.2.2, privacy-focused, no logging
##   cleanbrowse : CleanBrowsing — 185.228.168.9, family-safe filtering
## ApplyToIPv6  : [bool]   Apply to IPv6 — equivalent resolvers
## FlushCache   : [hidden] Flush the resolver cache afterwards
## SafeTest     : [bool]   Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title        : Utiliser un Internet plus rapide
## desc         : Accélère la navigation en utilisant un service plus rapide pour trouver les sites
## Mode         : Action — utiliser un fournisseur DNS ou revenir à l'automatique
##   apply      : Utiliser le fournisseur DNS choisi
##   restore    : Revenir au DNS automatique de votre box
## DnsProvider  : Fournisseur DNS — le service qui traduit les adresses des sites
##   cloudflare : Cloudflare — 1.1.1.1, le plus rapide sur la plupart des connexions
##   google     : Google — 8.8.8.8, très fiable
##   quad9      : Quad9 — 9.9.9.9, bloque les domaines malveillants connus
##   adguard    : AdGuard — 94.140.14.14, bloque les publicités et les traqueurs
##   adguardfam : AdGuard Famille — 94.140.14.15, bloque aussi le contenu adulte
##   opendns    : OpenDNS — 208.67.222.222, éprouvé et fiable
##   opendnsfam : OpenDNS FamilyShield — 208.67.222.123, bloque le contenu adulte
##   mullvad    : Mullvad — 194.242.2.2, axé vie privée, sans journalisation
##   cleanbrowse : CleanBrowsing — 185.228.168.9, filtrage adapté aux familles
## ApplyToIPv6  : Appliquer à l'IPv6 — résolveurs équivalents
## FlushCache   : Vider le cache de résolution ensuite
## SafeTest     : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Mode        = "apply"
    DnsProvider = "cloudflare"
    ApplyToIPv6 = $true
    FlushCache  = $true
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
# Seules les cartes reseau physiques actives sont modifiees (pas les cartes
# virtuelles : VPN, Hyper-V, VirtualBox...).
# SafeTest : les cartes et leurs DNS actuels sont lus, rien n'est ecrit.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$errors   = 0

$Providers = @{
    cloudflare = @{ Name = 'Cloudflare'; V4 = @('1.1.1.1', '1.0.0.1');             V6 = @('2606:4700:4700::1111', '2606:4700:4700::1001') }
    google     = @{ Name = 'Google';     V4 = @('8.8.8.8', '8.8.4.4');             V6 = @('2001:4860:4860::8888', '2001:4860:4860::8844') }
    quad9      = @{ Name = 'Quad9';      V4 = @('9.9.9.9', '149.112.112.112');     V6 = @('2620:fe::fe', '2620:fe::9') }
    adguard    = @{ Name = 'AdGuard';    V4 = @('94.140.14.14', '94.140.15.15');   V6 = @('2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff') }
    adguardfam = @{ Name = 'AdGuard Family'; V4 = @('94.140.14.15', '94.140.15.16'); V6 = @('2a10:50c0::bad1:ff', '2a10:50c0::bad2:ff') }
    opendns    = @{ Name = 'OpenDNS';    V4 = @('208.67.222.222', '208.67.220.220'); V6 = @('2620:119:35::35', '2620:119:53::53') }
    opendnsfam = @{ Name = 'OpenDNS FamilyShield'; V4 = @('208.67.222.123', '208.67.220.123'); V6 = @('2620:119:35::123', '2620:119:53::123') }
    mullvad    = @{ Name = 'Mullvad';    V4 = @('194.242.2.2', '194.242.2.3');     V6 = @('2a07:e340::2', '2a07:e340::3') }
    cleanbrowse = @{ Name = 'CleanBrowsing'; V4 = @('185.228.168.9', '185.228.169.9'); V6 = @('2a0d:2a00:1::2', '2a0d:2a00:2::2') }
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - network settings are read, nothing is changed" }

# --- 1/3 : cartes reseau ----------------------------------------------------
Write-Host "[STEP] 1/3 Finding active network adapters"

$adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })
if ($adapters.Count -eq 0) {
    Write-Host "[ERR]  No active network adapter found"
    Write-Host "[DONE] Finished with 1 error(s)"
    exit 1
}

foreach ($a in $adapters) {
    $current = @(Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue |
                 ForEach-Object { $_.ServerAddresses }) -join ', '
    if (-not $current) { $current = 'none' }
    Write-Host "[INFO] $($a.Name) - current DNS: $current"
}

# --- 2/3 : application ------------------------------------------------------
if ($CONFIG.Mode -eq 'restore') {
    Write-Host "[STEP] 2/3 Restoring automatic DNS"
    foreach ($a in $adapters) {
        if ($SafeTest) {
            Write-Host "[INFO] SafeTest - would reset $($a.Name) to automatic DNS"
            continue
        }
        try {
            Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses -ErrorAction Stop
            Write-Host "[OK]   $($a.Name): automatic DNS restored"
        } catch {
            Write-Host "[ERR]  $($a.Name): $($_.Exception.Message)"
            $errors++
        }
    }
} else {
    $p = $Providers[$CONFIG.DnsProvider]
    if (-not $p) {
        Write-Host "[ERR]  Unknown DNS provider '$($CONFIG.DnsProvider)'"
        Write-Host "[DONE] Finished with 1 error(s)"
        exit 1
    }
    Write-Host "[STEP] 2/3 Applying $($p.Name) DNS"

    $servers = @($p.V4)
    if ($CONFIG.ApplyToIPv6) { $servers += $p.V6 }

    foreach ($a in $adapters) {
        if ($SafeTest) {
            Write-Host "[INFO] SafeTest - would set $($a.Name) DNS to $($servers -join ', ')"
            continue
        }
        try {
            Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses $servers -ErrorAction Stop
            Write-Host "[OK]   $($a.Name): $($p.Name) DNS applied"
        } catch {
            Write-Host "[ERR]  $($a.Name): $($_.Exception.Message)"
            $errors++
        }
    }
}

# --- 3/3 : cache et verification ---------------------------------------------
Write-Host "[STEP] 3/3 Checking name resolution"

if ($CONFIG.FlushCache) {
    if ($SafeTest) {
        Write-Host "[INFO] SafeTest - would flush the DNS cache"
    } else {
        Clear-DnsClientCache -ErrorAction SilentlyContinue
        Write-Host "[OK]   DNS cache flushed"
    }
}

try {
    $null = Resolve-DnsName -Name 'www.microsoft.com' -DnsOnly -ErrorAction Stop
    Write-Host "[OK]   Name resolution works"
} catch {
    Write-Host "[WARN] Name resolution test failed - check your connection"
}

if ($SafeTest) {
    Write-Host "[DONE] SafeTest finished - nothing was changed"
    exit 0
}
if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}
Write-Host "[DONE] DNS settings updated"
exit 0
