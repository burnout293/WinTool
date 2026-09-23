/**
 * WinTool - amorce de l'interface.
 *
 * Modules ES natifs, aucun bundler : Tauri sert src/ en fichiers statiques.
 * C'est volontaire et coherent avec le principe du projet - on depose un
 * fichier, ca marche, sans etape de build.
 */

const invoke = window.__TAURI__.core.invoke;
const ecouter = window.__TAURI__.event.listen;
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

/**
 * Forme d'un nom Lucide : minuscules, chiffres et tirets simples.
 *
 * Le nom vient du fichier de script, donc d'une source non fiable, et le SVG
 * obtenu est insere tel quel dans la page. Sans ce filtre, un script pourrait
 * ecrire `icon : ../../autre-chose` et faire injecter dans l'interface un
 * fichier qui n'est pas une icone.
 */
const NOM_ICONE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function iconeSVG(nom) {
  if (!nom || !NOM_ICONE.test(nom)) return '';
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
   Etat
   ------------------------------------------------------------------------- */

const ECHAPPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ECHAPPE[c]);

const LIBELLE_RISQUE = { low: 'Risque faible', medium: 'Risque moyen', high: 'Risque élevé' };
const CLASSE_RISQUE = { low: 'low', medium: 'med', high: 'high' };
const LIBELLE_DUREE = { fast: 'Rapide', medium: 'Moyen', slow: 'Lent' };
const LANGUE = 'fr';

/** Scripts decouverts, indexes par id. */
const catalogue = new Map();
/** Interpreteurs presents sur la machine (specification 6.7). */
let moteurs = { winps: null, pwsh: null };
/** Execution en cours, ou null. Une seule a la fois (specification 6.6). */
let course = null;

/* -------------------------------------------------------------------------
   Rendu des scripts decouverts
   ------------------------------------------------------------------------- */

/** Libelle affiche pour une option, traduit si la langue le permet. */
function libelleOption(entree, opt) {
  const t = entree.meta.translations?.[LANGUE]?.options?.[opt.key];
  if (t && t[0]) return { label: t[0], desc: t[1] || '' };
  return { label: opt.label, desc: opt.desc };
}

/** Libelle affiche pour un choix, traduit si la langue le permet. */
function libelleChoix(entree, opt, choix) {
  const t = entree.meta.translations?.[LANGUE]?.choices?.[`${opt.key}/${choix.value}`];
  if (t && t[0]) return t[0];
  return choix.label || choix.value;
}

/**
 * Commande de saisie correspondant au type de l'option.
 * Chaque commande porte `data-opt` et `data-kind` : c'est ainsi que la valeur
 * est relue au lancement, sans avoir a maintenir un miroir de l'etat.
 */
function rendreCommande(entree, opt) {
  const k = opt.kind;
  const v = opt.default;

  if (k === 'bool' || k === 'hidden') {
    const on = v === true;
    return `<button class="switch" type="button" role="switch" data-opt="${esc(opt.key)}"
             data-kind="bool" aria-checked="${on}" aria-label="${esc(libelleOption(entree, opt).label)}"></button>`;
  }

  if (k === 'number') {
    return `<input type="number" data-opt="${esc(opt.key)}" data-kind="number"
             value="${esc(v ?? 0)}" />`;
  }

  if (k === 'select') {
    const options = opt.choices
      .map((c) => `<option value="${esc(c.value)}"${c.value === v ? ' selected' : ''}>${esc(libelleChoix(entree, opt, c))}</option>`)
      .join('');
    return `<select data-opt="${esc(opt.key)}" data-kind="select">${options}</select>`;
  }

  if (k === 'multi') {
    const actifs = Array.isArray(v) ? v : [];
    const puces = opt.choices
      .map((c) => {
        const on = actifs.includes(c.value);
        return `<button class="chip" type="button" data-value="${esc(c.value)}"
                 aria-pressed="${on}" title="${esc(c.desc || '')}">${esc(libelleChoix(entree, opt, c))}</button>`;
      })
      .join('');
    return `<div class="opt-choices" data-opt="${esc(opt.key)}" data-kind="multi">${puces}</div>`;
  }

  // string, et tout type inconnu : le texte libre ne perd aucune information.
  return `<input type="text" data-opt="${esc(opt.key)}" data-kind="string" value="${esc(v ?? '')}" />`;
}

