## WINTOOL:START
## title    : Supprimer bloatwares
## desc     : Retire les applications inutiles préinstallées par Microsoft
## category : appli
## icon     : 🗑️
## tags     : bloatware, apps, microsoft, nettoyage
## version  : 1.0
## WINTOOL:END

# ==============================================================
# SCRIPT : Suppression des bloatwares Microsoft
# ==============================================================
# CONFIGURATION — modifier ici selon vos besoins
# --------------------------------------------------------------

$CONFIG = @{
    # Supprimer pour tous les utilisateurs du PC
    TousLesUtilisateurs     = $true

    # Empêcher la réinstallation lors des mises à jour Windows
    BloquerReinstallation   = $true

    # Afficher les apps non trouvées (déjà absentes)
    AfficherNonTrouves      = $false

    # --- Sélection par catégorie ---
    Supprimer_Jeux          = $true   # Solitaire, Mahjong, Sudoku...
    Supprimer_Meteo_Actus   = $true   # Bing News, Météo, Sports, Finance
    Supprimer_Multimedia    = $true   # Groove Music, Films & TV, Clipchamp
    Supprimer_Productivite  = $true   # To Do, Hub Office, Get Started
    Supprimer_Social        = $true   # People, Skype, Phone Link
    Supprimer_Divers        = $true   # Feedback Hub, Mixed Reality, Maps...
}

# ==============================================================
# LISTE DES APPS PAR CATÉGORIE
# ==============================================================

$categories = @{
    Jeux = @(
        "Microsoft.MicrosoftSolitaireCollection"
        "Microsoft.MicrosoftMahjong"
        "Microsoft.MicrosoftSudoku"
        "Microsoft.GamingApp"
    )
    Meteo_Actus = @(
        "Microsoft.BingNews"
        "Microsoft.BingWeather"
        "Microsoft.BingSports"
        "Microsoft.BingFinance"
        "Microsoft.BingTravel"
    )
    Multimedia = @(
        "Microsoft.ZuneMusic"
        "Microsoft.ZuneVideo"
        "Clipchamp.Clipchamp"
        "Microsoft.WindowsSoundRecorder"
    )
    Productivite = @(
        "Microsoft.Todos"
        "Microsoft.MicrosoftOfficeHub"
        "Microsoft.Getstarted"
        "Microsoft.GetHelp"
        "Microsoft.PowerAutomateDesktop"
    )
    Social = @(
        "Microsoft.People"
        "Microsoft.SkypeApp"
        "Microsoft.YourPhone"
        "MicrosoftTeams"
    )
    Divers = @(
        "Microsoft.WindowsFeedbackHub"
        "Microsoft.MixedReality.Portal"
        "Microsoft.WindowsMaps"
        "Microsoft.3DBuilder"
        "Microsoft.549981C3F5F10"
    )
}

# ==============================================================
# EXECUTION — ne pas modifier en dessous
# ==============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  Suppression des bloatwares Microsoft" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor DarkCyan

$aSupprimer = @()
if ($CONFIG.Supprimer_Jeux)         { $aSupprimer += $categories.Jeux }
if ($CONFIG.Supprimer_Meteo_Actus)  { $aSupprimer += $categories.Meteo_Actus }
if ($CONFIG.Supprimer_Multimedia)   { $aSupprimer += $categories.Multimedia }
if ($CONFIG.Supprimer_Productivite) { $aSupprimer += $categories.Productivite }
if ($CONFIG.Supprimer_Social)       { $aSupprimer += $categories.Social }
if ($CONFIG.Supprimer_Divers)       { $aSupprimer += $categories.Divers }

$compteur = @{ OK = 0; Absent = 0; Erreur = 0 }

foreach ($app in $aSupprimer) {
    $found = $false

    $pkg = Get-AppxPackage -Name $app -AllUsers -ErrorAction SilentlyContinue
    if ($pkg) {
        $found = $true
        try {
            if ($CONFIG.TousLesUtilisateurs) {
                $pkg | Remove-AppxPackage -AllUsers -ErrorAction Stop
            } else {
                $pkg | Remove-AppxPackage -ErrorAction Stop
            }
            Write-Host "  [OK] $app" -ForegroundColor Green
            $compteur.OK++
        } catch {
            Write-Host "  [ERR] $app — $_" -ForegroundColor Red
            $compteur.Erreur++
        }
    }

    if ($CONFIG.BloquerReinstallation) {
        $prov = Get-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue | Where-Object DisplayName -EQ $app
        if ($prov) {
            $found = $true
            $prov | Remove-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue | Out-Null
        }
    }

    if (!$found -and $CONFIG.AfficherNonTrouves) {
        Write-Host "  [--] $app (absent)" -ForegroundColor DarkGray
        $compteur.Absent++
    }
}

Write-Host ""
Write-Host "--- Résumé ---" -ForegroundColor DarkGray
Write-Host "  Supprimés : $($compteur.OK)"
Write-Host "  Absents   : $($compteur.Absent)"
Write-Host "  Erreurs   : $($compteur.Erreur)"
Write-Host ""
Write-Host "[DONE] Bloatwares traités." -ForegroundColor Green
