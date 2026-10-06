// Chaque cle de l'interface existe en francais ET en anglais.
//
// t() se replie sur le francais quand une cle manque en anglais : l'oubli ne
// casse rien, il ne se voit donc pas — un utilisateur anglophone lit du
// francais, et personne ne le remarque. Cinq cles etaient dans ce cas avant la
// 1.2. Une convention que rien ne verifie finit toujours morte.
//
// Usage : node tools/verifier-traductions.mjs

import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');
const coupure = source.search(/\ben\s*:\s*\{/);
if (coupure < 0) {
  console.log('::error title=Traductions::bloc anglais introuvable dans src/i18n.js');
  process.exit(1);
}

const cles = [...source.matchAll(/^\s+'([a-z_.0-9]+)':/gm)];
const fr = new Set(cles.filter((m) => m.index < coupure).map((m) => m[1]));
const en = new Set(cles.filter((m) => m.index > coupure).map((m) => m[1]));

const sansAnglais = [...fr].filter((k) => !en.has(k));
const sansFrancais = [...en].filter((k) => !fr.has(k));
for (const k of sansAnglais) console.log(`::error title=Traduction manquante::'${k}' n'existe qu'en francais`);
for (const k of sansFrancais) console.log(`::error title=Traduction manquante::'${k}' n'existe qu'en anglais`);

if (sansAnglais.length || sansFrancais.length) process.exit(1);
console.log(`${fr.size} cles, presentes dans les deux langues.`);