function rendreOption(entree, opt) {
  const { label, desc } = libelleOption(entree, opt);
  const marqueur = opt.hidden ? ' <span class="chip">expert</span>' : '';
  const interrupteur = opt.kind === 'bool' || opt.kind === 'hidden';
  const commande = rendreCommande(entree, opt);

  return `
    <div class="opt editable">
      ${interrupteur ? commande : ''}
      <div class="opt-body">
        <div class="opt-key">${esc(opt.key)} · ${esc(opt.kind)}${marqueur}</div>
        <div class="opt-label">${esc(label)}</div>
        ${desc ? `<div class="opt-desc">${esc(desc)}</div>` : ''}
        ${interrupteur ? '' : commande}
      </div>
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

/**
 * Le script exige-t-il un interpreteur absent de cette machine ?
 * Verifie d'avance (specification 5.5) plutot qu'au moment du clic : mieux vaut
 * un bouton desactive avec sa raison qu'une erreur apres coup.
 */
function moteurManquant(meta) {
  const e = (meta.engine || 'auto').toLowerCase();
  if (e === 'pwsh' && !moteurs.pwsh) return 'PowerShell 7 n’est pas installé sur cette machine.';
  if (e === 'winps' && !moteurs.winps) return 'powershell.exe est introuvable.';
  if (!moteurs.pwsh && !moteurs.winps) return 'Aucun interpréteur PowerShell trouvé.';
  return null;
}

async function rendreCarte(entree) {
  const m = entree.meta;
  const tr = m.translations?.[LANGUE];
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
    // L'origine n'est pas decorative : un script livre vit dans le dossier
    // d'installation, que du code non eleve ne peut pas modifier. Un script
    // perso vit dans un dossier inscriptible, d'ou l'approbation.
    entree.origin === 'shipped'
      ? '<span class="badge acc">Livré</span>'
      : '<span class="badge">Perso</span>',
  ]
    .filter(Boolean)
    .join('');

  const options = m.options?.length
    ? `<div class="opts">${m.options.map((o) => rendreOption(entree, o)).join('')}</div>`
    : '';

  const manque = moteurManquant(m);

  return `
    <article class="card" data-id="${esc(entree.id)}">
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
      <div class="card-actions">
        <button class="btn primary" type="button" data-run="${esc(entree.id)}"
                ${manque ? 'disabled' : ''}>Lancer</button>
        ${manque ? `<span class="opt-desc">${esc(manque)}</span>` : ''}
      </div>
    </article>`;
}

async function chargerScripts() {
  const liste = document.getElementById('list');
  const soucis = document.getElementById('problems');
  liste.innerHTML = '<div class="empty">Analyse en cours…</div>';
  soucis.innerHTML = '';
  catalogue.clear();

  try {
    const resultat = await invoke('list_scripts');
    document.getElementById('rootPath').innerHTML =
      `Livrés : ${esc(resultat.shipped_root)} <span class="muted">(lecture seule)</span>` +
      `<br />Perso : ${esc(resultat.root)}`;

    if (resultat.problems?.length) {
      soucis.innerHTML = resultat.problems
        .map((p) => `<div class="finding error"><span class="code">DOSSIER</span><span class="msg">${esc(p)}</span></div>`)
        .join('');
    }

    if (!resultat.scripts.length) {
      liste.innerHTML = '<div class="empty">Aucun script trouvé. Déposez un .ps1 dans le dossier ci-dessus.</div>';
      return;
    }

    for (const s of resultat.scripts) catalogue.set(s.id, s);
    const cartes = await Promise.all(resultat.scripts.map((s) => rendreCarte(s)));
    liste.innerHTML = cartes.join('');
  } catch (e) {
    liste.innerHTML = `<div class="empty">La découverte a échoué : ${esc(e)}</div>`;
    console.error(e);
  }
}

/* -------------------------------------------------------------------------
   Lecture des valeurs choisies

   Relues dans le DOM au moment du lancement. Elles ne survivent pas encore a
   une relance de l'application : la persistance viendra avec settings.rs, et
   l'interface ne pretend pas le contraire.
   ------------------------------------------------------------------------- */
function lireConfig(carte) {
  const config = {};
  for (const el of carte.querySelectorAll('[data-opt]')) {
    const cle = el.dataset.opt;
    switch (el.dataset.kind) {
      case 'bool':
        config[cle] = el.getAttribute('aria-checked') === 'true';
        break;
      case 'number': {
        const n = Number(el.value);
        // Une saisie vide ou illisible vaut 0 plutot que NaN : le JSON n'a pas
        // de NaN, et ConvertFrom-Json refuserait le fichier entier.
        config[cle] = Number.isFinite(n) ? n : 0;
        break;
      }
      case 'multi':
        config[cle] = [...el.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.value);
        break;
      default:
        config[cle] = el.value;
    }
  }
  return config;
}

/* -------------------------------------------------------------------------
   Terminal
   ------------------------------------------------------------------------- */

/** Au-dela, les plus anciennes lignes sortent du DOM. Le journal complet est
 *  sur le disque : rien n'est perdu, et l'affichage reste fluide. */
const LIGNES_MAX = 2000;

const term = {
  panneau: null, titre: null, sous: null, corps: null, prog: null,
  stop: null, log: null, fermer: null,
};

function initTerminal() {
  term.panneau = document.getElementById('term');
  term.titre = document.getElementById('termTitle');
  term.sous = document.getElementById('termSub');
  term.corps = document.getElementById('termBody');
  term.prog = document.getElementById('termProg');
  term.stop = document.getElementById('btnStop');
  term.log = document.getElementById('btnLog');
  term.fermer = document.getElementById('btnCloseTerm');
}

/** Vrai si l'utilisateur regarde le bas : on ne lui arrache pas son defilement. */
function colleEnBas() {
  const c = term.corps;
  return c.scrollHeight - c.scrollTop - c.clientHeight < 40;
}

function ajouterLigne({ at_ms, stream, marker, text }) {
  const suivre = colleEnBas();
  const classes = ['tl', `s-${stream}`];
  if (marker) classes.push(`m-${marker.toLowerCase()}`);

  const ligne = document.createElement('div');
  ligne.className = classes.join(' ');
  ligne.innerHTML = `<span class="t">${(at_ms / 1000).toFixed(1)}s</span><span>${esc(text)}</span>`;
  term.corps.appendChild(ligne);

  while (term.corps.childElementCount > LIGNES_MAX) term.corps.firstElementChild.remove();
  if (suivre) term.corps.scrollTop = term.corps.scrollHeight;
}

function ouvrirTerminal(entree, demarre) {
  const tr = entree.meta.translations?.[LANGUE];
  term.titre.textContent = tr?.title || entree.meta.title || entree.id;
  term.sous.textContent = `${demarre.engine} · ${demarre.policy} · pid ${demarre.pid}`;
  term.corps.innerHTML = '';
  term.prog.style.width = '0';
  term.panneau.hidden = false;
  term.stop.hidden = false;
  term.stop.disabled = false;
  term.stop.textContent = 'Arrêter';
  term.log.hidden = true;
  term.fermer.hidden = true;
}

const PLURIEL = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

function afficherVerdict(fin) {
  const secondes = (fin.duration_ms / 1000).toFixed(1);
  const bloc = document.createElement('div');

  let ton, titre;
  if (fin.killed) {
    ton = 'warn';
    titre = 'Interrompu';
  } else if (fin.success) {
    ton = 'ok';
    titre = 'Terminé';
  } else {
    ton = 'bad';
    // Le verdict vient du code de sortie, jamais du fait que le script a
    // demarre. C'est le defaut de la v3 que corrige cette ligne.
    titre = `Échec — code de sortie ${fin.exit_code ?? 'inconnu'}`;
  }

  const details = [
    `${secondes} s`,
    fin.counts_ok ? PLURIEL(fin.counts_ok, 'réussite') : '',
    fin.counts_warn ? PLURIEL(fin.counts_warn, 'avertissement') : '',
    fin.counts_err ? PLURIEL(fin.counts_err, 'erreur') : '',
    fin.reboot_requested ? 'redémarrage nécessaire' : '',
  ].filter(Boolean);

  bloc.className = `term-verdict ${ton}`;
  bloc.innerHTML = `<b>${esc(titre)}</b>${esc(details.join(' · '))}`;
  term.corps.appendChild(bloc);
  term.corps.scrollTop = term.corps.scrollHeight;

  term.prog.style.width = fin.success ? '100%' : term.prog.style.width;
  term.stop.hidden = true;
  term.log.hidden = false;
  term.fermer.hidden = false;
}

/* -------------------------------------------------------------------------
   Lancement
   ------------------------------------------------------------------------- */
async function lancer(id) {
  if (course) return;
  const entree = catalogue.get(id);
  if (!entree) return;

  const carte = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  const bouton = carte?.querySelector('[data-run]');

  try {
    const demarre = await invoke('run_script', {
      req: {
        script_id: id,
        // L'empreinte vue a la decouverte : le moteur refuse de lancer un
        // fichier modifie depuis, plutot que d'executer autre chose que ce
        // que l'interface a montre.
        expected_hash: entree.hash,
        config: lireConfig(carte),
      },
    });

    course = { runId: demarre.run_id, id, logPath: demarre.log_path };
    if (bouton) bouton.disabled = true;
    document.querySelectorAll('[data-run]').forEach((b) => (b.disabled = true));
    ouvrirTerminal(entree, demarre);
  } catch (e) {
    alerterEchecLancement(entree, String(e));
  }
}

/** Un refus de lancement doit se voir : il ne part pas dans la console. */
function alerterEchecLancement(entree, message) {
  term.titre.textContent = entree.meta.title || entree.id;
  term.sous.textContent = 'lancement refusé';
  term.corps.innerHTML = '';
  term.prog.style.width = '0';
  term.panneau.hidden = false;
  term.stop.hidden = true;
  term.log.hidden = true;
  term.fermer.hidden = false;

  const bloc = document.createElement('div');
  bloc.className = 'term-verdict bad';
  bloc.innerHTML = `<b>Le script n’a pas été lancé</b>${esc(message)}`;
  term.corps.appendChild(bloc);
}

/**
 * Specification 6.3 : le script decide de ce qui est sur.
 * Sans `force`, le moteur refuse d'interrompre un script qui s'est declare non
 * interruptible et n'a franchi aucun `[CKPT]`. On demande alors confirmation
 * au lieu de forcer d'office.
 */
async function arreter(force) {
  if (!course) return;
  try {
    const issue = await invoke('cancel_script', { runId: course.runId, force });
    if (issue.needs_confirmation) {
      const bloc = document.createElement('div');
      bloc.className = 'term-verdict warn';
      bloc.innerHTML = `<b>Interruption risquée</b>${esc(issue.message)}`;
      term.corps.appendChild(bloc);
      term.corps.scrollTop = term.corps.scrollHeight;
      term.stop.textContent = 'Forcer l’arrêt';
      term.stop.dataset.force = '1';
      return;
    }
    if (issue.killed) term.stop.disabled = true;
  } catch (e) {
    console.error('Arrêt impossible :', e);
  }
}

/* -------------------------------------------------------------------------
   Evenements du moteur
   ------------------------------------------------------------------------- */
async function cablerMoteur() {
  await ecouter('script:line', ({ payload }) => {
    if (!course || payload.run_id !== course.runId) return;
    ajouterLigne(payload);
    if (payload.step) {
      const [n, total] = payload.step;
      if (total > 0) term.prog.style.width = `${Math.min(100, (n / total) * 100)}%`;
    }
  });

  await ecouter('script:end', ({ payload }) => {
    if (!course || payload.run_id !== course.runId) return;
    course = null;
    document.querySelectorAll('[data-run]').forEach((b) => (b.disabled = false));
    term.stop.dataset.force = '';
    afficherVerdict(payload);
  });
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
 * Delegation : les cartes sont reconstruites a chaque analyse, attacher les
 * gestionnaires une fois sur le conteneur evite de les recabler a chaque fois
 * et d'en oublier un.
 */
function cablerInteractions() {
  document.getElementById('list').addEventListener('click', (ev) => {
    const run = ev.target.closest('[data-run]');
    if (run && !run.disabled) return void lancer(run.dataset.run);

    const inter = ev.target.closest('.switch');
    if (inter) {
      inter.setAttribute('aria-checked', inter.getAttribute('aria-checked') !== 'true');
      return;
    }

    const puce = ev.target.closest('.opt-choices[data-kind="multi"] .chip');
    if (puce) puce.setAttribute('aria-pressed', puce.getAttribute('aria-pressed') !== 'true');
  });

  term.stop.onclick = () => arreter(term.stop.dataset.force === '1');
  term.fermer.onclick = () => { term.panneau.hidden = true; };
  term.log.onclick = async () => {
    const chemin = course?.logPath || term.log.dataset.path;
    if (chemin) {
      try {
        await invoke('open_log', { path: chemin });
      } catch (e) {
        console.error('Ouverture du journal impossible :', e);
      }
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
  initTerminal();
  cablerFenetre();
  cablerInteractions();
  await cablerPauseAnimation();
  await cablerMoteur();

  try {
    const infos = await invoke('app_info');
    document.getElementById('version').textContent = infos.version;
    if (infos.elevated) document.getElementById('adminPill').hidden = false;
  } catch (e) {
    console.error('app_info a echoue :', e);
    document.getElementById('version').textContent = '?';
  }

  try {
    moteurs = await invoke('engines');
  } catch (e) {
    console.error('engines a echoue :', e);
  }

  await chargerScripts();

  // La fenetre est creee invisible pour eviter un flash blanc avant la peinture.
  await laFenetre.show();
}

demarrer();
