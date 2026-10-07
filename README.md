# WinTool

Outil de maintenance Windows. Une interface, deux modes, et des scripts PowerShell que
vous pouvez lire, modifier et ajouter vous-même.

- **Mode Simple** — un assistant en trois étapes, sans un seul terme technique. Conçu pour
  quelqu'un qui n'a jamais ouvert un terminal.
- **Mode Expert** — le panneau de configuration du mode Simple : vous composez les lots,
  réglez chaque script, et lisez la sortie réelle de PowerShell pendant qu'elle défile.

L'application ne fait rien d'autre que lancer des scripts. Ce qu'ils font est écrit dans
leur fichier, en clair, et vous pouvez le lire avant de cliquer.

**WinTool est livré sans aucun script.** Au premier lancement, il propose d'installer le
[catalogue officiel](https://github.com/burnout293/WinTool-Catalogue) — publié à part, sous licence MIT, et signé : chaque script est
vérifié contre un index signé avant d'être écrit sur le disque. Vous choisissez les actions
à installer, et vous pouvez ajouter d'autres catalogues (Réglages → Catalogues) : un dépôt
GitHub et la clé publique de son éditeur. Vous pouvez aussi continuer sans, et n'utiliser
que vos propres scripts.

---

## Installation

Téléchargez l'installeur depuis la page **Releases**, puis exécutez-le.

### « Windows a protégé votre PC »

Cet écran bleu apparaîtra. C'est normal, et voici pourquoi : **WinTool n'est pas signé
numériquement**. Un certificat de signature coûte plusieurs centaines d'euros par an, et ce
projet n'en a pas.

SmartScreen ne dit pas que le programme est dangereux — il dit qu'il ne le reconnaît pas.

Pour continuer :

1. Cliquez sur **Informations complémentaires**
2. Cliquez sur **Exécuter quand même**

Si vous préférez vérifier avant, chaque Release publie l'empreinte SHA-256 de l'installeur.
Comparez-la avec :

```powershell
Get-FileHash .\WinTool_*_x64-setup.exe -Algorithm SHA256
```

### Droits administrateur

WinTool **s'ouvre normalement, sans élévation**. Il vous le dira s'il n'a pas les droits, et
vous proposera de se relancer en administrateur — **une seule autorisation Windows**, et
tous les scripts en héritent ensuite.

La plupart des actions en ont besoin : Windows réserve aux administrateurs le
droit d'effacer des fichiers système, de changer une configuration réseau ou de désinstaller
une application.

### Mises à jour

Depuis la **1.1**, WinTool vérifie à son ouverture si une version plus récente est publiée,
et **vous la propose** dans un bandeau. Il ne télécharge et n'installe rien sans votre clic.
Vous pouvez désactiver cette vérification dans les réglages ; « Vérifier maintenant » reste
alors disponible.

- **Rien n'identifie votre PC** dans cette vérification, pas même la version installée :
  WinTool demande simplement un fichier public à GitHub.
- **Chaque mise à jour est signée.** WinTool vérifie la signature avant d'installer quoi que
  ce soit, et refuse un installeur qui ne viendrait pas de ce dépôt.
- **Si vous avez la 1.0.0**, installez la 1.1 à la main une dernière fois : la 1.0.0 ne
  savait pas encore se mettre à jour. Toutes les versions suivantes arriveront seules.

### Désinstaller

Depuis les **Paramètres de Windows → Applications**. Le désinstalleur vous demande ce qui
doit rester :

- **garder vos données**, pour une réinstallation par exemple ;
- **tout effacer, sauf vos scripts personnels** ;
- ou **choisir** : réglages, historique, journaux, catalogue, scripts approuvés,
  emplacements protégés, données de l'interface, scripts personnels.

---

## La simulation

Un script **simulé** montre ce qu'il ferait, sans rien modifier. Chaque script se règle
séparément dans le mode Expert, et la pastille **Simulation** de la barre de titre les
simule tous d'un coup — ou les repasse tous en réel.

- Vos choix **sont conservés** d'une session à l'autre. Pour qu'on ne puisse jamais croire
  réel un entretien simulé, un bandeau le signale dès qu'un seul script est simulé, le
  bilan dit combien l'ont été, et une exécution simulée ne compte jamais comme « Fait le … ».
- Tant que la simulation est **activée**, un script qui ne sait pas se simuler est
  **refusé, pas exécuté**. Mieux vaut un refus visible qu'une fausse garantie.

---

## Ajouter vos propres scripts

Déposez un `.ps1` dans :

```
%LOCALAPPDATA%\WinTool\scripts\
```

Les sous-dossiers sont libres, la découverte est récursive. Le script apparaît au prochain
démarrage, ou après **Ré-analyser tous les scripts** dans les Réglages.

**Avant sa première exécution**, WinTool vous montre son contenu et vous demande de
l'approuver nommément. L'approbation porte sur l'empreinte exacte du fichier : toute
modification ultérieure la révoque.

Pour écrire un script conforme, tout est dans **[`docs/FORMAT_SCRIPT.md`](docs/FORMAT_SCRIPT.md)** :
le squelette à copier, les règles, et les pièges silencieux.

Vérifiez-le avant de le lancer :

```powershell
.\tools\lint-scripts.ps1 -Path <votre dossier>
```

---

## Développement

```bash
npm install
npm run dev            # lance l'application
npm run build          # produit l'installeur NSIS
npm run lint:scripts   # valide le catalogue, extrait à côté (../WinTool-Catalogue)
npm run icons:sync     # régénère les icônes depuis lucide-static
```

```bash
cd src-tauri && cargo test --lib   # la suite de tests Rust
```

### Voir l'interface sans lancer l'application

L'application demande l'élévation pour être utile, ce qui complique le développement de
l'interface. Un banc d'essai sert `src/` dans un navigateur ordinaire, avec un faux pont
vers Rust :

```bash
node tools/bench/serve.mjs 8123
```

Puis `http://localhost:8123/`. Quelques variantes utiles :
`?onboarding=1` rejoue l'écran d'accueil, `?sansadmin` simule l'absence de droits.

Ce banc ne part jamais dans le binaire : les fixtures vivent dans `tools/bench/`.

---

## Documentation

| Fichier | Contenu |
|---|---|
| [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) | Ce que l'application doit faire, et pourquoi. Fait autorité en cas de doute. |
| [`docs/FORMAT_SCRIPT.md`](docs/FORMAT_SCRIPT.md) | Écrire un script : squelette, règles, codes du validateur. |
| [`docs/PRESENTATION.md`](docs/PRESENTATION.md) | Modifier la présentation du premier démarrage sans toucher au code. |
| [WinTool-Catalogue](https://github.com/burnout293/WinTool-Catalogue) | Les scripts officiels, leur licence (MIT) et la liste des scripts prévus. |

Une règle du projet : **toute convention décrite dans la documentation est vérifiée par un
outil**. `tools/lint-scripts.ps1` valide les scripts, la suite de tests Rust lit le
squelette de `FORMAT_SCRIPT.md` pour qu'il ne puisse pas diverger du parseur, et
`tools/verifier-presentation.mjs` contrôle le contenu de la présentation.

C'est la leçon de la version précédente, dont la convention était documentée et respectée
par zéro script sur treize.

---

## Licence

**Apache-2.0, assortie d'avenants restrictifs** — le texte complet est dans
[`LICENSE`](LICENSE), et une traduction française de courtoisie des avenants dans
[`LICENSE.fr.md`](LICENSE.fr.md).

En une phrase : WinTool est gratuit pour tout le monde, entreprises comprises, et
personne ne peut en faire un produit payant.

| Vous pouvez | Vous ne pouvez pas |
|---|---|
| L'utiliser, y compris dans une entreprise | Le vendre, le louer, en faire un abonnement |
| Facturer une prestation d'installation, de dépannage ou de formation | Faire payer son téléchargement ou son accès |
| Le modifier, le forker, le redistribuer gratuitement | Réclamer un don en échange de son accès |
| Le diffuser depuis un site financé par la publicité | Faire dépendre le prix d'un pack de sa présence |
| Vendre vos propres scripts | Présenter un fork comme la version officielle |

Deux obligations si vous distribuez une version modifiée : **remettre son code source à
chaque personne qui en reçoit le binaire** (aucune publication ouverte exigée — un usage
interne à une entreprise ne déclenche rien), et **signaler toute collecte de données que
vous ajoutez**.

**Ce n'est pas une licence Open Source** au sens de l'Open Source Initiative : la clause
de non-vente discrimine un champ d'activité, ce que la définition OSI interdit. C'est
assumé et écrit en tête du fichier plutôt que laissé à découvrir.

**Les scripts ne font pas partie de WinTool** et ne sont pas soumis à cette licence. Leurs
auteurs choisissent librement leurs conditions, y compris commerciales — un script
conforme au contrat v2 reste exécutable sans WinTool, il ne lui doit donc rien. Ceux du
catalogue officiel sont sous licence MIT et distribués à part, dans
[leur propre dépôt](https://github.com/burnout293/WinTool-Catalogue) : l'installeur de WinTool n'en contient aucun.

Les composants tiers conservent leurs propres licences, énumérées dans
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

> Ce texte n'a pas été relu par un juriste. Le §28 du cahier des charges de la licence
> prévoit cette relecture avant de le considérer comme définitif.
