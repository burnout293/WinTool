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
ancienne ligne d'override, script non simulable en mode test, interpréteur absent, fichier
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

**Cette norme ne s'applique qu'aux scripts officiels**, ceux livrés dans `Default\`.
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

Tous les scripts officiels vivent à plat dans `Default\`, sans sous-dossiers.

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
## SafeTest     : [bool]   Safe test — simulates every change, modifies nothing
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
## SafeTest     : Test sans risque — simule chaque modification, ne change rien
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

Tous ces champs sont **obligatoires**. `tags` est le seul facultatif.

| Champ | Valeurs | Rôle |
|---|---|---|
| `id` | GUID (`New-Guid`) | **Identifie le script pour toujours.** Un chemin change au moindre renommage ; l'`id` survit, et avec lui la configuration, le classement et l'historique. |
| `lang` | `en`, `fr`… | Langue dans laquelle cet entête est rédigé |
| `title` | texte court | Nom affiché |
| `desc` | une phrase | Description affichée |
| `category` | voir ci-dessous | **Suggestion de rangement, pas un ordre** |
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

### Les tokens acceptés par `category`

Chaque catégorie d'usine a **un id anglais et un id français**, tous deux acceptés — écrivez
celui qui correspond à la langue de votre `lang`, sans avoir à traduire. La liste vit dans
**`tools/categories.json`** (`id` = token anglais, `id_fr` = token français) — c'est la seule
source, lue à la fois par `tools/lint-scripts.ps1` (`CATEGORIE_INCONNUE` si vous en sortez) et
par l'application (`src-tauri/src/settings.rs`) pour éviter que la liste ne diverge d'un côté
comme c'est arrivé avec `CREER_UN_SCRIPT.txt`. Au 23/09/2026 : `cleaning`/`nettoyage`,
`performance`/`performance`, `privacy`/`vieprivee`, `apps`/`applications`, `health`/`sante`,
`tools`/`outillage`.

Une catégorie **créée par l'utilisateur** en mode Expert n'a ni id anglais ni traduction :
un seul id, dans la langue tapée à la création (SPECIFICATION.md §10). Un script ne peut
donc viser par `category` qu'une catégorie d'usine, jamais une catégorie personnelle d'une
installation particulière.

### Ce que « suggestion » veut dire pour `category`

À la découverte du fichier, si la catégorie existe, le script y est rangé ; sinon il part
en **« Non classé »**. Tant que personne ne l'a déplacé à la main, une ré-analyse le
replacera en suivant `category`. **Dès que l'utilisateur le range lui-même, c'est terminé** :
son classement devient figé. Le script propose, l'humain dispose.

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
[INFO]   message           ligne neutre
[OK]     message           succès d'une étape
[WARN]   message           avertissement, n'échoue pas
[ERR]    message erreur affichée et comptée — **ne suffit PAS à faire échouer le script**
[STEP]   3/7 message       alimente la barre de progression
[CKPT]   message           « interruption sans risque à partir d'ici »
[REBOOT] message           un redémarrage est réellement nécessaire
[DONE]   message           fin nominale
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
.\tools\lint-scripts.ps1                                   # tout le dossier scripts/
.\tools\lint-scripts.ps1 -Path .\scripts\Default -Strict   # exigence CI
```

