╔══════════════════════════════════════════════════╗
║              WINTOOL — MODE D'EMPLOI             ║
╚══════════════════════════════════════════════════╝

LANCEMENT
─────────
  Double-cliquer sur : LANCER_EN_ADMIN.bat
  (accepter la demande d'élévation UAC)

AJOUTER UN SCRIPT
─────────────────
  1. Créer un fichier .ps1 dans le dossier .\scripts\
  2. Nommer le avec un numéro devant pour l'ordre :
       05_mon_nouveau_script.ps1
  3. Relancer WinTool ou appuyer sur [R] pour rafraîchir
  → Il apparaît automatiquement dans le menu

STRUCTURE D'UN SCRIPT COMPATIBLE
──────────────────────────────────
  Chaque script doit être autonome.
  Mettre les options configurables en haut dans $CONFIG = @{ ... }
  Le script est appelé directement par WinTool.

SCRIPTS INCLUS
──────────────
  01_desactiver_veille.ps1       Désactive toute mise en veille
  02_installer_vcredist.ps1      Installe les VCRedist 2010→2022
  03_supprimer_bloatwares.ps1    Supprime les apps inutiles Microsoft
  04_desinstaller_apps_ms.ps1    OneDrive / OneNote / Xbox / Copilot

JOURNAL
───────
  Chaque exécution est tracée dans : wintool.log
  (désactivable dans WinTool.ps1 > $CONFIG.JournalActif)
