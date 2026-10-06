// Derive le modele NSIS de Tauri pour l'installeur de WinTool.
//
// Tauri n'offre que des crochets (installeur/crochets.nsh) inseres dans des
// sections : pas de quoi remplacer une page. Or WinTool a besoin de deux
// changements que les crochets ne permettent pas :
//
// 1. Sa propre page de desinstallation — garder ses donnees, tout effacer
//    sauf ses scripts, ou choisir precisement (specification 12.4) — a la
//    place de la page de confirmation de Tauri et de sa case unique.
// 2. Un effacement SUR des donnees de l'interface. Le modele de Tauri efface
//    %LOCALAPPDATA%\<identifiant> avec `RmDir /r`, en administrateur. Verifie :
//    `RmDir /r` de NSIS suit les jonctions. Un programme sans droits qui y
//    glisse une jonction vers System32 la ferait vider par le desinstalleur.
//
// Plutot que de recopier tout le modele (et de manquer ses corrections
// futures), cet outil le relit dans la CLI de Tauri installee et n'y remplace
// que ces deux passages. Chaque repere doit apparaitre exactement une fois :
// si une version de Tauri change le modele, la construction s'arrete ici, avec
// un message, plutot que de produire un desinstalleur bancal.
//
// Usage : node tools/modele-installeur.mjs   (fait par `npm run build`)
// Produit src-tauri/installeur/installer.nsi (non versionne).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const racine = new URL('..', import.meta.url);
const depot = new URL('.', racine).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function echec(message) {
  console.log(`::error title=Modele de l'installeur::${message}`);
  process.exit(1);
}

// --- La CLI de Tauri, et le modele qu'elle embarque ------------------------
const dossierTauri = join(depot, 'node_modules', '@tauri-apps');
const cli = readdirSync(dossierTauri).find((d) => d.startsWith('cli-win32-'));
if (!cli) echec('CLI Tauri pour Windows introuvable dans node_modules (npm ci ?)');
const binaire = readdirSync(join(dossierTauri, cli)).find((f) => f.endsWith('.node'));
if (!binaire) echec(`aucun binaire .node dans ${cli}`);
const version = JSON.parse(readFileSync(join(dossierTauri, 'cli', 'package.json'), 'utf8')).version;

const octets = readFileSync(join(dossierTauri, cli, binaire));
// Fins de ligne Windows ou Unix selon la facon dont la CLI a ete construite.
let debut = octets.indexOf(Buffer.from('Unicode true\r\nManifestDPIAware true'));
if (debut < 0) debut = octets.indexOf(Buffer.from('Unicode true\nManifestDPIAware true'));
if (debut < 0) echec(`modele NSIS introuvable dans la CLI ${version}`);
// Le modele est du texte ASCII : il s'arrete au premier octet qui n'en est pas.
let fin = debut;
while (fin < octets.length) {
  const o = octets[fin];
  if (!(o === 9 || o === 10 || o === 13 || (o >= 32 && o <= 126))) break;
  fin++;
}
let modele = octets.subarray(debut, fin).toString('ascii').replace(/\r\n/g, '\n');
modele = modele.slice(0, modele.lastIndexOf('FunctionEnd') + 'FunctionEnd'.length) + '\n';
if (!modele.includes('Section Uninstall') || !modele.includes('{{#if installer_hooks}}')) {
  echec(`modele NSIS de la CLI ${version} incomplet ou meconnaissable`);
}

// --- Les deux remplacements -------------------------------------------------
function remplacer(nom, avant, apres) {
  const n = modele.split(avant).length - 1;
  if (n !== 1) {
    echec(
      `repere « ${nom} » trouve ${n} fois dans le modele de la CLI ${version}. ` +
        'Tauri a change son modele : adapter tools/modele-installeur.mjs.',
    );
  }
  modele = modele.replace(avant, apres);
}

// 1. La page de confirmation de Tauri (et sa case) laisse place a celle de
//    WinTool, definie dans crochets.nsh. $DeleteAppDataCheckboxState reste
//    declaree : la section de desinstallation de Tauri la lit, et la page de
//    WinTool la positionne.
const debutPage = modele.indexOf('; 1. Confirm uninstall page');
const repereFin = '!insertmacro MUI_UNPAGE_CONFIRM\n';
const finPage = modele.indexOf(repereFin, debutPage);
if (debutPage < 0 || finPage < 0) {
  echec(`page de confirmation introuvable dans le modele de la CLI ${version}`);
}
remplacer(
  'page de confirmation',
  modele.slice(debutPage, finPage + repereFin.length),
  '; 1. Page de desinstallation de WinTool (installeur/crochets.nsh)\n' +
    'Var DeleteAppDataCheckboxState\n' +
    '!insertmacro WINTOOL_PAGE_DESINSTALLATION\n',
);

// 2. Effacement des donnees de l'interface sans suivre les jonctions.
remplacer(
  'effacement des donnees de l interface',
  '    RmDir /r "$APPDATA\\${BUNDLEID}"\n    RmDir /r "$LOCALAPPDATA\\${BUNDLEID}"\n',
  '    !insertmacro WINTOOL_EFFACER_ARBRE "$APPDATA\\${BUNDLEID}"\n' +
    '    !insertmacro WINTOOL_EFFACER_ARBRE "$LOCALAPPDATA\\${BUNDLEID}"\n',
);

// Plus aucune suppression recursive ne doit subsister.
if (/rmdir\s+(\/rebootok\s+)?\/r\b/i.test(modele)) {
  echec('une suppression recursive subsiste dans le modele derive');
}

const entete =
  `; GENERE par tools/modele-installeur.mjs depuis le modele de la CLI Tauri ${version}.\n` +
  '; Ne pas modifier : relancer l outil (npm run build le fait).\n';
const sortie = join(depot, 'src-tauri', 'installeur', 'installer.nsi');
writeFileSync(sortie, (entete + modele).replace(/\n/g, '\r\n'), 'utf8');
console.log(`Modele de l'installeur derive de la CLI Tauri ${version} : ${sortie}`);
