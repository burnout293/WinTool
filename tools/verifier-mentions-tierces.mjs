// Chaque bibliotheque compilee dans WinTool figure dans THIRD-PARTY-NOTICES.md.
//
// Entre la 1.1 et la 1.2, 46 composants arrives avec la mise a jour automatique
// manquaient a ce document — dont plusieurs (ring, rustls-webpki, untrusted,
// subtle, sync_wrapper) qui imposent de reproduire des avis. Rien ne le
// signalait : une convention que rien ne verifie finit toujours morte.
//
// Compare l'arbre reel (la meme commande que la section 2 du document) aux
// composants qu'il cite, et le total de son tableau de la section 3 a la taille
// de l'arbre.
//
// Usage : node tools/verifier-mentions-tierces.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const racine = new URL('..', import.meta.url);
// Sans --no-dedupe, contrairement a la section 2 : la sortie complete depasse
// plusieurs mega-octets, et pour un ENSEMBLE de composants la sortie dedupliquee
// suffit — chacun y apparait au moins une fois.
const sortie = execFileSync(
  'cargo',
  ['tree', '--edges', 'normal', '--target', 'x86_64-pc-windows-msvc', '--prefix', 'none'],
  { cwd: new URL('src-tauri/', racine), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 },
);

// « nom v1.2.3+meta (chemin) (*) » -> « nom 1.2.3 ». La metadonnee de build
// (+spec-1.1.0) ne fait pas partie de la version citee.
const arbre = new Set();
for (const ligne of sortie.split(/\r?\n/)) {
  const m = /^(\S+) v(\d+\.\d+\.\d+)/.exec(ligne.trim());
  if (m && m[1] !== 'wintool') arbre.add(`${m[1]} ${m[2]}`);
}

const doc = readFileSync(new URL('THIRD-PARTY-NOTICES.md', racine), 'utf8');
const cites = new Set();
for (const m of doc.matchAll(/`([A-Za-z0-9_-]+)` (\d+\.\d+\.\d+)/g)) cites.add(`${m[1]} ${m[2]}`);
for (const m of doc.matchAll(/\| `([A-Za-z0-9_-]+)` \| (\d+\.\d+\.\d+)(?: et (\d+\.\d+\.\d+))? \|/g)) {
  cites.add(`${m[1]} ${m[2]}`);
  if (m[3]) cites.add(`${m[1]} ${m[3]}`);
}

let echecs = 0;
for (const c of [...arbre].sort()) {
  if (!cites.has(c)) {
    console.log(`::error title=Composant non mentionne::${c} est compile dans WinTool mais absent de THIRD-PARTY-NOTICES.md`);
    echecs++;
  }
}

const total = /\| \*\*Total\*\* \| \*\*(\d+)\*\* \|/.exec(doc);
if (!total || Number(total[1]) !== arbre.size) {
  console.log(
    `::error title=Total perime::le tableau de la section 3 annonce ${total ? total[1] : '?'} composants, l'arbre en compte ${arbre.size}`,
  );
  echecs++;
}

if (echecs) process.exit(1);
console.log(`${arbre.size} composants, tous mentionnes ; total du tableau conforme.`);
