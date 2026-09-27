# Cahier des charges - Licence de WinTool

## 1. Contexte du projet

Le logiciel s'appelle **WinTool**.

WinTool est une application Windows destinée notamment à organiser, configurer et exécuter des scripts permettant différentes opérations sur le système.

Le projet est destiné à être distribué gratuitement et son code source doit être publiquement accessible.

Le développeur souhaite permettre aux utilisateurs de consulter, modifier, forker et redistribuer le logiciel, tout en interdisant que quelqu'un puisse tirer directement des revenus de WinTool lui-même.

La licence sera donc une **licence personnalisée**, et non une licence Open Source OSI classique, puisque l'interdiction de commercialisation est volontaire.

---

# 2. Principes fondamentaux

La licence doit garantir les principes suivants :

* WinTool est gratuit.
* Toute personne peut utiliser WinTool.
* L'utilisation personnelle est autorisée.
* L'utilisation professionnelle est autorisée.
* L'utilisation par des entreprises est autorisée.
* L'utilisation par des administrations, associations, écoles, etc. est autorisée.
* Le code source est accessible publiquement.
* La modification du code source est autorisée.
* La création de forks est autorisée.
* La redistribution est autorisée.
* Les copies et versions modifiées distribuées doivent rester gratuites.
* La commercialisation directe de WinTool est interdite.
* La licence ne doit pas empêcher quelqu'un de gagner de l'argent grâce à une prestation dans laquelle WinTool est simplement utilisé comme outil.

---

# 3. Définition de la commercialisation

Le terme « commercial » doit être défini précisément.

Dans le cadre de cette licence, une activité est considérée comme une commercialisation de WinTool lorsqu'elle génère **directement des revenus grâce à WinTool lui-même**.

Sont notamment interdits :

* vendre WinTool ;
* vendre une copie de WinTool ;
* vendre une licence d'utilisation de WinTool ;
* demander un abonnement pour utiliser WinTool ;
* faire payer le téléchargement de WinTool ;
* faire payer l'accès à WinTool ;
* vendre une version modifiée de WinTool ;
* vendre un fork de WinTool ;
* faire payer une fonctionnalité faisant partie de WinTool ;
* mettre WinTool derrière un paywall ;
* demander des dons spécifiquement en échange de l'accès à WinTool.

En revanche, les activités suivantes doivent rester autorisées :

* utiliser WinTool dans une entreprise ;
* utiliser WinTool dans le cadre d'une prestation informatique payante ;
* facturer une prestation de maintenance ou de dépannage utilisant WinTool comme outil ;
* facturer l'installation ou la configuration de WinTool ;
* vendre un service dans lequel WinTool est simplement utilisé comme outil ;
* inclure WinTool dans un ensemble ou un pack payant lorsque le prix demandé ne dépend pas de la présence de WinTool et que WinTool reste librement disponible séparément.

La licence doit éviter de considérer automatiquement comme « commercial » tout usage effectué par une entreprise.

---

# 4. Redistribution

La redistribution de WinTool est autorisée à condition qu'elle reste gratuite.

Une personne peut notamment :

* héberger WinTool sur son propre site ;
* héberger une copie sur GitHub, GitLab, Codeberg ou autre plateforme ;
* distribuer WinTool sur un forum ;
* distribuer WinTool sur un réseau interne ;
* transmettre WinTool à d'autres personnes ;
* distribuer une version modifiée.

Conditions souhaitées :

* la redistribution doit rester gratuite ;
* la licence doit être conservée ;
* les mentions de copyright doivent être conservées ;
* un lien vers le dépôt officiel doit être conservé ;
* la copie doit indiquer clairement sa provenance lorsqu'elle est redistribuée.

---

# 5. Versions modifiées et forks

Les modifications du code source sont autorisées.

Les forks sont également autorisés.

Cependant, une version modifiée distribuée doit :

* rester gratuite ;
* fournir son code source ;
* conserver les mentions et la licence applicables ;
* indiquer clairement qu'il s'agit d'une version modifiée/non officielle ;
* ne pas se présenter comme la version officielle de WinTool.

Un fork peut évoluer librement et ajouter ses propres fonctionnalités.

La licence ne doit pas empêcher un fork de modifier profondément le fonctionnement du programme.

---

# 6. Nom et identité de WinTool

Le nom **WinTool** et l'identité visuelle associée au projet original doivent être distingués du code source.

Un fork peut utiliser le code mais ne doit pas pouvoir se présenter comme le WinTool officiel.

Principe souhaité :

