/**
 * Synchronise les icones Lucide depuis node_modules vers src/.
 *
 *   node tools/sync-icons.mjs
 *
 * Produit deux choses :
 *
 *   src/icons/<nom>.svg   les 2112 icones, copiees telles quelles. Elles sont
 *                         chargees a la demande : seules celles reellement
 *                         affichees entrent en memoire. Aucune requete reseau -
 *                         WinTool sert justement quand la machine va mal.
 *
 *   src/icons.svg         un sprite des icones du chrome de l'application,
 *                         injecte dans le document au demarrage. On evite ainsi
 *                         les references <use> vers un fichier externe, dont le
 *                         support varie selon les moteurs de rendu.
 *
 * Les SVG Lucide sont en stroke="currentColor" : une icone herite de la couleur
 * du texte au lieu d'en porter une. C'est ce qui permet a la meme icone d'etre
 * sombre sur l'aplat accent, claire en theme sombre et neutre au repos, sans
 * jeu d'icones en double. Voir SPECIFICATION.md section 15.5.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(racine, 'node_modules', 'lucide-static', 'icons');
const destDossier = join(racine, 'src', 'icons');
const destSprite = join(racine, 'src', 'icons.svg');

/** Icones du chrome : barre de titre, boutons, etats. Mises dans le sprite. */
const SPRITE = {
  logo: 'waves',
  shield: 'shield',
  sun: 'sun',
  moon: 'moon',
  search: 'search',
  settings: 'settings',
  play: 'play',
  check: 'check',
  clock: 'clock',
  download: 'download',
  'file-text': 'file-text',
  warn: 'triangle-alert',
  'arrow-right': 'arrow-right',
  'arrow-left': 'arrow-left',
  chevron: 'chevron-down',
  plus: 'plus',
  pencil: 'pencil',
  pin: 'pin',
  trash: 'trash-2',
  folder: 'folder',
  x: 'x',
  // Bulle d'aide : sert partout ou un reglage a besoin d'etre explique sans
  // allonger son libelle (ex. la politique d'execution PowerShell).
  help: 'circle-help',
  // Reglages en page entiere : une icone par section (specification 8).
  'sec-general': 'sliders-horizontal',
  'sec-catalogue': 'package',
  'sec-execution': 'terminal',
  'sec-outils': 'wrench',
  'sec-config': 'save',
  'sec-histo': 'history',
  'chevron-right': 'chevron-right',
  // Plan du disque des emplacements proteges (specification 12.4).
  'shield-check': 'shield-check',
  'shield-off': 'shield-off',
  lock: 'lock',
  'hard-drive': 'hard-drive',
  monitor: 'monitor',
  package: 'package',
  database: 'database',
  users: 'users',
  user: 'user',
  'folder-lock': 'folder-lock',
  'folder-plus': 'folder-plus',
  // Ecran d'analyse (specification 17) : une icone par genre d'element trouve.
  file: 'file',
  globe: 'globe',
  power: 'power',
  'calendar-clock': 'calendar-clock',
  cpu: 'cpu',
  info: 'info',
  scan: 'scan-search',
};

if (!existsSync(source)) {
  console.error("[ERR]  lucide-static introuvable. Lancez d'abord : npm install");
  process.exit(1);
}

// --- 1. Copie integrale ------------------------------------------------------
rmSync(destDossier, { recursive: true, force: true });
mkdirSync(destDossier, { recursive: true });

const fichiers = readdirSync(source).filter((f) => f.endsWith('.svg'));
for (const f of fichiers) copyFileSync(join(source, f), join(destDossier, f));
console.log(`[OK]   ${fichiers.length} icones copiees vers src/icons/`);

// --- 2. Sprite du chrome -----------------------------------------------------
const symboles = [];
const manquantes = [];

for (const [id, nom] of Object.entries(SPRITE)) {
  const chemin = join(source, `${nom}.svg`);
  if (!existsSync(chemin)) {
    manquantes.push(`${id} -> ${nom}`);
    continue;
  }
  // On ne garde que le contenu du <svg>, sans ses attributs : le viewBox est
  // porte par le <symbol>, et la couleur vient de currentColor a l'usage.
  const brut = readFileSync(chemin, 'utf8');
  const interieur = brut.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  symboles.push(
    `  <symbol id="${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n` +
    interieur.split('\n').map((l) => '    ' + l.trim()).filter(Boolean).join('\n') +
    `\n  </symbol>`
  );
}

if (manquantes.length) {
  console.error(`[ERR]  Icones absentes de Lucide : ${manquantes.join(', ')}`);
  process.exit(1);
}

const sprite =
  `<!-- Genere par tools/sync-icons.mjs depuis lucide-static (ISC). Ne pas editer a la main. -->\n` +
  `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">\n` +
  symboles.join('\n') +
  `\n</svg>\n`;

writeFileSync(destSprite, sprite, 'utf8');
console.log(`[OK]   Sprite de ${symboles.length} icones ecrit dans src/icons.svg`);
// Index lisible par l'interface : la fenetre de choix d'icone a besoin de la
// liste complete, et une page ne peut pas parcourir un dossier.
const noms = readdirSync(destDossier).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
writeFileSync(join(destDossier, '_index.txt'), `${noms.join('\n')}\n`, 'utf8');
console.log(`[OK]   Index de ${noms.length} noms ecrit dans src/icons/_index.txt`);
console.log('[DONE] Icones synchronisees');
