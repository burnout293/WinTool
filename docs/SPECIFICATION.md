# WinTool v4 — Spécification fonctionnelle

> Ce document fait autorité sur le comportement de l'application.
> Toute divergence entre ce document et le code est un défaut, à corriger d'un côté
> ou de l'autre — jamais à laisser courir. C'est précisément cette dérive qui a rendu
> la v3 inexploitable.

Version du document : 1.0 — 22/09/2026

---

## 1. Ce qu'est WinTool

Un outil de maintenance Windows qui exécute des scripts PowerShell derrière une interface
graphique. Distribué publiquement sur GitHub sous forme d'un `.exe` unique (Tauri 2).

**Principe fondateur, hérité de la v3 et conservé** : déposer un fichier `.ps1` dans le
dossier des scripts suffit pour qu'il apparaisse dans l'application. Aucun couplage,
aucune recompilation, aucune liste à tenir à jour.

**Principe central de la v4** :

> **Le mode Expert est le panneau de configuration du mode Simple.**

Ce ne sont pas deux vues du même outil. Chaque bouton que voit le débutant est une
catégorie dont l'utilisateur avancé a défini le contenu, l'ordre, la configuration et le
comportement.

---

## 2. Les deux modes

### Mode Simple — assistant pas-à-pas

Destiné aux débutants et aux personnes âgées. Trois étapes :

| Étape | Rôle | Ne fait jamais |
|---|---|---|
| **1 · Choisir** | La catégorie épinglée en grand, puis les autres catégories | — |
| **2 · Vérifier** | Récapitulatif de ce qui va être fait, réglages repliés, annonce du point de restauration | **Ne modifie rien** |
| **3 · Entretien** | Progression, liste des tâches, puis bilan | — |

Une seule décision par écran. Retour possible à tout moment avant l'étape 3.

### Mode Expert — master-détail

Colonne gauche filtrable mêlant **Lots** (les catégories) et **Scripts**, détail à droite,
journal ancré en bas.

---

## 3. Règles de langage du mode Simple — non négociables

Aucun terme technique n'apparaît en mode Simple, jamais.

| Interdit | Formulation retenue |
|---|---|
| Télémétrie | **Protéger ma vie privée** — réduit ce que Windows transmet à Microsoft |
| Bloatwares | **Retirer les applications inutiles** — désinstalle ce que Windows a ajouté sans votre accord |
| Cache, fichiers temp | **Faire le ménage** — libère de la place sur votre disque |
| SFC, DISM, SMART | **Vérifier l'état du PC** — contrôle les disques et répare Windows |
| DNS | **Utiliser un Internet plus rapide** |
| Code de sortie 0 | **C'est terminé !** · *7 actions sur 7 réussies* |

Deux obligations supplémentaires :

- Toute action destructive s'accompagne de la phrase qui rassure
  (« Vos favoris et vos mots de passe ne sont pas touchés »).
- L'étape 2 annonce explicitement le point de restauration avant de lancer quoi que ce soit.

Les cibles cliquables du mode Simple ne descendent **jamais sous 56 px**
(recommandation d'accessibilité : 44 px).

---

## 4. Modèle de données

### 4.1 Catégories — données **utilisateur**

C'est l'inversion majeure par rapport à la v3, où la catégorie était figée dans le script.

Une catégorie porte :

| Champ | Détail |
|---|---|
| `id` | interne, stable |
| `name` | **un seul nom**, partagé par les deux modes → les catégories d'usine sont livrées avec des noms déjà grand public (« Faire le ménage », pas « Nettoyage ») |
| `description` | une phrase, en langage courant |
| `icon` | choisie parmi le jeu d'icônes de l'application |
| `pinned` | épinglée en grand dans l'étape 1 du mode Simple |
| `scripts[]` | **liste ordonnée** de références de scripts |

Le mode Expert permet de **créer, renommer, réordonner et supprimer** des catégories.

**Appartenance multiple** : un script peut figurer dans plusieurs catégories.
→ **Garde-fou obligatoire** : si deux catégories enchaînées partagent un script, il ne
s'exécute **qu'une fois**.

**« Entretien complet »** n'est pas un cas particulier du code : c'est une catégorie
ordinaire, simplement `pinned`. Elle est renommable et supprimable comme les autres.

### 4.2 Réglages par script

Stockés dans la configuration, **jamais dans le fichier `.ps1`** :

| Réglage | Origine de la valeur initiale |
|---|---|
| Valeurs du `$CONFIG` | les défauts déclarés dans le script |
| **Nécessite un point de restauration** | pré-coché si le script déclare `reversible : false` |
| **Nécessite un redémarrage** | pré-coché si le script déclare `reboot : true` |
| Activé / désactivé | activé |

**Principe général, valable pour tout réglage dérivé d'un script** (valeurs de `$CONFIG`,
ces deux cases, et le classement en catégorie du script — §5.1) : la métadonnée du script
**propose**, l'utilisateur **dispose**. Tant que l'utilisateur n'a rien changé, la valeur
suit le script et se met à jour si le script change (à la Ré-analyse, §5.5) ; dès qu'il la
modifie à la main, elle devient une **configuration figée** qu'aucun réglage venant du
script ne réécrit plus jamais automatiquement.

