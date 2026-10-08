# Écrire un script WinTool

Remplace `CREER_UN_SCRIPT.txt`, dont la convention n'était respectée par **aucun** des
13 scripts livrés. Pour que cela ne se reproduise pas, tout ce qui est décrit ici est
**vérifié par `tools/lint-scripts.ps1`** — et la dernière section liste les contrôles un
par un. Une règle ne peut plus changer d'un côté sans l'autre.

Référence normative : `docs/SPECIFICATION.md` §5.

---

## En deux minutes

1. Copiez le squelette ci-dessous dans un fichier `.ps1`.
2. Générez un identifiant : `New-Guid`, collez-le dans `id`.
3. **Enregistrez en UTF-8 *avec BOM*** (voir Encodage — c'est le piège n°1).
4. Déposez-le dans `%LOCALAPPDATA%\WinTool\scripts\` (sous-dossiers libres).
5. Vérifiez : `.\tools\lint-scripts.ps1`

Un script non conforme **s'exécute quand même** : WinTool signale, il ne bloque pas
(§5.4). **Mais plusieurs situations font refuser le lancement** — approbation manquante,
ancienne ligne d'override, script non simulable alors que la simulation est activée, interpréteur absent, fichier
modifié depuis son analyse. Elles sont toutes listées dans **« Ce qui empêche un script de
se lancer »**, plus bas : lisez cette section avant d'écrire votre premier script.

---

## Le principe : trois blocs, un rôle chacun

```
## WINTOOL:START     ce qu'est le script          ─┐
## WINTOOL:OPTIONS   ses réglages, typés et nommés ├─ pour les humains et l'interface
## WINTOOL:LANG fr   les mêmes, traduits          ─┘

$CONFIG = @{ ... }   les valeurs par défaut        ─── du PowerShell pur
```

**Tout ce qui s'adresse à un humain vit dans les blocs `##`.** `$CONFIG` ne contient que
des clés et des valeurs : pas d'annotation, pas de libellé, pas de traduction. Les deux
langues se déclarent donc **exactement de la même façon**, en bloc — c'est cette symétrie
qui rend la dérive détectable.

Le nom d'une clé apparaît dans trois endroits. Le validateur **croise les trois dans les
deux sens** : une option sans valeur par défaut, une valeur sans option déclarée, une
traduction qui ne correspond à rien — tout est signalé, avec le numéro de ligne.

---

## Nommer le fichier

**Cette norme ne s'applique qu'aux scripts officiels**, ceux du catalogue
([WinTool-Catalogue](https://github.com/burnout293/WinTool-Catalogue)).
Vos scripts personnels se nomment comme vous voulez : l'application ne regarde jamais le
nom de fichier, elle ne connaît que le champ `id`.

Format : `NNN_NOM_EN_ANGLAIS.ps1` — trois chiffres, tiret bas, nom en majuscules.

```
126_CLEAR_REGISTRY.ps1
200_DISABLE_SLEEP.ps1
501_CHECK_DISK_HEALTH.ps1
```

| Plage | Domaine |
|---|---|
| `1xx` | Nettoyage |
| `2xx` | Performance |
| `3xx` | Vie privée |
| `4xx` | Applications |
| `5xx` | Santé |
| `6xx` | Outillage |
| `7xx` – `8xx` | Réservé |
| `9xx` | Diagnostics internes |

**Le numéro ne détermine rien d'autre que le tri du dossier.** Ni l'ordre d'exécution —
c'est le classement manuel du mode Expert qui décide — ni l'identité du script, qui vient
de son `id`. Ne renumérotez donc jamais un fichier pour réorganiser un affichage.

Tous les scripts officiels vivent à plat dans `scripts/` du dépôt du catalogue, sans
sous-dossiers : son index signé est une liste plate.

---

## Le squelette

```powershell
## WINTOOL:START
## id            : 3f2b1a9c-7e4d-4c6a-9b0e-1d5f6a8c2e0b
## lang          : en
## title         : Set fast DNS
## desc          : Speeds up browsing with a faster resolver
## category      : performance
## icon          : zap
## tags          : dns, network, latency
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
## DnsProvider  : [select] DNS provider — the service that resolves website addresses
##   cloudflare : Cloudflare — 1.1.1.1, fastest on most connections
##   google     : Google — 8.8.8.8, very reliable
##   quad9      : Quad9 — 9.9.9.9, blocks known malicious domains
## ApplyToIPv6  : [bool]   Apply to IPv6 — equivalent resolvers
## FlushCache   : [hidden] Flush the resolver cache afterwards
## SafeTest     : [bool]   Simulate — shows what would be done, changes nothing
## WINTOOL:END

## WINTOOL:LANG fr
## title        : Utiliser un Internet plus rapide
## desc         : Accélère la navigation avec un résolveur plus rapide
## DnsProvider  : Fournisseur DNS — le service qui traduit les adresses des sites
##   cloudflare : Cloudflare — 1.1.1.1, le plus rapide sur la plupart des connexions
##   google     : Google — 8.8.8.8, très fiable
##   quad9      : Quad9 — 9.9.9.9, bloque les domaines malveillants connus
## ApplyToIPv6  : Appliquer à l'IPv6 — résolveurs équivalents
## FlushCache   : Vider le cache de résolution ensuite
## SafeTest     : Simuler — montre ce qui serait fait, sans rien modifier
## WINTOOL:END

$CONFIG = @{
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

# Comparaison de CHAINE, pas de booleen : la valeur arrive par JSON et peut
# valoir $true, "True" ou 1 selon le chemin emprunte.
$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')

Write-Host "[STEP] 1/1 Applying DNS settings"
if ($SafeTest) {
    Write-Host "[INFO] SafeTest - would set the resolver to $($CONFIG.DnsProvider)"
} else {
    Write-Host "[OK]   Provider set to $($CONFIG.DnsProvider)"
}
Write-Host "[DONE] Done"
exit 0
```

---

## La langue : code en anglais, commentaires libres

**Tout ce que lit une machine ou un contributeur est en anglais** : noms de fichiers,
entête de base, clés, libellés d'options, noms de variables et de fonctions, et la sortie
d'exécution.

**Les commentaires peuvent rester en français.** Ils s'adressent à celui qui maintient le
script, pas à l'application.

---

## L'entête

Tous ces champs sont **obligatoires**, sauf `tags`, `scan`, `view`, `panels` et `show`.

| Champ | Valeurs | Rôle |
|---|---|---|
| `id` | GUID (`New-Guid`) | **Identifie le script pour toujours.** Un chemin change au moindre renommage ; l'`id` survit, et avec lui la configuration, le classement et l'historique. |
| `lang` | `en`, `fr`… | Langue dans laquelle cet entête est rédigé |
| `title` | texte court | Nom affiché |
| `desc` | une phrase | Description affichée |
| `category` | voir ci-dessous | Sa catégorie dans l'Expert, et une **suggestion** de lot |
| `icon` | nom Lucide | Voir la section Icônes |
| `tags` | liste, virgules | Facultatif, alimente la recherche |
| `version` | `2.0` | Version du script lui-même |
| `admin` | `true` / `false` | Nécessite les droits administrateur |
| `risk` | `low` / `medium` / `high` | `high` déclenche une confirmation |
| `duration` | `fast` / `medium` / `slow` | `slow` est annoncé à l'avance |
| `reversible` | `true` / `false` | `false` **pré-coche** « nécessite un point de restauration » |
| `interruptible` | `true` / `false` | `false` = ne peut pas être tué sans risque |
| `reboot` | `true` / `false` | `true` **pré-coche** « nécessite un redémarrage » |
| `engine` | `auto` / `winps` / `pwsh` | Interpréteur requis |
| `scan` | `true` / `false` | Facultatif. `true` = le script sait analyser avant d'agir — voir « Le mode analyse » |
| `view` | une vue | Facultatif. La présentation de l'analyse — voir « Choisir sa vue » |
| `panels` | des panneaux | Facultatif. Les panneaux de l'Expert ouverts d'office — voir « Les panneaux de l'Expert » |
| `show` | `expert` | Facultatif. L'action n'existe qu'en mode Expert : ni montrée ni lancée en Simple |

### Catégories et lots : deux choses distinctes

Depuis la 1.4, WinTool range les scripts de deux façons, qui ne se confondent plus :

| | La **catégorie** | Le **lot** |
|---|---|---|
| Ce que c'est | Le domaine du script : nettoyage, vie privée… | Un groupe de scripts lancés ensemble |
| Qui décide | **Le script**, par `category` | **L'utilisateur**, en mode Expert |
| Où elle sert | L'onglet **Scripts** du mode Expert, pour trier | Les boutons du mode **Simple**, et l'onglet **Lots** de l'Expert |
| Combien | Une par script | Autant que l'utilisateur veut : un script peut être dans plusieurs lots, ou dans aucun |

### Les tokens acceptés par `category`

Chaque catégorie a **un id anglais et un id français**, tous deux acceptés — écrivez celui
qui correspond à la langue de votre `lang`, sans avoir à traduire. La liste vit dans
**`tools/categories.json`** (`id` = token anglais, `id_fr` = token français) — c'est la seule
source, lue à la fois par `tools/lint-scripts.ps1` (`CATEGORIE_INCONNUE` si vous en sortez) et
par l'application (`src-tauri/src/settings.rs`) pour éviter que la liste ne diverge d'un côté
comme c'est arrivé avec `CREER_UN_SCRIPT.txt`. Au 8/10/2026 : `cleaning`/`nettoyage`,
`performance`/`performance`, `privacy`/`vieprivee`, `apps`/`applications`, `health`/`sante`,
`tools`/`outillage`, `customize`/`personnalisation`.

Une catégorie inconnue ne bloque rien : le script est rangé dans **« Autres »**, en fin de
liste.

### Ce que « suggestion » veut dire pour les lots

Les lots d'usine vivent dans **`tools/lots.json`**, et chacun dit quelles catégories il
accueille : « Faire le ménage » accueille `cleaning`, « Vie privée » accueille `privacy`…
À la découverte d'un script, WinTool le place dans le lot qui accueille sa catégorie ; s'il
n'y en a aucun, le script part en **« Non classé »**. Tant que personne ne l'a déplacé à la
main, une ré-analyse le replacera en suivant `category`. **Dès que l'utilisateur le range
lui-même, c'est terminé** : son rangement devient figé. Le script propose, l'humain dispose.

Un lot **créé par l'utilisateur** n'accueille aucune catégorie : seul un rangement manuel y
place un script. Un script ne peut donc viser par `category` qu'un lot d'usine, jamais un
lot personnel d'une installation particulière.

La même règle vaut pour `reversible` et `reboot` : ils **pré-cochent** une case que
l'utilisateur peut décocher, et son choix l'emporte ensuite définitivement.

### Le cas de `icon`

**Aucun emoji, jamais.** Un emoji est rendu par la police du système : il change d'aspect
d'une machine à l'autre, ne peut pas hériter de la couleur du texte, et ne s'aligne pas sur
la grille. Le validateur le refuse.

`icon` prend un **nom d'icône [Lucide](https://lucide.dev)**, en minuscules avec tirets.
Les 2 112 icônes sont embarquées, donc disponibles hors ligne. Le validateur vérifie le nom
et suggère la bonne orthographe : `mon` → *vouliez-vous dire `moon` ?*

Ces icônes sont en `stroke="currentColor"` : **elles héritent de la couleur du texte**.
Une même icône devient donc sombre sur l'aplat accent, claire en thème sombre et neutre au
repos, sans aucun réglage.

| Domaine | Icônes |
|---|---|
| Nettoyage | `broom` · `sparkles` · `trash-2` · `eraser` · `recycle` |
| Performance | `zap` · `gauge` · `rocket` · `timer` · `cpu` |
| Vie privée | `shield` · `shield-check` · `eye-off` · `lock` · `user-x` |
| Applications | `app-window` · `package` · `package-minus` · `layout-grid` · `box` |
| Santé | `activity` · `heart-pulse` · `stethoscope` · `hard-drive` · `scan-line` |
| Outillage | `wrench` · `settings` · `calendar-clock` · `download` · `hammer` |
| Divers | `moon` · `sun` · `wifi` · `network` · `globe` · `folder` · `file-text` · `database` · `monitor` · `power` · `refresh-cw` · `bell-off` |

N'importe lequel des 2 112 noms fonctionne ; cette table sert à choisir vite. En revanche
**un script ne peut pas fournir sa propre image** — c'est ce qui garantit l'uniformité.

### Le cas de `engine`

Un `.ps1` ne peut pas choisir son interpréteur — sous Windows c'est le processus appelant
qui décide, il n'y a pas d'équivalent du shebang Unix. `auto` prend le plus récent
disponible. Ne forcez `pwsh` que si vous utilisez vraiment de la syntaxe PowerShell 7
(`??`, `?:`) : si PowerShell 7 est absent, WinTool **ne se replie jamais en silence** sur
5.1 — le script est marqué indisponible.

---

## Le bloc `OPTIONS`

Une ligne par réglage : `## Clé : [type] Libellé — Description`.

```powershell
## WINTOOL:OPTIONS
## TimeoutSeconds : [number] Operation timeout — in seconds
## CreateBackup   : [bool]   Create a backup first — recommended
## WINTOOL:END
```

| Type | Contrôle affiché |
|---|---|
| `bool` | interrupteur |
| `number` | champ numérique |
| `string` | champ texte libre |
| `select` | **liste déroulante, un seul choix** |
| `multi` | **cases à cocher, plusieurs choix** |
| `hidden` | **interrupteur, comme `bool`** — mais visible en mode Expert seulement |

> **`hidden` n'est pas un modificateur de visibilité.** C'est un `bool` caché : sa valeur
> par défaut doit être `$true` ou `$false`, et l'interface lui injectera **toujours** un
> booléen. Un `[hidden]` posé sur une chaîne ou un nombre passe le validateur **sans un
> seul constat**, puis casse à l'exécution — le script reçoit `false` là où il attend son
> texte. Pour cacher un réglage non booléen, il n'existe aucun moyen aujourd'hui.

Le séparateur entre libellé et description est un tiret cadratin `—`, **entouré d'un espace
de chaque côté**. Sans ces espaces, toute la chaîne devient le libellé et la description
disparaît. La description est facultative ; le libellé ne l'est pas.

### Un espace pour une option, deux pour un choix

C'est l'indentation **après `##`**, et elle seule, qui distingue une option d'un choix :

```
## MaCle      : [bool] Une option          ← UN espace  : c'est une option
##   monchoix : Un choix                   ← DEUX espaces : c'est un choix
```

**Alignez les deux-points en garnissant APRÈS le nom de la clé, jamais avant.** Une option
écrite `##  MaCle : [bool] X` (deux espaces) n'est plus une option : elle devient un choix
de l'option précédente. La clé disparaît de l'interface, et vous récoltez
`CHOIX_INATTENDU` puis `OPTION_NON_DECLAREE` sans comprendre pourquoi.

### Listes et multi-listes

`select` et `multi` déclarent leurs choix en **sous-lignes indentées d'au moins deux
espaces**. C'est l'indentation, et elle seule, qui distingue un choix d'une option.

```powershell
## WINTOOL:OPTIONS
## DnsProvider  : [select] DNS provider — the service that resolves website addresses
##   cloudflare : Cloudflare — 1.1.1.1, fastest on most connections
##   google     : Google — 8.8.8.8, very reliable
##   quad9      : Quad9 — 9.9.9.9, blocks known malicious domains
## CleanTargets : [multi]  What to clean — pick one or more
##   temp       : Temporary files
##   cache      : Browser caches
##   logs       : Old log files
## WINTOOL:END
```

Chaque choix reçoit un libellé et une description, traduits dans le bloc `LANG` de la même
façon. Et dans `$CONFIG` :

```powershell
$CONFIG = @{
    DnsProvider  = "cloudflare"          # select : UN des choix déclarés
    CleanTargets = @("temp", "cache")    # multi  : un TABLEAU de choix déclarés
}
```

Le validateur vérifie que chaque valeur par défaut fait bien partie des choix, qu'un
`select` n'est pas un tableau, qu'un `multi` en est un, et qu'une liste déclare au moins
deux choix. `@()` est accepté pour un `multi` sans sélection initiale.

Côté script, un `multi` se parcourt comme n'importe quel tableau :

```powershell
foreach ($target in $CONFIG.CleanTargets) {
    Write-Host "[OK]   Cleaned: $target"
}
```

---

## Le bloc de traduction

L'application est bilingue (§10). Le bloc traduit l'entête, les options **et les choix**,
vers une langue **différente** de celle déclarée par `lang` :

```powershell
## WINTOOL:LANG fr
## title        : Utiliser un Internet plus rapide
## desc         : Accélère la navigation avec un résolveur plus rapide
## DnsProvider  : Fournisseur DNS — le service qui traduit les adresses des sites
##   cloudflare : Cloudflare — 1.1.1.1, le plus rapide
## WINTOOL:END
```

`title` et `desc` sont obligatoires. Une traduction absente retombe sur la langue de base —
rien ne casse, le validateur émet un avertissement.

**En revanche, une traduction qui ne correspond à aucune option ou à aucun choix est une
erreur.** C'est le contrôle qui manquait à la v0.3 : renommez une clé et laissez sa
traduction derrière vous, et plus rien ne le signalait.

Les scripts officiels sont rédigés en anglais et traduits vers le français. Un script
personnel écrit en français fera l'inverse : le validateur accepte les deux sens, il exige
seulement qu'une seconde langue existe.

---

## La ligne d'override — ne la supprimez pas

```powershell
# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}
```

**Sans elle, les réglages choisis dans l'interface sont purement et simplement ignorés** :
le script tourne toujours avec ses valeurs par défaut, sans que rien ne le signale.

Elle remplace un mécanisme bien pire. La v0.3 reconstruisait le bloc `$CONFIG` à coups
d'expression régulière, écrivait un `.ps1` temporaire et exécutait *celui-là* — fragile,
et déjà cassé au moment de la refonte. Désormais WinTool pose vos réglages dans la
variable `WINTOOL_CONFIG` et exécute **votre fichier, tel quel**.

> **La variable contient le JSON, pas un chemin de fichier.** Une version antérieure de ce
> guide écrivait `Get-Content $env:WINTOOL_CONFIG -Raw | ConvertFrom-Json` : cette forme
> ne fonctionne plus, et le validateur la refuse (`OVERRIDE_OBSOLETE`). Le fichier
> intermédiaire a été supprimé parce qu'il vivait dans un dossier inscriptible sans
> élévation : un autre programme pouvait le remplacer entre l'écriture par WinTool et la
> lecture par votre script, et faire ainsi entrer ses propres valeurs dans `$CONFIG` —
> en administrateur.

Bénéfice secondaire : sans cette variable, votre script reste parfaitement exécutable seul,
en double-clic, avec ses valeurs par défaut.

---

## Les marqueurs de sortie

La sortie est **en anglais** (§10). En mode Simple elle est masquée derrière « Voir le
détail technique » ; c'est l'interface qui traduit la progression à partir des marqueurs.

```
[INFO]     message          ligne neutre
[OK]       message          succès d'une étape
[WARN]     message          avertissement, n'échoue pas
[ERR]      message          erreur affichée et comptée — ne suffit PAS à faire échouer le script
[STEP]     3/7 message      alimente la barre de progression
[PROGRESS] 0-100            la progression en pourcentage, quand [STEP] ne convient pas
[CKPT]     message          « interruption sans risque à partir d'ici »
[REBOOT]   message          un redémarrage est réellement nécessaire
[DONE]     message          fin nominale
[FREED]    octets           espace réellement libéré, repris dans le bilan
[LOG]      Canal texte      une ligne de journal rangée dans un canal (mode Expert)
[FIND]     Option champs    mode analyse : un constat sur une case — voir « Le mode analyse »
[ITEM]     Option id=…      mode analyse : un élément trouvé
[METRIC]   Libellé value=…  mode analyse : une mesure
[NOTE]     Note [cible]     mode analyse : une phrase du bloc REPORT
```

> ### Le seul verdict est `exit`
>
> `[ERR]` n'est qu'un affichage : il colore une ligne et incrémente un compteur. Il
> **n'échoue pas** le script. Un script qui écrit `[ERR] ...` puis se termine par `exit 0`
> — ou sans `exit` du tout, PowerShell renvoyant alors 0 — est enregistré comme une
> **réussite**, avec « 1 erreur » en petit à côté.
>
> Si votre script a rencontré une erreur, il **doit** se terminer par `exit 1`.
>
> C'est exactement le « succès fictif » que la v0.3 produisait et que cette refonte corrige :
> ne le réintroduisez pas depuis le script.

**Le verdict de réussite vient du code de sortie** (`exit 0` = succès), jamais du fait que
le script ait démarré. Terminez donc explicitement par `exit 0` ou `exit 1`. La v0.3 se
contentait de constater le démarrage, et enregistrait ainsi des succès fictifs.

### `[CKPT]`, le marqueur qui rend l'annulation sûre

Au premier clic sur « Arrêter », WinTool laisse le script en cours aller au bout. Au
second, il ne le tue que si le script est `interruptible`, **ou** si un `[CKPT]` a été
franchi. Émettez-en un dès que l'état du système redevient cohérent :

```powershell
Write-Host "[CKPT] Backup complete - safe to interrupt from here"
```

---

## Le mode analyse

> **Exploité par WinTool depuis la 1.4.** Un script qui ne déclare rien de ce qui suit
> fonctionne exactement comme avant : le mode analyse est une capacité en plus, jamais
> une obligation.

C'est le fonctionnement de CCleaner ou de Malwarebytes, en trois temps :

1. **Analyser** — WinTool demande au script ce qu'il ferait, sans rien modifier.
2. **Cocher** — l'utilisateur voit ce que le script a trouvé et choisit ce qu'il veut traiter.
3. **Agir** — WinTool relance le script en ne lui transmettant que les cases cochées.

En mode Simple, c'est l'étape 2 de l'assistant, « Voici ce que j'ai trouvé ». En mode
Expert, c'est le bouton **Analyser** de la fiche d'un script (§17 de la spécification).

**Le script ne compose pas l'écran : il le décrit.** Il n'écrit que des nombres, des noms
et des jetons. Les mots viennent de son entête, déjà traduite, et WinTool les met en page
dans la vue que le script a choisie. C'est ce qui permet au même script de s'afficher en
résumé pour un débutant et en détail pour l'Expert, en français comme en anglais.

### Déclarer : l'entête

| Champ | Valeurs | Rôle |
|---|---|---|
| `scan` | `true` / `false` | `true` = le script sait analyser. Sans lui, rien de ce qui suit n'est lu. |
| `view` | une vue, puis `expert=<vue>` si l'Expert doit en voir une autre | La présentation de l'analyse — voir « Choisir sa vue ». Absente : la liste à cocher. |
| `panels` | des panneaux, séparés par des espaces | Les panneaux de l'Expert ouverts d'office — voir « Les panneaux de l'Expert » |
| `show` | `expert` | L'action n'existe qu'en Expert — voir « Ce qui ne s'affiche que dans un mode » |

```
## scan          : true
## view          : gauge expert=table
## panels        : plan progress
```

### Le contrat, en quatre règles

**1. WinTool pose `WINTOOL_MODE=scan`.** C'est une variable d'environnement, distincte de
`WINTOOL_CONFIG`. Absente — lancement normal, ou double-clic sur le fichier —, le script
agit comme d'habitude.

**2. En mode analyse, le script ne modifie RIEN.** Ni fichier, ni registre, ni service, ni
tâche planifiée, ni réglage réseau. Il mesure, décrit, et se termine par `exit 0`. Un code
de sortie non nul signifie « l'analyse a échoué » : ce qu'elle a écrit reste visible en
Expert, mais rien n'en est retenu, et en mode Simple l'action n'est pas lancée.

**3. Chaque constat s'écrit sur une ligne**, qui vise une case que le script déclare — une
option, un choix — ou un mot de son bloc `REPORT`. Une ligne qui vise autre chose est
ignorée, et relevée en mode Expert : un script ne parle que de ses propres cases.

**4. La sélection revient par `$CONFIG`, comme n'importe quel réglage.** C'est le point qui
rend le mode analyse presque gratuit à écrire : il n'y a **pas de mode « action » à
implémenter**. Après l'analyse, WinTool lance le script normalement, avec dans `$CONFIG`
ce qui a été coché — voir « Ce qui revient au script ». Votre code d'action existe déjà :
il lit `$CONFIG`, et fait ce qu'on lui dit.

### Les lignes de l'analyse

| Marqueur | Forme | Ce que c'est |
|---|---|---|
| `[FIND]` | `[FIND] Option champs…` ou `[FIND] Option.choix champs…` | Un constat sur une case déclarée : une option `[bool]`, un choix d'un `[multi]` ou d'un `[select]` |
| `[ITEM]` | `[ITEM] Option id=… champs…` | Un élément trouvé, rangé dans une liste `[items]` |
| `[METRIC]` | `[METRIC] Libellé value=… champs…` | Une mesure sans case : espace libre, température, durée de démarrage |
| `[NOTE]` | `[NOTE] Note [Option ou Option.choix] [show=…]` | Une phrase du bloc `REPORT`, sous une case ou, sans cible, en tête |
| `[LOG]` | `[LOG] Canal texte` | Une ligne de journal, rangée dans un canal que l'Expert peut filtrer. Jamais traduite. |
| `[PROGRESS]` | `[PROGRESS] 0-100` | Un pourcentage, quand `[STEP] n/m` ne convient pas |
| `[STEP]` | `[STEP] n/m texte` | Comme pendant l'action : la progression |

Les champs s'écrivent `nom=valeur`, séparés par des espaces. Une valeur qui contient des
espaces se met entre guillemets : `name="Google Chrome"`. Une valeur illisible — du texte
là où il faut un nombre, un jeton hors liste — est **ignorée et relevée, jamais
interprétée au mieux**.

#### Les champs de `[FIND]`

| Champ | Valeur | Sens |
|---|---|---|
| `size=` | entier, en **octets** | Espace récupérable. WinTool l'affiche dans l'unité et la langue de l'utilisateur. |
| `count=` | entier | Nombre d'éléments trouvés : fichiers, entrées de démarrage… |
| `state=` | `todo` / `ok` | Un réglage : `todo` = pas encore en place, `ok` = déjà fait — la case est alors grisée |
| `checked=` | `true` / `false` | L'avis du script : cocher d'office ou non, quoi que disent les mesures |
| `ms=` | entier | Une durée en millisecondes, pour comparer les choix d'un `[select]` (vue `chart`) |
| `current=` | `true` / `false` | Sur un choix de `[select]` : le réglage en place aujourd'hui |
| `recommended=` | `true` / `false` | Sur un choix de `[select]` : celui que le script conseille, présélectionné |
| `show=` | `simple` / `expert` | Ne s'affiche que dans ce mode |

#### Les champs de `[ITEM]`

| Champ | Valeur | Sens |
|---|---|---|
| `id=` | lettres, chiffres et `- _ . : @ +`, 128 au plus | **Obligatoire.** Ce que WinTool renverra au script si l'élément est coché |
| `parent=` | l'`id` d'un autre élément de la même liste | Range l'élément sous ce parent : une arborescence |
| `name=` | texte | Lequel : « Default », « Adobe Reader » |
| `label=` | une clé du bloc `REPORT` | Ce que c'est, traduit : `label=Cache name=Default` s'affiche « Fichiers en cache — Default » |
| `path=` | texte | Où il se trouve. Affiché, **jamais renvoyé**. |
| `publisher=`, `version=`, `to=` | texte | Éditeur, version en place, version proposée |
| `date=` | `AAAA-MM-JJ` | Une date : dernière utilisation, installation |
| `kind=` | `folder` `file` `registry` `app` `startup` `service` `task` `driver` `browser` | L'icône de la ligne |
| `confidence=` | `high` / `medium` / `low` | Sûr, Probable, À vérifier — **`low` n'est jamais coché d'office** |
| `impact=` | `high` / `medium` / `low` | Impact élevé, moyen, faible |
| `risk=` | `high` / `medium` / `low` | Suspect, Inhabituel — `low` n'affiche rien |
| `locked=` | `open` `system` `protected` `inuse` | Visible mais **pas cochable**, avec la raison : programme ouvert, nécessaire à Windows… |
| `group=`, `keep=` | identifiant ; `true` / `false` | Pour `[items:keep-one]` : les exemplaires d'un même fichier, et celui à garder |
| `size=` `count=` `state=` `checked=` `show=` | comme pour `[FIND]` | |

#### Les champs de `[METRIC]`

| Champ | Valeur | Sens |
|---|---|---|
| `value=` | un nombre, ou un jeton court | **Obligatoire.** La mesure. |
| `unit=` | `celsius` `pct` `hours` `days` `s` `count` `cycles` | Son unité, écrite dans la langue de l'utilisateur |
| `health=` | `ok` / `warn` / `crit` | Bon, À surveiller, Critique |
| `max=` | nombre | Le maximum possible : de quoi dessiner une jauge |
| `group=` | une clé de groupe du bloc `REPORT` | Regroupe les mesures dans la vue `light` |
| `show=` | `simple` / `expert` | Ne s'affiche que dans ce mode |

### Le bloc `REPORT` : les mots de l'analyse

Le script n'écrit jamais de phrase dans sa sortie : elle est en anglais, et l'interface est
bilingue. Tout ce que l'analyse affiche et qui n'est pas déjà le libellé d'une option se
déclare dans un bloc `REPORT`, placé entre `OPTIONS` et `LANG` :

```
## WINTOOL:REPORT
## Junk       : [group] Junk files — Temporary files and the recycle bin
## Cache      : Cache
## FreeSpace  : Free space on drive C:
## UpdateNote : [note:warn] If an update is waiting to be installed, Windows will download it again.
## WINTOOL:END
```

| Forme | Sert à | Visé par |
|---|---|---|
| `Clé : Libellé` | Nommer une mesure, ou la nature d'un élément | `[METRIC] Clé`, `[ITEM] … label=Clé` |
| `Clé : [note:info] Phrase` ou `[note:warn]` | Une phrase neutre, ou un avertissement | `[NOTE] Clé` |
| `Clé : [group] Libellé — sous-titre` | Un **poste** du résumé Simple | `[group:Clé]` sur une option ou un choix |

Chaque clé se traduit dans le bloc `LANG`, comme une option, sans répéter son étiquette :
`## Junk : Fichiers inutiles — Fichiers temporaires et corbeille`. Une clé sans traduction
s'affiche dans la langue de base (`TRADUCTION_RAPPORT`, avertissement).

### `[items]` : une liste que seule l'analyse connaît

Un `[multi]` déclare ses choix dans l'entête. Mais les caches de navigateurs, les restes de
programmes désinstallés, les doublons n'existent qu'une fois la machine examinée. `[items]`
est une liste **vide dans l'entête**, que l'analyse remplit de lignes `[ITEM]` :

```
## Browsers   : [items] Browser caches
```

Sa valeur par défaut dans `$CONFIG` est toujours un tableau, en général `@()`. Sans
WinTool, la liste reste vide et le script ne touche à rien : c'est le comportement sûr
du double-clic.

**L'`id` est une clé, pas un chemin.** Calculez-le à partir de ce qui ne bouge pas entre
l'analyse et l'action — le navigateur et le profil, l'identifiant d'un programme. À
l'action, **retrouvez les éléments en rappelant la même fonction** que pendant l'analyse,
et ne vous servez de l'id reçu que pour choisir parmi ce que vous avez vous-même retrouvé.
Un id ne sert jamais à fabriquer un chemin.

WinTool y veille de son côté : il retient les ids de la dernière analyse de chaque script,
avec l'empreinte du fichier analysé, et **refuse de lancer** l'action si `$CONFIG` contient
un id que cette analyse n'a pas annoncé — voir « Ce qui empêche un script de se lancer ».

**Une arborescence.** `parent=` range un élément sous un autre de la même liste. Seules les
**feuilles** reviennent au script : cocher un navigateur coche ses profils, et ce sont les
ids des profils qui reviennent. Un parent jamais annoncé n'efface pas l'élément : il
s'affiche à la racine, et l'Expert voit l'anomalie.

**`[items:keep-one]`, pour les doublons.** Les éléments qui partagent un `group=` sont des
exemplaires d'un même fichier ; l'utilisateur choisit celui qu'il garde — `keep=true`
désigne celui que conseille le script, sinon c'est le premier. **Ce qui revient au script,
ce sont les ids à supprimer.**

Limites : 5 000 éléments par liste, 20 000 lignes par analyse, 400 caractères par texte.
Au-delà, la suite est ignorée, et l'Expert le voit.

### Les étiquettes : `[group:]`, `[show:]`, `[view:]`, `[scan]`

Elles se placent entre le type et le libellé d'une option ; `[group:]` et `[show:]` se
posent aussi sur un choix, avant son libellé :

```
## Targets    : [multi] Temporary files
##   user     : [group:Junk] Your temporary files
##   windows  : [group:Junk] [show:expert] Windows temporary files
## RecycleBin : [bool] [group:Junk] Empty the recycle bin
## Browsers   : [items] [view:tree] Browser caches
## MinAgeDays : [number] [scan] Only files older than — in days
```

| Étiquette | Sur | Effet |
|---|---|---|
| `[group:Clé]` | option, choix | Range la case dans un **poste** du résumé Simple : le groupe `Clé`, déclaré dans `REPORT`. Sans groupe, une option fait un poste à elle seule. |
| `[show:simple]`, `[show:expert]` | option, choix | La case ne s'affiche que dans ce mode |
| `[view:x]` | option | La présentation de cette seule option : `bars` ou `donut` pour un `[multi]`, `chart` pour un `[select]`, `tree` `table` `tiles` `treemap` pour un `[items]` |
| `[scan]` | option | Un réglage **de l'analyse elle-même** — une ancienneté minimale, un dossier à examiner. Ce n'est pas une case : WinTool le transmet tel qu'il est configuré, à l'analyse comme à l'action. |

Les étiquettes ne se traduisent pas : le bloc `LANG` ne reprend que le libellé.

### Ce que WinTool coche d'office

Dans cet ordre :

1. **`checked=`** — l'avis du script l'emporte toujours.
2. Sinon, **`state=todo`** coche, et **`state=ok`** décoche et grise la case (« Déjà en place »).
3. Sinon, une **`size` ou un `count` supérieur à zéro** coche ; zéro décoche.
4. Un élément **`locked=`** n'est jamais cochable, et un élément **`confidence=low`** jamais
   coché d'office.
5. Un `[select]` présélectionne le choix `recommended=true`, sinon `current=true`, sinon le
   premier rapporté.

Une nouvelle analyse remet toutes les cases à l'avis du script.

**Montrer sans cocher.** `checked=false` sert ce qui est gros mais peut encore servir : les
mises à jour de Windows téléchargées, par exemple. Accompagnez-le d'une `[NOTE]` qui dit
pourquoi la case n'est pas cochée.

### Ce qui ne s'affiche que dans un mode

Un seul affichage, réglé par le script — pas deux rendus à écrire :

| Où | Forme | Effet |
|---|---|---|
| Entête | `## show : expert` | L'action entière n'existe qu'en Expert. Dans un lot lancé en Simple, elle n'est **ni montrée ni lancée**, et l'écran d'analyse le dit. |
| Option, choix | `[show:expert]`, `[show:simple]` | La case n'apparaît que dans ce mode |
| Ligne | `show=expert`, `show=simple` | Ce constat, cet élément, cette mesure ou cette note n'apparaît que dans ce mode |

**Un élément caché garde sa case, et suit celle qui le contient — en revenant à l'avis du
script.** Le cache de 300 Ko d'un profil, marqué `show=expert`, n'encombre pas le résumé
d'un débutant ; si celui-ci coche « Google Chrome », ce petit cache est traité avec les
autres s'il était coché d'office, et laissé s'il ne l'était pas. Le résumé annonce ce qu'il
cache (« Un élément de plus ne s'affiche qu'en mode Expert »), jamais en silence.

### Choisir sa vue

`## view : <vue>` choisit la présentation de l'analyse, pour les deux modes ; `expert=<vue>`
en donne une autre à l'Expert : `## view : gauge expert=table`.

| Vue | Ce qu'il lui faut | Pour |
|---|---|---|
| `checklist` | rien : c'est la vue par défaut | Tout : chaque option devient une liste à cocher |
| `minimal` | une case | Une phrase et un interrupteur : « Libérer 1,2 Go — fichiers inutiles » |
| `bars` | un `[multi]` dont les choix ont une `size` | Les choix en barres proportionnelles |
| `donut` | un `[multi]` dont les choix ont une `size` | L'anneau, ses choix en légende |
| `tiles` | un `[items]` | Une tuile par élément |
| `table` | un `[items]` | Un tableau triable, avec recherche |
| `treemap` | un `[items]` avec des `size` | Des rectangles proportionnels, à explorer |
| `tree` | un `[items]` avec des `parent=` | L'arborescence |
| `timeline` | un `[items]` avec `impact=`, et une `[METRIC]` en `unit=s` | Le démarrage : ce qui se lance, et le temps gagné |
| `compare` | des `[bool]` avec `state=` | Aujourd'hui → après, réglage par réglage |
| `chart` | un `[select]` dont les choix ont un `ms=` | Des colonnes à comparer : plus bas, plus rapide |
| `light` | des `[METRIC]` avec `health=` | Un feu : tout va bien, un point à surveiller, un problème |
| `gauge` | une `[METRIC]` avec `max=` | Une jauge seule |
| `history` | rien : WinTool garde le `[FREED]` de chaque action | Ce que l'action a libéré, passage après passage |

**Une vue ne fait jamais disparaître une case.** Ce qu'elle ne montre pas suit dessous, en
liste. Et une vue qui ne trouve pas de quoi s'afficher — un `donut` sans aucune taille —
retombe sur la liste à cocher : jamais un écran vide.

En mode Simple, la vue du script ne s'applique que si le lot ne contient **qu'une** action
analysable. Dès qu'il y en a plusieurs, WinTool les rassemble dans son propre résumé : un
poste par groupe, le graphique choisi dans les réglages (l'anneau par défaut), et des
chevrons pour déplier le détail.

### Les panneaux de l'Expert

`## panels : plan progress` ouvre d'office, à côté de l'analyse, des panneaux que
l'utilisateur peut aussi ouvrir et fermer lui-même :

| Panneau | Contenu |
|---|---|
| `config` | Les réglages appliqués |
| `progress` | Le journal de l'analyse, filtrable par étapes, constats et canaux `[LOG]` |
| `plan` | Ce qui sera fait, d'après les cases cochées |
| `payload` | Ce que recevra le script : le JSON exact de `WINTOOL_CONFIG` |
| `attention` | Les points d'attention que WinTool repère dans le texte du script |
| `history` | Ce que l'action a libéré, passage après passage |
| `origin` | La provenance : catalogue, fichier, empreinte, accord |
| `disk` | L'espace disque, aujourd'hui et après l'action |

### Ce qui revient au script

Après l'analyse, WinTool lance le script **sans** `WINTOOL_MODE`, avec dans `$CONFIG` :

| Option | Ce que reçoit le script |
|---|---|
| `[bool]` visée par un `[FIND]` | `$true` si sa case est cochée, `$false` sinon |
| `[multi]` | La liste des choix cochés **parmi ceux que l'analyse a rapportés** : un choix qu'elle n'a pas montré n'est jamais traité |
| `[select]` visée par des `[FIND]` | Le choix retenu |
| `[items]` | La liste des ids cochés — les feuilles seulement |
| `[items:keep-one]` | La liste des ids **à supprimer** |
| `[scan]`, et toute option sans constat | Sa valeur configurée, inchangée |

**Rien de coché, rien de lancé.** Une action dont aucune case n'est cochée n'est pas
relancée. Une action qui n'a rapporté que des mesures non plus : elle a fait son travail en
analysant. La lancer pour rien l'inscrirait « fait » dans l'historique.

### `[FREED]` : ce qui a réellement été libéré

L'analyse et l'action sont deux exécutions distinctes. Entre les deux, des fichiers
temporaires apparaissent, d'autres sont verrouillés et ne pourront pas être supprimés. Le
chiffre de l'analyse est donc une **estimation**.

Un script qui libère de l'espace peut le dire, en fin d'action :

```powershell
Write-Output "[FREED] $freed"      # en octets
```

Le bilan affiche alors le chiffre réel, l'historique le garde, et la vue `history` le
montre. Sans `[FREED]`, le bilan affiche l'estimation de l'analyse, précédée de
« environ ».

### Exemple complet — faire de la place

C'est l'exemple de référence de la norme. Il passe le validateur en `-Strict`, et il est
identique au fichier `docs/mockups/exemple-analyse.ps1` — un test y veille. Il montre des
choix mesurés, une case simple, un choix montré sans être coché avec sa note, une
arborescence d'`[items]`, des éléments réservés à l'Expert, une note réservée au Simple,
une mesure et des lignes de journal ; puis l'action, qui ne lit que ce que WinTool lui
renvoie.

```powershell
## WINTOOL:START
## id            : 6c08ece0-709a-4210-aacb-eda594e8deee
## lang          : en
## title         : Free up disk space
## desc          : Removes temporary files, downloaded updates and browser caches
## category      : cleaning
## icon          : trash-2
## tags          : temp, cache, disk space, browsers
## version       : 1.0
## admin         : true
## risk          : low
## duration      : medium
## reversible    : false
## interruptible : true
## reboot        : false
## engine        : auto
## scan          : true
## view          : donut
## panels        : plan progress
## WINTOOL:END

## WINTOOL:OPTIONS
## Targets    : [multi] Temporary files
##   user     : [group:Junk] Your temporary files
##   windows  : [group:Junk] [show:expert] Windows temporary files
##   update   : [group:OldUpdates] Downloaded Windows updates
## RecycleBin : [bool] [group:Junk] Empty the recycle bin
## Browsers   : [items] [view:tree] Browser caches
## SafeTest   : [bool] Simulate — shows what would be done, changes nothing
## WINTOOL:END

## WINTOOL:REPORT
## Junk       : [group] Junk files — Temporary files and the recycle bin
## OldUpdates : [group] Old Windows updates — What Windows keeps after installing them
## Cache      : Cache
## FreeSpace  : Free space on drive C:
## UpdateNote : [note:warn] If an update is waiting to be installed, Windows will download it again.
## Untouched  : [note:info] Your passwords, bookmarks and history are not touched.
## WINTOOL:END

## WINTOOL:LANG fr
## title      : Faire de la place
## desc       : Supprime les fichiers temporaires, les mises à jour téléchargées et le cache des navigateurs
## Targets    : Fichiers temporaires
##   user     : Vos fichiers temporaires
##   windows  : Fichiers temporaires de Windows
##   update   : Mises à jour de Windows téléchargées
## RecycleBin : Vider la corbeille
## Browsers   : Cache des navigateurs
## SafeTest   : Simuler — montre ce qui serait fait, sans rien modifier
## Junk       : Fichiers inutiles — Fichiers temporaires et corbeille
## OldUpdates : Anciennes mises à jour de Windows — Ce que Windows garde après les avoir installées
## Cache      : Fichiers en cache
## FreeSpace  : Espace libre sur le disque C:
## UpdateNote : Si une mise à jour attend d'être installée, Windows la téléchargera de nouveau.
## Untouched  : Vos mots de passe, vos favoris et votre historique ne sont pas touchés.
## WINTOOL:END

# ==============================================================================
# L'exemple de référence de la norme d'analyse : docs/FORMAT_SCRIPT.md,
# « Le mode analyse », le reproduit à l'identique, et un test y veille.
# Il passe le validateur en -Strict (tools/lint-scripts.ps1).
#
# Le script est lancé deux fois :
#   1. ANALYSE  — WinTool pose WINTOOL_MODE=scan. Le script mesure, décrit ce
#      qu'il a trouvé, et ne modifie RIEN.
#   2. ACTION   — WinTool relance le script sans WINTOOL_MODE, avec dans
#      WINTOOL_CONFIG ce que l'utilisateur a coché. Le script ne fait que ça.
#
# Seul, en double-clic, il agit avec ses valeurs par défaut ($CONFIG ci-dessous).
# ==============================================================================

$CONFIG = @{
    Targets    = @("user", "windows")
    RecycleBin = $false
    Browsers   = @()
    SafeTest   = $false
}
# Browsers est une liste [items] : ses éléments n'existent qu'après l'analyse.
# Sans WinTool, elle reste vide et le script ne touche à aucun navigateur.

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================
# Ce que le script sait faire — utilisé par les deux passages
# ==============================================================================

$Folders = @{
    user    = $env:TEMP
    windows = Join-Path $env:SystemRoot 'Temp'
    update  = Join-Path $env:SystemRoot 'SoftwareDistribution\Download'
}

function Measure-Folder([string] $Path) {
    $m = Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
         Measure-Object -Property Length -Sum
    [pscustomobject]@{ Size = [long]$m.Sum; Count = [int]$m.Count }
}

function Get-RecycleBinItems {
    @((New-Object -ComObject Shell.Application).NameSpace(10).Items())
}

# Les caches de navigateurs. Chaque cache reçoit un Id STABLE, calculé à partir
# de ce qui ne bouge pas entre l'analyse et l'action : le navigateur et le profil.
# WinTool ne renverra que des Id ; c'est cette même fonction, rappelée à l'action,
# qui retrouvera les chemins. Un Id reçu ne sert jamais à fabriquer un chemin.
$Browsers = @(
    @{ Id = 'chrome';  Name = 'Google Chrome';   Process = 'chrome';  Cache = 'Cache';  Root = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data' }
    @{ Id = 'edge';    Name = 'Microsoft Edge';  Process = 'msedge';  Cache = 'Cache';  Root = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data' }
    @{ Id = 'brave';   Name = 'Brave';           Process = 'brave';   Cache = 'Cache';  Root = Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\User Data' }
    @{ Id = 'firefox'; Name = 'Mozilla Firefox'; Process = 'firefox'; Cache = 'cache2'; Root = Join-Path $env:LOCALAPPDATA 'Mozilla\Firefox\Profiles' }
)

function Get-BrowserCaches {
    foreach ($b in $Browsers) {
        if (-not (Test-Path -LiteralPath $b.Root)) { continue }
        $open = [bool](Get-Process -Name $b.Process -ErrorAction SilentlyContinue)
        foreach ($dir in Get-ChildItem -LiteralPath $b.Root -Directory -ErrorAction SilentlyContinue) {
            $path = Join-Path $dir.FullName $b.Cache
            if (-not (Test-Path -LiteralPath $path)) { continue }
            # Firefox préfixe ses profils d'un code (« me5fmut4.default-release ») :
            # on n'affiche que la fin. Un vrai script lirait le nom choisi par
            # l'utilisateur (Local State pour Chrome et Edge, profiles.ini pour Firefox).
            $shown = if ($b.Id -eq 'firefox') { ($dir.Name -split '\.', 2)[-1] } else { $dir.Name }
            [pscustomobject]@{
                Id      = "$($b.Id)-$($dir.Name -replace '[^\w.-]', '-')"
                Browser = $b
                Profile = $shown
                Path    = $path
                Open    = $open
            }
        }
    }
}

# ==============================================================================
# 1. ANALYSE — on mesure, on décrit, on ne modifie RIEN
# ==============================================================================
# Tout ce bloc est en lecture seule. WinTool ne peut pas le vérifier : c'est une
# promesse de l'auteur, et l'utilisateur coche sur la foi de ce qu'elle rapporte.
# Le script n'écrit jamais de phrase : des nombres, des noms, des jetons. Les
# mots viennent de l'entête (REPORT, LANG), déjà traduite.

if ($env:WINTOOL_MODE -eq 'scan') {

    # --- Des choix mesurés : une ligne [FIND] par choix de Targets ---
    Write-Output "[STEP] 1/3 Measuring temporary folders"
    foreach ($t in 'user', 'windows') {
        $m = Measure-Folder $Folders[$t]
        Write-Output "[FIND] Targets.$t size=$($m.Size) count=$($m.Count)"
    }

    # --- Une case simple, mesurée ---
    $bin = Get-RecycleBinItems
    $binSize = [long]($bin | Measure-Object -Property Size -Sum).Sum
    Write-Output "[FIND] RecycleBin size=$binSize count=$($bin.Count)"

    # --- Gros, mais peut encore servir : montré, PAS coché, avec sa note ---
    Write-Output "[STEP] 2/3 Measuring downloaded Windows updates"
    $m = Measure-Folder $Folders.update
    Write-Output "[FIND] Targets.update size=$($m.Size) count=$($m.Count) checked=false"
    Write-Output "[NOTE] UpdateNote Targets.update"

    # --- Une arborescence : un parent par navigateur, un enfant par profil ---
    Write-Output "[STEP] 3/3 Looking for browser caches"
    $seen = @{}
    foreach ($c in Get-BrowserCaches) {
        # Navigateur ouvert : visible, mais pas cochable, avec la raison.
        $lock = if ($c.Open) { ' locked=open' } else { '' }
        if (-not $seen[$c.Browser.Id]) {
            $seen[$c.Browser.Id] = $true
            Write-Output "[ITEM] Browsers id=$($c.Browser.Id) name=""$($c.Browser.Name)"" kind=browser$lock"
        }
        $m = Measure-Folder $c.Path
        # Un cache minuscule encombre le résumé d'un débutant : Expert seulement.
        # Il garde sa case, et suit celle de son navigateur.
        $show = if ($m.Size -lt 1MB) { ' show=expert' } else { '' }
        # label= dit ce que c'est (traduit), name= lequel : « Fichiers en cache — Default ».
        Write-Output "[ITEM] Browsers id=$($c.Id) parent=$($c.Browser.Id) kind=folder label=Cache name=""$($c.Profile)"" path=""$($c.Path)"" size=$($m.Size)$lock$show"
        # Une ligne de journal, rangée dans le canal « Browsers » (Expert seulement).
        Write-Output "[LOG] Browsers $($c.Browser.Name) / $($c.Profile): $($m.Count) files"
    }
    # Une note pour le débutant, inutile à l'Expert qui voit la liste exacte.
    Write-Output "[NOTE] Untouched Browsers show=simple"

    # --- Une mesure sans case : l'espace libre, pour situer le reste ---
    $drive = Get-PSDrive -Name C
    $pct = [math]::Round(100 * $drive.Free / ($drive.Used + $drive.Free))
    $health = if ($pct -lt 10) { 'crit' } elseif ($pct -lt 20) { 'warn' } else { 'ok' }
    Write-Output "[METRIC] FreeSpace value=$pct unit=pct health=$health max=100"

    exit 0
}

# ==============================================================================
# 2. ACTION — uniquement ce que l'utilisateur a coché
# ==============================================================================
# WinTool a posé dans WINTOOL_CONFIG, et l'override a versé dans $CONFIG :
#   Targets    = les choix cochés, par exemple @("user", "update")
#   RecycleBin = $true ou $false
#   Browsers   = les Id cochés, par exemple @("chrome-Default", "firefox-abcd.default")
# Une valeur reçue ne sert que de CLÉ dans les tables du script, et seulement si
# elle y figure : $Folders['inconnu'] vaut $null, et "$null\*" viserait la racine.

$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')
$targets  = @($CONFIG.Targets | Where-Object { $Folders.ContainsKey("$_") })
$doBin    = ("$($CONFIG.RecycleBin)" -eq 'True')
$wanted   = @($CONFIG.Browsers | ForEach-Object { "$_" })
$caches   = @(Get-BrowserCaches | Where-Object { $wanted -contains $_.Id })
$total    = $targets.Count + [int]$doBin + [int]($caches.Count -gt 0)
$step     = 0
$freed    = [long]0

function Remove-FolderContent([string] $Path) {
    $n = [long]0
    foreach ($f in Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue) {
        if ($SafeTest) { $n += $f.Length; continue }
        try {
            Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
            $n += $f.Length
        } catch {
            # Fichier ouvert par un programme : on le laisse, c'est normal.
        }
    }
    $n
}

foreach ($t in $targets) {
    $step++
    Write-Output "[STEP] $step/$total Cleaning $t"
    $stopped = $false
    if ($t -eq 'update' -and -not $SafeTest) {
        # Windows Update garde ses fichiers ouverts : on l'arrête le temps du ménage.
        Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue
        $stopped = $true
    }
    $freed += Remove-FolderContent $Folders[$t]
    if ($stopped) { Start-Service -Name wuauserv -ErrorAction SilentlyContinue }
}

if ($doBin) {
    $step++
    Write-Output "[STEP] $step/$total Emptying the recycle bin"
    $freed += [long](Get-RecycleBinItems | Measure-Object -Property Size -Sum).Sum
    if (-not $SafeTest) { Clear-RecycleBin -Force -ErrorAction SilentlyContinue }
}

if ($caches.Count) {
    $step++
    Write-Output "[STEP] $step/$total Clearing browser caches"
    foreach ($c in $caches) {
        # Le navigateur a pu être ouvert depuis l'analyse : on revérifie.
        if (Get-Process -Name $c.Browser.Process -ErrorAction SilentlyContinue) {
            Write-Output "[WARN] $($c.Browser.Name) is open - cache left in place"
            continue
        }
        $freed += Remove-FolderContent $c.Path
        Write-Output "[LOG] Browsers Cleared $($c.Browser.Name) / $($c.Profile)"
    }
}

# Ce qui a vraiment été libéré : le bilan l'affiche, l'historique le garde.
Write-Output "[FREED] $freed"
Write-Output "[DONE] Disk space freed"
exit 0
```

Remarquez que les clés `Targets.$t` sont calculées. Le validateur ne peut vérifier que les
clés écrites en toutes lettres ; une clé calculée lui échappe, par construction. À vous de
garantir qu'elle ne produit que des choix déclarés — WinTool, lui, ignorera les autres.

### Exemple court — un réglage

Pour l'optimisation ou la vie privée, on ne mesure pas une taille : on constate un **état**.

```powershell
if ($env:WINTOOL_MODE -eq 'scan') {
    $key   = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection'
    $value = (Get-ItemProperty -Path $key -Name AllowTelemetry -ErrorAction SilentlyContinue).AllowTelemetry
    $state = if ($value -eq 0) { 'ok' } else { 'todo' }
    Write-Output "[FIND] DisableTelemetry state=$state"
    exit 0
}
```

`DisableTelemetry` est ici une option `[bool]`. Si la télémétrie est déjà coupée, la case
arrive grisée avec la mention « Déjà en place » ; sinon elle arrive cochée. Avec
`## view : compare`, plusieurs réglages de ce genre s'affichent en « aujourd'hui → après ».

### Ce qu'il faut respecter

- **Une option ciblée signifie « fais-le » quand elle vaut `$true`.** La case cochée
  transmet `$true`. Une option comme `KeepCookies`, dont `$true` veut dire « ne touche à
  rien », ne peut pas porter un constat : la case cochée dirait l'inverse de ce qu'elle
  montre. Nommez vos options par l'action.
- **L'analyse se place après la ligne d'override et avant tout code qui modifie.** Après,
  pour disposer de `$CONFIG` — et de vos options `[scan]`. Avant, parce qu'une
  modification qui s'exécuterait avant le test de `WINTOOL_MODE` aurait lieu pendant
  l'analyse.
- **L'analyse rapporte tout ce qu'elle pourrait faire**, pas seulement ce que la
  configuration actuelle sélectionne. C'est l'utilisateur qui choisit, après.
- **À l'action, ne faites confiance qu'à ce que vous retrouvez.** Une valeur reçue ne sert
  que de clé dans les tables du script, et seulement si elle y figure : `$Folders['x']`
  vaut `$null` pour une clé inconnue, et `"$null\*"` viserait la racine du disque.
- **Analyser, c'est exécuter.** WinTool lance le script en administrateur pour l'analyser,
  exactement comme pour agir. Un script non approuvé ne sera pas plus analysé qu'exécuté
  (§12.1 de la spécification).
- **L'analyse doit être rapide.** Elle précède chaque action et l'utilisateur l'attend
  devant l'écran. Mesurez des tailles, ne calculez pas d'empreintes — sauf si c'est le
  métier du script, comme pour les doublons.

---

## Encodage : UTF-8 **avec BOM**

C'est le piège n°1, et il est silencieux.

PowerShell 5.1 — celui livré nativement avec Windows, donc celui qui exécutera la plupart
des scripts — lit un `.ps1` **sans BOM** comme de l'ANSI, pas de l'UTF-8. Le moindre accent
est alors mal décodé : au mieux l'affichage est du charabia, au pire le script ne s'analyse
plus du tout.

Ce validateur lui-même a cassé à sa première exécution pour cette raison exacte.

```powershell
# Convertir un fichier existant
$c = (Resolve-Path .\mon_script.ps1).Path
$t = [System.IO.File]::ReadAllText($c, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($c, $t, [System.Text.UTF8Encoding]::new($true))
```

Dans VS Code : *Sélectionner l'encodage → Enregistrer avec l'encodage → UTF-8 with BOM*.

---

## Valider

```powershell
.\tools\lint-scripts.ps1                                               # vos scripts
.\tools\lint-scripts.ps1 -Path ..\WinTool-Catalogue\scripts -Strict   # catalogue officiel
```

`-Strict` traite les avertissements comme des erreurs. Les scripts du catalogue officiel
doivent passer en `-Strict`.

### Les contrôles, un par un

Cette table est le contrat entre la documentation et le code. **Ajouter un contrôle au
validateur sans l'ajouter ici est un défaut.**

| Code | Gravité | Déclencheur |
|---|---|---|
| `BOM_ABSENT` | erreur | Fichier non-ASCII sans BOM UTF-8 |
| `ENTETE_ABSENT` | erreur | Pas de bloc `WINTOOL:START` |
| `ENTETE_NON_FERME` | erreur | `WINTOOL:START` sans `WINTOOL:END` |
| `CHAMP_MANQUANT` | erreur | Champ d'entête obligatoire absent |
| `CHAMP_DOUBLON` | avertissement | Champ déclaré deux fois |
| `VALEUR_INVALIDE` | erreur | `risk`, `duration`, `engine`, `show` ou un booléen hors valeurs admises ; `[show:]` hors `simple`/`expert` |
| `ID_INVALIDE` | erreur | `id` n'est pas un GUID |
| `ID_COLLISION` | erreur | Deux scripts portent le même `id` |
| `CATEGORIE_INCONNUE` | avertissement | Catégorie hors `tools/categories.json` → « Autres », et aucun lot |
| `ICONE_EMOJI` | erreur | `icon` contient un emoji |
| `ICONE_INCONNUE` | erreur | Nom d'icône absent de Lucide — suggestion si proche |
| `OPTIONS_ABSENT` | erreur | Pas de bloc `WINTOOL:OPTIONS` |
| `OPTIONS_NON_FERME` | erreur | Bloc `OPTIONS` non refermé |
| `TYPE_ABSENT` | erreur | Option déclarée sans `[type]` |
| `TYPE_INVALIDE` | erreur | Type inconnu, ou variante autre que `[items:keep-one]` |
| `LIBELLE_VIDE` | erreur | Option, choix ou entrée de `REPORT` sans texte |
| `CHOIX_MANQUANT` | erreur | `select` ou `multi` avec moins de deux choix |
| `CHOIX_INATTENDU` | erreur | Choix déclarés sur un type qui n'en accepte pas |
| `CONFIG_ABSENT` | erreur | Pas de bloc `$CONFIG = @{ }` |
| `CONFIG_NON_FERME` | erreur | Bloc `$CONFIG` non refermé |
| `CONFIG_LIGNE_ILLISIBLE` | avertissement | Ligne non reconnue comme « Clé = valeur » |
| `OPTION_NON_DECLAREE` | erreur | Clé dans `$CONFIG` absente du bloc `OPTIONS` |
| `OPTION_ORPHELINE` | erreur | Option déclarée sans valeur par défaut dans `$CONFIG` |
| `TYPE_INCOHERENT` | avertissement | `[bool]` sur une valeur non booléenne, `[number]` sur du texte |
| `DEFAUT_INVALIDE` | erreur | Défaut hors des choix, `select` en tableau, `multi` ou `items` qui n'en est pas un |
| `TRADUCTION_ABSENTE` | erreur | Aucun bloc `WINTOOL:LANG` vers une langue autre que `lang` |
| `TRADUCTION_NON_FERMEE` | erreur | Bloc de traduction non refermé |
| `TRADUCTION_INCOMPLETE` | erreur | `title` ou `desc` non traduit |
| `TRADUCTION_OPTION` | avertissement | Une option sans libellé traduit |
| `TRADUCTION_CHOIX` | avertissement | Un choix sans libellé traduit |
| `TRADUCTION_ORPHELINE` | erreur | Traduction d'une option, d'un choix ou d'une entrée de `REPORT` qui n'existe pas |
| `TRADUCTION_RAPPORT` | avertissement | Une entrée de `REPORT` sans texte traduit |
| `OVERRIDE_ABSENT` | erreur | Ligne d'override manquante |
| `OVERRIDE_OBSOLETE` | erreur | Ancienne ligne d'override lisant un fichier — `WINTOOL_CONFIG` contient le JSON |
| `OVERRIDE_FICHIER` | erreur | Repli vers un fichier de configuration — **WinTool refuse de lancer le script** |
| `MARQUEUR_INCONNU` | erreur | Balise proche d'un marqueur connu — `[REBBOT]` → `[REBOOT]` |
| `MARQUEUR_CASSE` | avertissement | Marqueur pas en majuscules |
| `SORTIE_NON_ANGLAISE` | avertissement | Message affiché contenant des accents |
| `SCAN_NON_GERE` | erreur | `scan : true` mais `$env:WINTOOL_MODE` n'est jamais lu : le script agirait au lieu d'analyser |
| `SCAN_SANS_FIND` | erreur | `scan : true` mais aucun `[FIND]`, `[ITEM]` ni `[METRIC]` n'est émis |
| `FIND_SANS_SCAN` | avertissement | Le script sait analyser mais ne déclare pas `scan : true` : il ne sera jamais interrogé |
| `FIND_CLE_INCONNUE` | erreur | `[FIND]` vise une option absente, d'un type autre que `[bool]`/`[multi]`/`[select]`, ou un choix non déclaré |
| `FIND_MESURE` | erreur | `[FIND]` sans mesure (`size`, `count`, `state` ou `ms`), avec un champ inconnu ou une valeur hors liste |
| `ITEM_CLE_INCONNUE` | erreur | `[ITEM]` vise une option absente, ou qui n'est pas un `[items]` |
| `ITEM_SANS_ID` | erreur | `[ITEM]` sans `id=` |
| `ITEM_CHAMP` | erreur | `[ITEM]` avec un champ inconnu, ou une valeur hors liste |
| `LIBELLE_INCONNU` | erreur | `[ITEM] … label=` vise une clé absente du bloc `REPORT` |
| `METRIC_CLE_INCONNUE` | erreur | `[METRIC]` vise une clé qui n'est pas un libellé du bloc `REPORT` |
| `METRIC_CHAMP` | erreur | `[METRIC]` sans `value=`, avec un champ inconnu ou une valeur hors liste |
| `NOTE_INCONNUE` | erreur | `[NOTE]` vise une note absente de `REPORT` ou une cible non déclarée, ou porte un champ autre que `show=` |
| `LOG_CANAL` | erreur | `[LOG]` sans canal : un mot, puis le texte |
| `PROGRESS_VALEUR` | erreur | `[PROGRESS]` hors d'un entier de 0 à 100 |
| `RAPPORT_NON_FERME` | erreur | Bloc `WINTOOL:REPORT` non refermé |
| `NOTE_NIVEAU` | erreur | `[note:…]` hors `info` / `warn` |
| `ETIQUETTE_INCONNUE` | erreur | Étiquette inconnue sur une option, un choix ou une entrée de `REPORT` |
| `GROUPE_INCONNU` | erreur | `[group:Clé]` vise un groupe que `REPORT` ne déclare pas |
| `GROUPE_ORPHELIN` | avertissement | Groupe déclaré dans `REPORT` où aucune option ni aucun choix ne se range |
| `VUE_INCONNUE` | erreur | `view` ou `[view:]` hors des vues admises, ou `view` d'une autre forme que `<vue> expert=<vue>` |
| `PANNEAU_INCONNU` | erreur | `panels` cite un panneau inconnu |

Les contrôles des lignes d'analyse ne voient que ce qui est écrit **en toutes lettres** :
une clé ou une valeur calculée (`Targets.$t`, `size=$($m.Size)`) leur échappe, par
construction. WinTool, lui, lit la vraie sortie, et ignore ce qui ne correspond pas.

Le contrôle des marqueurs ne regarde que les balises **en tête de chaîne affichée**.
Sans cette restriction, les transtypages PowerShell deviennent des faux positifs :
`[long]` ressemble à `[DONE]` à deux caractères près, et `[int]` à `[INFO]`.

---

## Votre modèle : le squelette de ce document

Le dépôt [WinTool-Catalogue](https://github.com/burnout293/WinTool-Catalogue) contient le catalogue officiel, et chacun de ses scripts passe le
validateur en `-Strict`. Ils sont de bons exemples de ce qu'on peut faire — mais ils
évoluent, et aucun n'est garanti représentatif de toutes les règles.

**Le squelette donné plus haut reste le modèle de référence**, et pour un script
analysable, l'exemple complet de « Le mode analyse » — aussi disponible tel quel dans
`docs/mockups/exemple-analyse.ps1`. Il est vérifié : on l'extrait de
ce fichier et on le passe au validateur en `-Strict` à chaque relecture de la documentation.

---

## Pièges silencieux — ce que le validateur ne vous dira pas

Ces règles sont appliquées par le code mais **ne produisent aucun constat**. Un script qui
les enfreint passe `-Strict` sans un mot, puis se comporte mal.

### En analyse, un refus d'accès se lit comme un zéro

`-ErrorAction SilentlyContinue` transforme un dossier interdit en dossier vide. Lancée sans
droits d'administrateur, l'analyse de l'exemple rapporte `size=0` pour
`C:\Windows\Temp` — non parce qu'il est vide, mais parce qu'elle n'a pas pu y entrer.

Dans WinTool, un script `admin : true` est analysé en administrateur et voit juste. Le piège
guette **l'auteur qui teste à la main** : lancez vos analyses dans une console
administrateur, sinon vous validerez des zéros qui n'en sont pas.

### Le type s'écrit en minuscules

`[Bool]` ou `[Select]` **passent le validateur** — la comparaison PowerShell y est
insensible à la casse. Mais l'interface compare en respectant la casse : elle ne reconnaît
pas le type et affiche un champ de texte libre à la place de l'interrupteur ou de la liste.

Écrivez toujours `[bool]`, `[number]`, `[string]`, `[select]`, `[multi]`, `[hidden]`.

### Le code de langue fait exactement deux lettres

`## WINTOOL:LANG fr` — pas `fr-FR`, pas `french`. Le validateur n'accepte que deux lettres
et signalerait `TRADUCTION_ABSENTE` sans expliquer pourquoi.

### L'accolade fermante de `$CONFIG` est seule sur sa ligne

```powershell
$CONFIG = @{        # l'ouverture aussi tient sur une seule ligne
    MaCle = $true
}                   # rien d'autre sur cette ligne, pas même un commentaire
```

Un `}  # fin de config` empêche le parseur de trouver la fin du bloc.

### Le bloc d'override ne peut pas être en commentaire

Il doit contenir littéralement `$env:WINTOOL_CONFIG`, sur une ligne non commentée. Un
exemple mis en commentaire dans un en-tête `<# … #>` ne compte pas, et vous récoltez
`OVERRIDE_ABSENT`.

### Une clé d'option ne contient pas d'espace

Et elle doit être **identique aux trois endroits** : `WINTOOL:OPTIONS`, `WINTOOL:LANG` et
`$CONFIG`. Le validateur croise les trois dans les deux sens.

### `category` ne peut pas viser un lot

`category` désigne une **catégorie** (`tools/categories.json`), jamais un lot. « Entretien
complet », en particulier, est un lot agrégat : il rassemble automatiquement ce qui est
rangé ailleurs, et aucun script ne peut le désigner. Écrire `category : maintenance` range
le script dans « Autres ».

### Une valeur d'`engine` inconnue se comporte comme `auto`

`engine : powershell` ou `engine : ps7` ne produisent aucune erreur : WinTool prend
simplement l'interpréteur le plus récent disponible. Les trois seules valeurs qui ont un
sens sont `auto`, `winps` et `pwsh`.

### La configuration injectée est plafonnée

Au-delà de **30 000 caractères** de JSON, WinTool refuse le lancement (limite Windows sur
une variable d'environnement). Un `[multi]` à très nombreux choix ou une `[string]` très
longue peuvent y conduire.

---

## Sécurité : ce que votre script reçoit n'est pas fiable

Un script officiel s'exécute en administrateur, souvent sans que personne relise son code
(§16.4 de la spécification). Or une partie de ce qu'il lit vient de fichiers et de
variables que **n'importe quel programme tournant sous le compte de l'utilisateur peut
modifier**, sans élévation. Tout ce qu'un tel programme peut écrire, il peut le faire viser
par votre script.

| Ce que vous lisez | D'où ça vient | Ce que WinTool garantit | Ce qui vous reste |
|---|---|---|---|
| `$CONFIG` | `settings.json`, inscriptible par l'utilisateur | Type et choix conformes à votre bloc `OPTIONS` ; aucun chemin d'un texte libre ne vise un emplacement protégé | Bornes des nombres, sens des textes |
| `$env:SystemRoot`, `$env:ProgramData`, `$env:SystemDrive`, `$env:ProgramFiles` | Rétablies par WinTool depuis la base de registre `HKLM` | Justes sous WinTool | **Rien hors de WinTool** : en double-clic, elles viennent du profil |
| `$env:TEMP`, `$env:TMP`, `$env:LOCALAPPDATA`, `$env:APPDATA`, `$env:USERPROFILE` | Le profil de l'utilisateur | Ramenées dans son profil si elles visent le système | À vérifier avant toute suppression |
| Le dossier courant | System32 sous WinTool | — | **Ne vous en servez jamais** : `$PSScriptRoot` pour vos fichiers |

Les règles qui en découlent :

1. **Avant de supprimer ou d'écraser, vérifiez où vous êtes.** Un chemin issu de `$CONFIG`
   ou d'une variable de l'utilisateur ne doit jamais désigner Windows, les Program Files,
   ProgramData, la racine d'un lecteur ou un autre profil. WinTool le refuse déjà pour les
   textes libres, mais votre script peut être lancé seul — et un double-clic n'a pas de
   garde.
2. **Bornez vos nombres.** WinTool garantit qu'un `[number]` est un nombre, pas qu'il est
   raisonnable : une ancienneté de `-1` heure, un délai de `100000` jours se refusent dans
   le script.
3. **N'exécutez jamais une valeur.** Pas d'`Invoke-Expression`, pas de
   `[scriptblock]::Create`, pas de commande bâtie par concaténation avec une valeur de
   `$CONFIG`. Passez les valeurs en paramètres (`-LiteralPath $chemin`).
4. **Appelez les outils du système par leur chemin complet**
   (`"$env:SystemRoot\System32\ipconfig.exe"`), jamais par leur seul nom.
5. **Pas de secret dans une option.** Une option `[string]` est enregistrée en clair dans
   `settings.json`. WinTool masque dans le journal les valeurs des clés dont le nom contient
   `Password`, `Secret` ou `Token` — nommez-les ainsi si vous ne pouvez pas faire autrement.

Exemple, pour une liste de dossiers à vider reçue en texte libre :

```powershell
$interdits = @($env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData) |
    Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }

foreach ($dossier in ("$($CONFIG.CustomPaths)" -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    $plein = [IO.Path]::GetFullPath($dossier).TrimEnd('\')
    $racine = [IO.Path]::GetPathRoot($plein).TrimEnd('\')
    $refuse = ($plein -eq $racine) -or ($interdits | Where-Object { $plein -eq $_ -or $plein.StartsWith("$_\", 'OrdinalIgnoreCase') })
    if ($refuse) {
        Write-Host "[WARN] Protected location skipped: $dossier"
        continue
    }
    # ... nettoyage de $plein
}
```

---

## Ce qui empêche un script de se lancer

WinTool applique partout le principe « **constater, jamais bloquer** » : un script
non conforme s'exécute quand même, ses anomalies sont simplement affichées. Il
existe exactement **cinq exceptions**, et aucune ne porte sur la forme du fichier :
toutes protègent ce qui s'exécute avec les droits administrateur, ou ce que
l'interface promet à l'utilisateur.

Si vous écrivez des scripts pour WinTool, ce sont les seules choses qui peuvent
faire refuser le lancement :

### 1. Le script n'est pas approuvé

Tout script qui ne vient pas du catalogue officiel — ou qui en vient mais a été modifié
depuis — doit être approuvé une fois, par son empreinte exacte. Toute modification du
fichier invalide l'approbation. Voir §12.1 et §16.4 de la spécification.

### 2. La ligne d'override lit un fichier

**C'est le refus qui surprend le plus, donc lisez-le en entier.**

`WINTOOL_CONFIG` **contient le JSON** de vos réglages. Elle ne contient pas, et
n'a jamais à contenir, le chemin d'un fichier. La bonne forme est :

```powershell
# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}
```

WinTool **refuse de lancer** un script dont le bloc d'override passe
`WINTOOL_CONFIG` — ou une variable qui la porte — à `Get-Content` :

```powershell
# REFUSÉ : mécanisme retiré pour raison de sécurité
$wtJson = $env:WINTOOL_CONFIG
if (-not $wtJson.TrimStart().StartsWith('{')) { $wtJson = Get-Content -LiteralPath $wtJson -Raw }
```

**Pourquoi.** Ce repli vient d'une version antérieure où la variable donnait le
chemin d'un fichier JSON. Ce fichier vivait dans un dossier inscriptible sans
élévation : un autre programme pouvait le remplacer entre le moment où WinTool
l'écrivait et celui où PowerShell le lisait, et faire entrer ses propres valeurs
dans votre `$CONFIG` — **avec les droits administrateur**. Le fichier a disparu,
mais tant que le repli existe dans un script, la porte peut être rouverte.

**Ce contrôle ne regarde que votre bloc d'override.** Un script qui lit des
fichiers pour son propre compte n'est pas concerné, même s'il utilise
`Get-Content` partout ailleurs :

```powershell
# Parfaitement accepté : rien à voir avec la configuration injectée
$hosts = Get-Content -LiteralPath "$env:SystemRoot\System32\drivers\etc\hosts" -Raw
```

Le validateur signale le même problème sous le code `OVERRIDE_FICHIER`, avec le
numéro de ligne, avant même que vous n'essayiez de lancer le script.

### 3. Un réglage refusé par la garde

Juste avant le lancement, WinTool contrôle chaque valeur de `$CONFIG` contre votre bloc
`OPTIONS` (section « Sécurité » ci-dessus). Le script **n'est pas lancé** si une valeur n'a
pas le type déclaré, si un choix ne fait pas partie de la liste, ou si un texte libre
désigne un emplacement protégé. L'utilisateur voit quel réglage est en cause, et pourquoi.

Conséquence pour vous : **déclarez précisément.** Une option qui reçoit un chemin doit être
un `[string]`, une liste fermée un `[select]` ou un `[multi]`. Les clés de `$CONFIG` absentes
de `OPTIONS` ne sont pas transmises.

### 4. La simulation, pour un script qui ne sait pas se simuler

Un script qui déclare l'option `SafeTest` sait **se simuler** : il montre ce qu'il ferait,
sans rien modifier. L'utilisateur règle la simulation script par script, et une pastille
« Simulation » permet de tout simuler d'un coup (§6.9 de la spécification).

Quand la simulation est **activée** — tous les scripts simulables simulés —, un script
qui ne déclare pas `SafeTest` est **refusé**, pas exécuté. C'est volontaire : injecter une
clé qu'un script n'utilise pas ajouterait une entrée inerte à sa table, et il modifierait
la machine pendant que l'interface annonce une simulation. Un refus visible vaut mieux
qu'une garantie fausse.

**Le libellé de l'option ne vous appartient pas.** WinTool affiche partout « Simuler »,
quel que soit celui que vous écrivez : le terme doit être le même pour tous les scripts.
Le bloc `OPTIONS` exige néanmoins un libellé, et la traduction, une ligne ; écrivez donc
celui-ci, pour que votre script se lise comme l'interface le montrera.

Pour qu'un script sache se simuler, déclarez l'option et honorez-la :

```powershell
## SafeTest      : [bool]   Simulate — shows what would be done, changes nothing
```

```powershell
$SafeTest = ("$($CONFIG.SafeTest)" -eq 'True')

if ($SafeTest) {
    Write-Host "[INFO] SafeTest - would delete $($files.Count) file(s)"
} else {
    Remove-Item @files -Force
}
```

**Deux pièges à éviter**, observés dans des scripts existants :

- **Ne simulez pas à moitié.** Une commande qui contacte le réseau, accepte un
  contrat de licence ou modifie un réglage global doit être derrière le garde,
  elle aussi — pas seulement la suppression finale.
- **N'inventez jamais un résultat.** Écrire `[OK] simulated: no corruption found`
  sans avoir rien vérifié fait mentir le journal. Dites ce que vous *auriez* fait,
  jamais ce que vous *auriez trouvé*.

### 5. Une sélection qui ne vient pas de la dernière analyse

Pour un script analysable, ce qui revient dans une liste `[items]` est une liste d'ids
(voir « Le mode analyse »). WinTool retient les ids que la **dernière analyse** de chaque
script a annoncés, avec l'empreinte exacte du fichier analysé, et **refuse de lancer**
l'action si `$CONFIG` contient un id que cette analyse n'a pas annoncé — ou si le fichier a
changé depuis. L'utilisateur voit « Relancez l'analyse ».

Ce souvenir ne vit qu'en mémoire : une analyse ne vaut que pour la session qui l'a vue.
Conséquence pour vous : **un id doit être stable** entre l'analyse et l'action, et il ne doit
désigner que ce que l'analyse a montré. C'est ce qui empêche une configuration modifiée à la
main de faire traiter au script un élément que personne n'a vu.
