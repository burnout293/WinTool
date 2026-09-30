# WinTool — feuille de route

Versions mineures successives jusqu'à ce que le gros du travail soit fait ; la 2.0
viendra ensuite. Numérotation sémantique : une version qui apporte des fonctions monte
d'un cran (1.1, 1.2…), une version de corrections seules prend un troisième chiffre
(1.1.1, 1.1.2…).

| Version | Contenu | État |
|---|---|---|
| **1.0.0** | Première version publiée | Publiée le 27/09/2026 |
| **1.1** | Mise à jour automatique de WinTool | En cours |
| **1.2** | Analyser → cocher → nettoyer (§17) | Contrat script prêt, interface à faire |
| **1.3** | Catégories distinctes des lots, onglets Scripts / Lots en Expert | À faire |
| **1.4** | Sources de scripts, index signé Ed25519 (§16) | Spécifié |
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

**Les sources arrivent en dernier** : c'est la surface de sécurité la plus large — du
PowerShell téléchargé, exécuté en administrateur —, et elle suppose que les scripts aient
quitté ce dépôt pour le leur.

## Ce qui attend une décision

- **1.3** — le passage des « catégories » actuelles aux « lots » renomme environ 310
  occurrences dans le code et impose de migrer `settings.json` sans rien perdre.
  `tools/categories.json`, qui sert aujourd'hui à la fois au validateur et à fabriquer les
  lots d'usine, sera scindé en deux.
- **1.4** — l'adresse du dépôt qui hébergera la source officielle.