### 4.3 Emplacement des scripts

Toute l'arborescence vit dans **`%LOCALAPPDATA%\WinTool\scripts\`** — inscriptible, hors
`Program Files`. **Les sous-dossiers sont autorisés et la découverte est récursive.**

```
%LOCALAPPDATA%\WinTool\scripts\
├─ Default\          ← scripts livrés avec l'application
│   ├─ 01_disable_sleep.ps1
│   └─ …
├─ MesScripts\       ← l'utilisateur organise comme il veut
└─ Essais\
```

**Règle de mise à jour** : une mise à jour de l'application ne remplace **que** `Default\`.
Les autres sous-dossiers ne sont jamais touchés.
Si un fichier de `Default\` a été modifié à la main, il est **sauvegardé avant
remplacement** et l'utilisateur en est informé.

**Identifiant d'un script — le champ `id` de l'entête (§5.1), pas le chemin.** Un chemin
change au moindre renommage ou déplacement ; l'`id` survit, ce qui préserve la
configuration, le classement dans les catégories et l'historique.

- **Scripts de `Default\`** : `id` obligatoire, vérifié en CI (§5.4).
- **Scripts utilisateur sans `id`** : tolérés (« constater, jamais bloquer ») — WinTool
  retombe alors sur le **chemin relatif** à `scripts\` comme identifiant provisoire, et le
  lint signale l'anomalie « pas d'id déclaré : un renommage ou déplacement fera perdre la
  configuration de ce script ».
- **Si l'`id` d'un fichier change** (ou disparaît), l'ancienne référence dans une catégorie
  devient une référence vers un script **manquant** (règle ci-dessous) : aucun mécanisme de
  migration automatique, c'est un nouveau script aux yeux de l'application.
- **Collision d'`id`** (copier-coller d'un script sans relancer `New-Guid`) : le **premier
  fichier découvert** (ordre alphabétique du chemin) garde l'`id` ; les suivants portant le
  même `id` sont traités comme des doublons, signalés par le lint avec leur chemin, et
  identifiés provisoirement par leur chemin en attendant qu'un nouvel `id` soit généré.

Un script référencé par une catégorie mais introuvable (par `id` ou, à défaut, par chemin)
est affiché comme **manquant** et ignoré à l'exécution — jamais une erreur bloquante.

Un script dont le moteur requis (`engine`, §5.1) n'est pas installé est affiché avec un
marqueur clair — « nécessite PowerShell 7 » — et ignoré à l'exécution, sans bloquer le
reste de sa catégorie. Ce constat est fait à l'analyse (§5.5), pas à chaque lancement.
Détail au §6.7.

---

## 5. Le contrat de script v2

### 5.1 Entête

```powershell
## WINTOOL:START
## id            : 3f2b1a9c-7e4d-4c6a-9b0e-1d5f6a8c2e0b
## lang          : fr
## title         : Désactiver la veille
## desc          : Empêche Windows de se mettre en veille ou en hibernation
## category      : performance
## icon          : moon
## tags          : veille, hibernation, énergie
## version       : 2.0
## admin         : true
## risk          : low        # low | medium | high
## duration      : fast       # fast | medium | slow
## reversible    : true       # false → pré-coche « nécessite un point de restauration »
## interruptible : true       # false → ne peut pas être tué sans risque
## reboot        : false      # true  → pré-coche « nécessite un redémarrage »
## engine        : auto       # auto | winps | pwsh — voir §6.7
## WINTOOL:END

