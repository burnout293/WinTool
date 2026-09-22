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
3. **Enregistrez en UTF-8 *avec BOM*** (voir la section Encodage — c'est le piège n°1).
4. Déposez-le dans `%LOCALAPPDATA%\WinTool\scripts\` (sous-dossiers libres).
5. Vérifiez : `.\tools\lint-scripts.ps1`

Un script non conforme **s'exécute quand même** : WinTool signale, il ne bloque pas
(§5.4). La seule exception est l'approbation de sécurité (§12.1), qui, elle, bloque.

---

## Le squelette

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
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END

## WINTOOL:LANG en
## title             : Disable sleep
## desc              : Prevents Windows from sleeping or hibernating
## VeilleBranche_Min : Sleep on AC power — 0 = never
## WINTOOL:END

$CONFIG = @{
    VeilleBranche_Min = 0   # [number] Veille sur secteur — 0 = jamais
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    (Get-Content $env:WINTOOL_CONFIG -Raw | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

# ==============================================================================

Write-Host "[STEP] 1/1 Applying power settings"
powercfg /change standby-timeout-ac $CONFIG.VeilleBranche_Min
Write-Host "[OK]   Sleep on AC power: $($CONFIG.VeilleBranche_Min) min"
Write-Host "[DONE] Sleep disabled"
exit 0
```

---

## L'entête

Tous ces champs sont **obligatoires**. `tags` est le seul facultatif.

| Champ | Valeurs | Rôle |
|---|---|---|
| `id` | GUID (`New-Guid`) | **Identifie le script pour toujours.** Un chemin change au moindre renommage ; l'`id` survit, et avec lui la configuration, le classement et l'historique. |
| `lang` | `fr`, `en`… | Langue dans laquelle cet entête est rédigé |
| `title` | texte court | Nom affiché |
| `desc` | une phrase | Description affichée |
| `category` | voir ci-dessous | **Suggestion de rangement, pas un ordre** |
| `icon` | nom d'icône | Choisie dans le jeu de l'application |
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
son classement devient figé et plus rien ne l'écrase. Le script propose, l'humain dispose.

La même règle vaut pour `reversible` et `reboot` : ils **pré-cochent** une case que
l'utilisateur peut décocher, et son choix l'emporte ensuite définitivement.

### Le cas de `engine`

Un `.ps1` ne peut pas choisir son interpréteur — sous Windows c'est le processus appelant
qui décide, il n'y a pas d'équivalent du shebang Unix. `auto` prend le plus récent
disponible. Ne forcez `pwsh` que si vous utilisez vraiment de la syntaxe PowerShell 7
(`??`, `?:`) : si PowerShell 7 est absent, WinTool **ne se replie jamais en silence** sur
5.1 — le script est marqué indisponible.

---

## Le bloc de traduction

L'application est bilingue (§10). Un second bloc traduit l'entête **et les libellés des
options** :

```powershell
## WINTOOL:LANG en
## title             : Disable sleep
## desc              : Prevents Windows from sleeping or hibernating
## VeilleBranche_Min : Sleep on AC power — 0 = never
## WINTOOL:END
```

`title` et `desc` sont obligatoires. Chaque clé de `$CONFIG` devrait y figurer, sinon son
libellé restera en français dans l'interface anglaise. Une traduction absente retombe
toujours sur la langue de base — rien ne casse.

---

## Le bloc `$CONFIG`

Chaque ligne s'annote `# [type] Libellé — Description`. **Sans annotation, l'interface
affiche la clé brute** : l'utilisateur lirait `VeilleBranche_Min` au lieu de
« Veille sur secteur ».

```powershell
$CONFIG = @{
    VeilleBranche_Min     = 0      # [number] Veille sur secteur — 0 = jamais
    DesactiverHibernation = $true  # [bool]   Supprimer l'hibernation — efface hiberfil.sys
    ServeurDNS            = "CF"   # [string] Fournisseur DNS — Cloudflare, Google, Quad9
    VerrouillerRegistre   = $true  # [hidden] Verrouiller via le registre
}
```

| Type | Contrôle affiché |
|---|---|
| `bool` | interrupteur |
| `number` | champ numérique |
| `string` | champ texte |
| `hidden` | **visible en mode Expert seulement** |

Le séparateur entre libellé et description est un tiret cadratin `—`. La description est
facultative ; le libellé ne l'est pas.

---

## La ligne d'override — ne la supprimez pas

```powershell
# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    (Get-Content $env:WINTOOL_CONFIG -Raw | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}
```

**Sans elle, les réglages choisis dans l'interface sont purement et simplement ignorés** :
le script tourne toujours avec ses valeurs par défaut, sans que rien ne le signale.

Elle remplace un mécanisme bien pire. La v3 reconstruisait le bloc `$CONFIG` à coups
d'expression régulière, écrivait un `.ps1` temporaire et exécutait *celui-là* — fragile,
et déjà cassé au moment de la refonte. Désormais WinTool écrit un fichier JSON, pose la
variable `WINTOOL_CONFIG`, et exécute **votre fichier, tel quel**.

Bénéfice secondaire : sans cette variable d'environnement, votre script reste parfaitement
exécutable seul, en double-clic, avec ses valeurs par défaut.

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
.\tools\lint-scripts.ps1                              # tout le dossier scripts/
.\tools\lint-scripts.ps1 -Path .\scripts\Default -Strict   # exigence CI
```

`-Strict` traite les avertissements comme des erreurs. Les scripts livrés dans `Default\`
doivent passer en `-Strict` : ceux-là, on les maîtrise.

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
| `TRADUCTION_ABSENTE` | erreur | Pas de bloc `WINTOOL:LANG en` |
| `TRADUCTION_NON_FERMEE` | erreur | Bloc de traduction non refermé |
| `TRADUCTION_INCOMPLETE` | erreur | `title` ou `desc` non traduit |
| `TRADUCTION_OPTION` | avertissement | Une clé de `$CONFIG` sans libellé anglais |
| `CONFIG_ABSENT` | erreur | Pas de bloc `$CONFIG = @{ }` |
| `CONFIG_NON_FERME` | erreur | Bloc `$CONFIG` non refermé |
| `CONFIG_LIGNE_ILLISIBLE` | avertissement | Ligne non reconnue comme « Clé = valeur » |
| `ANNOTATION_ABSENTE` | erreur | Option sans `# [type] Libellé` |
| `TYPE_INVALIDE` | erreur | Type d'annotation inconnu |
| `TYPE_INCOHERENT` | avertissement | `[bool]` sur une valeur non booléenne, `[number]` sur du texte |
| `LIBELLE_VIDE` | erreur | Annotation sans libellé |
| `OVERRIDE_ABSENT` | erreur | Ligne d'override manquante |
| `MARQUEUR_INCONNU` | erreur | Balise proche d'un marqueur connu — `[REBBOT]` → `[REBOOT]` |
| `MARQUEUR_CASSE` | avertissement | Marqueur pas en majuscules |
| `SORTIE_NON_ANGLAISE` | avertissement | Message affiché contenant des accents |

Le contrôle des marqueurs ne regarde que les balises **en tête de chaîne affichée**.
Sans cette restriction, les transtypages PowerShell deviennent des faux positifs :
`[long]` ressemble à `[DONE]` à deux caractères près, et `[int]` à `[INFO]`.
