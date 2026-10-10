# WinTool — feuille de route

Versions mineures successives jusqu'à ce que le gros du travail soit fait ; la 2.0
viendra ensuite. Numérotation sémantique : une version qui apporte des fonctions monte
d'un cran (1.1, 1.2…), une version de corrections seules prend un troisième chiffre
(1.1.1, 1.1.2…).

| Version | Contenu | État |
|---|---|---|
| **1.0.0** | Première version publiée | Publiée le 27/09/2026 |
| **1.1** | Mise à jour automatique de WinTool | Publiée le 06/10/2026 |
| **1.1.1** | Simulation réglable script par script, bouées posées sur la vague, rangées multiples — et premier test réel de la mise à jour automatique | Publiée le 06/10/2026 |
| **1.2** | Les scripts quittent WinTool : catalogue officiel dans son propre dépôt (MIT), index signé, installation et mises à jour depuis l'application (§16) ; durcissement (§12.4) ; visite du premier démarrage (§13) ; désinstallation au choix | Publiée le 06/10/2026 |
| **1.2.1** | Réglages en page entière, une section par page, recherche, Simple / Expert sans les quitter (§8) ; emplacements protégés : résumé et plan du disque ; écran « Choisir » : le champ de bouées défile au lieu de se défaire, « Continuer » collé en bas (§15.2) | Publiée le 07/10/2026 |
| **1.4** | Publiée d'un seul tenant, avec ce que prévoyait la 1.3 : | Prête |
| | — catalogues multiples : ajouter, modifier, retirer, activer ; consulter et choisir ses actions (§16) ; présentation modifiable sans code (`src/presentation.json`, §13) ; « action » au lieu d'« entretien » (§3) | Fait |
| | — analyser → cocher → nettoyer (§17), avec une norme qui laisse les scripts composer l'écran : listes d'éléments, arborescences, confiance, mesures, notes ; résumé à déplier en Simple (anneau par défaut, graphique au choix), vues et panneaux en Expert, un seul affichage réglé par `show` (`docs/FORMAT_SCRIPT.md`, exemple `docs/mockups/exemple-analyse.ps1`) | Fait |
| | — catégories distinctes des lots, onglets Scripts / Lots en Expert, réglages de la 1.2 migrés sans perte (§4.1) | Fait |
| **1.5** | Témoin des changements sensibles (voir ci-dessous) | À faire |
| | — couleur d'accent au choix, orange par défaut (§15.4) | Fait |
| | — journal : filtre par famille de lignes (infos, étapes, réussites, avertissements, erreurs, analyse, canaux, texte brut) | Fait |
| | — point de restauration : verdict indépendant de la langue de Windows, accents lisibles, message simple en Simple et détail au journal, aucun point pendant une simulation | Fait |
| en continu | Améliorations graphiques et d'organisation | Glissées dans chaque version |

## Pourquoi cet ordre

**La mise à jour passe en premier**, alors que l'analyse est la priorité fonctionnelle.
La 1.0.0 installée ne sait pas se mettre à jour : chaque version publiée avant l'updater
oblige chaque utilisateur à retélécharger l'installeur à la main. Livrer l'updater en 1.1,
c'est faire de la 1.1 la **dernière** installation manuelle.

**Le contrat d'analyse est écrit avant son interface.** Il change la façon dont les
scripts sont écrits, et c'est un autre agent qui les écrit. Le publier tôt — accepté par le
validateur dès la 1.1 — lui laisse le temps d'adapter le catalogue pendant que l'interface
se construit.

**Catégories et lots viennent après l'updater** parce qu'ils imposent une migration des
réglages : les utilisateurs de la 1.0.0 ont déjà composé leurs lots, et une migration se
livre mieux automatiquement.

**Le catalogue est passé devant l'analyse** (1.2, d'abord prévu en 1.4). Tant que les
scripts voyageaient dans l'installeur, la séparation entre WinTool et ses scripts — sur
laquelle repose la licence — restait difficile à défendre. Elle devait devenir réelle avant
toute nouvelle version.

**L'ordre de publication de la 1.2 est imposé.** Une installation qui se met à jour en 1.2
perd les scripts que l'installeur posait : le catalogue officiel doit donc être **publié
avant** WinTool 1.2, sans quoi la mise à jour automatique viderait les installations
existantes. Et la clé publique du catalogue est compilée dans WinTool : elle doit exister
avant la construction de la 1.2.

**Les sources tierces sont venues ensuite** (1.4) : c'est la surface de sécurité la plus
large — du PowerShell téléchargé auprès de n'importe qui, exécuté en administrateur. Elles
reprennent le chemin éprouvé par la source officielle (index signé, vérifié avant d'être
lu), avec une décision en plus : qui les ajoute, et avec quelle clé (§16.2).

## Ce qui attend une décision

- **Le catalogue officiel et la norme d'analyse.** WinTool 1.4 sait analyser ; les scripts
  du catalogue, eux, doivent l'adopter un par un — c'est le travail de l'agent qui les
  écrit, avec `docs/FORMAT_SCRIPT.md` pour modèle. Tant qu'un script ne déclare pas
  `scan : true`, il s'applique tel quel, comme en 1.2.

## Idées pour plus tard

- **Exceptions par script aux emplacements protégés.** La liste reste la même pour tous,
  mais tel script — « vérifier les fichiers de Windows » — a le droit de recevoir
  `C:\Windows`, sans ouvrir la porte aux autres. Même rangement que la liste (`HKLM`,
  administrateur), rattaché à l'identifiant du script.
- **Témoin des changements sensibles — retenu pour la 1.5.** Aucun bac à sable n'est
  possible pour un script administrateur (§12) : WinTool ne peut pas l'*empêcher* de
  toucher aux tâches planifiées ou aux variables d'environnement. Il peut en revanche
  **relever, avant et après chaque script**, ce qu'un logiciel malveillant modifie pour
  s'installer durablement — tâches planifiées, services, clés de démarrage automatique,
  variables d'environnement du système, exclusions de l'antivirus, fichier `hosts`,
  certificats racine, règles du pare-feu — et **le dire dans le bilan** : « ce script a
  créé la tâche planifiée X ». Presque tout se lit dans `HKLM` ou sur le disque, sans
  PowerShell, donc vite. En simulation, tout changement relevé trahirait un script qui ne
  simule pas vraiment. Les points d'attention de l'écran d'approbation (§12.2)
  s'étendraient aux mêmes gestes (`Register-ScheduledTask`,
  `Add-MpPreference -ExclusionPath`…).
- **Signer l'exécutable.** C'est ce qui fait taire SmartScreen avec le temps et réduit les
  faux positifs. Ni Microsoft (Azure Artifact Signing) ni les certificats « open source »
  ne s'offrent simplement à un particulier français au moment d'écrire : à trancher
  (statut d'indépendant, certificat OV, signature hors de GitHub Actions).
- **Faux positifs des antivirus.** Soumettre chaque version à l'analyse de Microsoft ;
  envisager `RemoteSigned` comme politique par défaut, `Bypass` étant un signal que les
  antivirus d'entreprise surveillent. Le script d'export des données de navigateur
  ressemble, par construction, à un voleur d'identifiants : le plus exposé.
- **Signaler à Tauri** que son modèle NSIS efface les données de l'interface avec
  `RmDir /r`, qui suit les jonctions, depuis un désinstalleur administrateur.