* fork autorisé ;
* utilisation du code autorisée ;
* utilisation du nom « WinTool » pour présenter le fork comme le logiciel officiel interdite ;
* utilisation du logo/identité graphique officielle interdite pour présenter un fork comme officiel ;
* les versions modifiées doivent utiliser un autre nom ou indiquer clairement leur statut non officiel.

Le développeur souhaite conserver le contrôle sur l'identité du projet original.

---

# 7. Code source

Le code source de WinTool doit être publiquement accessible.

Les utilisateurs sont autorisés à :

* consulter le code ;
* étudier le fonctionnement ;
* modifier le code ;
* compiler leur propre version ;
* créer des forks.

Une version modifiée distribuée doit également rendre son code source disponible conformément aux conditions de la licence.

---

# 8. Scripts

Les scripts sont **distincts du logiciel WinTool** et ne doivent pas être considérés comme faisant partie de WinTool uniquement parce qu'ils peuvent être lus ou exécutés par celui-ci.

WinTool ne fournit pas nécessairement les scripts eux-mêmes.

WinTool :

* lit les scripts ;
* peut reconnaître une syntaxe ou une norme particulière ;
* peut reconnaître des métadonnées ;
* peut catégoriser les scripts ;
* peut permettre leur configuration lorsqu'ils respectent la norme prévue ;
* peut permettre leur exécution.

WinTool **n'ajoute pas de capacité d'exécution particulière à un script**.

Un script qui ne fonctionne pas indépendamment de WinTool ne devient pas fonctionnel simplement parce qu'il est chargé dans WinTool.

La licence WinTool ne doit donc pas imposer de licence particulière aux scripts.

---

# 9. Licence des scripts

Les scripts sont indépendants de WinTool.

Chaque auteur de script peut choisir librement les conditions de licence et de distribution de ses propres scripts.

La licence de WinTool :

* ne s'applique pas automatiquement aux scripts tiers ;
* ne transfère pas sa licence aux scripts ;
* ne définit pas les droits accordés par les auteurs de scripts ;
* ne doit pas empêcher l'auteur d'un script de choisir sa propre licence.

Un script peut donc avoir une licence totalement différente de celle de WinTool.

Un auteur peut notamment distribuer gratuitement ou commercialement son propre script, sous réserve que ce script soit réellement indépendant de WinTool et que cela ne constitue pas une commercialisation de WinTool lui-même.

---

# 10. Sources de scripts

WinTool pourra permettre à l'utilisateur d'ajouter différentes sources de scripts.

Il pourra notamment exister :

* une source officielle maintenue par le développeur de WinTool ;
* des sources tierces ;
* des sources créées ou maintenues par des forks ;
* des sources personnelles.

La source officielle pourra être identifiée comme telle par WinTool.

Les scripts provenant de la source officielle pourront être reconnus comme provenant d'une source approuvée par WinTool.

Les scripts provenant d'autres sources devront pouvoir être identifiés comme provenant d'une source tierce.

WinTool pourra afficher un avertissement concernant :

* la provenance du script ;
* son auteur/source ;
* son contenu ;
* le fait qu'il n'est pas contrôlé ou approuvé par le projet WinTool.

---

# 11. Sources tierces et forks

La licence ne doit pas empêcher un fork de WinTool de proposer ses propres sources de scripts.

Un fork peut donc :

* créer ses propres sources ;
* ajouter des sources tierces ;
* permettre le téléchargement de scripts depuis ces sources ;
* modifier la manière dont les sources sont gérées.

La licence ne doit pas rendre WinTool responsable du contenu des sources tierces.

---

# 12. Scripts malveillants

WinTool lui-même ne doit pas être distribué intentionnellement avec un comportement malveillant.

En revanche, la licence ne doit pas tenter d'interdire ou de contrôler tous les scripts tiers susceptibles d'être malveillants.

Exemple :

1. WinTool est installé chez M. Fraise.
2. M. Cerise crée un script malveillant.
3. M. Fraise ajoute la source de M. Cerise à WinTool.
4. Le script est reconnu comme script tiers.
5. WinTool affiche un avertissement concernant sa provenance.
6. M. Fraise décide malgré tout de l'exécuter.

La licence doit clairement établir que le script tiers et son comportement ne constituent pas automatiquement un élément de WinTool et que WinTool ne garantit pas leur sécurité.

Cette séparation doit également être reflétée dans le fonctionnement de l'application.

---

# 13. Télémétrie et collecte de données

WinTool ne doit pas intégrer de télémétrie.

