## WINTOOL:START
## title    : Cache navigateurs
## desc     : Nettoie les caches Chrome, Edge, Firefox et Brave. Favoris préservés
## category : nettoyage
## icon     : 🌐
## tags     : chrome, edge, firefox, brave, cache, navigateur
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Nettoyage des caches navigateurs
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # --- Navigateurs à nettoyer ---
    Nettoyer_Chrome         = $true
    Nettoyer_Edge           = $true
    Nettoyer_Firefox        = $true
    Nettoyer_Brave          = $true
    Nettoyer_Opera          = $false
    Nettoyer_Vivaldi        = $false

    # --- Que supprimer (s'applique à tous les navigateurs sélectionnés) ---
    Supprimer_Cache         = $true    # Fichiers cache (images, scripts...)
    Supprimer_CacheGPU      = $true    # Cache GPU/shaders
    Supprimer_NetworkCache  = $false   # Cache réseau Chromium (plus agressif)

    # NE TOUCHE JAMAIS à :
    # - Mots de passe
    # - Favoris / signets
    # - Historique
    # - Cookies
    # - Extensions

    # Fermer les navigateurs ouverts avant nettoyage (recommandé)
    FermerNavigateurs       = $true

    # Afficher les tailles libérées
    AfficherEspaceLiberé    = $true

    # Simuler seulement
    SimulationUniquement    = $false
}

# ==============================================================
# EXECUTION
# ==============================================================

function Format-Octets {
    param([long]$Octets)
    if ($Octets -ge 1GB) { return "{0:N1} Go" -f ($Octets / 1GB) }
    if ($Octets -ge 1MB) { return "{0:N1} Mo" -f ($Octets / 1MB) }
    if ($Octets -ge 1KB) { return "{0:N1} Ko" -f ($Octets / 1KB) }
    return "$Octets octets"
}

