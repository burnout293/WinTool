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
| **1.2** | Les scripts quittent WinTool : catalogue officiel dans son propre dépôt (MIT), index signé, installation et mises à jour depuis l'application (§16) | Prête — à publier **après** le catalogue |
| **1.3** | Analyser → cocher → nettoyer (§17) | Contrat script prêt, interface à faire |
| **1.4** | Catégories distinctes des lots, onglets Scripts / Lots en Expert | À faire |
| plus tard | Sources tierces (§16.2, §16.8) | Spécifié |
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

**Les sources tierces viennent plus tard** : c'est la surface de sécurité la plus large — du
PowerShell téléchargé auprès de n'importe qui, exécuté en administrateur.

## Ce qui attend une décision

- **1.4** — le passage des « catégories » actuelles aux « lots » renomme environ 310
  occurrences dans le code et impose de migrer `settings.json` sans rien perdre.
  `tools/categories.json`, qui sert aujourd'hui à la fois au validateur et à fabriquer les
  lots d'usine, sera scindé en deux.
- **Sources tierces** — l'emplacement de leur liste (réservé à l'administrateur, §16.2)
  impose une élévation pour en ajouter une : à confirmer le moment venu.
