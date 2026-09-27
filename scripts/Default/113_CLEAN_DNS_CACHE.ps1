## WINTOOL:START
## id            : b4899144-84ed-4d97-a177-0e97f6db0c66
## lang          : en
## title         : Clear Windows internet cache
## desc          : Clears the network caches Windows keeps, which fixes many "page won't load" problems
## category      : cleaning
## icon          : globe
## tags          : dns, flushdns, netbios, arp, network cache, resolver
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
## Steps          : [multi] Caches to clear — pick one or more
##   dns          : DNS cache — the list of website addresses Windows remembers
##   netbios      : NetBIOS name cache — local network name lookups
##   arp          : ARP cache — the map of local network devices
##   restartdns   : Restart the DNS service — the DNS Client service
##   registerdns  : Re-register with DNS — announces the PC to the network again
## SafeTest       : [bool] Safe test — simulates every change, modifies nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title          : Vider le cache Internet de Windows
## desc           : Vide les caches réseau de Windows, ce qui corrige de nombreux problèmes de « page qui ne charge pas »
## Steps          : Caches à vider — un ou plusieurs
##   dns          : Cache DNS — la liste des adresses de sites que Windows garde en mémoire
##   netbios      : Cache de noms NetBIOS — recherche de noms sur le réseau local
##   arp          : Cache ARP — la carte des appareils du réseau local
##   restartdns   : Redémarrer le service DNS — le service Client DNS
##   registerdns  : Se réenregistrer dans le DNS — réannonce le PC sur le réseau
## SafeTest       : Test sans risque — simule chaque modification, ne change rien
## WINTOOL:END

$CONFIG = @{
    Steps    = @("dns", "netbios", "arp", "restartdns", "registerdns")
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
# Tout est reconstruit automatiquement par Windows : aucune de ces actions ne
# perd de donnee. Ordre fixe du plus doux au plus fort. Le redemarrage du
# service DNS Client echoue souvent (dependances) : traite en avertissement.
# SafeTest : chaque commande est seulement annoncee, aucune n'est lancee.
# ==============================================================================

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$errors   = 0

# Execute une commande native ; en SafeTest, l'annonce seulement.
function Invoke-Native {
    param([string] $Label, [string] $Exe, [string[]] $Arguments, [switch] $Soft)
    if ($SafeTest) {
        Write-Host "[INFO] SafeTest - would run $Exe $($Arguments -join ' ')"
        Start-Sleep -Milliseconds 200
        return
    }
    & $Exe @Arguments 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK]   $Label"
    } elseif ($Soft) {
        Write-Host "[WARN] $Label - reported code $LASTEXITCODE (often normal)"
    } else {
        Write-Host "[ERR]  $Label failed (exit code $LASTEXITCODE)"
        $script:errors++
    }
}

if ($SafeTest) { Write-Host "[INFO] SafeTest mode - nothing is cleared" }

$order    = @('dns', 'netbios', 'arp', 'restartdns', 'registerdns')
$selected = @($order | Where-Object { @($CONFIG.Steps) -contains $_ })
if ($selected.Count -eq 0) {
    Write-Host "[WARN] Nothing selected - nothing to do"
    Write-Host "[DONE] Nothing cleared"
    exit 0
}

$step  = 0
$total = $selected.Count
foreach ($s in $selected) {
    $step++
    switch ($s) {
        'dns' {
            Write-Host "[STEP] $step/$total DNS cache"
            Invoke-Native 'DNS cache cleared' 'ipconfig.exe' @('/flushdns')
        }
        'netbios' {
            Write-Host "[STEP] $step/$total NetBIOS name cache"
            # -R purge et recharge le cache de noms NetBIOS.
            Invoke-Native 'NetBIOS name cache cleared' 'nbtstat.exe' @('-R') -Soft
        }
        'arp' {
            Write-Host "[STEP] $step/$total ARP cache"
            Invoke-Native 'ARP cache cleared' 'netsh.exe' @('interface', 'ip', 'delete', 'arpcache') -Soft
        }
        'restartdns' {
            Write-Host "[STEP] $step/$total Restart the DNS Client service"
            if ($SafeTest) {
                Write-Host "[INFO] SafeTest - would restart the Dnscache service"
            } else {
                try {
                    Restart-Service -Name 'Dnscache' -Force -ErrorAction Stop
                    Write-Host "[OK]   DNS Client service restarted"
                } catch {
                    # Dnscache est souvent protege contre l'arret : ce n'est pas une erreur.
                    Write-Host "[WARN] The DNS Client service cannot be restarted on this PC (this is normal)"
                }
            }
        }
        'registerdns' {
            Write-Host "[STEP] $step/$total Re-register with DNS"
            Invoke-Native 'DNS registration refreshed' 'ipconfig.exe' @('/registerdns') -Soft
        }
    }
}

if ($SafeTest) {
    Write-Host "[DONE] SafeTest finished - nothing was cleared"
    exit 0
}
if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}
Write-Host "[DONE] Windows internet caches cleared"
exit 0
