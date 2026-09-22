/**
 * WinTool - amorce de l'interface.
 *
 * Modules ES natifs, aucun bundler : Tauri sert src/ en fichiers statiques.
 * C'est volontaire et coherent avec le principe du projet - on depose un
 * fichier, ca marche, sans etape de build.
 */

const invoke = window.__TAURI__.core.invoke;
const laFenetre = window.__TAURI__.window.getCurrentWindow();
const ouvrir = window.__TAURI__.opener?.openPath;

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
    const hote = document.createElement('div');
    hote.style.display = 'none';
    hote.innerHTML = await reponse.text();
    document.body.prepend(hote);
  } catch (e) {
    // Une icone manquante ne doit jamais empecher l'application de demarrer.
    console.warn("Sprite d'icones indisponible :", e.message);
  }
}

/** Cache des icones chargees a la demande, pour ne les lire qu'une fois. */
const cacheIcones = new Map();

async function iconeSVG(nom) {
  if (!nom) return '';
  if (cacheIcones.has(nom)) return cacheIcones.get(nom);
  try {
    const reponse = await fetch(`icons/${nom}.svg`);
    if (!reponse.ok) throw new Error(`icone inconnue : ${nom}`);
    const texte = await reponse.text();
    cacheIcones.set(nom, texte);
    return texte;
  } catch {
    cacheIcones.set(nom, '');
    return '';
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
  if (valeur === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = valeur;
  try {
    localStorage.setItem(CLE_THEME, valeur);
  } catch {
    // Mode prive ou stockage bloque : le theme ne sera pas retenu, rien de plus.
  }
}

function restaurerTheme() {
  let v = 'system';
  try {
    v = localStorage.getItem(CLE_THEME) || 'system';
  } catch { /* ignore */ }
  if (v !== 'system') document.documentElement.dataset.theme = v;
}

/* -------------------------------------------------------------------------
   Rendu des scripts decouverts
   ------------------------------------------------------------------------- */

const ECHAPPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ECHAPPE[c]);

const LIBELLE_RISQUE = { low: 'Risque faible', medium: 'Risque moyen', high: 'Risque élevé' };
const CLASSE_RISQUE = { low: 'low', medium: 'med', high: 'high' };
const LIBELLE_DUREE = { fast: 'Rapide', medium: 'Moyen', slow: 'Lent' };

/** Libelle affiche pour une option, traduit si la langue le permet. */
function libelleOption(entree, opt, langue) {
  const tr = entree.meta.translations?.[langue];
  const t = tr?.options?.[opt.key];
  if (t && t[0]) return { label: t[0], desc: t[1] || '' };
  return { label: opt.label, desc: opt.desc };
}

function rendreChoix(opt) {
  if (!opt.choices?.length) return '';
  const defaut = opt.default;
  const actifs = Array.isArray(defaut) ? defaut : [defaut];
  const puces = opt.choices
    .map((c) => {
      const on = actifs.includes(c.value) ? ' on' : '';
      return `<span class="chip${on}" title="${esc(c.label)}">${esc(c.value)}</span>`;
    })
    .join('');
  return `<div class="opt-choices">${puces}</div>`;
}

function rendreOption(entree, opt, langue) {
  const { label, desc } = libelleOption(entree, opt, langue);
  const marqueur = opt.hidden ? ' <span class="chip">expert</span>' : '';
  return `
    <div class="opt">
      <div class="opt-key">${esc(opt.key)} · ${esc(opt.kind)}${marqueur}</div>
      <div class="opt-label">${esc(label)}</div>
      ${desc ? `<div class="opt-desc">${esc(desc)}</div>` : ''}
      ${rendreChoix(opt)}
    </div>`;
}

function rendreAnomalies(meta) {
  if (!meta.findings?.length) return '';
  const lignes = meta.findings
    .map(
      (f) => `
      <div class="finding ${esc(f.severity)}">
        <span class="ln">ligne ${f.line}</span>
        <span class="code">${esc(f.code)}</span>
        <span class="msg">${esc(f.message)}</span>
      </div>`
    )
    .join('');
  return `<div class="findings">${lignes}</div>`;
}

async function rendreCarte(entree, langue) {
  const m = entree.meta;
  const tr = m.translations?.[langue];
  const titre = tr?.title || m.title || entree.path;
  const desc = tr?.desc || m.desc || '';

  const icone = (await iconeSVG(m.icon)) || '';

  const badges = [
    m.risk ? `<span class="badge ${CLASSE_RISQUE[m.risk] || ''}">${esc(LIBELLE_RISQUE[m.risk] || m.risk)}</span>` : '',
    m.duration ? `<span class="badge">${esc(LIBELLE_DUREE[m.duration] || m.duration)}</span>` : '',
    m.reversible ? '<span class="badge acc">Réversible</span>' : '',
    m.reboot ? '<span class="badge med">Redémarrage</span>' : '',
    m.interruptible ? '' : '<span class="badge med">Non interruptible</span>',
    m.admin ? '<span class="badge">Admin requis</span>' : '',
    entree.declared_id ? '' : '<span class="badge med">Sans id</span>',
  ]
    .filter(Boolean)
    .join('');

  const options = m.options?.length
    ? `<div class="opts">${m.options.map((o) => rendreOption(entree, o, langue)).join('')}</div>`
    : '';

  return `
    <article class="card">
      <div class="card-top">
        <div class="card-icon">${icone}</div>
        <div style="flex:1;min-width:0">
          <div class="card-title">${esc(titre)}</div>
          ${desc ? `<div class="card-desc">${esc(desc)}</div>` : ''}
          <div class="card-path">${esc(entree.path)} · ${esc(m.version || '?')} · ${esc(entree.hash.slice(0, 12))}…</div>
        </div>
      </div>
      <div class="badges">${badges}</div>
      ${options}
      ${rendreAnomalies(m)}
    </article>`;
}

async function chargerScripts() {
  const liste = document.getElementById('list');
  const soucis = document.getElementById('problems');
  liste.innerHTML = '<div class="empty">Analyse en cours…</div>';
  soucis.innerHTML = '';

  try {
    const resultat = await invoke('list_scripts');
    document.getElementById('rootPath').textContent = resultat.root;

    if (resultat.problems?.length) {
      soucis.innerHTML = resultat.problems
        .map((p) => `<div class="finding error"><span class="code">DOSSIER</span><span class="msg">${esc(p)}</span></div>`)
        .join('');
    }

    if (!resultat.scripts.length) {
      liste.innerHTML = '<div class="empty">Aucun script trouvé. Déposez un .ps1 dans le dossier ci-dessus.</div>';
      return;
    }

    const langue = 'fr';
    const cartes = await Promise.all(resultat.scripts.map((s) => rendreCarte(s, langue)));
    liste.innerHTML = cartes.join('');
  } catch (e) {
    liste.innerHTML = `<div class="empty">La découverte a échoué : ${esc(e)}</div>`;
    console.error(e);
  }
}

/* -------------------------------------------------------------------------
   Cablage
   ------------------------------------------------------------------------- */
function cablerFenetre() {
  document.getElementById('btnMin').onclick = () => laFenetre.minimize();
  document.getElementById('btnMax').onclick = () => laFenetre.toggleMaximize();
  document.getElementById('btnClose').onclick = () => laFenetre.close();
  document.getElementById('themeBtn').onclick = () =>
    appliquerTheme(themeEffectif() === 'dark' ? 'light' : 'dark');
  document.getElementById('btnReload').onclick = () => chargerScripts();
  document.getElementById('btnFolder').onclick = async () => {
    try {
      const racine = await invoke('scripts_root');
      if (ouvrir) await ouvrir(racine);
    } catch (e) {
      console.error("Ouverture du dossier impossible :", e);
    }
  };
}

/**
 * Obligation de la specification 15.3 : l'eau se met en pause quand la fenetre
 * passe en arriere-plan. Une animation permanente sollicite le processeur
 * graphique pour rien sur un outil qu'on laisse parfois ouvert longtemps.
 */
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

async function demarrer() {
  restaurerTheme();
  await injecterSprite();
  cablerFenetre();
  await cablerPauseAnimation();

  try {
    const infos = await invoke('app_info');
    document.getElementById('version').textContent = infos.version;
    if (infos.elevated) document.getElementById('adminPill').hidden = false;
  } catch (e) {
    console.error('app_info a echoue :', e);
    document.getElementById('version').textContent = '?';
  }

  await chargerScripts();

  // La fenetre est creee invisible pour eviter un flash blanc avant la peinture.
  await laFenetre.show();
}

demarrer();
