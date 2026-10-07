# Modifier la présentation de WinTool

La présentation — les pages qui s'ouvrent au premier démarrage, et que l'on revoit depuis
**Réglages → Général → Présentation de WinTool** — lit tout son contenu dans
[`src/presentation.json`](../src/presentation.json). Titres, phrases, icônes, illustrations,
ordre et nombre de pages : tout se change dans ce fichier, sans toucher au code.

## Le circuit

1. Modifier `src/presentation.json`.
2. Vérifier : `node tools/verifier-presentation.mjs`. Il dit ce qui ne va pas, et où
   (`pages[2] (actions).essentiel[1] : texte « en » vide`). La CI le lance aussi : une
   erreur bloque la construction plutôt que d'afficher une page blanche.
3. Regarder le résultat dans le banc d'essai, page `http://localhost:8123/?onboarding`
   (voir `tools/bench/serve.mjs`), ou dans l'application.

Le fichier est **embarqué dans l'exécutable** : modifié après l'installation, il serait
ignoré. C'est voulu. Un fichier modifiable sur le disque laisserait un programme malveillant
faire dire à WinTool, dans une page de confiance, « désactivez votre antivirus ».

## Le fichier

```json
{
  "format": 1,
  "pages": [ … ]
}
```

`format` vaut 1. Les pages s'affichent dans l'ordre de la liste.

### Les textes

Tout texte existe dans les deux langues :

```json
{ "fr": "Le mode Simple : un bouton, et c’est fait.", "en": "Simple mode: one button, and it’s done." }
```

Les apostrophes typographiques (’) et les guillemets français (« ») passent tels quels.

### La page de bienvenue

Facultative ; si elle existe, c'est la première. C'est elle qui fait choisir la langue et
l'apparence. Relancée depuis les Réglages, la présentation commence après elle.

```json
{
  "id": "bienvenue",
  "type": "bienvenue",
  "titre": { "fr": "…", "en": "…" },
  "texte": { "fr": "…", "en": "…" }
}
```

### Une page ordinaire

```json
{
  "id": "securite",
  "illustration": "securite",
  "titre": { "fr": "Votre sécurité d’abord", "en": "Your safety first" },
  "essentiel": [
    { "icone": "eye", "texte": { "fr": "…", "en": "…" } }
  ],
  "detail": [
    { "fr": "Un paragraphe, replié derrière « En savoir plus ».", "en": "…" }
  ]
}
```

| Champ | Rôle |
|---|---|
| `id` | nom court, unique : minuscules, chiffres, tirets |
| `titre` | le titre de la page |
| `illustration` | `principe`, `catalogue`, `securite` (les trois illustrations animées), `icone`, ou `aucune` |
| `icone` | avec `"illustration": "icone"` : une grande icône à la place d'une illustration |
| `essentiel` | ce qui se voit d'emblée : **cinq phrases au plus**, une icône chacune |
| `detail` | les paragraphes repliés derrière « En savoir plus » (facultatif) |
| `action` | facultatif : un bouton sur la page (voir plus bas) |

Les icônes sont celles de [Lucide](https://lucide.dev/icons) : on écrit leur nom tel que le
site l'affiche (`shield-check`, `mouse-pointer-click`…). Le contrôleur refuse un nom inconnu.

**Lisible à 9 ans comme à 80** (spécification §13) : dans `essentiel`, une idée par phrase,
pas de terme technique. Le détail peut en dire plus, toujours sans jargon.

### Le bouton du catalogue

Une page peut proposer d'installer le catalogue officiel. Une fois installé, le bouton
laisse place à la phrase `installe`, où `{n}` est le nombre d'actions et `{s}` le pluriel.

```json
"action": {
  "type": "catalogue",
  "installer": { "fr": "Installer le catalogue officiel", "en": "Install the official catalogue" },
  "plus_tard": { "fr": "ou plus tard, depuis les Réglages", "en": "or later, from Settings" },
  "installe": { "fr": "Catalogue installé : {n} action{s} prête{s}.", "en": "Catalogue installed: {n} action{s} ready." }
}
```

## Ce qui reste dans le code

Les boutons de navigation (« Suivant », « Retour », « Passer la présentation »…), les libellés
« Langue » et « Apparence » de la page de bienvenue, et le contenu des trois illustrations
animées. Les boutons sont dans `src/i18n.js` (clés `onb.*`) ; une nouvelle illustration
animée demande du code (`illustrationVisite` dans `src/main.js`, styles dans
`src/styles.css`).
