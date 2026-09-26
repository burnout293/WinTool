# WinTool — Catalogue des scripts officiels (`Default\`)

Version 0.1 — 23/09/2026 · Statut : **liste de besoins, aucun script écrit**

## Règles

- Seul `scripts\Default\` fait foi. Les anciens scripts (`scripts\01_…` à `13_…`) sont **obsolètes** et ne servent pas de base de travail.
- Déjà présents dans `Default\` : `200_DISABLE_SLEEP` (officiel) et `992_STYLE_B_OPTIONS` (diagnostic).
- Tout est au format v2 (`docs/FORMAT_SCRIPT.md`), passe `lint-scripts.ps1 -Strict`, est rédigé en anglais et traduit en français.
- Les identifiants de catégorie sont en anglais : `cleaning`, `performance`, `privacy`, `apps`, `health`, `tools`, `customize`.
- Cible : Windows 10 et 11, éditions Famille et Pro. Quand un réglage n'a pas d'effet sur une édition, le script émet `[WARN]` et ne renvoie pas d'erreur.
- **Un script = une intention.** Les variantes passent par `OPTIONS`. Chaque réglage Windows qu'on modifie a un **script inverse** ou une option `Restore` : le mode Simple ne doit jamais piéger l'utilisateur.
- Dans les tableaux ci-dessous : Risque L/M/H · Rév. = `reversible` · Redém. = `reboot`.

**Proposition à valider : la plage `7xx` est affectée à « Personnalisation »** (catégorie `customize`). Elle était réservée jusqu'ici.

---

## 1xx — Ménage (`cleaning`)

| Fichier | Titre FR | Contenu / options | Risque | Rév. | Redém. |
|---|---|---|---|---|---|
| 100_CLEAN_TEMP_FILES | Supprimer les fichiers temporaires | %TEMP% utilisateur(s), Windows\Temp · option : tous les profils | L | non | non |
| 101_CLEAN_BROWSER_CACHE | Vider le cache des navigateurs | Edge, Chrome, Firefox, Brave, Opera · `multi` navigateurs · favoris et mots de passe intacts | L | non | non |
| 102_EMPTY_RECYCLE_BIN | Vider la corbeille | tous les lecteurs | M | non | non |
| 103_CLEAN_WINDOWS_UPDATE_CACHE | Supprimer les téléchargements de mises à jour | SoftwareDistribution\Download | L | non | non |
| 104_CLEANUP_COMPONENT_STORE | Alléger Windows | DISM StartComponentCleanup · option ResetBase | M | non | non |
| 105_CLEAN_THUMBNAIL_CACHE | Réparer les miniatures | cache de miniatures et d'icônes, redémarrage de l'Explorateur | L | oui | non |
| 106_CLEAN_ERROR_REPORTS | Supprimer les rapports d'erreur | WER, minidumps, MEMORY.DMP | L | non | non |
| 107_CLEAN_OLD_LOGS | Supprimer les vieux journaux | CBS, DISM, logs d'installation · option : ancienneté en jours | L | non | non |
| 108_CLEAN_DELIVERY_OPTIMIZATION | Vider le cache de partage des mises à jour | Delivery Optimization | L | non | non |
| 109_CLEAN_WINDOWS_OLD | Supprimer l'ancienne version de Windows | Windows.old, $WINDOWS.~BT · **retour arrière de Windows impossible ensuite** | H | non | non |
| 110_CLEAN_DOWNLOADS_OLD | Ranger les vieux téléchargements | fichiers de plus de N jours · option : vers la corbeille, jamais supprimés directement | M | oui | non |
| 111_CLEAN_APP_CACHES | Vider le cache des applications | Teams, Discord, Spotify, Office · `multi` | L | non | non |
| 112_CLEAN_EVENT_LOGS | Effacer l'historique des événements | journaux d'événements Windows | M | non | non |
| 113_CLEAN_DNS_CACHE | Vider le cache Internet de Windows | ipconfig /flushdns | L | oui | non |
| 114_CLEAN_FONT_CACHE | Réparer l'affichage des polices | FontCache | L | oui | non |
| 115_CLEAN_STORE_CACHE | Réparer le Microsoft Store | wsreset | L | oui | non |
| 116_CLEAN_RESTORE_POINTS_OLD | Supprimer les anciens points de restauration | garde le plus récent | H | non | non |
| 117_DISABLE_HIBERNATION_FILE | Libérer la place de l'hibernation | powercfg /h off (supprime hiberfil.sys) · inverse : 217 | M | oui | non |

## 2xx — Performance (`performance`)

| Fichier | Titre FR | Contenu / options | Risque | Rév. | Redém. |
|---|---|---|---|---|---|
| 200_DISABLE_SLEEP | Désactiver la veille | **existe** | L | oui | non |
| 201_SET_DNS | Utiliser un Internet plus rapide | Cloudflare, Google, Quad9, AdGuard · IPv6 · option : revenir au DNS automatique | M | oui | non |
| 202_OPTIMIZE_DRIVES | Optimiser les disques | TRIM pour les SSD, défragmentation pour les HDD, détection automatique | L | oui | non |
| 203_MANAGE_STARTUP_APPS | Accélérer le démarrage | désactive les entrées de démarrage non essentielles · liste blanche | M | oui | non |
| 204_SET_POWER_PLAN | Choisir le mode d'alimentation | Équilibré, Performances élevées, Performances optimales | L | oui | non |
| 205_DISABLE_FAST_STARTUP | Désactiver le démarrage rapide | corrige de nombreux bugs de mise à jour et de pilotes | L | oui | non |
| 206_DISABLE_VISUAL_EFFECTS | Alléger l'affichage | animations, transparence, ombres · `multi` | L | oui | non |
| 207_DISABLE_BACKGROUND_APPS | Empêcher les applications de tourner en arrière-plan | | L | oui | non |
| 208_DISABLE_SEARCH_INDEXING | Désactiver l'indexation | service WSearch · pour les PC lents | M | oui | non |
| 209_DISABLE_SYSMAIN | Désactiver SysMain | pour les SSD et les PC lents | M | oui | non |
| 210_ENABLE_GAME_MODE | Optimiser pour les jeux | Game Mode, GPU scheduling, Game DVR désactivé | L | oui | oui |
| 211_SET_VISUAL_PERFORMANCE_PROFILE | Réglage « meilleures performances » | profil global de SystemPropertiesPerformance | L | oui | non |
| 212_DISABLE_DELIVERY_OPTIMIZATION_P2P | Ne pas partager mes mises à jour | P2P limité au réseau local ou désactivé | L | oui | non |
| 213_SET_PAGEFILE | Régler la mémoire virtuelle | automatique ou taille fixe | M | oui | oui |
| 214_DISABLE_USB_SELECTIVE_SUSPEND | Éviter les déconnexions USB | | L | oui | non |
| 215_OPTIMIZE_NETWORK_ADAPTER | Stabiliser la connexion | économie d'énergie de la carte réseau désactivée | L | oui | non |
| 216_ENABLE_SLEEP | Réactiver la veille | inverse de 200 | L | oui | non |
| 217_ENABLE_HIBERNATION | Réactiver l'hibernation | inverse de 117 | L | oui | non |
| 218_SET_PROCESSOR_SCHEDULING | Priorité aux programmes | Win32PrioritySeparation | L | oui | non |

## 3xx — Vie privée (`privacy`)

| Fichier | Titre FR | Contenu / options | Risque | Rév. | Redém. |
|---|---|---|---|---|---|
| 300_REDUCE_TELEMETRY | Protéger ma vie privée | niveau minimal selon l'édition, DiagTrack, dmwappushservice · option : restaurer | M | oui | oui |
| 301_DISABLE_ADVERTISING_ID | Désactiver la publicité ciblée | identifiant publicitaire, suivi du lancement des applications | L | oui | non |
| 302_DISABLE_SUGGESTIONS | Supprimer les suggestions et pubs de Windows | menu Démarrer, écran de verrouillage, Paramètres, astuces, « Terminer la configuration » | L | oui | non |
| 303_DISABLE_ACTIVITY_HISTORY | Ne pas garder mon historique d'activité | Timeline, historique d'activité | L | oui | non |
| 304_DISABLE_LOCATION | Désactiver la localisation | option : par application ou globale | L | oui | non |
| 305_DISABLE_WEB_SEARCH_START | Ne pas chercher sur Internet depuis le menu Démarrer | Bing dans la recherche | L | oui | non |
| 306_DISABLE_COPILOT | Désactiver Copilot | stratégie, bouton de la barre des tâches | L | oui | non |
| 307_DISABLE_RECALL | Désactiver Recall | Copilot+ PC uniquement, `[WARN]` ailleurs | L | oui | oui |
| 308_DISABLE_TAILORED_EXPERIENCES | Refuser les expériences personnalisées | | L | oui | non |
| 309_DISABLE_FEEDBACK_REQUESTS | Ne plus me demander mon avis | fréquence des commentaires : jamais | L | oui | non |
| 310_DISABLE_INKING_TYPING_DATA | Ne pas envoyer ce que je tape | personnalisation de l'écriture manuscrite et de la saisie | L | oui | non |
| 311_DISABLE_CLIPBOARD_SYNC | Ne pas synchroniser le presse-papiers | historique et synchronisation cloud | L | oui | non |
| 312_REVIEW_APP_PERMISSIONS | Couper l'accès caméra et micro par défaut | `multi` caméra, micro, contacts, calendrier | M | oui | non |
| 313_DISABLE_OFFICE_TELEMETRY | Réduire la télémétrie d'Office | | L | oui | non |
| 314_DISABLE_BROWSER_TELEMETRY | Réduire la télémétrie des navigateurs | Edge, Chrome, Firefox via stratégies | L | oui | non |
| 315_DISABLE_WIFI_SENSE | Ne pas partager mes réseaux Wi-Fi | Hotspot 2.0, partage automatique | L | oui | non |
| 316_DISABLE_ERROR_REPORTING | Ne pas envoyer les rapports d'erreur | WER | L | oui | non |
| 317_DISABLE_CEIP | Quitter le programme d'amélioration | tâches planifiées CEIP et Compatibility Appraiser | L | oui | non |
| 318_BLOCK_TELEMETRY_HOSTS | Bloquer les serveurs de télémétrie | fichier hosts · peut casser des services, **désactivé par défaut** | H | oui | non |

## 4xx — Applications (`apps`)

| Fichier | Titre FR | Contenu / options | Risque | Rév. | Redém. |
|---|---|---|---|---|---|
| 400_REMOVE_BLOATWARE | Retirer les applications inutiles | jeux et applis tierces préinstallées · `multi` | M | non | non |
| 401_REMOVE_MS_APPS | Retirer des applications Microsoft | Actualités, Météo, Cortana, Solitaire, Clipchamp… · `multi` | M | non | non |
| 402_REMOVE_ONEDRIVE | Désinstaller OneDrive | vérifie d'abord que les fichiers sont bien en local | H | non | non |
| 403_REMOVE_TEAMS_PERSONAL | Retirer Teams (personnel) et Chat | | L | non | non |
| 404_REMOVE_XBOX_APPS | Retirer les applications Xbox | | M | non | non |
| 405_REMOVE_OEM_TOOLS | Retirer les logiciels du fabricant | HP, Dell, Lenovo, Asus · `multi` | M | non | non |
| 406_UPDATE_ALL_APPS | Mettre à jour mes applications | winget upgrade --all · option : exclusions | M | non | non |
| 407_INSTALL_VCREDIST | Installer les composants Visual C++ | 2005 → 2015-2022, x86 + x64 | L | oui | non |
| 408_INSTALL_DOTNET_RUNTIMES | Installer les composants .NET | .NET Framework 3.5, Desktop Runtime | L | oui | non |
| 409_INSTALL_DIRECTX | Installer DirectX (runtime complet) | | L | oui | non |
| 410_INSTALL_ESSENTIALS | Installer des logiciels utiles | via winget · `multi` : navigateur, 7-Zip, VLC, lecteur PDF… | L | oui | non |
| 411_INSTALL_WINGET | Installer le gestionnaire d'applications | App Installer, prérequis de 406 et 410 | L | oui | non |
| 412_REINSTALL_STORE_APPS | Réparer les applications du Store | re-enregistrement AppX | M | oui | non |
| 413_REINSTALL_DEFAULT_APPS | Réinstaller les applications de Windows | inverse de 400 et 401 | L | oui | non |
| 414_REMOVE_EDGE_BAR_EXTRAS | Épurer Microsoft Edge | barre latérale, achats, page d'accueil MSN, via stratégies | L | oui | non |
| 415_REPAIR_OFFICE | Réparer Office | réparation rapide Click-to-Run | M | oui | non |
| 416_LIST_INSTALLED_APPS | Lister mes applications | export CSV sur le Bureau · lecture seule | L | oui | non |

## 5xx — Santé (`health`)

| Fichier | Titre FR | Contenu / options | Risque | Rév. | Redém. |
|---|---|---|---|---|---|
| 500_CHECK_SYSTEM_FILES | Vérifier l'état du PC | SFC /scannow · lent · non interruptible | L | oui | non |
| 501_REPAIR_WINDOWS_IMAGE | Réparer Windows | DISM CheckHealth / ScanHealth / RestoreHealth | M | oui | non |
| 502_CHECK_DISK_HEALTH | Vérifier la santé des disques | SMART, usure des SSD, température · lecture seule | L | oui | non |
| 503_CHECK_DISK_ERRORS | Rechercher les erreurs du disque | chkdsk /scan, ou planifié au redémarrage (option) | M | oui | oui |
| 504_REPAIR_NETWORK | Réparer Internet | Winsock, pile IP, DNS, renouvellement DHCP | M | oui | oui |
| 505_REPAIR_WINDOWS_UPDATE | Réparer Windows Update | services, SoftwareDistribution, catroot2 | M | oui | oui |
| 506_CHECK_WINDOWS_UPDATE | Rechercher les mises à jour Windows | option : installer · lent | M | non | oui |
| 507_UPDATE_DEFENDER | Mettre à jour l'antivirus | signatures Defender | L | oui | non |
| 508_SCAN_DEFENDER | Analyser le PC | rapide ou complète (option) | L | oui | non |
| 509_CHECK_BATTERY | Vérifier la batterie | powercfg /batteryreport, capacité restante · lecture seule | L | oui | non |
| 510_CHECK_MEMORY | Tester la mémoire | planifie le diagnostic mémoire Windows | L | oui | oui |
| 511_CHECK_DRIVERS | Détecter les pilotes en erreur | périphériques en erreur ou inconnus · lecture seule | L | oui | non |
| 512_CHECK_ACTIVATION | Vérifier l'activation de Windows | lecture seule | L | oui | non |
| 513_CHECK_SECURITY_STATUS | Vérifier la sécurité | Defender, pare-feu, UAC, SmartScreen, BitLocker, Secure Boot · lecture seule | L | oui | non |
| 514_CHECK_STABILITY | Analyser les plantages récents | BSOD, arrêts inattendus, index de fiabilité · lecture seule | L | oui | non |
| 515_SYSTEM_REPORT | Faire un bilan du PC | matériel, espace disque, uptime · rapport HTML sur le Bureau | L | oui | non |
| 516_REPAIR_PRINT_SPOOLER | Réparer l'imprimante | vide la file, redémarre le spouleur | L | oui | non |
| 517_REPAIR_SEARCH | Réparer la recherche Windows | reconstruction de l'index | L | oui | non |
| 518_REPAIR_START_TASKBAR | Réparer le menu Démarrer | ShellExperienceHost, StartMenuExperienceHost | M | oui | non |
| 519_REPAIR_AUDIO | Réparer le son | redémarrage des services audio | L | oui | non |
| 520_REPAIR_TIME_SYNC | Remettre l'heure à jour | w32tm | L | oui | non |
| 521_REPAIR_WMI | Réparer WMI | vérification, puis salvagerepository | H | non | oui |
| 522_REBUILD_ICON_CACHE | Réparer les icônes | | L | oui | non |
| 523_RESET_FIREWALL | Réinitialiser le pare-feu | règles par défaut | H | non | non |
| 524_CHECK_STARTUP_TIME | Mesurer le temps de démarrage | journaux Diagnostics-Performance · lecture seule | L | oui | non |

## 6xx — Outillage (`tools`)

| Fichier | Titre FR | Contenu / options | Risque | Rév. | Redém. |
|---|---|---|---|---|---|
| 600_INSTALL_POWERSHELL_7 | Installer PowerShell 7 | **imposé par la spec (§6.7)** · winget, sinon MSI | L | oui | non |
| 601_ENABLE_SYSTEM_RESTORE | Activer la protection du système | active la protection, règle le quota · **prérequis des points de restauration de l'appli (§6.4)** | L | oui | non |
| 602_BACKUP_DRIVERS | Sauvegarder mes pilotes | export DISM vers un dossier | L | oui | non |
| 603_BACKUP_WIFI_PROFILES | Sauvegarder mes réseaux Wi-Fi | netsh export | L | oui | non |
| 604_SHOW_WIFI_PASSWORDS | Retrouver mes mots de passe Wi-Fi | affiche ou exporte · risque « medium » car ça expose des secrets | M | oui | non |
| 605_EXPORT_PRODUCT_KEY | Retrouver ma clé Windows | clé OEM du BIOS | L | oui | non |
| 606_ENABLE_WINDOWS_FEATURES | Activer des fonctionnalités Windows | Sandbox, Hyper-V, WSL, .NET 3.5 · `multi` | M | oui | oui |
| 607_PAUSE_WINDOWS_UPDATE | Mettre en pause les mises à jour | 1 à 5 semaines | L | oui | non |
| 608_SET_UPDATE_POLICY | Contrôler les mises à jour Windows | heures actives, pas de redémarrage automatique, pilotes exclus | M | oui | non |
| 609_ENABLE_REMOTE_DESKTOP | Autoriser le Bureau à distance | Pro uniquement · NLA | M | oui | non |
| 610_CREATE_RESTORE_POINT_NOW | Créer un point de restauration maintenant | action manuelle (l'appli gère les points automatiques) | L | oui | non |
| 611_SET_TIMEZONE_LOCALE | Régler le fuseau horaire et la langue | | L | oui | non |
| 612_RENAME_PC | Renommer le PC | | M | oui | oui |
| 613_ADD_LOCAL_ADMIN | Créer un compte administrateur de secours | | H | oui | non |
| 614_SHOW_BITLOCKER_KEY | Afficher ma clé de récupération BitLocker | | M | oui | non |

## 7xx — Personnalisation (`customize`) — *proposée*

| Fichier | Titre FR | Contenu / options | Risque | Rév. | Redém. |
|---|---|---|---|---|---|
| 700_SET_DARK_MODE | Choisir le thème clair ou sombre | Windows et applications, séparément | L | oui | non |
| 701_SHOW_FILE_EXTENSIONS | Afficher les extensions de fichiers | aide aussi à la sécurité (facture.pdf.exe) | L | oui | non |
| 702_SHOW_HIDDEN_FILES | Afficher les fichiers cachés | option : fichiers système | L | oui | non |
| 703_EXPLORER_OPEN_THIS_PC | Ouvrir l'Explorateur sur « Ce PC » | | L | oui | non |
| 704_CLASSIC_CONTEXT_MENU | Retrouver le clic droit complet | Windows 11 | L | oui | non |
| 705_TASKBAR_ALIGN_LEFT | Aligner la barre des tâches à gauche | Windows 11 | L | oui | non |
| 706_TASKBAR_CLEANUP | Épurer la barre des tâches | recherche, Widgets, Vue des tâches, Copilot, Chat · `multi` | L | oui | non |
| 707_TASKBAR_NEVER_COMBINE | Ne pas regrouper les fenêtres | | L | oui | non |
| 708_DISABLE_WIDGETS | Désactiver les Widgets et les actualités | | L | oui | non |
| 709_DISABLE_LOCKSCREEN_ADS | Écran de verrouillage sans pub | image fixe ou Windows Spotlight sans astuces | L | oui | non |
| 710_DISABLE_BING_WALLPAPER_EXTRAS | Épurer le Bureau | icône « En savoir plus sur cette image » | L | oui | non |
| 711_DESKTOP_ICONS | Afficher les icônes du Bureau | Ce PC, Corbeille, Documents · `multi` | L | oui | non |
| 712_DISABLE_STICKY_KEYS_PROMPT | Désactiver les touches rémanentes | | L | oui | non |
| 713_ENABLE_NUMLOCK_BOOT | Pavé numérique activé au démarrage | | L | oui | non |
| 714_MOUSE_DISABLE_ACCELERATION | Désactiver l'accélération de la souris | | L | oui | non |
| 715_SET_DEFAULT_BROWSER_PROMPT | Choisir mon navigateur par défaut | ouvre le bon écran (Windows interdit de le forcer par script) | L | oui | non |
| 716_DISABLE_EDGE_PROMPTS | Stopper les incitations à utiliser Edge | | L | oui | non |
| 717_DISABLE_MS_ACCOUNT_NAGS | Ne plus me pousser vers un compte Microsoft | rappels, « Terminer la configuration » | L | oui | non |
| 718_DISABLE_UAC_DIMMING | Contrôle de compte sans écran noir | UAC conservé, sans assombrissement du Bureau · **ne jamais désactiver l'UAC** | M | oui | non |
| 719_DISABLE_AUTOPLAY | Désactiver l'exécution automatique | clés USB, CD · aussi un gain de sécurité | L | oui | non |
| 720_SET_SCALING_CURSOR | Agrandir le texte et le pointeur | pour les personnes âgées · option : taille | L | oui | non |
| 721_ENABLE_CLIPBOARD_HISTORY | Activer l'historique du presse-papiers | Win+V | L | oui | non |
| 722_DISABLE_SNAP_ASSIST | Désactiver les suggestions d'ancrage | | L | oui | non |
| 723_SET_POWER_BUTTON_ACTION | Choisir l'action du bouton d'alimentation | éteindre, veille ou rien · capot du portable | L | oui | non |
| 724_DISABLE_TRANSPARENCY | Désactiver la transparence | | L | oui | non |
| 725_ENABLE_END_TASK_TASKBAR | « Fin de tâche » dans la barre des tâches | Windows 11 | L | oui | non |
| 726_DISABLE_NOTIFICATIONS | Réduire les notifications | astuces, bienvenue, notifications d'applications · `multi` | L | oui | non |
| 727_DISABLE_FOCUS_STEALING | Empêcher les fenêtres de voler le focus | | L | oui | non |
| 728_RESTART_EXPLORER | Relancer l'Explorateur | pratique après les réglages 7xx | L | oui | non |
| 729_RESET_CUSTOMIZATIONS | Revenir à l'apparence d'origine | annule les réglages 7xx | L | oui | non |

## 9xx — Diagnostics internes (hors mode Simple)

| Fichier | Rôle |
|---|---|
| 990_SELFTEST_MARKERS | Émet tous les marqueurs, `[STEP]` n/m, `[CKPT]`, `[REBOOT]` |
| 991_SELFTEST_FAILURE | `[ERR]` puis `exit 1` : vérifie le verdict par code de sortie |
| 992_STYLE_B_OPTIONS | **existe** : couverture des types d'options |
| 993_SELFTEST_CANCEL | Script long, `interruptible:false`, avec `[CKPT]` : teste l'annulation en deux clics |
| 994_SELFTEST_ENGINE_PWSH | `engine:pwsh` et syntaxe `??` : teste le marquage « nécessite PowerShell 7 » |
| 995_SELFTEST_ENCODING | Accents dans les blocs `LANG` : teste le BOM |

---

## Catégories d'usine suggérées (composition par défaut)

| Catégorie FR | Scripts |
|---|---|
| **Entretien complet** (épinglée) | 100, 101, 103, 106, 113, 202, 507, 500 |
| Faire le ménage | 100 → 108, 111, 113 |
| Accélérer mon PC | 202, 203, 205, 207, 212 |
| Protéger ma vie privée | 300 → 305, 308, 309, 316, 317 |
| Retirer les applications inutiles | 400, 401, 403 |
| Vérifier l'état du PC | 502, 513, 500, 501, 511, 514 |
| Réparer | 504, 505, 516 → 520, 522 |
| Personnaliser Windows | 701, 703, 706, 708, 709, 717 |

**Hors de toute catégorie par défaut**, car trop intrusifs pour un clic de débutant : 109, 116, 318, 402, 521, 523, 613.

## Points à trancher

1. Ouvrir la plage `7xx` pour la Personnalisation (et donc mettre à jour `FORMAT_SCRIPT.md` et `$CATEGORIES_USINE` dans le linter).
2. Scripts « lecture seule » (502, 509, 513, 515…) : `reversible:true` est trompeur. Faut-il ajouter un champ `readonly` au contrat ?
3. Scripts avec un inverse : un script inverse séparé (200 et 216), ou une option `Mode = apply|restore` ? Recommandation : l'option, pour ne pas doubler le catalogue.
4. Scripts qui dépendent de winget (406, 410) : prérequis 411. La spec ne prévoit pas de dépendances entre scripts.
