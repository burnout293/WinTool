# WinTool v0.4 — Spécification fonctionnelle

> Ce document fait autorité sur le comportement de l'application.
> Toute divergence entre ce document et le code est un défaut, à corriger d'un côté
> ou de l'autre — jamais à laisser courir. C'est précisément cette dérive qui a rendu
> la v0.3 inexploitable.

Version du document : 0.1 — 22/09/2026

> **Trois numérotations coexistent dans ce projet, ne pas les confondre :**
>
> | Axe | Où | État |
> |---|---|---|
> | Génération de l'application | « v0.3 », « v0.4 » dans ce document | Quatre réécritures internes, **aucune publiée** |
> | Version publiée | `tauri.conf.json`, `Cargo.toml`, les tags git | **1.0.0**, publiée le 27/09/2026, a été la première mise à disposition du public |
> | Contrat de script | « contrat v2 », `docs/FORMAT_SCRIPT.md` | Format des `.ps1`, indépendant des deux autres |
>
> Les générations antérieures sont donc numérotées en `v0.x` : rien n'a jamais
> été distribué avant la 1.0.0, et afficher « v4.0.0 » à un utilisateur
> laisserait croire à trois versions publiées qui n'ont pas existé.

---

## 1. Ce qu'est WinTool

Un outil de maintenance Windows qui exécute des scripts PowerShell derrière une interface
graphique. Distribué publiquement sur GitHub sous forme d'un `.exe` unique (Tauri 2).

**Principe fondateur, hérité de la v0.3 et conservé** : déposer un fichier `.ps1` dans le
dossier des scripts suffit pour qu'il apparaisse dans l'application. Aucun couplage,
aucune recompilation, aucune liste à tenir à jour.

**Principe central de la v0.4** :

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

C'est l'inversion majeure par rapport à la v0.3, où la catégorie était figée dans le script.

Une catégorie porte :

| Champ | Détail |
|---|---|
| `id` | interne, stable |
| `name` | **un seul nom**, partagé par les deux modes → les catégories d'usine sont livrées avec des noms déjà grand public (« Faire le ménage », pas « Nettoyage ») |
| `description` | une phrase, en langage courant |
| `icon` | choisie parmi le jeu d'icônes de l'application |
| `pinned` | épinglée en grand dans l'étape 1 du mode Simple |
| `scripts[]` | **liste ordonnée** de références de scripts |

**Fr/en (§10) ne s'applique qu'aux catégories d'usine**, et seulement à elles : `id` y est
doublé (`id_en` + `id_fr`, ex. `privacy` / `vieprivee`) — les deux sont acceptés par
`category` dans l'entête d'un script (docs/FORMAT_SCRIPT.md) — et `name` y est traduit
fr/en. Une catégorie **créée par l'utilisateur** n'a qu'un seul `id` et un seul `name`,
dans la langue tapée à la création : aucun script ne peut la viser par `category`, elle ne
se remplit qu'à la main.

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

**Deux racines, et c'est une décision de sécurité autant que de rangement.**

```
<dossier d'installation>\scripts\Default\   ← scripts livrés, lecture seule
│   ├─ 200_DISABLE_SLEEP.ps1
│   └─ …
%LOCALAPPDATA%\WinTool\scripts\             ← scripts de l'utilisateur
├─ MesScripts\                              ← il organise comme il veut
└─ Essais\
```

**Les scripts livrés restent dans le dossier d'installation** et ne sont recopiés nulle
part. `Program Files` n'est pas inscriptible sans élévation : du code lancé sous le compte
de l'utilisateur ne peut donc pas les remplacer — alors que ce sont précisément ceux qu'un
débutant lancera en mode Simple sans les lire. La protection vient des **droits du
système**, pas d'un mécanisme qu'il faudrait écrire et maintenir.

Corollaire à assumer : l'installation doit être **par machine** (`perMachine`), jamais
« pour moi seul ». Une installation dans un dossier inscriptible sans élévation rendrait
tout le reste sans objet — on y remplacerait aussi bien l'exécutable lui-même.

Le dossier de l'utilisateur, lui, **reste inscriptible** : c'est le principe du projet, on
dépose un `.ps1` et il apparaît. C'est aussi la raison pour laquelle tout ce qui s'y trouve
passe par l'approbation avant première exécution (§12.1). **Les sous-dossiers sont
autorisés et la découverte est récursive.**

**Règle de mise à jour** : `Default\` est remplacé avec l'application, puisqu'il en fait
partie. Les scripts de l'utilisateur vivent ailleurs et ne sont jamais touchés — il n'y a
plus de fusion à opérer, ni de modification locale à sauvegarder.

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
  **Les scripts livrés sont parcourus en premier**, et ce n'est pas un détail d'ordre : un
  script déposé dans le dossier utilisateur ne peut donc pas s'approprier l'`id` d'un
  script livré pour hériter de sa configuration ou de son approbation.

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

### 5.2 Options et configuration

**Principe : tout ce qui s'adresse à un humain vit dans les blocs `##` ; `$CONFIG` ne
contient que des clés et des valeurs par défaut.** Les deux langues se déclarent donc
exactement de la même façon, en bloc — c'est cette symétrie qui rend la dérive détectable.

