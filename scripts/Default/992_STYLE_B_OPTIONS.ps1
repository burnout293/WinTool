## WINTOOL:START
## id            : d2b6f8c3-0e45-4a92-b7d1-4f3c9e6a2158
## lang          : en
## title         : Contract showcase (style B)
## desc          : Demonstrates every rule of the script contract - changes nothing
## category      : outillage
## icon          : flask-conical
## tags          : demo, contract, reference
## version       : 1.0
## admin         : false
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : false
## reboot        : true
## engine        : auto
## WINTOOL:END

## WINTOOL:OPTIONS
## TimeoutSeconds : [number] Operation timeout — in seconds
## CreateBackup   : [bool]   Create a backup first — recommended
## DnsProvider    : [select] DNS provider — the service that resolves website addresses
##   cloudflare   : Cloudflare — 1.1.1.1, fastest on most connections
##   google       : Google — 8.8.8.8, very reliable
##   quad9        : Quad9 — 9.9.9.9, blocks known malicious domains
## CleanTargets   : [multi]  What to clean — pick one or more
##   temp         : Temporary files
##   cache        : Browser caches
##   logs         : Old log files
## VerboseLogging : [hidden] Verbose logging — for troubleshooting
## WINTOOL:END

## WINTOOL:LANG fr
## title          : Vitrine du contrat (style B)
## desc           : Démontre toutes les règles du contrat de script - ne modifie rien
## TimeoutSeconds : Délai d'attente — en secondes
## CreateBackup   : Créer une sauvegarde d'abord — recommandé
## DnsProvider    : Fournisseur DNS — le service qui traduit les adresses des sites
##   cloudflare   : Cloudflare — 1.1.1.1, le plus rapide sur la plupart des connexions
##   google       : Google — 8.8.8.8, très fiable
##   quad9        : Quad9 — 9.9.9.9, bloque les domaines malveillants connus
## CleanTargets   : Quoi nettoyer — un ou plusieurs éléments
##   temp         : Fichiers temporaires
##   cache        : Caches des navigateurs
##   logs         : Anciens journaux
## VerboseLogging : Journal détaillé — pour le diagnostic
## WINTOOL:END

# STYLE B : tout ce qui s'adresse a un humain vit dans les blocs ##.
# $CONFIG ne contient plus que des cles et des valeurs par defaut :
# du PowerShell pur, sans annotation parasite. Les deux langues se
# declarent exactement de la meme facon, en bloc.
#
# [select] : la valeur par defaut est UN des choix declares.
# [multi]  : la valeur par defaut est un TABLEAU de choix declares.
$CONFIG = @{
    TimeoutSeconds = 30
    CreateBackup   = $true
    DnsProvider    = "cloudflare"
    CleanTargets   = @("temp", "cache")
    VerboseLogging = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Demonstration uniquement : aucune commande systeme n'est executee.
# ==============================================================================

$errors = 0

Write-Host "[INFO] Demonstration script - no system change is performed"
Write-Host "[INFO] Timeout=$($CONFIG.TimeoutSeconds)s Backup=$($CONFIG.CreateBackup) Dns=$($CONFIG.DnsProvider)"
Write-Host "[INFO] Clean targets: $($CONFIG.CleanTargets -join ', ')"

Write-Host "[STEP] 1/3 Preparing"
if ($CONFIG.CreateBackup) {
    Write-Host "[OK]   Backup created"
    # A partir d'ici l'etat du systeme est coherent : l'arret force devient sur.
    Write-Host "[CKPT] Backup complete - safe to interrupt from here"
} else {
    Write-Host "[INFO] Backup skipped"
}

Write-Host "[STEP] 2/3 Applying settings"
Write-Host "[OK]   DNS provider set to $($CONFIG.DnsProvider)"
foreach ($target in $CONFIG.CleanTargets) {
    Write-Host "[OK]   Would clean: $target"
}
Write-Host "[WARN] Wi-Fi adapter disabled - skipped"

Write-Host "[STEP] 3/3 Verifying"
if ($CONFIG.VerboseLogging) {
    Write-Host "[INFO] Verbose: checking 3 adapters"
}
Write-Host "[ERR]  Bluetooth Network: access denied"
$errors++

Write-Host "[REBOOT] A restart is required to finish"

if ($errors -gt 0) {
    Write-Host "[DONE] Finished with $errors error(s)"
    exit 1
}

Write-Host "[DONE] Finished successfully"
exit 0