function Get-TailleRepertoire {
    param([string]$Path)
    if (!(Test-Path $Path)) { return 0 }
    try { return (Get-ChildItem $Path -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum }
    catch { return 0 }
}

function Remove-CacheRepertoire {
    param([string]$Path, [string]$Label)
    if (!(Test-Path $Path)) { return 0 }
    $taille = Get-TailleRepertoire $Path
    if (!$CONFIG.SimulationUniquement) {
        Get-ChildItem $Path -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($taille -gt 0) {
        Write-Host "    $(if($CONFIG.SimulationUniquement){'[SIM]'}else{'[OK]'}) $Label — $(Format-Octets $taille)" -ForegroundColor Green
    }
    return $taille
}

function Stop-NavigateurSiOuvert {
    param([string[]]$ProcessNames, [string]$Nom)
    $running = $ProcessNames | Where-Object { Get-Process $_ -ErrorAction SilentlyContinue }
    if ($running -and $CONFIG.FermerNavigateurs) {
        Write-Host "  [!] Fermeture de $Nom en cours..." -ForegroundColor Yellow
        $running | ForEach-Object { Stop-Process -Name $_ -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Nettoyage des caches navigateurs" -ForegroundColor Cyan
if ($CONFIG.SimulationUniquement) {
    Write-Host "  MODE SIMULATION — aucun fichier supprimé" -ForegroundColor Yellow
}
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  Favoris, mots de passe et historique sont préservés." -ForegroundColor DarkGray
Write-Host ""

$totalLibéré = 0
$localApp = $env:LOCALAPPDATA
$appData   = $env:APPDATA

# --- CHROME ---
if ($CONFIG.Nettoyer_Chrome) {
    Write-Host "[ Google Chrome ]" -ForegroundColor Yellow
    Stop-NavigateurSiOuvert @('chrome') "Chrome"
    $base = "$localApp\Google\Chrome\User Data"
    if (Test-Path $base) {
        $profiles = @("Default") + (Get-ChildItem $base -Directory -Filter "Profile *" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
        foreach ($p in $profiles) {
            if ($CONFIG.Supprimer_Cache)    { $totalLibéré += Remove-CacheRepertoire "$base\$p\Cache"       "Cache ($p)" }
            if ($CONFIG.Supprimer_Cache)    { $totalLibéré += Remove-CacheRepertoire "$base\$p\Code Cache"  "Code Cache ($p)" }
            if ($CONFIG.Supprimer_CacheGPU) { $totalLibéré += Remove-CacheRepertoire "$base\$p\GPUCache"    "GPU Cache ($p)" }
        }
        if ($CONFIG.Supprimer_NetworkCache) { $totalLibéré += Remove-CacheRepertoire "$base\ShaderCache"    "Shader Cache" }
    } else {
        Write-Host "  [--] Chrome non détecté" -ForegroundColor DarkGray
    }
}

# --- EDGE ---
if ($CONFIG.Nettoyer_Edge) {
    Write-Host ""
    Write-Host "[ Microsoft Edge ]" -ForegroundColor Yellow
    Stop-NavigateurSiOuvert @('msedge') "Edge"
    $base = "$localApp\Microsoft\Edge\User Data"
    if (Test-Path $base) {
        $profiles = @("Default") + (Get-ChildItem $base -Directory -Filter "Profile *" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
        foreach ($p in $profiles) {
            if ($CONFIG.Supprimer_Cache)    { $totalLibéré += Remove-CacheRepertoire "$base\$p\Cache"      "Cache ($p)" }
            if ($CONFIG.Supprimer_Cache)    { $totalLibéré += Remove-CacheRepertoire "$base\$p\Code Cache" "Code Cache ($p)" }
            if ($CONFIG.Supprimer_CacheGPU) { $totalLibéré += Remove-CacheRepertoire "$base\$p\GPUCache"   "GPU Cache ($p)" }
        }
    } else {
        Write-Host "  [--] Edge non détecté" -ForegroundColor DarkGray
    }
}

# --- FIREFOX ---
if ($CONFIG.Nettoyer_Firefox) {
    Write-Host ""
    Write-Host "[ Mozilla Firefox ]" -ForegroundColor Yellow
    Stop-NavigateurSiOuvert @('firefox') "Firefox"
    $ffBase = "$appData\Mozilla\Firefox\Profiles"
    if (Test-Path $ffBase) {
        Get-ChildItem $ffBase -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $p = $_.FullName
            if ($CONFIG.Supprimer_Cache) {
                $totalLibéré += Remove-CacheRepertoire "$p\cache2"           "Cache ($($_.Name))"
                $totalLibéré += Remove-CacheRepertoire "$p\startupCache"     "Startup Cache ($($_.Name))"
                $totalLibéré += Remove-CacheRepertoire "$p\shader-cache"     "Shader Cache ($($_.Name))"
            }
        }
    } else {
        Write-Host "  [--] Firefox non détecté" -ForegroundColor DarkGray
    }
}

# --- BRAVE ---
if ($CONFIG.Nettoyer_Brave) {
    Write-Host ""
    Write-Host "[ Brave ]" -ForegroundColor Yellow
    Stop-NavigateurSiOuvert @('brave') "Brave"
    $base = "$localApp\BraveSoftware\Brave-Browser\User Data"
    if (Test-Path $base) {
        $profiles = @("Default") + (Get-ChildItem $base -Directory -Filter "Profile *" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
        foreach ($p in $profiles) {
            if ($CONFIG.Supprimer_Cache)    { $totalLibéré += Remove-CacheRepertoire "$base\$p\Cache"      "Cache ($p)" }
            if ($CONFIG.Supprimer_CacheGPU) { $totalLibéré += Remove-CacheRepertoire "$base\$p\GPUCache"   "GPU Cache ($p)" }
        }
    } else {
        Write-Host "  [--] Brave non détecté" -ForegroundColor DarkGray
    }
}

# --- OPERA ---
if ($CONFIG.Nettoyer_Opera) {
    Write-Host ""
    Write-Host "[ Opera ]" -ForegroundColor Yellow
    Stop-NavigateurSiOuvert @('opera') "Opera"
    $base = "$appData\Opera Software\Opera Stable"
    if (Test-Path $base) {
        if ($CONFIG.Supprimer_Cache) { $totalLibéré += Remove-CacheRepertoire "$base\Cache"    "Cache" }
        if ($CONFIG.Supprimer_CacheGPU) { $totalLibéré += Remove-CacheRepertoire "$base\GPUCache" "GPU Cache" }
    } else {
        Write-Host "  [--] Opera non détecté" -ForegroundColor DarkGray
    }
}

# --- VIVALDI ---
if ($CONFIG.Nettoyer_Vivaldi) {
    Write-Host ""
    Write-Host "[ Vivaldi ]" -ForegroundColor Yellow
    Stop-NavigateurSiOuvert @('vivaldi') "Vivaldi"
    $base = "$localApp\Vivaldi\User Data\Default"
    if (Test-Path $base) {
        if ($CONFIG.Supprimer_Cache)    { $totalLibéré += Remove-CacheRepertoire "$base\Cache"    "Cache" }
        if ($CONFIG.Supprimer_CacheGPU) { $totalLibéré += Remove-CacheRepertoire "$base\GPUCache" "GPU Cache" }
    } else {
        Write-Host "  [--] Vivaldi non détecté" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
if ($CONFIG.AfficherEspaceLiberé) {
    Write-Host "  Espace total libéré : $(Format-Octets $totalLibéré)" -ForegroundColor Cyan
}
Write-Host "[DONE] Caches navigateurs nettoyés." -ForegroundColor Green