## WINTOOL:LANG en
## title             : Disable sleep
## desc              : Prevents Windows from sleeping or hibernating
## VeilleBranche_Min : Sleep on AC power — 0 = never
## WINTOOL:END
```

**`id` s'obtient avec `New-Guid`** (natif PowerShell, aucune dépendance) : lancer la
commande dans un terminal et coller le résultat dans l'entête à la création du script.
Risque de collision négligeable — pas besoin d'un schéma maison (timestamp, compteur…).

Le bloc `WINTOOL:START` est rédigé dans la langue déclarée par `lang`. Chaque bloc
`WINTOOL:LANG <code>` ajoute une traduction : métadonnées **et** libellés des clés de
`$CONFIG`. Une traduction absente retombe sur la langue de base. Ajouter une langue plus
tard ne touche à rien d'autre.

**`category` est une suggestion suivie tant que l'utilisateur n'a pas rangé le script
lui-même.** À la découverte, si la catégorie existe, le script y est placé ; sinon il va
dans « Non classé ». C'est une application du principe général du §4.2 : tant qu'aucun
humain n'a déplacé ce script manuellement, une **Ré-analyse** (§5.5) le replace en suivant
la valeur courante de `category` — utile si le script évolue. **Dès que l'utilisateur le
range lui-même** (glisser-déposer, changement manuel en mode Expert), ce classement devient
une configuration figée : ni un redémarrage ni une Ré-analyse ne le modifient plus, quoi
que dise `category` par la suite.

### 5.2 Configuration

```powershell
$CONFIG = @{
    VeilleBranche_Min     = 0      # [number] Veille sur secteur — 0 = jamais
    DesactiverHibernation = $true  # [bool]   Supprimer l'hibernation — efface hiberfil.sys
    VerrouillerRegistre   = $true  # [hidden] Verrouiller via le registre
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    (Get-Content $env:WINTOOL_CONFIG -Raw | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}
```

Types : `bool` · `number` · `string` · `hidden` (visible en Expert seulement).

**Pourquoi la ligne d'override est décisive.** La v3 reconstruisait le bloc `$CONFIG` par
expression régulière, écrivait un `.ps1` temporaire et l'exécutait — mécanisme fragile et
déjà cassé. Désormais WinTool écrit un simple fichier JSON, pose la variable
`WINTOOL_CONFIG`, et exécute **le script original tel quel**. Plus de réécriture, plus de
fichier temporaire. Le script reste parfaitement exécutable seul en double-clic : sans la
variable d'environnement, il utilise ses valeurs par défaut.

### 5.3 Sortie normalisée

**En anglais** (voir § 10). Le moteur colorise et interprète à partir de ces marqueurs :

```
[INFO]  message          ligne neutre
[OK]    message          succès d'une étape
[WARN]  message          avertissement, n'échoue pas
[ERR]   message          erreur, marque le script en échec
[STEP]  3/7 message      alimente la barre de progression
[CKPT]  message          « interruption sans risque à partir d'ici »
[REBOOT] message         un redémarrage est réellement nécessaire
[DONE]  message          fin nominale
```

**Le verdict de réussite vient du code de sortie du processus** (`0` = succès), jamais du
simple fait que le script ait démarré. C'était l'un des défauts majeurs de la v3, dont
l'historique enregistrait des succès fictifs.

### 5.4 Conformité : constater, jamais bloquer

**Un script non conforme s'exécute quand même.** Mais l'application le vérifie et signale
les anomalies dans le mode Expert, chacune **avec son numéro de ligne** :

- balise inconnue proche d'une balise connue → suggestion par distance d'édition
  (`[REBBOT]` ligne 47 → *vouliez-vous dire `[REBOOT]` ?*)
- métadonnée obligatoire manquante
- ligne de `$CONFIG` sans annotation `# [type] Libellé — Description`
- ligne d'override absente
- `id` absent (script utilisateur) → identification provisoire par chemin (§4.3)
- `id` en collision avec un autre script déjà découvert → doublon signalé avec son chemin
  (§4.3)

C'est ce qui corrige la v3 : elle acceptait en silence, d'où **zéro script conforme sur
treize** alors que la convention était documentée. Ici la non-conformité est visible sans
que le script cesse de fonctionner.

`tools/lint-scripts.ps1` reste utilisé **en intégration continue sur les scripts livrés** :
ceux-là, qu'on maîtrise, doivent être conformes à 100 %.

### 5.5 Analyse et ré-analyse

**L'analyse** d'un script (parsing de l'entête, résolution de l'`id` et de ses collisions
§4.3, vérification de conformité §5.4, vérification que le moteur requis par `engine` est
disponible §6.7) a lieu **une seule fois, à la découverte du fichier**. Elle n'est pas
relancée automatiquement si le fichier est modifié ensuite — WinTool ne surveille pas les
scripts en continu. Un script édité après coup continue de se comporter selon ce qui a été
compris **à sa découverte**, jusqu'à une ré-analyse explicite.

Deux déclenchements manuels, aucun automatique :

- dans les Réglages (Expert) : **« Ré-analyser tous les scripts »** ;
- en mode Expert, sur un script précis : **« Ré-analyser ce script »**.

Une ré-analyse rafraîchit tout ce qui n'a pas été figé par une configuration utilisateur
explicite (titre, description, tags, risque, réversibilité, redémarrage, moteur requis,
anomalies de lint, et le classement en catégorie **si** l'utilisateur ne l'a jamais changé
à la main — §4.2, §5.1). Elle n'écrase jamais une valeur que l'utilisateur a lui-même
modifiée : « Ré-analyser » n'est pas « Réinitialiser ».

---

## 6. Comportements d'exécution

### 6.1 Ordre

**Manuel, défini en mode Expert** par glisser-déposer, catégorie par catégorie.
Nécessaire dès lors qu'un script peut appartenir à plusieurs catégories : sa position n'a
plus de raison d'être la même partout.

### 6.2 Échecs

**Défaut : continuer et tout rapporter à la fin** — « 6 actions sur 7 réussies ». Les
scripts sont indépendants ; interrompre par une boîte de dialogue irait contre l'objectif
du mode Simple. Comportement modifiable en mode Expert.

### 6.3 Annulation — le script décide ce qui est sûr

1. **Premier clic sur « Arrêter »** — le script en cours va au bout, les suivants ne sont
   pas lancés. Aucun script n'est jamais coupé en deux.
2. **Deuxième clic** — si le script est `interruptible`, **ou** si un `[CKPT]` a été
   franchi, le processus est tué proprement. Sinon l'application **avertit explicitement**
   que ce script ne peut pas être interrompu sans risque, et ne force qu'après confirmation.

### 6.4 Point de restauration

- **Les scripts n'en créent jamais eux-mêmes.** C'est l'application.
- Au lancement d'une catégorie, **si au moins un de ses scripts le réclame, un seul point
  est créé** avant toute la série. Un point par catégorie, pas un par script.
- **À traiter explicitement, jamais en silence** : la protection système est désactivée par
  défaut sur beaucoup d'installations Windows 10/11, et Windows refuse plus d'un point par
  24 h. L'interface l'a promis à l'étape 2 — elle doit donc dire clairement ce qui s'est
  réellement passé.

### 6.5 Redémarrage

Annoncé d'avance à l'étape 2 si la case du script est cochée, confirmé à la fin si le
script émet `[REBOOT]`. **Jamais déclenché au milieu d'un entretien** : il est proposé
dans le bilan final, avec le choix de redémarrer maintenant ou plus tard.

### 6.6 Concurrence

Un seul entretien à la fois. Tant qu'une exécution est en cours, les autres lancements
sont refusés avec un message explicite.

### 6.7 Interpréteur et politique d'exécution

**Moteur** : un fichier `.ps1` ne peut pas choisir lui-même son interpréteur — sous
Windows, c'est toujours le processus appelant qui décide, il n'existe pas d'équivalent du
shebang Unix. Par défaut (`engine : auto`), WinTool choisit **le plus récent disponible**
entre `pwsh.exe` (PowerShell 7+) et `powershell.exe` (5.1, présent nativement sur tout
Windows 10/11). Un script peut forcer `engine : pwsh` ou `engine : winps` dans son entête
s'il a besoin d'une version précise (ex : opérateurs `??`/`?:`, propres à PowerShell 7+).

Si `engine : pwsh` est demandé et que PowerShell 7 n'est pas installé, WinTool ne se
replie **jamais silencieusement** sur 5.1 (risque de plantage en cours d'exécution sur une
syntaxe incompatible) : le script est marqué indisponible (§4.3), et WinTool propose comme
raccourci le script livré par défaut « Installer PowerShell 7 ». Si l'échec d'un script
en cours d'exécution ressemble à une incompatibilité de version, un indice peut être
affiché à titre indicatif — sans garantie de détection, ce n'est pas un pré-requis.

**Politique d'exécution (`ExecutionPolicy`)** : par défaut `Bypass`, appliquée **uniquement
au processus enfant** lancé par WinTool pour exécuter le script — jamais à la politique de
la machine ou de l'utilisateur, qui ne sont jamais lues ni modifiées. Rien à restaurer à la
désinstallation. Alternative réglable dans les paramètres Expert : `RemoteSigned` ou
`Unrestricted`, toujours au niveau du processus enfant seul.

---

## 7. État affiché — historique local uniquement

« Fait le 18 septembre » signifie **« lancé le 18 septembre »**, pas « vérifié appliqué ».
Aucun script n'a de mode « vérifier ».

**Limite assumée et à ne pas masquer** : une mise à jour Windows qui réactiverait la
télémétrie ne sera pas détectée, et un PC déjà configuré à la main affichera
« Jamais fait ». Le vocabulaire de l'interface doit rester cohérent avec ce qu'il sait
réellement.

---

## 8. Réglages

| Réglage | Emplacement |
|---|---|
| Thème (clair / sombre / Windows) | **partout**, icône engrenage |
| Langue | **partout** |
| Comportement des mises à jour | **partout** |
| Comportement en cas d'échec | Expert |
| Taille maximale des journaux | Expert |
| Réinitialisation aux réglages d'usine | Expert |
| Export / import de la configuration | Expert |
| Ouvrir le dossier des scripts | Expert |
| Rapport de conformité | Expert |
| Ré-analyser tous les scripts (§5.5) | Expert |
| Politique d'exécution : Bypass / RemoteSigned / Unrestricted (§6.7) | Expert |

Une personne à qui l'on a installé l'outil peut éclaircir ou agrandir son interface sans
jamais croiser un réglage qu'elle pourrait casser.

**Configuration d'usine** : l'application est livrée avec des catégories prêtes à l'emploi,
« Entretien complet » épinglée incluse, aux noms déjà grand public.
**Export / import** : toute la configuration tient dans un fichier, réimportable — on
configure une fois, on déploie chez un proche en quelques secondes. L'import **valide** le
fichier et refuse proprement un fichier corrompu ou issu d'une version incompatible.

---

## 9. Journaux et historique

| | Rétention |
|---|---|
| **Historique** (quoi, quand, réussi ou non, durée) | **maximale** — c'est lui qui alimente les « Fait le 18 septembre » |
| **Journaux techniques complets** | plafonnés par **taille**, pas par ancienneté ; limite réglable jusqu'à « Pas de limite » |

Le plafond porte sur la taille parce que c'est elle qui gêne réellement l'utilisateur —
et il serait contradictoire qu'un outil dont la raison d'être est de libérer de la place
laisse ses propres journaux s'accumuler sans limite.

---

## 10. Langue

| Niveau | Langue |
|---|---|
| Interface de l'application | **fr + en** |
| Catégories d'usine | **fr + en** (celles créées par l'utilisateur sont dans la langue qu'il tape) |
| Titres, descriptions et libellés d'options des scripts | **fr + en** via les blocs `WINTOOL:LANG` |
| **Sortie d'exécution brute des scripts** | **anglais seul** |

En mode Simple cette sortie est masquée derrière « Voir le détail technique », et la
progression affichée provient des marqueurs `[STEP]` / `[OK]` que l'interface traduit
elle-même. L'anglais est par ailleurs la convention pour un journal technique et pour une
contribution externe.

**Conséquence en phase 1** : les 13 scripts émettent aujourd'hui leurs messages en
français et doivent être réécrits en anglais.

Aucune chaîne de caractères en dur dans le code de l'interface.

---

## 11. Mises à jour

**Par défaut : détecter et proposer. Rien n'est téléchargé ni installé sans accord
explicite.** Cohérent avec un outil élevé en administrateur qui se présente comme
respectueux de la vie privée. D'autres comportements sont proposés dans les réglages.

À documenter dans le README : l'exécutable n'étant pas signé, **SmartScreen affichera un
avertissement** au téléchargement.

**Intégrité du téléchargement** : l'exécutable n'étant pas signé (Authenticode), l'appli
vérifie le **checksum** du binaire téléchargé contre celui publié avec la release GitHub
(fichier `.sha256` généré en CI, à côté de l'exe) avant de proposer l'installation. Ça ne
remplace pas une signature, mais ça détecte une altération en transit ou un CDN compromis
sans dépendre d'un certificat payant.

---

## 12. Sécurité

**Cadrage** : WinTool tourne en administrateur et exécute des scripts qui ont donc un accès
système complet. L'application **ne peut pas empêcher** un script malveillant de nuire —
aucun bac à sable n'a de sens ici, ce serait contraire à la raison d'être de l'outil
(maintenance système). Le risque réel n'est pas qu'un attaquant déjà capable d'exécuter du
code utilise WinTool pour ça — il n'en a pas besoin — mais que WinTool devienne, pour un
public non technique (le mode Simple vise explicitement les débutants), un **exécuteur
admin de confiance** qu'on le piège à pointer vers un script récupéré ailleurs (forum,
vidéo, mail). C'est un problème social, pas cryptographique : la réponse est la **friction
et la visibilité au bon moment**, pas une prétendue détection de malware.

### 12.1 Confiance à la première exécution

Tout script est identifié par un **hash de son contenu**, calculé à l'analyse (§5.5).

- Un script de `Default\` **dont le hash correspond** à ce que l'application a livré est
  **implicitement approuvé** — déjà vérifié en CI (§5.4).
- **Tout le reste** — script utilisateur, ou script de `Default\` dont le hash a changé
  depuis l'installation (modification locale, potentiellement malveillante) — doit être
  **explicitement approuvé avant sa toute première exécution** : un écran affiche le
  contenu du script (accessible même en mode Simple via un lien, sans jamais l'imposer en
  lecture) et demande une confirmation nommée, jamais une case cochée par réflexe.
- **Toute modification ultérieure du fichier invalide l'approbation** (nouveau hash → le
  script redevient « non approuvé », re-demande à la prochaine exécution). Une approbation
  ne porte que sur le contenu exact qui a été montré.
- Refuser d'exécuter un script non approuvé pour éviter le contournement du mode Simple —
  cette approbation, elle, **bloque** ; c'est la seule exception au principe « constater,
  jamais bloquer » (§5.4), parce qu'il s'agit d'exécution avec accès admin et non de
  conformité de format.

### 12.2 Points d'attention détectés — indicatif, non garanti

Sur l'écran d'approbation (§12.1), WinTool signale la présence de motifs à risque connu
dans le script — `Invoke-Expression`, `DownloadString`/`DownloadFile`, `-EncodedCommand`,
désactivation de Windows Defender, suppression récursive forcée hors dossiers temporaires,
etc.

**Explicitement non garanti** : cette détection se contourne trivialement (obfuscation,
concaténation de chaînes, `iex` déguisé). Elle est étiquetée dans l'interface comme
« points d'attention détectés — liste non exhaustive », jamais comme un verdict de
sécurité, pour ne pas donner un faux sentiment de sécurité à l'utilisateur qui ne verrait
aucune alerte. Elle est distincte du champ `risk` (§5.1), qui est déclaré par l'auteur du
script et donc sans valeur face à un script malveillant.

### 12.3 Intégrité de l'exécution

WinTool ne désactive **jamais** AMSI ni l'intégration antivirus native de PowerShell lors
du lancement d'un script — pas de `-EncodedCommand` ni d'autre mécanisme qui contournerait
le scan que Windows Defender effectue déjà par défaut sur le contenu d'un script. C'est une
couche de défense gratuite déjà présente sur la machine ; l'implémentation ne doit pas la
casser par inadvertance en cherchant à optimiser le lancement du processus.

---

## 13. Premier lancement

Un écran d'accueil unique et court : ce que fait l'outil, le fait qu'il s'exécute en
administrateur, le choix de la langue et du thème, un bouton « Commencer ». Puis l'étape 1
de l'assistant, avec les catégories d'usine déjà en place.

Il pose le cadre — notamment pourquoi Windows a réclamé une élévation, après un
avertissement SmartScreen — sans transformer le démarrage en formulaire.

---

## 14. Hypothèses retenues faute de décision explicite

Ces points ont été tranchés par défaut. Ils sont signalés ici pour pouvoir être
contestés, pas dissimulés.

| Sujet | Hypothèse |
|---|---|
| Script manquant | affiché comme « manquant » dans sa catégorie, ignoré à l'exécution |
| Exécutions simultanées | interdites, une seule à la fois |
| Granularité de l'historique | une entrée par catégorie lancée **et** une par script exécuté |
| Catégorie vide | affichée en Expert, masquée en mode Simple |
| Suppression d'une catégorie | ne supprime aucun fichier de script |

---

## 15. Système visuel — « Marée »

Direction retenue le 22/09/2026, après trois séries de maquettes comparatives.
Maquette de référence : `docs/mockups/` et le canevas *WinTool — Marée contre Ressac*.

### 15.1 Le principe

**L'eau est l'élément structurant de l'application.** Une ligne d'eau traverse chaque
écran ; ce qui est actionnable flotte dessus, ce qui est technique se trouve dessous.

| Écran | Rôle de l'eau |
|---|---|
| Simple · étape 1 | Les catégories sont des **bouées posées sur la ligne d'eau**, chacune à la hauteur que lui donne la courbe |
| Simple · étape 3 | Le niveau **monte de 0 à 100 %** ; la liste des tâches vit dans une **carte blanche flottant par-dessus** |
| Expert | Le **journal est l'eau profonde** : panneau sombre pleine largeur en bas d'écran, à crête ondulée |

**Limite assumée à l'étape 3.** L'eau monte du bas alors que la liste se lit du haut :
les deux sens se contredisent. La liste est donc placée dans une carte blanche opaque
au-dessus de l'eau, ce qui garantit la lisibilité et l'ordre de lecture. **Conséquence à
accepter : à cet écran l'eau est décorative, elle n'est plus porteuse d'information.**
Le pourcentage et la liste portent seuls le sens. L'alternative (inverser la liste, ou
faire redescendre la marée) a été écartée.

### 15.2 Ligne d'eau et nombre de catégories

Les catégories étant créées librement par l'utilisateur (§4.1), leur nombre est variable.

- **Six bouées au maximum par ligne d'eau.**
- Au-delà, une **seconde ligne d'eau** apparaît en dessous avec les suivantes.
- La hauteur de chaque bouée est **calculée à partir de la fonction de la vague**, jamais
  codée en dur, pour que l'arrangement reste intentionnel quel que soit le nombre.

**Contrainte d'implémentation qui en découle** : la mise en page de l'étape 1 doit être
dessinée dès le départ pour que deux lignes d'eau tiennent dans la hauteur de fenêtre,
la catégorie épinglée comprise. C'est le cas le plus contraint de cet écran.

### 15.3 Animation

Deux nappes dérivent horizontalement à des vitesses différentes, ce qui crée la profondeur.

| Contexte | Nappe de fond | Nappe de surface |
|---|---|---|
| Étapes 1 et 2 | 46 s | 29 s |
| Étape 3, entretien en cours | 38 s | 24 s |
| Expert, crête du journal | 52 s | — |

**Technique de bouclage** : chaque nappe fait deux fois la largeur de la fenêtre et
contient deux motifs identiques. La translater d'exactement une largeur la ramène sur
elle-même : la boucle est donc **sans raccord visible**.

Deux obligations :

- **`prefers-reduced-motion: reduce` coupe toute animation.** Non négociable.
- **L'animation se met en pause quand la fenêtre passe en arrière-plan.** Une animation
  permanente sollicite le processeur graphique pour rien, sur un outil qu'on laisse
  parfois ouvert longtemps (une vérification SFC dure un quart d'heure).

### 15.4 Couleur

Un **accent unique** — dégradé `#22D39A` → `#35C8E8` — pour tout ce qui est interactif,
actif ou sélectionné. Trois couleurs sémantiques qui ne disent **qu'un état** : réussi,
attention, échec. Rien d'autre n'est coloré : une icône de catégorie reste neutre tant
qu'elle n'est pas choisie.

Le code couleur par domaine (une teinte par catégorie) a été **essayé puis rejeté** :
quand tout est coloré, plus rien ne ressort, et le vert « nettoyage » entrait en
collision avec le vert « réussi ».

**Seuil de contraste** : 4,5 pour tout texte. Vérifié par mesure, pas à l'œil. Deux
valeurs ont dû être corrigées à ce titre — `#7C8FA0` en sous-libellé (3,3 sur blanc)
remplacé par `#54697A` (5,2).
