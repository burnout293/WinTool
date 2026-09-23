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
(§5.4). La seule exception est l'approbation de sécurité (§12.1), qui, elle, bloque.

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
## WINTOOL:END

$CONFIG = @{
    DnsProvider = "cloudflare"
    ApplyToIPv6 = $true
    FlushCache  = $true
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================

Write-Host "[STEP] 1/1 Applying DNS settings"
Write-Host "[OK]   Provider set to $($CONFIG.DnsProvider)"
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
| `hidden` | **visible en mode Expert seulement** |

Le séparateur entre libellé et description est un tiret cadratin `—`. La description est
facultative ; le libellé ne l'est pas.

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
erreur.** C'est le contrôle qui manquait à la v3 : renommez une clé et laissez sa
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

Elle remplace un mécanisme bien pire. La v3 reconstruisait le bloc `$CONFIG` à coups
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
[ERR]    message           erreur — marque le script en échec
[STEP]   3/7 message       alimente la barre de progression
[CKPT]   message           « interruption sans risque à partir d'ici »
[REBOOT] message           un redémarrage est réellement nécessaire
[DONE]   message           fin nominale
```

**Le verdict de réussite vient du code de sortie** (`exit 0` = succès), jamais du fait que
le script ait démarré. Terminez donc explicitement par `exit 0` ou `exit 1`. La v3 se
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

`-Strict` traite les avertissements comme des erreurs. Les scripts livrés dans `Default\`
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
| `MARQUEUR_INCONNU` | erreur | Balise proche d'un marqueur connu — `[REBBOT]` → `[REBOOT]` |
| `MARQUEUR_CASSE` | avertissement | Marqueur pas en majuscules |
| `SORTIE_NON_ANGLAISE` | avertissement | Message affiché contenant des accents |

Le contrôle des marqueurs ne regarde que les balises **en tête de chaîne affichée**.
Sans cette restriction, les transtypages PowerShell deviennent des faux positifs :
`[long]` ressemble à `[DONE]` à deux caractères près, et `[int]` à `[INFO]`.