Sont notamment interdits :

* collecte automatique de données d'utilisation ;
* collecte automatique d'informations système à des fins statistiques ;
* collecte automatique de l'historique d'utilisation ;
* collecte automatique des scripts utilisés ;
* collecte automatique de données personnelles ;
* transmission automatique de ces données ;
* suivi comportemental ;
* statistiques d'utilisation envoyées au développeur.

La licence doit distinguer clairement **télémétrie** et **communication réseau nécessaire au fonctionnement**.

---

# 14. Communications réseau

Une connexion réseau n'est pas considérée automatiquement comme de la télémétrie.

WinTool peut communiquer avec Internet ou un réseau lorsqu'une fonctionnalité le nécessite.

Exemples autorisés :

* vérifier automatiquement si une nouvelle version de WinTool est disponible ;
* télécharger une mise à jour ;
* permettre à l'utilisateur de récupérer une source de scripts ;
* permettre à l'utilisateur de télécharger un script ;
* permettre à l'utilisateur d'exporter ou transmettre volontairement des données ;
* permettre ultérieurement une synchronisation avec un compte WinTool lorsque l'utilisateur demande explicitement cette synchronisation.

La vérification automatique des mises à jour est donc autorisée.

Cette vérification ne doit cependant pas être utilisée comme moyen de collecte de télémétrie.

---

# 15. Export et synchronisation des données

Les données de l'utilisateur ne doivent pas être automatiquement envoyées vers un serveur.

L'utilisateur peut explicitement demander :

* un export local ;
* un export vers un emplacement réseau ;
* une synchronisation vers un éventuel compte WinTool ;
* toute autre opération de transfert explicitement déclenchée par lui.

Le principe est :

**pas de transmission automatique de données utilisateur à des fins de collecte ou de télémétrie.**

Une fonctionnalité réseau explicitement demandée par l'utilisateur est distincte de la télémétrie.

---

# 16. Plugins

Les plugins/extensions de WinTool doivent rester gratuits lorsqu'ils sont spécifiquement conçus comme extensions de WinTool.

La vente ou l'abonnement à un plugin WinTool est interdit.

En revanche, cette règle ne doit pas nécessairement s'appliquer à un logiciel ou script indépendant pouvant également fonctionner sans WinTool.

---

# 17. Garantie

WinTool est fourni **« en l'état »**.

Aucune garantie de fonctionnement parfait ne doit être donnée.

Le développeur ne garantit notamment pas :

* l'absence totale de bugs ;
* la compatibilité avec toutes les configurations ;
* l'absence d'interruption ;
* l'absence de perte de données ;
* l'absence de conséquences imprévues.

---

# 18. Responsabilité

La licence doit limiter la responsabilité du développeur dans les limites permises par la loi.

WinTool lui-même est conçu comme un outil/interface.

Les scripts peuvent effectuer des modifications importantes sur le système et ne sont pas nécessairement contrôlés par le développeur.

Le développeur ne doit donc pas être tenu responsable des conséquences résultant :

* de l'utilisation d'un script tiers ;
* du contenu d'un script tiers ;
* d'une source tierce ;
* d'une version modifiée de WinTool ;
* d'un fork ;
* d'une utilisation non conforme du logiciel ;
* d'une modification du système résultant d'un script.

La licence doit toutefois éviter d'affirmer une exclusion de responsabilité absolue lorsque la loi applicable ne le permet pas.

---

# 19. Télémétrie ajoutée par un fork

Un fork de WinTool ne doit pas ajouter de télémétrie ou de collecte de données tout en continuant à se présenter comme une version officielle de WinTool.

Une version modifiée doit être clairement identifiée comme non officielle.

La licence doit autant que possible distinguer :

* WinTool officiel ;
* versions modifiées ;
* scripts ;
* sources de scripts.

---

# 20. Comportements malveillants dans les forks

La licence ne doit pas tenter de contrôler toutes les fonctionnalités qu'un fork pourrait créer.

Un fork peut modifier le fonctionnement de WinTool et créer son propre écosystème de sources de scripts.

En revanche, il ne doit pas :

* se présenter comme la version officielle ;
* utiliser l'identité officielle pour tromper l'utilisateur ;
* distribuer une version malveillante en la présentant comme WinTool officiel.

---

# 21. Services payants autour de WinTool

Les services suivants doivent rester autorisés lorsqu'ils ne constituent pas une vente de WinTool :

* installation ;
* configuration ;
* dépannage ;
* maintenance ;
* formation ;
* support ;
* prestation informatique utilisant WinTool.