```powershell
## WINTOOL:OPTIONS
## DnsProvider  : [select] DNS provider — the service that resolves website addresses
##   cloudflare : Cloudflare — 1.1.1.1, fastest on most connections
##   google     : Google — 8.8.8.8, very reliable
##   quad9      : Quad9 — 9.9.9.9, blocks known malicious domains
## CleanTargets : [multi]  What to clean — pick one or more
##   temp       : Temporary files
##   cache      : Browser caches
## ApplyToIPv6  : [bool]   Apply to IPv6 — equivalent resolvers
## FlushCache   : [hidden] Flush the resolver cache afterwards
## WINTOOL:END

$CONFIG = @{
    DnsProvider  = "cloudflare"
    CleanTargets = @("temp", "cache")
    ApplyToIPv6  = $true
    FlushCache   = $true
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}
```

Types : `bool` · `number` · `string` · `select` · `multi` · `hidden` (Expert seulement).

**Listes** : `select` et `multi` déclarent leurs choix en **sous-lignes indentées d'au
moins deux espaces**. C'est l'indentation, et elle seule, qui distingue un choix d'une
option. Chaque choix porte un libellé et une description, traduits de la même façon dans
le bloc `LANG`. La valeur par défaut d'un `select` est **un** des choix ; celle d'un
`multi` est un **tableau** de choix — `@()` est accepté pour aucune sélection initiale.
Un tableau JSON injecté par l'override redevient bien un tableau PowerShell.

**Le nom d'une clé apparaît dans trois endroits** — `OPTIONS`, `LANG` et `$CONFIG`. C'est
le prix de cette structure, et il est couvert : le validateur croise les trois **dans les
deux sens**. Une option sans valeur par défaut, une valeur sans option déclarée, une
traduction qui ne correspond à rien — chacune est une erreur, signalée avec son numéro de
ligne. La v0.3 ne vérifiait rien de tout cela.

**Pourquoi la ligne d'override est décisive.** La v0.3 reconstruisait le bloc `$CONFIG` par
expression régulière, écrivait un `.ps1` temporaire et l'exécutait — mécanisme fragile et
déjà cassé. Désormais WinTool pose le JSON des valeurs choisies **dans la variable
`WINTOOL_CONFIG` elle-même**, et exécute **le script original tel quel**. Plus de
réécriture, plus de fichier temporaire. Le script reste parfaitement exécutable seul en
double-clic : sans la variable d'environnement, il utilise ses valeurs par défaut.

**La variable contient le JSON, jamais le chemin d'un fichier.** Un fichier aurait dû
vivre dans un dossier inscriptible sans élévation, et un processus tiers aurait pu le
remplacer entre notre écriture et la lecture par PowerShell ; ses valeurs auraient alors
atterri dans `$CONFIG`, **en administrateur**. Pas besoin d'`Invoke-Expression` pour que ce
soit grave : un `Remove-Item $CONFIG.Chemin -Recurse -Force` suffit. L'environnement d'un
processus déjà lancé ne peut pas être modifié de l'extérieur — il n'y a donc plus
d'intervalle à exploiter, parce qu'il n'y a plus de fichier.

Plafond : Windows limite une variable d'environnement à 32 767 caractères. Au-delà de
30 000, WinTool refuse le lancement avec un message clair plutôt que de transmettre une
configuration tronquée.

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
simple fait que le script ait démarré. C'était l'un des défauts majeurs de la v0.3, dont
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

C'est ce qui corrige la v0.3 : elle acceptait en silence, d'où **zéro script conforme sur
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

### 6.8 Vérifier un script sans l'exécuter

Une action **Vérifier**, disponible sur chaque script, répond à une seule question : *ce
fichier est-il lisible et conforme ?* Elle fait deux choses, sans jamais rien exécuter :

1. **relire le contrat** — la même analyse qu'à la découverte (§5.5), qui produit les
   anomalies avec leur numéro de ligne ;
2. **faire analyser le fichier par PowerShell** — l'arbre syntaxique est construit, aucune
   commande n'est évaluée.

