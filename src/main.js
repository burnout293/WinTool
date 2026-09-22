/**
 * WinTool - amorce de l'interface.
 *
 * Modules ES natifs, aucun bundler : Tauri sert src/ en fichiers statiques.
 * C'est volontaire et coherent avec le principe du projet - on depose un
 * fichier, ca marche, sans etape de build.
 */

const invoke = window.__TAURI__.core.invoke;
const laFenetre = window.__TAURI__.window.getCurrentWindow();

/* -------------------------------------------------------------------------
   Icones
   Le sprite est injecte dans le document plutot que reference par
   <use href="icons.svg#x">. Les references <use> vers un fichier externe sont
   inegalement supportees selon les moteurs ; une fois le sprite dans le DOM,
   les references internes fonctionnent partout.
   ------------------------------------------------------------------------- */
async function injecterSprite() {
  try {
    const reponse = await fetch('icons.svg');
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    const texte = await reponse.text();
    const hote = document.createElement('div');
    hote.style.display = 'none';
    hote.innerHTML = texte;
    document.body.prepend(hote);
  } catch (e) {
    // Une icone manquante ne doit jamais empecher l'application de demarrer.
    console.warn('Sprite d icones indisponible :', e.message);
  }
}

/** Charge une icone Lucide a la demande et l'insere dans un element. */
export async function poserIcone(element, nom, classes = 'ico') {
  try {
    const reponse = await fetch(`icons/${nom}.svg`);
    if (!reponse.ok) throw new Error(`icone inconnue : ${nom}`);
    const texte = await reponse.text();
    element.innerHTML = texte.replace('<svg', `<svg class="${classes}"`);
  } catch (e) {
    console.warn(e.message);
  }
}

/* -------------------------------------------------------------------------
   Theme
   Aucun attribut data-theme = on suit le reglage de Windows. La bascule
   manuelle pose l'attribut et l'emporte alors dans les deux sens.
   ------------------------------------------------------------------------- */
const CLE_THEME = 'wintool.theme';

function themeEffectif() {
  const choisi = document.documentElement.dataset.theme;
  if (choisi) return choisi;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function appliquerTheme(valeur) {
  if (valeur === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = valeur;
  }
  try {
    localStorage.setItem(CLE_THEME, valeur);
  } catch {
    // Mode prive ou stockage bloque : le theme ne sera pas retenu, rien de plus.
  }
  majFaits();
}

function restaurerTheme() {
  let v = 'system';
  try {
    v = localStorage.getItem(CLE_THEME) || 'system';
  } catch { /* ignore */ }
  if (v !== 'system') document.documentElement.dataset.theme = v;
}

/* -------------------------------------------------------------------------
   Commandes de fenetre
   La decoration native est desactivee : c'est nous qui fournissons reduire,
   agrandir et fermer.
   ------------------------------------------------------------------------- */
function cablerFenetre() {
  document.getElementById('btnMin').onclick = () => laFenetre.minimize();
  document.getElementById('btnMax').onclick = () => laFenetre.toggleMaximize();
  document.getElementById('btnClose').onclick = () => laFenetre.close();

  document.getElementById('themeBtn').onclick = () => {
    appliquerTheme(themeEffectif() === 'dark' ? 'light' : 'dark');
  };
}

/* -------------------------------------------------------------------------
   Animation
   Obligation de la specification 15.3 : l'eau se met en pause quand la fenetre
   passe en arriere-plan. Une animation permanente sollicite le processeur
   graphique pour rien sur un outil qu'on laisse parfois ouvert longtemps.
   ------------------------------------------------------------------------- */
async function cablerPauseAnimation() {
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('inactive', document.hidden);
  });
  try {
    await laFenetre.onFocusChanged(({ payload: focus }) => {
      document.body.classList.toggle('inactive', !focus);
    });
  } catch (e) {
    console.warn('Suivi du focus indisponible :', e.message);
  }
}

/* ------------------------------------------------------------------------- */

let infos = { version: '?', elevated: false };

function majFaits() {
  const t = themeEffectif();
  const suffixe = document.documentElement.dataset.theme ? 'manuel' : 'Windows';
  document.getElementById('factVersion').textContent = `version ${infos.version}`;
  document.getElementById('factElevation').textContent =
    infos.elevated ? 'élévation administrateur active' : 'élévation absente';
  document.getElementById('factTheme').textContent = `thème ${t === 'dark' ? 'sombre' : 'clair'} (${suffixe})`;
}

async function demarrer() {
  restaurerTheme();
  await injecterSprite();
  cablerFenetre();
  await cablerPauseAnimation();

  try {
    infos = await invoke('app_info');
    document.getElementById('version').textContent = infos.version;
    if (infos.elevated) document.getElementById('adminPill').hidden = false;
  } catch (e) {
    console.error('app_info a echoue :', e);
    document.getElementById('version').textContent = '?';
  }

  majFaits();

  // La fenetre est creee invisible pour eviter un flash blanc avant la peinture.
  await laFenetre.show();
}

demarrer();