`-Strict` traite les avertissements comme des erreurs. Les scripts destinés à `Default\`
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
| `VALEUR_INVALIDE` | erreur | `risk`, `duration`, `engine` ou un booléen hors valeurs admises |
| `ID_INVALIDE` | erreur | `id` n'est pas un GUID |
| `ID_COLLISION` | erreur | Deux scripts portent le même `id` |
| `CATEGORIE_INCONNUE` | avertissement | Catégorie hors catégories d'usine → « Non classé » |
| `ICONE_EMOJI` | erreur | `icon` contient un emoji |
| `ICONE_INCONNUE` | erreur | Nom d'icône absent de Lucide — suggestion si proche |
| `OPTIONS_ABSENT` | erreur | Pas de bloc `WINTOOL:OPTIONS` |
| `OPTIONS_NON_FERME` | erreur | Bloc `OPTIONS` non refermé |
| `TYPE_ABSENT` | erreur | Option déclarée sans `[type]` |
| `TYPE_INVALIDE` | erreur | Type inconnu |
| `LIBELLE_VIDE` | erreur | Option ou choix sans libellé |
| `CHOIX_MANQUANT` | erreur | `select` ou `multi` avec moins de deux choix |
| `CHOIX_INATTENDU` | erreur | Choix déclarés sur un type qui n'en accepte pas |
| `CONFIG_ABSENT` | erreur | Pas de bloc `$CONFIG = @{ }` |
| `CONFIG_NON_FERME` | erreur | Bloc `$CONFIG` non refermé |
| `CONFIG_LIGNE_ILLISIBLE` | avertissement | Ligne non reconnue comme « Clé = valeur » |
| `OPTION_NON_DECLAREE` | erreur | Clé dans `$CONFIG` absente du bloc `OPTIONS` |
| `OPTION_ORPHELINE` | erreur | Option déclarée sans valeur par défaut dans `$CONFIG` |
| `TYPE_INCOHERENT` | avertissement | `[bool]` sur une valeur non booléenne, `[number]` sur du texte |
| `DEFAUT_INVALIDE` | erreur | Défaut hors des choix, `select` en tableau, `multi` qui n'en est pas un |
| `TRADUCTION_ABSENTE` | erreur | Aucun bloc `WINTOOL:LANG` vers une langue autre que `lang` |
| `TRADUCTION_NON_FERMEE` | erreur | Bloc de traduction non refermé |
| `TRADUCTION_INCOMPLETE` | erreur | `title` ou `desc` non traduit |
| `TRADUCTION_OPTION` | avertissement | Une option sans libellé traduit |
| `TRADUCTION_CHOIX` | avertissement | Un choix sans libellé traduit |
| `TRADUCTION_ORPHELINE` | erreur | Traduction d'une option ou d'un choix qui n'existe pas |
| `OVERRIDE_ABSENT` | erreur | Ligne d'override manquante |
| `OVERRIDE_OBSOLETE` | erreur | Ancienne ligne d'override lisant un fichier — `WINTOOL_CONFIG` contient le JSON |
| `OVERRIDE_FICHIER` | erreur | Repli vers un fichier de configuration — **WinTool refuse de lancer le script** |
| `MARQUEUR_INCONNU` | erreur | Balise proche d'un marqueur connu — `[REBBOT]` → `[REBOOT]` |
| `MARQUEUR_CASSE` | avertissement | Marqueur pas en majuscules |
| `SORTIE_NON_ANGLAISE` | avertissement | Message affiché contenant des accents |

Le contrôle des marqueurs ne regarde que les balises **en tête de chaîne affichée**.
Sans cette restriction, les transtypages PowerShell deviennent des faux positifs :
`[long]` ressemble à `[DONE]` à deux caractères près, et `[int]` à `[INFO]`.

---

## Votre modèle : le squelette de ce document

`scripts/Default/` est **vide** : le catalogue est en cours de réécriture. Vous n'avez donc
aucun script existant à imiter, et c'est tant mieux — les précédents portaient tous une
ancienne forme de bloc d'override que WinTool refuse désormais de lancer.

**Le squelette donné plus haut est le seul modèle fiable.** Il est vérifié : on l'extrait de
ce fichier et on le passe au validateur en `-Strict` à chaque relecture de la documentation.

---

## Pièges silencieux — ce que le validateur ne vous dira pas

Ces règles sont appliquées par le code mais **ne produisent aucun constat**. Un script qui
les enfreint passe `-Strict` sans un mot, puis se comporte mal.

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

### `category` ne peut pas viser « Entretien complet »

Cette catégorie est un agrégat : elle rassemble automatiquement ce qui est rangé ailleurs.
Aucun script ne peut la désigner. Utilisez un des six jetons d'usine.

### Une valeur d'`engine` inconnue se comporte comme `auto`

`engine : powershell` ou `engine : ps7` ne produisent aucune erreur : WinTool prend
simplement l'interpréteur le plus récent disponible. Les trois seules valeurs qui ont un
sens sont `auto`, `winps` et `pwsh`.

### La configuration injectée est plafonnée

Au-delà de **30 000 caractères** de JSON, WinTool refuse le lancement (limite Windows sur
une variable d'environnement). Un `[multi]` à très nombreux choix ou une `[string]` très
longue peuvent y conduire.

---

## Ce qui empêche un script de se lancer

WinTool applique partout le principe « **constater, jamais bloquer** » : un script
non conforme s'exécute quand même, ses anomalies sont simplement affichées. Il
existe exactement **trois exceptions**, et toutes les trois portent sur
l'exécution avec les droits administrateur — jamais sur la forme du fichier.

Si vous écrivez des scripts pour WinTool, ce sont les seules choses qui peuvent
faire refuser le lancement :

### 1. Le script n'est pas approuvé

Tout script qui ne vient pas de `Default\` doit être approuvé une fois, par son
empreinte exacte. Toute modification du fichier invalide l'approbation. Voir §12.1
de la spécification.

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

### 3. Le mode test, pour un script qui ne sait pas se simuler

Quand le **mode test** est actif, WinTool impose `SafeTest = true` à chaque script.
Un script qui ne déclare pas cette option est **refusé**, pas exécuté.

C'est volontaire : injecter une clé qu'un script n'utilise pas ajouterait une
entrée inerte à sa table, et il modifierait la machine pendant que l'interface
annonce une simulation. Un refus visible vaut mieux qu'une garantie fausse.

Pour qu'un script soit utilisable en mode test, déclarez l'option et honorez-la :

```powershell
## SafeTest      : [bool]   Safe test — simulates every change, modifies nothing
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
