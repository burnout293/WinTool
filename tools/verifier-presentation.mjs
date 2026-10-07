// Verifie src/presentation.json, le contenu de la presentation (specification
// §13, docs/PRESENTATION.md).
//
// Ce fichier est fait pour etre modifie a la main. Une faute de frappe ne doit
// pas finir en page blanche devant un utilisateur : chaque regle ci-dessous
// echoue ici, en CI, avec un message qui dit quoi corriger et ou.
//
// Usage : node tools/verifier-presentation.mjs

import { existsSync, readFileSync } from 'node:fs';

const racine = new URL('..', import.meta.url);
const LANGUES = ['fr', 'en'];
const ILLUSTRATIONS = ['principe', 'catalogue', 'securite', 'icone', 'aucune'];
const ACTIONS = ['catalogue'];
const erreurs = [];
const err = (ou, message) => erreurs.push(`${ou} : ${message}`);

let doc;
try {
  doc = JSON.parse(readFileSync(new URL('src/presentation.json', racine), 'utf8'));
} catch (e) {
  console.log(`::error title=Presentation::src/presentation.json illisible : ${e.message}`);
  process.exit(1);
}

// Une icone est valable si Lucide la connait : le fichier existe dans le
// paquet installe par `npm ci`.
const iconeConnue = (nom) =>
  typeof nom === 'string' &&
  /^[a-z0-9-]+$/.test(nom) &&
  existsSync(new URL(`node_modules/lucide-static/icons/${nom}.svg`, racine));

function texte(ou, valeur, { vide = false } = {}) {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) {
    return err(ou, `attendu un objet { "fr": "…", "en": "…" }`);
  }
  for (const l of LANGUES) {
    if (typeof valeur[l] !== 'string') err(ou, `texte « ${l} » manquant`);
    else if (!vide && !valeur[l].trim()) err(ou, `texte « ${l} » vide`);
  }
  for (const l of Object.keys(valeur)) {
    if (!LANGUES.includes(l)) err(ou, `langue « ${l} » inconnue (attendu : ${LANGUES.join(', ')})`);
  }
}

if (doc.format !== 1) err('format', `vaut ${JSON.stringify(doc.format)}, cette version de WinTool lit le format 1`);
if (!Array.isArray(doc.pages) || !doc.pages.length) err('pages', 'au moins une page est attendue');

const ids = new Set();
(doc.pages || []).forEach((page, i) => {
  const ou = `pages[${i}]${page?.id ? ` (${page.id})` : ''}`;
  if (!page || typeof page !== 'object') return err(ou, 'une page est un objet');
  if (typeof page.id !== 'string' || !/^[a-z0-9-]+$/.test(page.id)) {
    err(ou, '« id » : minuscules, chiffres et tirets');
  } else if (ids.has(page.id)) {
    err(ou, `« id » deja utilise par une autre page`);
  }
  ids.add(page.id);
  texte(`${ou}.titre`, page.titre);

  if (page.type === 'bienvenue') {
    // La page qui fait choisir la langue et l'apparence : la premiere ou rien.
    if (i !== 0) err(ou, 'une page « bienvenue » ne peut etre que la premiere');
    texte(`${ou}.texte`, page.texte);
    return;
  }
  if (page.type !== undefined) err(ou, `type « ${page.type} » inconnu (seul « bienvenue » existe)`);

  const illustration = page.illustration ?? 'aucune';
  if (!ILLUSTRATIONS.includes(illustration)) {
    err(ou, `illustration « ${illustration} » inconnue (attendu : ${ILLUSTRATIONS.join(', ')})`);
  }
  if (illustration === 'icone' && !iconeConnue(page.icone)) {
    err(ou, `« icone » : « ${page.icone} » n'est pas une icone Lucide (https://lucide.dev/icons)`);
  }

  const essentiel = page.essentiel ?? [];
  if (!Array.isArray(essentiel)) err(`${ou}.essentiel`, 'attendu une liste');
  else {
    // Lisible a 9 ans comme a 80 : quelques phrases, pas un pave.
    if (essentiel.length > 5) err(`${ou}.essentiel`, `${essentiel.length} phrases, 5 au plus`);
    essentiel.forEach((e, k) => {
      if (!iconeConnue(e?.icone)) err(`${ou}.essentiel[${k}]`, `« icone » : « ${e?.icone} » n'est pas une icone Lucide`);
      texte(`${ou}.essentiel[${k}].texte`, e?.texte);
    });
  }

  const detail = page.detail ?? [];
  if (!Array.isArray(detail)) err(`${ou}.detail`, 'attendu une liste de paragraphes');
  else detail.forEach((d, k) => texte(`${ou}.detail[${k}]`, d));

  if (page.action !== undefined) {
    const a = page.action;
    if (!ACTIONS.includes(a?.type)) err(`${ou}.action`, `type « ${a?.type} » inconnu (attendu : ${ACTIONS.join(', ')})`);
    else for (const k of ['installer', 'plus_tard', 'installe']) texte(`${ou}.action.${k}`, a[k]);
  }
});

for (const e of erreurs) console.log(`::error title=Presentation::${e}`);
if (erreurs.length) process.exit(1);
console.log(`Presentation : ${doc.pages.length} pages, conformes.`);