Le paiement doit correspondre au **service fourni**, et non à l'accès à WinTool lui-même.

---

# 22. Bundles et produits contenant WinTool

WinTool peut être inclus gratuitement dans un ensemble payant uniquement lorsque :

* WinTool reste disponible gratuitement séparément ;
* le prix ne dépend pas de la présence de WinTool ;
* le paiement correspond réellement à d'autres produits ou services.

Une personne ne doit pas pouvoir augmenter artificiellement le prix d'un produit uniquement en y ajoutant WinTool.

---

# 23. Publicité

La redistribution de WinTool sur un site comportant des publicités peut rester autorisée tant que WinTool lui-même n'est pas vendu ou monétisé directement.

Exemples :

* site de téléchargement financé par la publicité : autorisé ;
* vidéo YouTube présentant WinTool et monétisée par YouTube : autorisé ;
* article avec publicité expliquant comment utiliser WinTool : autorisé.

En revanche :

* faire payer l'accès à WinTool ;
* faire payer une version de WinTool ;
* vendre WinTool sous forme d'abonnement ;

sont interdits.

---

# 24. Donations

Les dons spécifiquement demandés ou collectés en échange de l'accès à WinTool sont interdits.

Les donations générales destinées au développeur ou au financement général du projet devront être définies précisément dans la licence finale.

Ne pas supposer automatiquement qu'une donation est ou n'est pas un revenu directement généré par WinTool : la licence doit définir ce cas explicitement.

---

# 25. Modification de la licence

Une personne ne doit pas pouvoir redistribuer une version modifiée de WinTool en supprimant ou remplaçant les mentions de licence applicables à WinTool.

Les mentions de copyright et les conditions de licence doivent être conservées conformément aux exigences de la licence.

---

# 26. Définitions à inclure dans la licence

La licence finale devrait définir explicitement au minimum :

* **WinTool**
* **Logiciel**
* **Code source**
* **Version officielle**
* **Version modifiée**
* **Fork**
* **Script**
* **Script tiers**
* **Source de scripts**
* **Source officielle**
* **Redistribution**
* **Commercialisation**
* **Revenu direct**
* **Télémétrie**
* **Données utilisateur**
* **Service**

Ces définitions doivent éviter autant que possible les ambiguïtés.

---

# 27. Intention générale

L'intention générale de la licence est :

> WinTool doit rester un logiciel gratuit, accessible et modifiable. Le code source doit être disponible et les forks doivent être permis. Les utilisateurs, y compris les entreprises, peuvent utiliser WinTool librement. Personne ne doit cependant pouvoir transformer WinTool lui-même en produit payant ou générer directement des revenus en vendant, louant, faisant payer l'accès ou monétisant directement WinTool.

La licence doit donc trouver un équilibre entre :

**Liberté d'utilisation et de modification**

et

**interdiction de commercialiser WinTool lui-même.**

Elle ne doit pas chercher à contrôler les logiciels, scripts, services ou activités indépendants qui utilisent WinTool comme simple outil.

---

# 28. Points à traiter juridiquement

Avant de considérer le texte comme définitif, vérifier notamment :

1. La compatibilité de la licence avec le droit applicable.
2. La portée réelle d'une interdiction de commercialisation.
3. La définition juridiquement exploitable de « revenu directement généré ».
4. Les limitations de responsabilité.
5. Les droits sur le nom et le logo.
6. La séparation juridique entre WinTool et les scripts tiers.
7. Le traitement des contributions de code faites par des tiers.
8. Le traitement des dépendances et bibliothèques tierces utilisées par WinTool.
9. Le traitement des contributions provenant de code généré ou assisté par IA.
10. Les règles applicables aux utilisateurs professionnels et entreprises.
11. La validité des restrictions concernant les forks et versions modifiées.
12. La compatibilité entre les restrictions souhaitées et les droits accordés par le droit d'auteur.

## Instruction pour la rédaction finale

À partir de ce cahier des charges, rédiger une licence complète destinée au fichier `LICENSE` du dépôt GitHub de **WinTool**.

Ne pas supposer qu'une licence existante (MIT, GPL, Apache, CC, etc.) correspond aux besoins.

La licence doit être juridiquement aussi claire que possible, sans ambiguïtés inutiles, et doit distinguer explicitement WinTool, les scripts et les sources de scripts.

Lorsque deux exigences semblent contradictoires, privilégier l'intention explicitement définie dans ce document et signaler le conflit avant de choisir arbitrairement une formulation.