Le chemin du fichier est transmis par une variable d'environnement, jamais dans le texte de
la commande : aucun caractère du chemin ne peut en changer le sens (même règle qu'au §5.2).

**Ce que ce contrôle ne dit pas**, et que l'interface énonce noir sur blanc sous le
résultat : qu'un script qui s'analyse réussira. Les droits, l'état de la machine, une
applet absente ou une erreur de logique ne se voient qu'à l'exécution. C'est un contrôle de
forme, pas un essai à blanc — et laisser croire l'inverse serait pire que ne rien afficher
(même principe qu'au §12.2).

### 6.9 Simulation

Un script qui déclare l'option `SafeTest` sait **se simuler** : il montre ce qu'il ferait,
sans rien modifier. L'interface parle partout de **simulation** — jamais de « test sans
risque », de « Safe Test » ni de « mode test » — et **impose son propre libellé** à cette
option, quel que soit celui que l'auteur du script a écrit : « Simuler ». Le terme est
ainsi le même partout, sans dépendre de chaque auteur.

**Script par script.** Que chaque script soit simulé ou non est un réglage ordinaire,
enregistré dans sa configuration comme n'importe quelle option, et **conservé d'une
session à l'autre** (1.1.1). Il se règle dans le mode Expert ; le mode Simple ne montre pas
cette option.

**L'interrupteur général.** La pastille « Simulation » n'a pas d'état propre : elle se
déduit des scripts.

| État | Condition | Pastille |
|---|---|---|
| Désactivée | aucun script simulable n'est simulé | éteinte |
| Partielle | certains le sont | « Simulation n/total », bord en pointillés |
| Activée | tous ceux qui le peuvent le sont | allumée |

La basculer simule tous les scripts qui le permettent, ou les repasse tous en réel.
Chacun se règle ensuite à nouveau un par un.

Quatre règles non négociables :

- **Les réglages enregistrés décident, pas l'interface.** Au lancement, le moteur impose
  à `SafeTest` la valeur enregistrée pour ce script, quelle que soit la configuration que
  l'interface lui a transmise. Ce qui s'exécute est toujours ce que les réglages annoncent.
- **Simulation activée, script qui ne sait pas se simuler : refusé, pas exécuté.**
  L'intention « rien de réel » est alors sans ambiguïté. Injecter une clé que le script
  n'utilise pas ajouterait une entrée inerte à sa table, et il modifierait la machine
  pendant que l'interface annonce une simulation : un refus visible vaut mieux qu'une
  garantie fausse. En simulation **partielle**, chaque script suit son propre réglage —
  l'utilisateur a choisi script par script —, et celui qui ne sait pas se simuler
  s'exécute réellement. Le récapitulatif de l'étape 2 dit, pour chaque script, s'il sera
  simulé ou non lancé.
- **Une exécution simulée n'est jamais « faite ».** Elle porte `simulated` jusque dans
  l'historique, qui la garde, mais « Fait le … » (§7) ne retient que les exécutions
  réelles. Le bilan dit combien de scripts ont été simulés.
- **L'état est rappelé à deux endroits** — la pastille et un bandeau en tête d'écran,
  affiché dès qu'un seul script est simulé.

**Pourquoi la persistance, et ce qu'elle change.** Jusqu'à la 1.1.0, le mode test était un
état de session, perdu à la fermeture, pour qu'un entretien réel ne passe jamais pour une
simulation. Régler la simulation script par script impose de la conserver — c'est le choix
fait pour la 1.1.1. Le risque s'inverse alors : croire réel un entretien simulé. Ce sont
les deux dernières règles qui le ferment, et c'est pourquoi elles ne se discutent pas.

**Limite assumée** : `SafeTest` est une convention de script. WinTool garantit que la clé
est transmise avec la valeur enregistrée, et qu'aucun script incapable de se simuler ne
part quand la simulation est activée ; il ne peut pas garantir qu'un script qui la déclare
l'honore complètement. Cette responsabilité est celle de l'auteur du script, et
`docs/FORMAT_SCRIPT.md` la lui rappelle.

---

## 7. État affiché — historique local uniquement

« Fait le 18 septembre » signifie **« lancé le 18 septembre »**, pas « vérifié appliqué ».
Jusqu'à la 1.1, aucun script n'a de mode « vérifier ». À partir de la 1.2, un script peut
savoir analyser (§17) — mais une analyse est un instantané montré avant d'agir, pas un
suivi : elle n'écrit rien dans l'historique et ne change pas ce qu'affiche « Fait le … ».

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

**Par défaut : détecter et proposer. Rien n'est téléchargé ni installé sans un clic.**
Cohérent avec un outil élevé en administrateur qui se présente comme respectueux de la vie
privée.

Implémenté en 1.1 par le greffon officiel `tauri-plugin-updater`, dont le code a été lu
avant d'être retenu. Le détail des choix est en tête de `src-tauri/src/update.rs`.

### 11.1 Comportement

- **Au démarrage**, si le réglage vaut « Proposer », WinTool interroge la dernière release
  publiée — **après** l'affichage de la fenêtre et sans l'attendre. Une machine hors ligne
  est un cas normal : la vérification échoue alors en silence.
- **Une version plus récente** fait apparaître un bandeau : « Installer » ou « Plus tard ».
  « Plus tard » vaut pour la session : WinTool ne redemande pas avant le prochain lancement.
- **« Ne jamais vérifier »** supprime toute requête automatique. « Vérifier maintenant »
  reste disponible dans les réglages : c'est alors une action explicite, pas un contact
  silencieux.
- **L'installation est refusée pendant un entretien**, par l'interface et par le moteur.
  Sous Windows, l'installeur ferme WinTool : il couperait le script en cours au milieu de
  ce qu'il fait. Entre deux scripts d'un lot, un drapeau dédié tient ce refus — ni l'état
  d'exécution, nul le temps de lancer le script suivant, ni l'état du bilan ne le disent.
- **L'installeur ferme WinTool puis le rouvre.** Il demande l'élévation, l'installation
  étant `perMachine` (§4.3).

### 11.2 Intégrité : une signature, pas une empreinte

La première version de ce paragraphe prévoyait de vérifier une empreinte SHA-256 publiée à
côté de l'installeur. Elle a été abandonnée : une empreinte hébergée sur la même release que
l'exécutable protège d'une corruption en transit, pas de quelqu'un capable de remplacer les
fichiers de la release — il remplacerait l'empreinte avec.

À la place, **une signature**, faite avec une clé privée qui n'est jamais publiée :

1. l'installeur est téléchargé **en mémoire** ;
2. sa signature est vérifiée avec la **clé publique compilée dans l'application** ;
3. **seulement ensuite** il est écrit et exécuté. Une signature invalide arrête tout, et
   l'interface le présente comme ce que c'est — un refus de sécurité, en rouge, « rien n'a
   été installé » —, pas comme un incident réseau. La mise à jour refusée n'est plus
   reproposée de la session.

**Protection contre le retour en arrière.** Le manifeste `latest.json`, qui annonce la
version disponible, n'est **pas** signé : seul l'installeur l'est. Sans précaution, une
réponse falsifiée pourrait annoncer « 9.9.9 » en l'associant à un ancien installeur,
authentiquement signé mais vulnérable. L'option `requireSignedVersion` est donc activée :
la version annoncée doit égaler celle inscrite dans la partie signée de la signature.
Vérifié empiriquement avant de l'activer — la CLI 2.11.5 inscrit bien `version:` dans le
commentaire signé ; sans cela, l'option aurait bloqué toutes les mises à jour.

**Ce que la signature ne couvre pas.** La clé privée vit dans les secrets du dépôt GitHub.
Qui compromet le compte peut modifier le workflow et faire signer ce qu'il veut. La clé
publique étant compilée dans l'application, la remplacer exige de publier une version qui
porte la nouvelle — la même contrainte que pour les sources de scripts (§16.9).

**Perdre la clé privée, c'est perdre la mise à jour.** Toutes les installations
existantes refuseraient un installeur signé par une autre clé : chaque utilisateur devrait
réinstaller à la main. Elle doit être sauvegardée hors du dépôt, avec son mot de passe.

### 11.3 Vie privée

La requête ne porte que `User-Agent: tauri-plugin-updater/<version du greffon>` et
`Accept: application/json`. L'adresse interrogée est fixe : le greffon n'y substitue
`{{current_version}}`, `{{arch}}` ou `{{target}}` que si elles y figurent, et elles n'y
figurent pas. **Rien n'identifie la machine, pas même la version installée.** GitHub voit
une adresse IP qui demande un fichier public. Vérifié dans le source de la version 2.12.0.

### 11.4 Publier, c'est livrer

La construction de la release produit `latest.json` à côté de l'installeur, mais GitHub ne
le sert qu'une fois la release **publiée**. Tant qu'elle reste en brouillon, aucune
installation ne reçoit rien. Publier le brouillon est donc l'acte qui livre la mise à jour
à tout le monde : il se fait après l'avoir relue, jamais par réflexe.

À documenter dans le README : l'exécutable n'étant pas signé Authenticode, **SmartScreen
affichera un avertissement** au premier téléchargement. La signature de mise à jour est
d'une autre nature : elle ne rassure pas Windows, elle garantit à WinTool que ce qu'il
installe vient bien de ce dépôt.

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

- Un script de `Default\` **dont l'empreinte correspond à ce que l'installeur a posé** est
  **implicitement approuvé** — déjà vérifié en CI (§5.4).
  *Quand les sources de scripts seront implémentées (§16), l'installeur ne livrera plus
  aucun script : cet ancrage passera à la signature Ed25519 de l'index officiel (§16.4).*
- **Tout le reste** — script déposé à la main, script dont l'empreinte a changé depuis son
  installation (modification locale, potentiellement malveillante) et, avec le §16, tout
  script de source tierce — doit être **explicitement approuvé avant sa toute première
  exécution** : un écran affiche le contenu du script (accessible même en mode Simple via un
  lien, sans jamais l'imposer en lecture) et demande une confirmation nommée, jamais une
  case cochée par réflexe.
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

### 12.4 Élévation : où WinTool pourrait servir d'escalier

**Modèle de menace.** L'attaquant est du code qui tourne **sous le compte de l'utilisateur,
sans élévation**. C'est le seul qui compte : celui qui est déjà administrateur n'a pas
besoin de WinTool. Toute la question est donc de savoir où WinTool, qui est élevé, lui
tiendrait l'échelle.

Chaque étape entre le lancement de l'application et la fin d'un script a été passée en
revue. Les mesures ci-dessous ne sont pas des précautions générales : chacune ferme un
chemin identifié.

| Étape | Ce qui serait exploitable | Mesure |
|---|---|---|
| Installation | Dossier d'installation inscriptible → on remplace l'exécutable ou une DLL voisine | Installation **`perMachine`** imposée (§4.3) |
| Interface | Les fichiers de l'interface sont **embarqués dans le binaire**, pas lus du disque | Rien à remplacer |
| Découverte | Le champ `icon` vient du script et sert à charger un fichier inséré dans la page | Nom filtré sur la forme Lucide (`^[a-z0-9]+(-[a-z0-9]+)*$`) |
| Approbation | Voir la règle de lecture unique ci-dessous | §12.1 |
| Configuration | Un fichier JSON dans un dossier inscriptible, relu par PowerShell | Le JSON passe **dans la variable**, il n'y a plus de fichier (§5.2) |
| Lancement | Le script peut être remplacé entre sa vérification et son ouverture | Fichier **ouvert en interdisant le partage en écriture**, empreinte calculée depuis ce handle, handle gardé ouvert pendant toute l'exécution |
| Lancement | Le profil PowerShell vit sous `Documents`, inscriptible | `-NoProfile` |
| Lancement | `Import-Module` cherche d'abord sous `Documents`, inscriptible | `PSModulePath` réduit aux **chemins système** |
| Lancement | L'interpréteur résolu par le `PATH` | **Chemin absolu** (§6.7) |
| Bouton Arrêter | `taskkill` résolu par le `PATH`, exécuté en administrateur | **Chemin absolu** |

**Règle de lecture unique — approbation.** L'écran d'approbation affiche le contenu du
script et enregistre son empreinte. **Les deux viennent d'une seule et même lecture**, sous
le même verrou en partage-lecture. Deux lectures distinctes ouvriraient un intervalle où
l'utilisateur approuverait ce qu'il a vu pendant que l'application enregistrerait
l'empreinte d'un contenu substitué — l'approbation porterait alors sur un contenu que
personne n'a jamais lu.

**Magasin d'approbations.** La liste des empreintes approuvées vit dans un emplacement que
seul un administrateur peut écrire. Dans un fichier de réglages inscriptible par
l'utilisateur, un logiciel malveillant y ajouterait simplement sa propre empreinte, et tout
le dispositif du §12.1 deviendrait décoratif.

**Résidu assumé.** Le `PATH` n'est pas restreint : un script qui appelle un outil sans
chemin absolu suit toujours l'ordre du `PATH`, qui contient des dossiers inscriptibles sans
élévation — `winget` vit précisément dans l'un d'eux. Le restreindre casserait des scripts
légitimes. C'est une limite connue, à réexaminer quand les scripts livrés seront écrits et
qu'on saura lesquels appellent quoi.

---

## 13. Premier lancement

Un écran d'accueil unique et court : ce que fait l'outil, le fait qu'il s'exécute en
administrateur, le choix de la langue et du thème, un bouton « Commencer ». Puis l'étape 1
de l'assistant, avec les catégories d'usine déjà en place.

L'installation étant livrée **sans aucun script** (§16.1), cet écran enchaîne sur la
proposition de sources décrite au §16.6 — proposition qu'il doit rester possible de
refuser sans quitter l'application.

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

### 15.2 Ligne d'eau et nombre de lots

Les lots étant créés librement par l'utilisateur (§4.1), leur nombre est variable.

- Les bouées flottent **sur une ligne d'eau réellement dessinée**, ancrée au bas de la
  scène — à 308 px du bas, quelle que soit la hauteur de la fenêtre —, et **en suivent le
  mouvement** : chaque bouée oscille à la cadence de sa vague, déphasée selon sa position
  (§15.3). Elles ne se placent jamais par rapport au titre : avant la 1.1.1, c'est ce qui
  les faisait flotter à mi-hauteur, loin de l'eau, sur un grand écran.
- **Autant de bouées par ligne d'eau que la largeur le permet** — 150 px chacune au
  moins —, **huit au plus**. Au-delà, une **ligne d'eau de plus apparaît derrière**, plus
  haut : les rangées s'étagent vers le large, chacune sur sa propre vague, plus lente et
  plus calme que celle de devant. L'ordre des lots se lit de haut en bas.
- Deux rangées de même effectif sont **en quinconce**, et les bouées de devant passent
  devant celles de derrière. Les vagues dérivant à des vitesses différentes, tous les
  déphasages finissent par se produire ; dans le pire, une étiquette ne tombe pas sur un
  flotteur.
- **Fenêtre trop basse** pour poser toutes les rangées sur l'eau sans recouvrir le titre
  ni le lot épinglé : les bouées reviennent dans le flux de la page, qui défile. Rien n'est
  jamais inaccessible, et rien ne recouvre le reste.

La position de chaque bouée se calcule à partir de la fonction de la vague et de sa
position mesurée — jamais codée en dur. Vérifié sur le banc : à trois instants espacés de
2,5 s, chaque bouée se trouve à un pixel près de la hauteur de la vague sous elle, sur
l'une comme sur l'autre rangée.

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

**La houle des bouées.** Vue d'un point fixe, une vague qui dérive est une simple
oscillation verticale : la longueur d'onde vaut une demi-largeur de fenêtre, la nappe
glisse d'une largeur par cycle, donc sa hauteur sous un point revient avec une période
moitié de sa durée de dérive. Chaque bouée oscille à cette cadence, son retard calé sur
l'horloge de l'animation de la vague à l'instant où elle est posée : elle épouse la vague
en mouvement sans aucun calcul à chaque image, même redessinée longtemps après le départ
de la vague.

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

### 15.5 Icônes — Lucide, embarqué, sans exception

**Aucun emoji dans l'interface, nulle part.** Un emoji est rendu par la police du système :
son aspect change d'une machine à l'autre, il ne peut pas hériter de la couleur du texte et
ne s'aligne pas sur la grille. La v0.3 en utilisait (🧹 ⚡ 🛡️ 😴) ; c'est proscrit.

| Décision | Détail |
|---|---|
| Bibliothèque | **Lucide** — 2 112 icônes, 999 Ko de SVG, licence ISC |
| Pourquoi celle-là | C'est exactement l'idiome des maquettes. Les 22 icônes dessinées à la main pendant la phase 0 existent toutes chez Lucide, aux mêmes métriques — l'adopter ne change pas l'apparence validée, elle remplace des approximations par les tracés officiels. |
| Distribution | **Intégralement embarquée**, chargée à la demande. Aucune récupération réseau : WinTool sert précisément quand la machine va mal, parfois sans connexion, et c'est une application élevée en administrateur. |
| Icônes personnalisées | **Interdites.** Avec 2 112 icônes le besoin est nul, et un SVG arbitraire affiché par une application administrateur est une surface d'attaque. C'est ce qui garantit l'uniformité. |
| Sélecteur (Expert) | Une cinquantaine d'icônes curées mises en avant, recherche pour atteindre les 2 112 |

**La propriété qui rend cette famille indispensable à Marée** : les tracés sont en
`stroke="currentColor"`, donc l'icône **hérite de la couleur du texte** au lieu d'en porter
une. La même icône devient automatiquement sombre sur l'aplat accent, claire en thème
sombre, neutre au repos et accent quand la bouée est choisie — sans une ligne de code par
icône, et sans jeu d'icônes en double pour le thème sombre.

**Outillage** : `tools/lucide-icon-names.txt` versionne la liste des noms valides pour que
le validateur fonctionne hors ligne et en intégration continue. Les SVG eux-mêmes arrivent
par npm (`lucide-static`) côté frontend — ils ne sont pas versionnés dans le dépôt.

## 16. Sources de scripts

> **État : spécifié, non implémenté au 27/09/2026.** Aucune ligne de code ne réalise
> encore cette section. Elle est écrite avant l'implémentation, pas après, pour que le
> modèle de sécurité soit arrêté avant qu'un raccourci ne le décide à notre place.
>
> **Tant qu'elle ne l'est pas, l'installeur livre le catalogue**, comme en 1.0.0, et les
> scripts de `Default\` y restent implicitement approuvés par comparaison d'empreinte
> avec ce que l'installeur a posé (§12.1, première règle). Le basculement vers les
> sources — installeur vide, confiance ancrée sur la signature Ed25519 — vaut à partir
> de la version qui implémentera cette section. Tant qu'elle n'est pas écrite, c'est la
> règle du §12.1 qui s'applique, pas celle du §16.4.

### 16.1 Pourquoi WinTool ne livre plus de scripts

Jusqu'ici les scripts voyageaient dans l'installeur. Ils n'y sont plus : **WinTool est
livré sans aucun script** et propose à l'utilisateur de les récupérer depuis une *source*.

Deux raisons, l'une juridique et l'autre technique.

La raison juridique commande. La licence de WinTool interdit d'en tirer un revenu direct,
mais ne s'applique **pas** aux scripts, qui restent la propriété de leurs auteurs et
peuvent avoir n'importe quelle licence — y compris commerciale. Cette séparation ne tient
que si elle est réelle : un script embarqué dans l'installeur serait difficile à présenter
comme indépendant du logiciel qui le distribue. En cessant de les livrer, WinTool rend la
séparation juridique visible dans son fonctionnement, ce que le cahier des charges de la
licence exige explicitement.

La raison technique suit. Les scripts évoluent plus vite que l'application — un réglage
Windows change, une clé de registre se déplace, une commande disparaît. Les lier au rythme
des versions de WinTool condamnait soit l'application à sortir une version pour corriger un
script, soit les scripts à vieillir entre deux versions.

**Conséquence assumée** : une installation neuve ne sait rien faire tant que l'utilisateur
n'a pas ajouté une source ou déposé ses propres scripts. L'écran d'accueil doit donc
proposer, jamais imposer (§16.6).

### 16.2 Ce qu'est une source

Une source est un catalogue de scripts publié à une adresse, signé par son éditeur.

| Champ | Rôle |
|---|---|
| `id` | identifiant court et stable, sert de nom de dossier local |
| `name` | nom affiché |
| `url` | adresse de l'index |
| `public_key` | clé publique Ed25519 de l'éditeur |
| `official` | vraie pour la seule source officielle, jamais modifiable par l'utilisateur |
| `enabled` | une source peut être conservée sans être interrogée |

**La clé publique de la source officielle est compilée dans le binaire.** Elle ne vit ni
dans les réglages ni dans un fichier de configuration. Le raisonnement est celui du §12.4 :
tout ce qui est inscriptible sans élévation est remplaçable par un logiciel malveillant, et
une clé publique remplacée transforme le bandeau « source officielle » en décor.

Pour la même raison, **la liste des sources vit dans l'emplacement réservé à
l'administrateur**, avec le magasin d'approbations (§12.4). Ajouter ou retirer une source
demande donc une élévation. C'est une friction volontaire : ajouter une source, c'est
décider à qui l'on confiera l'exécution de code en administrateur.

### 16.3 L'index et sa vérification

Chaque source publie un index JSON et sa signature détachée. L'index déclare, pour chaque
script : son identifiant, son nom de fichier, sa version, sa taille et l'empreinte SHA-256
de son contenu.

L'ordre des opérations n'est pas négociable :

1. Télécharger l'index **et** sa signature.
2. Vérifier la signature Ed25519 avec la clé publique de la source.
3. **Si la vérification échoue, s'arrêter là** — ne rien analyser, ne rien écrire, ne rien
   afficher du contenu de l'index. Un index non vérifié est une donnée hostile.
4. Analyser l'index vérifié.

Un index est refusé s'il déclare un chemin de fichier contenant un séparateur de dossier,
un `..`, un caractère interdit par Windows ou un nom de périphérique réservé (`CON`, `PRN`,
`AUX`, `NUL`, `COM1`…). Sans ce filtre, une source pourrait écrire hors de son dossier.

### 16.4 Où la confiance est ancrée

Le §12.1 accordait une approbation implicite aux scripts « livrés par l'installeur ».
Puisqu'il n'en livre plus, cet ancrage disparaît et **la signature le remplace** :

| Provenance | Approbation avant première exécution |
|---|---|
| Source officielle, empreinte conforme à l'index signé | **implicite** |
| Source tierce, même signature valide | **explicite, écran du §12.1** |
| Script déposé à la main par l'utilisateur | **explicite** |
| N'importe quel script dont l'empreinte a changé depuis | **explicite, à nouveau** |

Une signature valide prouve l'origine, pas l'innocuité. C'est pourquoi une source tierce
correctement signée ne gagne aucune approbation implicite : WinTool sait alors de qui vient
le script, ce qui est exactement ce dont l'utilisateur a besoin pour décider — et rien de
plus.

Le dossier des scripts restant inscriptible sans élévation, un script téléchargé peut être
modifié après coup. Aucun mécanisme neuf n'est nécessaire : son empreinte cesse de
correspondre à celle de l'index signé, il perd son approbation implicite et l'écran du
§12.1 réapparaît. Le dispositif existant couvre ce cas, à condition que la comparaison se
fasse **contre l'index signé** et non contre une empreinte recalculée localement.

### 16.5 Installer et mettre à jour un script

Un script téléchargé est d'abord reçu en mémoire, son empreinte calculée, puis comparée à
celle de l'index signé. **Il n'est écrit sur le disque qu'après cette comparaison**, dans
`%LOCALAPPDATA%\WinTool\scripts\<id-source>\`. Un dossier par source : deux sources ne
peuvent pas se marcher dessus, et la provenance d'un script se lit dans son chemin.

La mise à jour suit le §11 — **détecter et proposer, jamais installer sans accord**. Trois
comportements au choix dans les réglages : vérifier au démarrage, vérifier à la demande,
ne jamais vérifier. Par défaut, vérification au démarrage et **proposition** ; rien n'est
téléchargé tant que l'utilisateur n'a pas dit oui.

Une mise à jour change l'empreinte. Elle repasse donc par la règle du §16.4 : automatique
pour la source officielle, écran d'approbation pour les autres. Un script mis à jour n'est
jamais exécuté dans la foulée de son téléchargement.

### 16.6 Ce que l'interface montre

**Ni source ni script.** L'accueil affiche une liste de sources proposées, la source
officielle en tête et identifiée comme telle. Un bouton permet de **continuer sans aucune
source** : l'utilisateur qui veut seulement déposer ses propres scripts ne doit pas avoir à
refuser un catalogue pour arriver à l'application.

**Des scripts, mais aucune source.** Un rappel discret, une fois, expliquant que ces
scripts ne recevront aucune mise à jour. Il porte une case **« ne plus afficher »** qui est
respectée définitivement.

**Sur chaque script**, sa provenance est visible sans avoir à la chercher : source
officielle, nom de la source tierce, ou script local. Un script de source tierce porte la
mention qu'il **n'est ni contrôlé ni approuvé par le projet WinTool**.

**Dans les réglages**, la gestion des sources : ajouter, retirer, activer, vérifier
maintenant, et le choix du comportement de mise à jour.

Le mode Simple suit les règles de langage du §3. « Source » n'y apparaît pas : on y parle
de **« catalogue d'entretiens »**, et une source tierce devient **« ajouté par vous, pas
vérifié par WinTool »**.

### 16.7 Vie privée

La licence interdit toute télémétrie mais autorise la communication réseau nécessaire à une
fonctionnalité. La frontière se tient ici, et elle est étroite : une vérification d'index
qui identifierait l'appareil serait de la collecte déguisée.

La requête ne transporte donc **aucun identifiant** : pas de numéro d'installation, pas
d'identifiant machine, pas de paramètre d'URL, pas d'en-tête personnalisé permettant de
distinguer une installation d'une autre. La source apprend qu'une adresse IP a demandé un
fichier public — ce que tout hébergeur voit — et rien de plus.

WinTool n'envoie jamais à une source la liste des scripts installés, l'historique
d'exécution ou la configuration.

### 16.8 Forks et sources tierces

Aucune adresse n'est câblée ailleurs que dans la constante de la source officielle. Un fork
remplace cette constante et sa clé publique, et dispose du même mécanisme pour son propre
catalogue — c'est l'intention : le modèle est fait pour être repris.

Le format d'index est documenté pour que n'importe qui publie une source sans demander
d'autorisation. WinTool n'exerce aucun contrôle sur le contenu des sources tierces et ne
répond pas de ce qu'elles distribuent.

### 16.9 Si la clé officielle est compromise

La clé publique étant dans le binaire, **la remplacer exige une mise à jour de
l'application**. C'est le prix de l'ancrage : on gagne l'impossibilité de substituer la clé
localement, on perd la rotation rapide.

En cas de compromission : publier une version de WinTool portant la nouvelle clé, et
considérer comme non approuvé tout script dont l'empreinte provient d'un index signé par
l'ancienne. Les scripts déjà installés ne sont pas supprimés — WinTool ne supprime jamais
un fichier de script (§14) — mais ils repassent par l'écran d'approbation.

### 16.10 Ce qui reste hors de portée

- WinTool **ne vérifie pas** ce que fait un script. La signature atteste l'origine, jamais
  l'intention. Le §12.2 reste ce qu'il est : des points d'attention, pas un verdict.
- Pas de dépendances entre scripts, pas de résolution de versions. Un index est une liste
  plate.
- Pas de miroir ni de reprise sur échec : une source injoignable est signalée, et
  l'application fonctionne avec ce qui est déjà installé.

---

## 17. Analyser avant d'agir

> **État : spécifié au 30/09/2026, prévu pour la 1.2.** Le contrat côté script — `scan`,
> `WINTOOL_MODE`, `[FIND]`, `[FREED]` — est décrit dans `docs/FORMAT_SCRIPT.md`, section
> « Le mode analyse ». Le validateur l'accepte dès la 1.1, pour que le catalogue puisse
> être adapté avant que l'interface n'existe. Cette section décrit ce que fait
> l'application.

### 17.1 Le principe

Le fonctionnement de CCleaner ou de Malwarebytes : **analyser, montrer, laisser choisir,
puis agir**. L'utilisateur ne lance plus un nettoyage à l'aveugle ; il voit ce qui sera
fait et en combien, et décoche ce qu'il veut garder.

Ce n'est pas une nouvelle mécanique d'exécution. Un script analysable est lancé deux fois :
une fois avec `WINTOOL_MODE=scan`, puis normalement, avec ses options `[bool]` et `[multi]`
fixées d'après les cases cochées. La sélection voyage par `WINTOOL_CONFIG`, comme n'importe
quel réglage (§5.2).

### 17.2 Dans le mode Simple

L'étape 2 de l'assistant cesse d'être un récapitulatif et devient l'analyse elle-même.

1. **Choisir** — inchangé : un lot.
2. **Analyser** — WinTool interroge chaque script analysable du lot et affiche ses constats,
   regroupés par script, chacun avec sa case. Un total résume ce qui est en jeu
   (« 1,1 Go à libérer, 3 réglages à appliquer »). Les scripts du lot qui ne savent pas
   analyser apparaissent aussi, cochés, avec la mention qu'ils s'appliqueront tels quels.
3. **Entretien** — seuls les éléments cochés sont traités.
4. **Bilan** — reprend `[FREED]` quand le script l'a émis, sinon l'estimation de l'analyse
   précédée de « environ ». Un chiffre n'est jamais présenté comme mesuré s'il est estimé.

Les règles de langage du §3 s'appliquent : « 795 Mo de fichiers temporaires », jamais
`size=795278422`.

Une analyse n'écrit **rien** dans l'historique. Seule l'action compte pour « Fait le … »
(§7) : avoir regardé n'est pas avoir fait.

### 17.3 Dans le mode Expert

Chaque script analysable propose « Analyser » dans son détail, qui affiche ses constats
sans rien lancer d'autre. C'est l'outil de l'utilisateur avancé qui veut comprendre avant de
composer un lot, et celui de l'auteur de script qui vérifie ce que son analyse rapporte.

### 17.4 Sécurité : analyser, c'est exécuter

C'est le point à ne jamais perdre de vue. L'analyse fait tourner le script, en
administrateur si l'entête le demande. Que ce mode ne modifie rien est une **promesse de
l'auteur**, que WinTool ne peut pas vérifier (§12, cadrage).

En conséquence :

- **L'approbation du §12.1 s'applique à l'analyse** exactement comme à l'action. Un script
  non approuvé n'est pas plus analysé qu'exécuté.
- L'analyse passe par le **même lanceur durci** que l'action (§12.4) : verrou en écriture
  sur le fichier, `-NoProfile`, `PSModulePath` réduit, interpréteur par chemin absolu.
- Un `[FIND]` qui vise une option que le script ne déclare pas est **ignoré** et relevé
  comme anomalie : un script ne peut parler que de ses propres cases, jamais faire
  apparaître une case au nom d'un autre.
- Une mesure illisible — taille négative, texte à la place d'un nombre, `state` inconnu —
  est ignorée et relevée, jamais interprétée au mieux.
- L'interface ne présente jamais l'analyse comme « sans risque ». Elle dit ce qu'elle fait :
  WinTool examine le PC.

### 17.5 Arrêter une analyse

Le bouton « Arrêter » s'applique à l'analyse. Elle ne modifie rien par contrat, et peut donc
être interrompue à tout instant sans la précaution du §6 : aucune notion de `[CKPT]` ne s'y
applique.

---
