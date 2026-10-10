/**
 * WinTool - amorce de l'interface.
 *
 * Modules ES natifs, aucun bundler : Tauri sert src/ en fichiers statiques.
 * C'est volontaire et coherent avec le principe du projet - on depose un
 * fichier, ca marche, sans etape de build.
 */

import { t, setLang, currentLang } from './i18n.js';
import * as A from './analyse.js';

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

   Persiste dans settings.json (settings.rs), pas dans localStorage : les deux
   auraient fini par diverger, et le theme est desormais un reglage utilisateur
   comme un autre (specification 8), au meme endroit que la langue.
   ------------------------------------------------------------------------- */
function themeEffectif() {
  const choisi = document.documentElement.dataset.theme;
  if (choisi) return choisi;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** `persister = false` au demarrage : la valeur vient deja des reglages, pas la
 *  peine de la reecrire aussitot lue. */
function appliquerTheme(valeur, persister = true) {
  if (valeur === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = valeur;
  if (persister) invoke('set_theme', { theme: valeur }).catch((e) => console.error('set_theme a echoue :', e));
}

/** Couleur d'accent (reglage 1.8). L'orange est celle des tokens : aucun
 *  attribut. Les autres posent `data-accent`, que la feuille surcharge. */
const ACCENTS = ['orange', 'tide', 'blue', 'violet', 'pink'];
function appliquerAccent(valeur) {
  const v = ACCENTS.includes(valeur) ? valeur : 'orange';
  if (v === 'orange') delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = v;
}

/* -------------------------------------------------------------------------
   Etat
   ------------------------------------------------------------------------- */

const ECHAPPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ECHAPPE[c]);

const CLASSE_RISQUE = { low: 'low', medium: 'med', high: 'high' };

/** Scripts decouverts, indexes par id. */
const catalogue = new Map();
/** Interpreteurs presents sur la machine (specification 6.7). */
let moteurs = { winps: null, pwsh: null };
/** Execution en cours, ou null. Une seule a la fois (specification 6.6). */
let course = null;
/** Mode test global (§6.9) : en memoire de session, jamais persiste. */
/** Etat de l'interrupteur general de simulation (§6.9), deduit des scripts par
 *  le moteur : { etat: 'desactivee' | 'partielle' | 'activee', simulables, simules }. */
let simulation = { etat: 'desactivee', simulables: 0, simules: 0 };
/** Vrai si le processus a les droits administrateur. */
let estEleve = false;
/** Heure de depart de l'execution en cours, pour horodater les lignes du journal. */
let departCourse = 0;

/* -------------------------------------------------------------------------
   Mode Expert — master-detail (specification 2)
   ------------------------------------------------------------------------- */

/** Dernier resultat de `list_scripts_grouped` : lots, Non classe, et le
 *  rangement par categorie de l'onglet Scripts. */
let etatGroupes = null;
/** Ligne selectionnee dans la colonne de gauche : { type: 'lot'|'script', id }. */
let selection = null;
/** Verdict du dernier lancement de cette session, par id de script — jamais
 *  persiste : un statut qu'on ne peut pas garantir vrai au redemarrage ne
 *  doit pas survivre au redemarrage (specification 7). */
const derniersResultats = new Map();

const NON_CLASSE = 'unclassified';
/** Doit correspondre exactement a la sentinelle renvoyee par `run_script`
 *  cote Rust (lib.rs::NON_APPROUVE) — les deux ne peuvent pas diverger sans
 *  casser silencieusement la detection de ce cas precis. */
const NON_APPROUVE_MARQUEUR = 'NON_APPROUVE';

/** Nom affiche d'un lot ou d'une categorie : langue courante, sinon la base disponible —
 *  meme regle de repli que les traductions de script. */
function nomLot(cat) {
  return cat.name[currentLang()] || cat.name.fr || cat.name.en || Object.values(cat.name)[0] || cat.id;
}

/* -------------------------------------------------------------------------
   Reglages par script (specification 4.2)

   Deux sources pour une meme valeur : ce que le script declare, et ce que
   l'utilisateur a fige. Le principe de la specification est que la premiere
   *propose* et la seconde *dispose* — donc on ne les fusionne jamais en une
   seule valeur cote backend : on garde les deux, et ces accesseurs disent a
   chaque fois laquelle gagne. C'est aussi ce qui permet d'afficher « vous avez
   change ca » et de proposer de revenir en arriere.
   ------------------------------------------------------------------------- */

/** Ce que l'utilisateur a fige pour ce script, ou un objet vide. */
function reglagesScript(id) {
  return etatGroupes?.overrides?.[id] || {};
}

/** Vrai si cette cle de $CONFIG a ete figee a la main — donc ne suit plus le
 *  script, meme si le fichier change (specification 5.5). */
function optionFigee(entree, cle) {
  const config = reglagesScript(entree.id).config;
  return !!config && Object.prototype.hasOwnProperty.call(config, cle);
}

/** Valeur a afficher pour une option : celle de l'utilisateur si elle existe,
 *  sinon le defaut declare par le script. */
function valeurOption(entree, opt) {
  return optionFigee(entree, opt.key) ? reglagesScript(entree.id).config[opt.key] : opt.default;
}

/** Meme regle que le moteur (simulation.rs) : la valeur enregistree, sinon le
 *  defaut du script. Sert a l'AFFICHAGE ; au lancement, c'est le moteur qui
 *  decide, d'apres les reglages enregistres. */
function estSimulable(entree) {
  return (entree.meta.options || []).some((o) => o.key === CLE_SIMULATION);
}
function estSimule(entree) {
  const opt = (entree.meta.options || []).find((o) => o.key === CLE_SIMULATION);
  if (!opt) return false;
  const v = valeurOption(entree, opt);
  return v === true || v === 1 || String(v).toLowerCase() === 'true';
}

/** Ce script exige-t-il un point de restauration ? Pre-coche si le script se
 *  declare non reversible (4.2), mais l'utilisateur a le dernier mot. */
function besoinPointRestauration(entree) {
  return reglagesScript(entree.id).reversible_ack ?? !entree.meta.reversible;
}

/** Un point de restauration avant ce script, a ce lancement : pas s'il est
 *  simule — il ne modifiera rien, et la simulation promet de ne rien modifier
 *  non plus, point de restauration compris. */
function pointAvant(entree) {
  return besoinPointRestauration(entree) && !estSimule(entree);
}

/** Idem pour le redemarrage, pre-coche si le script declare `reboot : true`. */
function besoinRedemarrage(entree) {
  return reglagesScript(entree.id).reboot_ack ?? !!entree.meta.reboot;
}

/** Les valeurs de $CONFIG a imposer au script : uniquement celles que
 *  l'utilisateur a figees. Le script garde ses propres defauts pour tout le
 *  reste — c'est son bloc override qui fusionne les deux (specification 5.2),
 *  donc rien a reconstruire ici. */
function configFigee(id) {
  return reglagesScript(id).config || {};
}

/** Un script desactive reste range et garde ses reglages : il est saute
 *  pendant l'entretien (specification 4.2). Active par defaut. */
function scriptActif(entree) {
  return reglagesScript(entree.id).enabled ?? true;
}

/** Les scripts d'un lot qui tourneront vraiment. Le mode Simple ne doit jamais
 *  compter, annoncer ni estimer sur les autres. */
function scriptsActifs(groupe) {
  return groupe.scripts.filter(scriptActif);
}

/** Ceux que le mode Simple montre et lance : une action qui se declare
 *  reservee a l'Expert (`show : expert`, §17) n'y est ni montree ni lancee —
 *  un debutant ne lance pas ce qu'il n'a pas pu voir. */
function scriptsSimples(groupe) {
  // Lance depuis l'Expert, un lot montre tout ce que l'Expert montre.
  if (groupe.expert) return scriptsActifs(groupe);
  return scriptsActifs(groupe).filter((s) => s.meta.show !== 'expert');
}

/** Le lot en cours de lancement, du choix au bilan. Un lancement depuis
 *  l'Expert y pose une copie marquee `expert` ; pour une seule action, un lot
 *  qui n'existe que le temps de ce lancement (`LOT_EXPERT`). */
const LOT_EXPERT = '__expert';
let groupeLancement = null;
/** Les actions decochees a l'etape « Verifier » : pour ce lancement seulement. */
let exclusLancement = new Set();

/** Les actions retenues pour ce lancement. */
function scriptsRetenus(groupe) {
  return scriptsSimples(groupe).filter((s) => !exclusLancement.has(s.id));
}

/** Champ de l'override correspondant a chaque booleen WinTool (specification 4.2). */
const CHAMP_BOOLEEN = { restore: 'reversible_ack', reboot: 'reboot_ack', enabled: 'enabled' };

/** Vrai des que quelque chose est fige pour ce script — hors classement en
 *  lot, qui se defait par ses propres puces. */
function aDesReglagesFiges(entree) {
  const o = reglagesScript(entree.id);
  return (
    Object.keys(o.config || {}).length > 0 ||
    Object.values(CHAMP_BOOLEEN).some((champ) => o[champ] != null)
  );
}

/* -------------------------------------------------------------------------
   Rendu des scripts decouverts
   ------------------------------------------------------------------------- */

/** Libelle affiche pour une option, traduit si la langue le permet. */
/** Cle d'option par laquelle un script declare savoir se simuler (§6.9). */
const CLE_SIMULATION = 'SafeTest';

function libelleOption(entree, opt) {
  // La simulation porte le meme nom partout, quel que soit le libelle ecrit par
  // l'auteur du script : c'est WinTool qui l'impose, pas chaque script.
  if (opt.key === CLE_SIMULATION) return { label: t('simulation.option_label'), desc: t('simulation.option_desc') };
  const tr = entree.meta.translations?.[currentLang()]?.options?.[opt.key];
  if (tr && tr[0]) return { label: tr[0], desc: tr[1] || '' };
  return { label: opt.label, desc: opt.desc };
}

/** Libelle affiche pour un choix, traduit si la langue le permet. */
function libelleChoix(entree, opt, choix) {
  const tr = entree.meta.translations?.[currentLang()]?.choices?.[`${opt.key}/${choix.value}`];
  if (tr && tr[0]) return tr[0];
  return choix.label || choix.value;
}

/**
 * Commande de saisie correspondant au type de l'option.
 * Chaque commande porte `data-opt` et `data-kind` : c'est ainsi que la valeur
 * est relue au lancement, sans avoir a maintenir un miroir de l'etat.
 */
function rendreCommande(entree, opt) {
  const k = opt.kind;
  const v = valeurOption(entree, opt);

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
    return `<select class="opt-pill" data-opt="${esc(opt.key)}" data-kind="select">${options}</select>`;
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
  const marqueur = opt.hidden ? ` <span class="chip">${esc(t('opt.avancee'))}</span>` : '';
  const commande = rendreCommande(entree, opt);
  // Le nom technique (variable + type) va en infobulle plutot qu'affiche en
  // dur : plus lisible, l'info reste a un survol de distance.
  const info = `${opt.key} · ${opt.kind}`;
  const figee = optionFigee(entree, opt.key);

  // Un choix multiple produit une rangee de puces qui peut etre tres large.
  // Sur une ligne, elle refusait de retrecir et ecrasait le libelle a une
  // colonne d'un mot de large, tout en debordant de la pilule. Ces options-la
  // s'empilent : libelle au-dessus, puces dessous.
  const large = opt.kind === 'multi';

  return `
    <div class="opt${figee ? ' figee' : ''}${large ? ' empilee' : ''}" data-cle="${esc(opt.key)}">
      <div class="opt-body">
        <div class="opt-label" data-tip="${esc(info)}">${esc(label)}${marqueur}${
          figee ? `<i class="fige-dot" data-tip="${esc(t('opt.figee_tip'))}"></i>` : ''
        }</div>
        ${desc ? `<div class="opt-desc">${esc(desc)}</div>` : ''}
      </div>
      <div class="opt-ctl">${commande}</div>
    </div>`;
}

/**
 * Les trois booleens de la specification 4.2 qui n'appartiennent pas au script :
 * WinTool pre-coche les deux premiers d'apres `reversible` et `reboot`,
 * l'utilisateur les corrige, et sa correction ne bouge plus. Ils vivent dans le
 * meme bloc que le $CONFIG parce que c'est la meme question — « comment ce
 * script tourne chez moi » — meme s'ils ne partent pas dans le script.
 */
function rendreReglagesWinTool(entree) {
  const over = reglagesScript(entree.id);
  const cases = [
    { flag: 'enabled', label: t('opt.active'), desc: t('opt.active_desc'), on: scriptActif(entree) },
    { flag: 'restore', label: t('opt.point_restauration'), on: besoinPointRestauration(entree) },
    { flag: 'reboot', label: t('opt.redemarrage'), on: besoinRedemarrage(entree) },
  ];

  return cases
    .map((c) => {
      const fige = over[CHAMP_BOOLEEN[c.flag]] != null;
      return `
    <div class="opt wintool${fige ? ' figee' : ''}">
      <div class="opt-body">
        <div class="opt-label">${esc(c.label)}${
          fige ? `<i class="fige-dot" data-tip="${esc(t('opt.figee_tip'))}"></i>` : ''
        }</div>
        <div class="opt-desc">${esc(c.desc || t('opt.reglage_wintool'))}</div>
      </div>
      <div class="opt-ctl">
        <button class="switch" type="button" role="switch" data-flag="${c.flag}" data-kind="bool"
                aria-checked="${c.on}" aria-label="${esc(c.label)}"></button>
      </div>
    </div>`;
    })
    .join('');
}

/** Bloc CONFIGURATION de la maquette : le compte d'options, de quoi tout rendre
 *  au script, puis les reglages eux-memes. */
function rendreConfiguration(entree) {
  const options = entree.meta.options || [];
  const avancees = options.filter((o) => o.hidden).length;
  const compte = [
    PLURIEL('opt.compte', options.length),
    avancees ? PLURIEL('opt.compte_avancees', avancees) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const reinit = aDesReglagesFiges(entree)
    ? `<button class="conf-reinit" type="button" data-reinit="${esc(entree.id)}">${esc(t('opt.reinitialiser'))}</button>`
    : '';

  return `
    <div class="conf">
      <div class="conf-h">
        <span>${esc(t('opt.configuration'))}</span>
        <span class="conf-compte">${esc(compte)}</span>
        ${reinit}
      </div>
      <div class="opts">
        ${options.map((o) => rendreOption(entree, o)).join('')}
        ${rendreReglagesWinTool(entree)}
      </div>
    </div>`;
}

/**
 * Resultat d'une verification.
 *
 * Le texte dit explicitement ce que le controle NE prouve pas. Un script qui
 * s'analyse peut tres bien echouer a l'execution — droits, etat de la machine,
 * applet absente — et laisser croire le contraire serait pire que ne rien
 * afficher (meme regle qu'au §12.2 pour les points d'attention).
 */
function rendreVerification(r) {
  const lignes = [];

  if (r.syntax.parses) {
    lignes.push(`<div class="vl ok">${esc(t('verif.syntaxe_ok'))}</div>`);
  } else {
    for (const e of r.syntax.errors) {
      lignes.push(
        `<div class="vl bad"><span class="ln">${esc(t('verif.ligne', { n: e.line }))}</span>${esc(e.message)}</div>`
      );
    }
  }

  if (r.findings.length) {
    for (const f of r.findings) {
      lignes.push(
        `<div class="vl ${esc(f.severity)}"><span class="ln">${esc(t('verif.ligne', { n: f.line }))}</span>${esc(f.code)} — ${esc(f.message)}</div>`
      );
    }
  } else {
    lignes.push(`<div class="vl ok">${esc(t('verif.contrat_ok'))}</div>`);
  }

  lignes.push(`<div class="vnote">${esc(t('verif.limite'))}</div>`);
  return lignes.join('');
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
  if (e === 'pwsh' && !moteurs.pwsh) return t('moteur.pwsh_absent');
  if (e === 'winps' && !moteurs.winps) return t('moteur.winps_absent');
  if (!moteurs.pwsh && !moteurs.winps) return t('moteur.aucun');
  return null;
}

/**
 * Etiquettes d'un script : le jeu COMPLET, toujours dans le meme ordre.
 *
 * Auparavant seules les etiquettes applicables etaient rendues, et la ligne
 * changeait de composition d'un script a l'autre : on ne pouvait pas comparer
 * deux scripts d'un coup d'oeil, ni savoir si une etiquette absente signifiait
 * « non » ou « pas renseigne ». Ici la grille est fixe, chaque case est
 * toujours a la meme place, et c'est la couleur qui porte l'information.
 *
 * Deux exceptions assumees a la regle « griser ce qui ne s'applique pas » :
 * « non reversible » et « non interruptible » s'allument en ambre au lieu
 * d'etre grisees. Ce sont des mises en garde, et une mise en garde qui se
 * signale par une ABSENCE de couleur ne se voit pas.
 */
function etiquette(texte, ton, allumee, titre) {
  const classes = ['badge', allumee ? ton : 'off'].filter(Boolean).join(' ');
  const info = titre ? ` title="${esc(titre)}"` : '';
  return `<span class="${classes}"${info}>${esc(texte)}</span>`;
}

function rendreEtiquettes(entree) {
  const m = entree.meta;

  // Echelles : une seule valeur vraie parmi N, les autres grisees.
  const risques = ['low', 'medium', 'high']
    .map((n) => etiquette(t(`risque.${n}`), CLASSE_RISQUE[n], m.risk === n))
    .join('');
  const durees = ['fast', 'medium', 'slow']
    .map((n) => etiquette(t(`duree.${n}`), 'neutre', m.duration === n))
    .join('');

  const booleens = [
    m.reversible
      ? etiquette(t('badge.reversible'), 'acc', true)
      : etiquette(t('badge.non_reversible'), 'med', true, t('badge.non_reversible_tip')),
    m.interruptible
      ? etiquette(t('badge.interruptible'), 'neutre', true)
      : etiquette(t('badge.non_interruptible'), 'med', true, t('badge.non_interruptible_tip')),
    etiquette(t('badge.redemarrage'), 'med', !!m.reboot),
    etiquette(t('badge.admin_requis'), 'neutre', !!m.admin),
    // La provenance n'est pas decorative (§16.4/16.6) : un script officiel
    // conforme a l'index signe s'execute sans approbation ; modifie, ou depose
    // a la main, il la demande.
    entree.origin === 'official'
      ? entree.verified
        ? etiquette(t('badge.officiel'), 'acc', true, t('badge.officiel_tip'))
        : etiquette(t('badge.modifie'), 'med', true, t('badge.modifie_tip'))
      : entree.origin === 'tierce'
        ? etiquette(nomSource(entree.source), 'med', true, t('badge.tierce_tip'))
        : etiquette(t('badge.perso'), 'neutre', true),
    etiquette(libelleFait(derniereExecution(entree.id)), 'neutre', !!derniereExecution(entree.id)),
    entree.declared_id ? '' : etiquette(t('badge.sans_id'), 'med', true),
  ]
    .filter(Boolean)
    .join('');

  return `<div class="badges-row">${risques}<i class="badges-sep"></i>${durees}</div>
          <div class="badges-row">${booleens}</div>`;
}

async function rendreCarte(entree, { sousBadges = '' } = {}) {
  const m = entree.meta;
  const tr = m.translations?.[currentLang()];
  const titre = tr?.title || m.title || entree.path;
  const desc = tr?.desc || m.desc || '';

  const icone = (await iconeSVG(m.icon)) || '';

  const badges = rendreEtiquettes(entree);

  // Toujours affiche, meme sans $CONFIG : les deux cases WinTool de la 4.2
  // existent pour tout script, et c'est la seule place ou les regler.
  const options = rendreConfiguration(entree);

  // Un script desactive ne se lance pas par surprise : le bouton dit pourquoi,
  // et la ligne « Actif » juste au-dessus le remet en service en un clic.
  const manque = scriptActif(entree) ? moteurManquant(m) : t('opt.desactive_raison');

  return `
    <article class="card" data-id="${esc(entree.id)}">
      <div class="card-top">
        <div class="card-icon">${icone}</div>
        <div class="card-ident">
          <div class="card-title">${esc(titre)}</div>
          ${desc ? `<div class="card-desc">${esc(desc)}</div>` : ''}
          <div class="card-path">${esc(entree.path)} · v${esc(m.version || '?')} · ${esc(entree.hash.slice(0, 8))}</div>
        </div>
        <div class="card-actions">
          ${m.scan
            ? `<button class="btn" type="button" data-analyser="${esc(entree.id)}"
                       data-tip="${esc(t('an.analyser_tip'))}" ${manque ? 'disabled' : ''}>${esc(t('an.analyser'))}</button>`
            : ''}
          <button class="btn" type="button" data-verifier="${esc(entree.id)}"
                  data-tip="${esc(t('action.verifier_tip'))}">${esc(t('action.verifier'))}</button>
          <button class="btn primary" type="button" data-run="${esc(entree.id)}"
                  ${manque ? 'disabled' : ''}>${esc(t('action.lancer'))}</button>
        </div>
      </div>
      <div class="badges">${badges}</div>
      ${sousBadges}
      ${manque ? `<p class="card-warn">${esc(manque)}</p>` : ''}
      ${options}
      ${rendreAnomalies(m)}
      <div class="verif" id="verif-${esc(entree.id)}" hidden></div>
      ${zoneAnalyseExpert(entree)}
    </article>`;
}

/** Pastille de statut d'un script : seulement ce qu'on sait vraiment (voir la
 *  note sur `derniersResultats`). */
function statutScript(id) {
  if (course?.id === id) return 'run';
  return derniersResultats.get(id) || '';
}

async function rendreRowLot(cat, count, { draggable = true } = {}) {
  const icone = (await iconeSVG(cat.icon)) || '';
  const nom = nomLot(cat);
  const actif = selection?.type === 'lot' && selection.id === cat.id;
  return `
    <div class="row lot" data-lot="${esc(cat.id)}" data-nom="${esc(nom.toLowerCase())}"
         aria-current="${actif}" ${draggable ? 'draggable="true"' : ''}>
      <div class="ri">${icone}</div>
      <div class="rt">${esc(nom)}</div>
      ${cat.pinned ? `<svg class="ico i14 etoile" aria-hidden="true"><use href="#pin" /></svg>` : ''}
      <span class="rc">${count}</span>
    </div>`;
}

/** Prefixe numerique du nom de fichier (ex. "07" pour 07_configurer_dns.ps1),
 *  la convention de rangement de docs/FORMAT_SCRIPT.md §"Nommer le fichier" —
 *  purement decoratif ici, vide pour un script perso qui ne la suit pas. */
function numeroFichier(entree) {
  const nom = entree.path.split('/').pop() || '';
  const m = /^(\d{2,3})[_-]/.exec(nom);
  // Le numero est rendu tel quel : le tronquer aux deux derniers chiffres
  // faisait afficher « 00 » pour 200_ comme pour 300_, et la colonne cessait
  // d'identifier quoi que ce soit.
  return m ? m[1] : '';
}

function rendreRowScript(entree, { draggable = false, lotId = null } = {}) {
  const m = entree.meta;
  const tr = m.translations?.[currentLang()];
  const titre = tr?.title || m.title || entree.path;
  const actif = selection?.type === 'script' && selection.id === entree.id;
  return `
    <div class="row script${scriptActif(entree) ? '' : ' off'}" data-script="${esc(entree.id)}" data-nom="${esc(titre.toLowerCase())}"
         aria-current="${actif}"
         ${draggable ? `draggable="true" data-lot-drag="${esc(lotId)}"` : ''}>
      <span class="rn">${esc(numeroFichier(entree))}</span>
      <div class="rt">${esc(titre)}</div>
      <span class="dt ${statutScript(entree.id)}"></span>
    </div>`;
}

function rendreRowManquant(id) {
  return `
    <div class="row" aria-disabled="true">
      <span class="dt missing"></span>
      <div class="rt muted">${esc(id)} — ${esc(t('expert.manquant'))}</div>
    </div>`;
}

/* -------------------------------------------------------------------------
   Colonne de gauche : deux onglets (specification §2, §4.1)

   « Scripts » range chaque script dans sa categorie — celle de son entete,
   pour s'y retrouver quand la liste s'allonge. « Lots » montre les groupes de
   scripts que le mode Simple propose et que l'on compose ici. Deux notions
   distinctes depuis la 1.4 : une categorie ne lance rien, un lot ne range rien.
   ------------------------------------------------------------------------- */

/** Onglet affiche dans la colonne de gauche. Une commodite de session, retenue
 *  par l'interface seule — rien qui doive survivre a un autre poste. */
let ongletExpert = (() => {
  try {
    return localStorage.getItem('wintool.onglet') === 'lots' ? 'lots' : 'scripts';
  } catch {
    return 'scripts';
  }
})();

function choisirOnglet(onglet) {
  ongletExpert = onglet === 'lots' ? 'lots' : 'scripts';
  try {
    localStorage.setItem('wintool.onglet', ongletExpert);
  } catch {
    // Stockage indisponible : l'onglet reviendra aux scripts au prochain lancement.
  }
  rendreLots();
}

/** L'onglet « Scripts » : une rubrique par categorie, dans l'ordre de
 *  tools/categories.json, « Autres » en dernier. */
async function rendreOngletScripts() {
  const rubriques = await Promise.all(
    (etatGroupes.categories || []).map(async (b) => {
      const icone = (await iconeSVG(b.category.icon)) || '';
      const lignes = b.scripts
        .map((id) => catalogue.get(id))
        .filter(Boolean)
        .map((s) => rendreRowScript(s))
        .join('');
      return `
        <div class="rubrique" data-rubrique="${esc(b.category.id)}">
          <div class="ghead rubrique-h">
            <span class="rubrique-t">${icone}${esc(nomLot(b.category))}</span>
            <span class="rc">${b.scripts.length}</span>
          </div>
          ${lignes}
        </div>`;
    })
  );
  return rubriques.join('') || `<div class="empty">${esc(t('chrome.aucun_script'))}</div>`;
}

/** L'onglet « Lots » : les lots, puis ceux qui ne sont dans aucun. */
async function rendreOngletLots() {
  const lignesLots = await Promise.all(
    etatGroupes.lots.map((g) => rendreRowLot(g.lot, scriptsActifs(g).length))
  );
  const lotNonClasse = { id: NON_CLASSE, icon: 'folder', name: { [currentLang()]: t('expert.non_classe') } };
  const ligneNonClasse = await rendreRowLot(lotNonClasse, etatGroupes.unclassified.length, { draggable: false });
  return `
    <div class="ghead">
      <span>${esc(t('expert.lots'))}</span>
      <button class="iconbtn" id="btnAjouterLot" type="button" data-tip="${esc(t('expert.ajouter_lot'))}">
        <svg class="ico" aria-hidden="true"><use href="#plus" /></svg>
      </button>
    </div>
    <div class="row" id="ligneNouveauLot" hidden>
      <input type="text" id="nomNouveauLot" placeholder="${esc(t('expert.nom_lot_invite'))}" />
    </div>
    ${lignesLots.join('')}
    ${ligneNonClasse}`;
}

/** Reconstruit toute la colonne de gauche et reapplique le filtre en cours,
 *  s'il y en a un. */
async function rendreLots() {
  const zone = document.getElementById('lotsRows');
  const corps = ongletExpert === 'lots' ? await rendreOngletLots() : await rendreOngletScripts();
  const nbScripts = catalogue.size;
  zone.innerHTML = `
    <div class="lots-onglets" role="tablist" aria-label="${esc(t('expert.onglets'))}">
      <button type="button" role="tab" data-onglet-expert="scripts" aria-selected="${ongletExpert === 'scripts'}">
        ${esc(t('expert.onglet_scripts'))}<span class="rc">${nbScripts}</span>
      </button>
      <button type="button" role="tab" data-onglet-expert="lots" aria-selected="${ongletExpert === 'lots'}">
        ${esc(t('expert.onglet_lots'))}<span class="rc">${etatGroupes.lots.length}</span>
      </button>
    </div>
    <div role="tabpanel">${corps}</div>`;
  appliquerFiltre();
}

function appliquerFiltre() {
  const champ = document.getElementById('filtreLots');
  const q = champ.value.trim().toLowerCase();
  document.querySelectorAll('#lotsRows .row[data-nom]').forEach((el) => {
    el.hidden = q.length > 0 && !el.dataset.nom.includes(q);
  });
  // Une rubrique dont aucun script ne correspond disparait avec son entete :
  // un titre seul au-dessus de rien ferait croire a une categorie vide.
  document.querySelectorAll('#lotsRows .rubrique').forEach((r) => {
    r.hidden = q.length > 0 && !r.querySelector('.row[data-nom]:not([hidden])');
  });
}

async function rendreDetailLot(id) {
  const estNonClasse = id === NON_CLASSE;
  const groupe = estNonClasse ? null : etatGroupes.lots.find((g) => g.lot.id === id);
  if (!estNonClasse && !groupe) {
    selection = null;
    return `<div class="empty-detail">${esc(t('expert.aucune_selection'))}</div>`;
  }

  const cat = estNonClasse
    ? { id: NON_CLASSE, icon: 'folder', name: { [currentLang()]: t('expert.non_classe') }, pinned: false }
    : groupe.lot;
  const scripts = estNonClasse ? etatGroupes.unclassified : groupe.scripts;
  const manquants = estNonClasse ? [] : groupe.missing;
  const icone = (await iconeSVG(cat.icon)) || '';
  const nom = nomLot(cat);

  const actions = estNonClasse
    ? ''
    : `
    <div class="dact">
      <button class="btn primary" type="button" data-lancer-lot="${esc(cat.id)}"${scriptsActifs(groupe).length ? '' : ' disabled'}>${esc(t('expert.lancer_lot'))}</button>
      <button class="iconbtn" type="button" data-renommer-lot="${esc(cat.id)}" data-tip="${esc(t('expert.renommer'))}">
        <svg class="ico i17" aria-hidden="true"><use href="#pencil" /></svg>
      </button>
      <button class="iconbtn" type="button" data-icone-lot="${esc(cat.id)}"
              data-tip="${esc(t('expert.changer_icone'))}" aria-label="${esc(t('expert.changer_icone'))}">
        <svg class="ico i17" aria-hidden="true"><use href="#folder" /></svg>
      </button>
      <button class="iconbtn" type="button" data-epingler-lot="${esc(cat.id)}"
              data-tip="${esc(t(cat.pinned ? 'expert.detacher' : 'expert.epingler'))}">
        <svg class="ico i17" aria-hidden="true"><use href="#pin" /></svg>
      </button>
      <button class="iconbtn" type="button" data-supprimer-lot="${esc(cat.id)}" data-tip="${esc(t('expert.supprimer'))}">
        <svg class="ico i17" aria-hidden="true"><use href="#trash" /></svg>
      </button>
    </div>`;

  const manquantsHtml = manquants.map(rendreRowManquant).join('');

  // UNE seule liste. Un resume des membres au-dessus de la composition
  // faisait doublon : les memes noms, deux fois, a deux endroits. Ici les
  // membres sont en tete et restent ordonnables par glisser-deposer (§6.1),
  // le reste du catalogue suit, et l'interrupteur dit l'appartenance.
  const membres = new Set(scripts.map((s) => s.id));
  const ordonnes = [
    ...scripts,
    ...[...catalogue.values()]
      .filter((e) => !membres.has(e.id))
      .sort((a, b) => numeroFichier(a).localeCompare(numeroFichier(b), undefined, { numeric: true })),
  ];

  const ligne = (entree) => {
    const tr = entree.meta.translations?.[currentLang()];
    const titre = tr?.title || entree.meta.title || entree.path;
    const dedans = membres.has(entree.id);
    const bougeable = dedans && !estNonClasse && !cat.aggregate;
    return `
      <div class="row script membre${dedans ? ' dedans' : ''}"
           data-script="${esc(entree.id)}" data-nom="${esc(titre.toLowerCase())}"
           ${bougeable ? `data-lot-drag="${esc(cat.id)}"` : ''}>
        ${bougeable
          ? `<span class="grip" data-grip data-tip="${esc(t('expert.reordonner'))}" aria-hidden="true">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                    stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
             </span>`
          : '<span class="grip vide" aria-hidden="true"></span>'}
        <span class="rn">${esc(numeroFichier(entree))}</span>
        <div class="rt">${esc(titre)}</div>
        <span class="dt ${statutScript(entree.id)}"></span>
        ${cat.aggregate
          ? ''
          : `<button class="switch" type="button" role="switch" aria-checked="${dedans}"
                     aria-label="${esc(titre)}" data-membre="${esc(entree.id)}"
                     data-lot="${esc(cat.id)}"></button>`}
      </div>`;
  };

  const corps = cat.aggregate
    ? `<p class="muted">${esc(t('expert.agregat_explication'))}</p>` +
      scripts.map((e) => ligne(e)).join('')
    : ordonnes.map(ligne).join('') + manquantsHtml;

  const composition = `
    <div class="box">
      <div class="box-h">
        ${esc(estNonClasse ? t('expert.scripts_du_lot') : t('expert.composer'))}
        <span class="box-h-note">${esc(PLURIEL('expert.compte_membres', membres.size))}</span>
      </div>
      <div class="box-b list" id="scriptsDuLot">
        ${corps || `<p class="muted">${esc(t('chrome.aucun_script'))}</p>`}
      </div>
    </div>`;

  return `
    <div class="dhead">
      <div class="di">${icone}</div>
      <h2 data-nom-lot="${esc(cat.id)}">${esc(nom)}</h2>
      ${cat.pinned ? `<span class="badge acc principale" data-tip="${esc(t('expert.principale_tip'))}">${esc(t('expert.principale'))}</span>` : ''}
      ${actions}
    </div>
    <div class="ic-grille" id="choixIcone" hidden></div>
    ${composition}`;
}

/**
 * Icones proposees pour un lot.
 *
 * Une selection, pas les 2112 de Lucide : un choix trop large fait perdre plus
 * de temps qu'il n'en fait gagner, et toutes ne se lisent pas a 16 px. Celles
 * retenues evoquent des domaines d'entretien.
 */
const ICONES_LOT = [
  'sparkles', 'broom', 'zap', 'shield', 'app-window', 'activity', 'wrench',
  'trash-2', 'hard-drive', 'cpu', 'wifi', 'globe', 'lock', 'eye-off',
  'rocket', 'gauge', 'battery-charging', 'monitor', 'folder', 'file-text',
  'package', 'download', 'refresh-cw', 'calendar-clock', 'bell', 'moon',
  'flame', 'leaf', 'anchor', 'waves',
];

/** Toutes les icones connues, chargees une fois depuis l'index versionne. */
let toutesLesIcones = null;

async function chargerListeIcones() {
  if (toutesLesIcones) return toutesLesIcones;
  try {
    const r = await fetch('icons/_index.txt');
    if (!r.ok) throw new Error(String(r.status));
    toutesLesIcones = (await r.text()).split('\n').map((x) => x.trim()).filter(Boolean);
  } catch {
    // Repli sur la selection courte : mieux vaut trente icones que zero.
    toutesLesIcones = ICONES_LOT.slice();
  }
  return toutesLesIcones;
}

/** Nombre d'icones ajoutees a chaque « Voir plus ». */
const PAS_ICONES = 300;
let plafondIcones = PAS_ICONES;

/**
 * Remplit la grille de la fenetre, filtree par la recherche.
 *
 * Chargement par paliers plutot qu'en une fois : 2112 icones posent 2112
 * requetes et autant de noeuds SVG, ce qui fige la fenetre a l'ouverture. Le
 * bouton « Voir plus » en ajoute 300 a la demande, et la recherche reste le
 * moyen le plus court d'arriver a la bonne.
 */
async function rendreGrilleIcones(filtre = '', reinitialiser = true) {
  if (reinitialiser) plafondIcones = PAS_ICONES;
  const grille = document.getElementById('iconesGrille');
  const compte = document.getElementById('iconesCompte');
  const liste = await chargerListeIcones();
  const f = filtre.trim().toLowerCase();
  const filtrees = f ? liste.filter((n) => n.includes(f)) : liste;
  const retenues = filtrees.slice(0, plafondIcones);

  const cases = await Promise.all(
    retenues.map(async (nom) => {
      const svg = (await iconeSVG(nom)) || '';
      return `<button class="ic-case" type="button" data-choisir-icone="${esc(nom)}"
                      data-tip="${esc(nom)}" aria-label="${esc(nom)}">${svg}</button>`;
    })
  );

  const reste = filtrees.length - retenues.length;
  const plus = reste > 0
    ? `<button class="ic-plus" type="button" data-plus-icones>${esc(t('expert.icone_plus', { n: Math.min(reste, PAS_ICONES) }))}</button>`
    : '';

  grille.innerHTML = (cases.join('') + plus) || `<p class="muted">${esc(t('expert.icone_aucune'))}</p>`;
  compte.textContent = t('expert.icone_compte', { n: retenues.length, total: filtrees.length });
}

async function ouvrirChoixIcone(id) {
  const overlay = document.getElementById('iconesOverlay');
  overlay.dataset.pour = id;
  document.getElementById('iconesTitre').textContent = t('expert.changer_icone');
  const recherche = document.getElementById('rechercheIcone');
  recherche.placeholder = t('expert.icone_recherche');
  recherche.value = '';
  overlay.hidden = false;
  await rendreGrilleIcones('');
  recherche.focus();
}

async function rendreDetailScript(entree) {
  // Une liste deroulante ne peut exprimer qu'un seul rangement ; la §4.1 en
  // autorise plusieurs. Chaque lot est donc une puce a bascule, et
  // l'etat « dans aucun » se lit a l'absence de puce allumee.
  const dedans = new Set(
    etatGroupes.lots
      .filter((g) => !g.lot.aggregate && g.scripts.some((x) => x.id === entree.id))
      .map((g) => g.lot.id)
  );

  const puces = etatGroupes.lots
    .filter((g) => !g.lot.aggregate)
    .map(
      (g) => `
      <button class="chip" type="button" aria-pressed="${dedans.has(g.lot.id)}"
              data-membre="${esc(entree.id)}" data-lot="${esc(g.lot.id)}">
        ${esc(nomLot(g.lot))}
      </button>`
    )
    .join('');

  // La categorie, elle, se lit seulement : elle vient de l'entete du script.
  const categorie = (etatGroupes.categories || []).find((b) => b.scripts.includes(entree.id))?.category;
  const ligneCategorie = categorie
    ? `<div class="cat-row">
         <label>${esc(t('expert.categorie_label'))}</label>
         <span class="badge" data-tip="${esc(t('expert.categorie_tip'))}">${esc(nomLot(categorie))}</span>
       </div>`
    : '';

  const ligneLots = `
    <div class="cat-row">
      <label>${esc(t('expert.lots_label'))}</label>
      <div class="cat-puces">${puces}</div>
      ${dedans.size === 0 ? `<span class="muted">${esc(t('expert.non_classe'))}</span>` : ''}
    </div>`;

  return rendreCarte(entree, { sousBadges: ligneCategorie + ligneLots });
}

async function rendreDetail() {
  const conteneur = document.getElementById('detailScroll');
  if (!selection) {
    conteneur.innerHTML = `<div class="empty-detail">${esc(t('expert.aucune_selection'))}</div>`;
    return;
  }
  if (selection.type === 'lot') {
    conteneur.innerHTML = await rendreDetailLot(selection.id);
    return;
  }
  const entree = catalogue.get(selection.id);
  if (!entree) {
    selection = null;
    return rendreDetail();
  }
  conteneur.innerHTML = await rendreDetailScript(entree);
}

async function chargerLots() {
  const zone = document.getElementById('lotsRows');
  const soucis = document.getElementById('problems');
  zone.innerHTML = `<div class="empty">${esc(t('chrome.analyse_en_cours'))}</div>`;
  soucis.hidden = true;
  soucis.innerHTML = '';
  catalogue.clear();

  try {
    etatGroupes = await invoke('list_scripts_grouped');
    // Les deux racines ont quitte le pied de la colonne — cette place revient
    // au journal compact. Elles restent consultables la ou on les cherche
    // vraiment : a cote du bouton qui ouvre le dossier, dans les Reglages.
    // Libelle en gras, chemin a la ligne : deux racines lisibles d'un coup
    // d'oeil, au lieu d'un pave ou le nom et le chemin se confondaient.
    document.getElementById('cheminsScripts').innerHTML =
      `<b>${esc(t('chrome.catalogue_titre'))}</b><br />` +
      `${esc(etatGroupes.catalogue_root)}<br /><br />` +
      `<b>${esc(t('chrome.perso_titre'))}</b><br />${esc(etatGroupes.root)}`;

    if (etatGroupes.problems?.length) {
      soucis.hidden = false;
      soucis.innerHTML = etatGroupes.problems
        .map((p) => `<div class="finding error"><span class="code">DOSSIER</span><span class="msg">${esc(p)}</span></div>`)
        .join('');
    }

    for (const g of etatGroupes.lots) for (const s of g.scripts) catalogue.set(s.id, s);
    for (const s of etatGroupes.unclassified) catalogue.set(s.id, s);

    // Un lot supprime, ou un script disparu, invalide une selection
    // qui pointait dessus : on retombe sur l'etat neutre plutot que de garder
    // une reference perimee.
    if (selection?.type === 'script' && !catalogue.has(selection.id)) selection = null;
    if (
      selection?.type === 'lot' &&
      selection.id !== NON_CLASSE &&
      !etatGroupes.lots.some((g) => g.lot.id === selection.id)
    ) {
      selection = null;
    }

    await rendreLots();
    await rendreDetail();
  } catch (e) {
    zone.innerHTML = `<div class="empty">${esc(t('chrome.decouverte_echouee', { erreur: String(e) }))}</div>`;
    console.error(e);
  }
}

/* -------------------------------------------------------------------------
   Lecture des valeurs choisies

   Relues dans le DOM au moment du lancement. Elles ne survivent pas encore a
   une relance de l'application : la persistance viendra avec settings.rs, et
   l'interface ne pretend pas le contraire.
   ------------------------------------------------------------------------- */
/** Valeur portee par un seul controle, dans le type attendu par le script. */
function valeurControle(el) {
  switch (el.dataset.kind) {
    case 'bool':
      return el.getAttribute('aria-checked') === 'true';
    case 'number': {
      const n = Number(el.value);
      // Une saisie vide ou illisible vaut 0 plutot que NaN : le JSON n'a pas
      // de NaN, et ConvertFrom-Json refuserait le fichier entier.
      return Number.isFinite(n) ? n : 0;
    }
    case 'multi':
      return [...el.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.value);
    default:
      return el.value;
  }
}

function lireConfig(carte) {
  const config = {};
  // `[data-opt]` seulement : les deux cases WinTool portent `data-ack` et ne
  // descendent pas dans le script — elles pilotent WinTool, pas $CONFIG.
  for (const el of carte.querySelectorAll('[data-opt]')) {
    config[el.dataset.opt] = valeurControle(el);
  }
  return config;
}

/**
 * Ecrit dans `settings.json` la valeur que l'utilisateur vient de poser, et
 * la fige (specification 4.2) : a partir de maintenant ce reglage ne suit plus
 * le script.
 *
 * Le panneau n'est re-rendu que si l'affichage change vraiment — c'est-a-dire
 * a la premiere modification d'un reglage, quand la pastille « fige » et le
 * bouton de remise a zero apparaissent. Re-rendre a chaque frappe ferait
 * clignoter la carte et reprendrait le focus pour rien.
 */
async function persisterReglage(el) {
  const carte = el.closest('.card[data-id]');
  if (!carte) return;
  const scriptId = carte.dataset.id;
  const entree = catalogue.get(scriptId);
  if (!entree) return;

  const drapeau = el.dataset.flag;
  const etaitFige = drapeau
    ? reglagesScript(scriptId)[CHAMP_BOOLEEN[drapeau]] != null
    : optionFigee(entree, el.dataset.opt);

  try {
    const reglages = drapeau
      ? await invoke('set_script_flag', { scriptId, flag: drapeau, value: valeurControle(el) })
      : await invoke('set_script_config', { scriptId, key: el.dataset.opt, value: valeurControle(el) });
    if (etatGroupes) etatGroupes.overrides = reglages.overrides;
  } catch (e) {
    // Un reglage qu'on n'a pas pu ecrire ne doit pas se faire passer pour
    // enregistre : l'ecran repart de ce qui est reellement sur le disque.
    console.error("Enregistrement du reglage impossible :", e);
    return void rendreDetail();
  }

  // Activer ou desactiver se voit ailleurs que sur la carte — la ligne du
  // script palit dans la colonne de gauche, et le bouton Executer suit.
  if (drapeau === 'enabled') await rendreLots();
  if (!etaitFige || drapeau === 'enabled') await rendreDetail();
  // Simuler un script un par un change l'etat de l'interrupteur general.
  if (el.dataset.opt === CLE_SIMULATION) await rafraichirSimulation();
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

/** Les familles de lignes du journal, chacune filtrable. Masquer ne supprime
 *  rien : recocher rend les lignes, et le fichier de log reste complet. */
const FAMILLES_JOURNAL = [
  ['info', ['INFO']],
  ['etapes', ['STEP', 'CKPT', 'PROGRESS']],
  ['succes', ['OK', 'DONE', 'FREED']],
  ['avert', ['WARN', 'REBOOT']],
  ['erreurs', ['ERR']],
  ['analyse', ['FIND', 'ITEM', 'METRIC', 'NOTE']],
  ['canaux', ['LOG']],
  ['texte', []],
];
function familleLigne(marker, stream) {
  if (stream === 'stderr' || marker === 'ERR') return 'erreurs';
  return FAMILLES_JOURNAL.find(([, m]) => m.includes(marker))?.[0] || 'texte';
}

/** Les familles masquees : une commodite d'affichage, gardee dans ce
 *  navigateur seulement (rien a voir avec les reglages de WinTool). */
const CLE_MASQUES = 'wintool.journalMasques';
let masquesJournal = new Set();
try { masquesJournal = new Set(JSON.parse(localStorage.getItem(CLE_MASQUES) || '[]')); } catch { /* stockage indisponible : tout est montre */ }

function appliquerMasquesJournal() {
  const valeur = [...masquesJournal].join(' ');
  for (const id of ['termBody', 'ljBody']) {
    const e = document.getElementById(id);
    if (e) e.dataset.masques = valeur;
  }
  document.querySelectorAll('#termFiltres [data-famille]').forEach((b) => {
    b.setAttribute('aria-pressed', String(!masquesJournal.has(b.dataset.famille)));
  });
}

function rendreFiltresJournal() {
  const zone = document.getElementById('termFiltres');
  if (!zone) return;
  zone.setAttribute('aria-label', t('console.filtrer'));
  zone.innerHTML = `<span class="term-filtres-t">${esc(t('console.afficher'))}</span>${FAMILLES_JOURNAL.map(([id]) =>
    `<button type="button" class="term-filtre f-${id}" data-famille="${id}">${esc(t(`console.f_${id}`))}</button>`).join('')}`;
  zone.querySelectorAll('[data-famille]').forEach((b) => {
    b.onclick = () => {
      const f = b.dataset.famille;
      if (masquesJournal.has(f)) masquesJournal.delete(f);
      else masquesJournal.add(f);
      try { localStorage.setItem(CLE_MASQUES, JSON.stringify([...masquesJournal])); } catch { /* sans memoire, le filtre vaut pour la session */ }
      appliquerMasquesJournal();
    };
  });
  appliquerMasquesJournal();
}

/** Densite de la console : Compact (aperçu tronque, docke), Etendu (pleine
 *  largeur, docke) ou Complet (par-dessus toute la fenetre) — jamais
 *  persiste, chaque lancement repart de Compact. */
function basculerConsole(mode) {
  document.body.dataset.console = mode;
  document.querySelectorAll('#consoleSeg [data-console-mode]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.consoleMode === mode));
  });
}

/**
 * Mode test : chaque script recoit `SafeTest = true`, impose par le moteur.
 *
 * L'etat est rappele a deux endroits simultanement — la pastille de la barre
 * de titre et un bandeau en tete d'ecran. C'est volontairement redondant :
 * croire qu'on simule alors qu'on modifie vraiment est le pire resultat
 * possible, et une seule pastille se perd dans une barre chargee.
 */
// --- Mise a jour de WinTool (specification §11) ------------------------------
// Detecter et proposer, rien d'installe sans un clic. La verification de la
// signature, le telechargement et l'installation sont faits cote Rust par le
// greffon officiel (voir src-tauri/src/update.rs) ; ici on ne fait qu'afficher.

/** { version, actuelle, notes, date } si une version plus recente existe. */
let majDisponible = null;
/** L'utilisateur a clique « Plus tard » : on ne redemande pas de la session. */
let majRepoussee = false;
/** Telechargement lance : le bandeau n'accepte plus d'autre geste. */
let majInstallation = false;

function executionEnCours() {
  return course !== null || entretienActif;
}

/** Traduit un echec du greffon. Une signature refusee n'est pas un incident
 *  reseau : c'est un evenement de securite, et il doit se lire comme tel. */
function messageErreurMaj(e) {
  const texte = String(e).replace(/^Error:\s*/, '');
  if (texte.includes('MAJ_PENDANT_EXECUTION')) return t('maj.pendant_execution');
  if (/signature|minisign|signed for version/i.test(texte)) return t('maj.signature');
  if (/error sending request|dns|connect|timed out|network/i.test(texte)) return t('maj.hors_ligne');
  // Serveur joint, mais aucun manifeste lisible : aucune version publiee, ou
  // une release sans latest.json. Ce n'est pas une panne de l'utilisateur.
  if (/release JSON/i.test(texte)) return t('maj.introuvable');
  return t('maj.echec', { e: texte });
}

function rendreBandeauMaj(erreur) {
  const bandeau = document.getElementById('majBanner');
  if (!bandeau) return;
  const visible = !!erreur || (!!majDisponible && !majRepoussee);
  bandeau.hidden = !visible;
  bandeau.classList.toggle('erreur', !!erreur);
  if (!visible) return;

  const texte = document.getElementById('majTexte');
  const installer = document.getElementById('majInstaller');
  const plusTard = document.getElementById('majPlusTard');

  if (erreur) {
    texte.textContent = erreur;
    installer.hidden = true;
    plusTard.hidden = false;
    plusTard.textContent = t('maj.fermer');
    return;
  }
  if (majInstallation) return;

  texte.textContent = t('maj.disponible', { v: majDisponible.version });
  installer.hidden = false;
  plusTard.hidden = false;
  installer.textContent = t('maj.installer');
  plusTard.textContent = t('maj.plus_tard');
  // L'installeur ferme WinTool : pendant un entretien, il couperait le script
  // en cours au milieu de ce qu'il fait. Le moteur refuse aussi de son cote.
  installer.disabled = executionEnCours();
  installer.dataset.tip = executionEnCours() ? t('maj.pendant_execution') : '';
}

/** Interroge la derniere release publiee. Silencieux au demarrage : une machine
 *  hors ligne est un cas normal, pas une erreur a afficher. */
async function verifierMaj({ silencieux = false } = {}) {
  const etat = document.getElementById('majEtat');
  if (!silencieux && etat) etat.textContent = t('maj.verification');
  try {
    majDisponible = await invoke('check_update');
    if (majDisponible) majRepoussee = false;
    rendreBandeauMaj();
    if (etat) {
      etat.textContent = majDisponible
        ? t('maj.disponible', { v: majDisponible.version })
        : t('maj.a_jour', { v: document.getElementById('version')?.textContent || '' });
    }
  } catch (e) {
    console.error('Verification de mise a jour :', e);
    if (!silencieux && etat) etat.textContent = messageErreurMaj(e);
  }
}

async function installerMaj() {
  if (majInstallation || executionEnCours()) return;
  majInstallation = true;
  const texte = document.getElementById('majTexte');
  document.getElementById('majInstaller').hidden = true;
  document.getElementById('majPlusTard').hidden = true;
  texte.textContent = t('maj.telechargement_debut');

  // Une fois tout recu, le texte annonce la suite plutot que de rester sur
  // « 100 % » : la verification de signature puis l'installeur prennent encore
  // quelques secondes, et c'est la que WinTool va se fermer.
  const arreterEcoute = await ecouter('update:progress', (ev) => {
    const { recu, total } = ev.payload;
    if (total && recu >= total) texte.textContent = t('maj.lancement');
    else if (total) texte.textContent = t('maj.telechargement', { p: Math.round((recu / total) * 100) });
    else texte.textContent = t('maj.telechargement_debut');
  });

  try {
    // Sous Windows, le greffon lance l'installeur puis ferme WinTool : on ne
    // revient ici qu'en cas d'echec.
    await invoke('install_update');
  } catch (e) {
    console.error('Installation de mise a jour :', e);
    majInstallation = false;
    rendreBandeauMaj(messageErreurMaj(e));
  } finally {
    arreterEcoute();
  }
}

function cablerMaj() {
  document.getElementById('majInstaller').addEventListener('click', installerMaj);
  // « Plus tard » comme « Fermer » apres un echec : on ne repropose pas de la
  // session. Apres une signature refusee surtout, l'installeur est suspect —
  // seule une verification demandee a la main peut le remettre sur la table.
  document.getElementById('majPlusTard').addEventListener('click', () => {
    majRepoussee = true;
    document.getElementById('majBanner').hidden = true;
  });
  document.getElementById('btnVerifierMaj').addEventListener('click', () => verifierMaj());
}

/* -------------------------------------------------------------------------
   Catalogue d'entretiens (specification §16)

   WinTool ne livre plus de scripts : ils viennent du catalogue officiel, dont
   l'index est signe. Tout le travail de confiance se fait cote Rust
   (catalogue.rs) — verification de signature, empreintes, ecriture. L'interface
   propose et rapporte ; elle n'installe jamais rien sans un clic (§16.5).
   ------------------------------------------------------------------------- */

/** `catalogue::Etat` — null tant qu'inconnu. */
let etatCatalogue = null;
/** `catalogue::Bilan` de la derniere verification, s'il propose quelque chose. */
let bilanCatalogue = null;
/** « Plus tard » : on ne repropose pas de la session. */
let catalogueRepousse = false;
/** Telechargement en cours : un seul a la fois. */
let catalogueInstallation = false;
/** Le rappel « des scripts mais aucun catalogue » ne se montre qu'une fois. */
let rappelCatalogueMontre = false;

const ERREURS_CATALOGUE = {
  CATALOGUE_PENDANT_EXECUTION: 'cat.pendant_execution',
  CATALOGUE_SANS_CLE: 'cat.sans_cle',
  CATALOGUE_HORS_LIGNE: 'cat.hors_ligne',
  CATALOGUE_INTROUVABLE: 'cat.introuvable',
  CATALOGUE_SIGNATURE: 'cat.signature',
  CATALOGUE_ANCIEN: 'cat.ancien',
  CATALOGUE_FORMAT: 'cat.format',
  CATALOGUE_EMPREINTE: 'cat.empreinte',
  CATALOGUE_INVALIDE: 'cat.invalide',
  CATALOGUE_CLE: 'cat.err_cle',
  CATALOGUE_DEPOT: 'cat.err_depot',
  SOURCES_SANS_DROITS: 'cat.droits',
  SOURCE_EXISTE: 'cat.err_existe',
  SOURCE_NOM: 'cat.err_nom',
  SOURCE_AUTRE_ID: 'cat.err_autre_id',
  SOURCE_INCONNUE: 'cat.err_inconnue',
};

/** Les erreurs arrivent sous la forme `CODE: detail` (catalogue.rs). Une
 *  signature refusee se dit comme un evenement de securite, pas comme une
 *  panne. */
function messageErreurCatalogue(e) {
  const texte = String(e).replace(/^Error:\s*/, '');
  const separateur = texte.indexOf(': ');
  const code = separateur < 0 ? texte : texte.slice(0, separateur);
  const detail = separateur < 0 ? '' : texte.slice(separateur + 2);
  if (code === 'CATALOGUE_ECRITURE') return t('cat.ecriture', { e: detail });
  if (ERREURS_CATALOGUE[code]) return t(ERREURS_CATALOGUE[code]);
  return t('cat.echec', { e: texte });
}

/** Titre d'un script de l'index, dans la langue de l'interface si possible. */
function titreElement(el) {
  const titres = el.title || {};
  return titres[currentLang()] || titres.en || Object.values(titres)[0] || el.file;
}

function dateCourte(iso) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  return d.toLocaleDateString(currentLang(), { day: 'numeric', month: 'long', year: 'numeric' });
}

/** « 2 ajouts, 3 mises à jour » : ce que changerait une installation. */
function resumeBilan(b) {
  const morceaux = [
    b.nouveaux.length && PLURIEL('cat.nouveaux', b.nouveaux.length),
    b.mis_a_jour.length && PLURIEL('cat.mis_a_jour', b.mis_a_jour.length),
    b.remplaces.length && PLURIEL('cat.remplaces', b.remplaces.length),
    b.retires.length && PLURIEL('cat.retires', b.retires.length),
  ].filter(Boolean);
  return morceaux.length ? morceaux.join(', ') : t('cat.nouvelle_version');
}

/** Bandeau du haut. Sans message : la proposition de mise a jour, s'il y en a
 *  une. Avec un message : un compte rendu (succes ou echec), a fermer. */
function rendreBandeauCatalogue(message, { erreur = false } = {}) {
  const bandeau = document.getElementById('catBanner');
  if (!bandeau || catalogueInstallation) return;
  const texte = document.getElementById('catTexte');
  const agir = document.getElementById('catInstaller');
  const plusTard = document.getElementById('catPlusTard');

  if (message) {
    bandeau.hidden = false;
    bandeau.classList.toggle('erreur', erreur);
    texte.textContent = message;
    agir.hidden = true;
    plusTard.hidden = false;
    plusTard.textContent = t('maj.fermer');
    return;
  }

  // Un catalogue ajoute qui a des nouveautes : le bandeau mene a sa carte,
  // ou l'on voit d'abord ce qui change (il ne s'installe pas d'ici).
  const tierce = [...bilansSources.entries()].find(([id]) =>
    etatSources?.sources.some((x) => x.id === id && x.active && !x.officielle),
  );
  const visible = (!!bilanCatalogue || !!tierce) && !catalogueRepousse;
  bandeau.hidden = !visible;
  bandeau.classList.remove('erreur');
  if (!visible) return;
  agir.hidden = false;
  if (bilanCatalogue) {
    texte.textContent = t('cat.banniere', { detail: resumeBilan(bilanCatalogue) });
    agir.textContent = t('cat.btn_maj');
    agir.dataset.action = 'installer';
  } else {
    texte.textContent = t('cat.banniere_source', { nom: nomSource(tierce[0]), detail: resumeBilan(tierce[1]) });
    agir.textContent = t('cat.voir');
    agir.dataset.action = 'voir';
  }
  plusTard.hidden = false;
  plusTard.textContent = t('maj.plus_tard');
  // Le script en cours est verrouille en ecriture : le remplacer echouerait.
  agir.disabled = executionEnCours();
  agir.dataset.tip = executionEnCours() ? t('cat.pendant_execution') : '';
}

/** Ligne d'etat et bouton de la section Catalogue des Reglages. */
function rendreReglagesCatalogue(message) {
  const etat = document.getElementById('catalogueEtat');
  const bouton = document.getElementById('btnCatalogue');
  if (!etat || !bouton) return;
  const e = etatCatalogue;
  bouton.hidden = !e?.cle;
  bouton.disabled = catalogueInstallation;
  if (!e) {
    etat.textContent = message || '';
    return;
  }
  if (!e.cle) {
    etat.textContent = t('cat.sans_cle');
    return;
  }
  if (!e.installe) bouton.textContent = t(e.probleme ? 'cat.btn_reinstaller' : 'cat.btn_installer');
  else bouton.textContent = t(bilanCatalogue ? 'cat.btn_maj' : 'cat.btn_verifier');

  if (message) {
    etat.textContent = message;
    return;
  }
  if (e.probleme) etat.textContent = t('cat.etat_probleme');
  else if (e.installe) {
    const n = e.installe.scripts;
    const installe = t('cat.etat_installe', {
      v: e.installe.version,
      d: dateCourte(e.installe.published),
      n,
      s: n > 1 ? 's' : '',
    });
    // Une nouveaute deja detectee se dit ici aussi : rouvrir les Reglages ne
    // doit pas la faire oublier.
    etat.textContent = bilanCatalogue
      ? `${installe} ${t('cat.disponible', { v: bilanCatalogue.version, detail: resumeBilan(bilanCatalogue) })}`
      : installe;
  } else etat.textContent = t('cat.etat_absent');
}

/** Ne telecharge que l'index signe : aucun script, rien d'ecrit. Silencieux
 *  au demarrage — une machine hors ligne est un cas normal. */
async function verifierCatalogue({ silencieux = false } = {}) {
  if (!etatCatalogue?.cle || catalogueInstallation) return;
  if (!silencieux) rendreReglagesCatalogue(t('cat.verification'));
  try {
    const b = await invoke('check_catalogue');
    bilanCatalogue = b.a_jour ? null : b;
    if (bilanCatalogue) catalogueRepousse = false;
    rendreBandeauCatalogue();
    if (bilanCatalogue) rendreReglagesCatalogue(t('cat.disponible', { v: b.version, detail: resumeBilan(b) }));
    else rendreReglagesCatalogue(silencieux ? undefined : t('cat.a_jour', { v: b.version }));
  } catch (e) {
    console.error('Verification du catalogue :', e);
    if (!silencieux) rendreReglagesCatalogue(messageErreurCatalogue(e));
  }
}

/** Le meme texte partout ou l'utilisateur peut regarder : bandeau, Reglages,
 *  et l'accueil s'il l'y a lance. */
function afficherProgressionCatalogue(texte) {
  const bandeau = document.getElementById('catBanner');
  bandeau.hidden = false;
  bandeau.classList.remove('erreur');
  document.getElementById('catTexte').textContent = texte;
  document.getElementById('catInstaller').hidden = true;
  document.getElementById('catPlusTard').hidden = true;
  const offre = document.getElementById('offreEtat');
  if (offre) offre.textContent = texte;
  const visiteEtat = document.getElementById('onbCatalogueEtat');
  if (visiteEtat) visiteEtat.textContent = texte;
  const etat = document.getElementById('catalogueEtat');
  if (etat) etat.textContent = texte;
}

async function installerCatalogue() {
  if (catalogueInstallation || executionEnCours() || !etatCatalogue?.cle) return;
  catalogueInstallation = true;
  document.querySelectorAll('[data-offre="installer"], [data-onb="installer"], #btnCatalogue').forEach((b) => { b.disabled = true; });
  afficherProgressionCatalogue(t('cat.telechargement_debut'));

  const arreterEcoute = await ecouter('catalogue:progress', (ev) => {
    const { fait, total } = ev.payload;
    afficherProgressionCatalogue(total ? t('cat.telechargement', { f: fait, n: total }) : t('cat.telechargement_debut'));
  });

  let message = '';
  let erreur = false;
  try {
    const r = await invoke('install_catalogue');
    const morceaux = [t('cat.installe', { v: r.version })];
    if (r.copies.length) morceaux.push(t('cat.copies', { f: r.copies.join(', ') }));
    if (r.retires.length) morceaux.push(t('cat.retires_info', { f: r.retires.map(titreElement).join(', ') }));
    message = morceaux.join(' ');
    bilanCatalogue = null;
  } catch (e) {
    console.error('Installation du catalogue :', e);
    message = messageErreurCatalogue(e);
    erreur = true;
  } finally {
    arreterEcoute();
    catalogueInstallation = false;
  }

  // Installer, c'est aussi choisir cette source : les reglages ont bouge.
  try {
    reglagesActuels = await invoke('get_settings');
    etatCatalogue = await invoke('catalogue_state');
  } catch (e) {
    console.error('Etat du catalogue :', e);
  }
  await chargerSources();
  if (!erreur) {
    await chargerLots();
    await rafraichirSimulation();
    const etapeVisible = document.querySelector('.s-step:not([hidden])')?.dataset.s;
    if (modeCourant === 'simple' && etapeVisible === '1') await rendreEtapeChoisir();
  }
  rendreReglagesCatalogue(message);
  rendreBandeauCatalogue(message, { erreur });
  const offre = document.getElementById('offreEtat');
  if (offre) offre.textContent = erreur ? message : '';
  document.querySelectorAll('[data-offre="installer"]').forEach((b) => { b.disabled = false; });
  // Lance depuis la visite : sa page montre le resultat.
  if (!document.getElementById('onboarding').hidden) {
    await rendreVisite();
    const visiteEtat = document.getElementById('onbCatalogueEtat');
    if (visiteEtat && erreur) visiteEtat.textContent = message;
  }
}

/* -------------------------------------------------------------------------
   Catalogues (specification §16.2, §16.6) : l'officiel, et ceux qu'un
   administrateur ajoute. Chacun a sa carte dans les Reglages ; « Consulter et
   choisir » ouvre son contenu, action par action, avant meme l'installation.
   Ajouter un catalogue, c'est decider a qui l'on confie des actions lancees en
   administrateur : un depot GitHub, et la cle publique de son editeur.
   ------------------------------------------------------------------------- */

/** `lib::EtatSources` — null tant qu'inconnu. */
let etatSources = null;
/** Nouveautes des catalogues ajoutes : id -> `catalogue::Bilan`. Celles de
 *  l'officiel restent dans `bilanCatalogue`. */
const bilansSources = new Map();
/** La page « Consulter et choisir » : { id, contenu, exclus: Set }. */
let sourceOuverte = null;
/** Le formulaire modifie cette source ; null : il en ajoute une. */
let sourceModifiee = null;

async function chargerSources() {
  try {
    etatSources = await invoke('sources_state');
  } catch (e) {
    console.error('Catalogues :', e);
  }
  rendreSources();
}

function sourceParId(id) {
  return etatSources?.sources.find((x) => x.id === id) || null;
}

/** Le nom d'un catalogue ; celui de l'officiel se traduit. */
function nomSource(id) {
  const x = sourceParId(id);
  if (!x) return id || '';
  return x.officielle ? t('cat.titre_reglage') : x.nom;
}

/** Un texte par langue (titre ou description d'une action) : la langue de
 *  l'interface, sinon le francais, sinon ce qu'il y a. */
function texteLangue(textes) {
  const t2 = textes || {};
  return t2[currentLang()] || t2.fr || t2.en || Object.values(t2)[0] || '';
}

function libelleAgirSource(x) {
  if (!x.installe) return x.probleme ? 'cat.btn_reinstaller' : 'cat.btn_installer';
  return bilansSources.has(x.id) ? 'cat.btn_maj' : 'cat.btn_verifier';
}

function etatTexteSource(x) {
  if (x.probleme) return t('cat.etat_probleme');
  if (!x.installe) return t('cat.etat_absent');
  const n = x.installe.scripts;
  const texte = t('cat.etat_installe', { v: x.installe.version, d: dateCourte(x.installe.published), n, s: n > 1 ? 's' : '' });
  const b = bilansSources.get(x.id);
  return b ? `${texte} ${t('cat.disponible', { v: b.version, detail: resumeBilan(b) })}` : texte;
}

function carteSource(x, modifiable) {
  const id = esc(x.id);
  const nom = esc(nomSource(x.id));
  const badge = x.officielle
    ? `<span class="badge acc">${esc(t('offre.badge_officiel'))}</span>`
    : `<span class="badge med">${esc(t('cat.badge_tierce'))}</span>`;
  // La carte officielle garde ses identifiants : rendreReglagesCatalogue et la
  // progression d'installation y ecrivent, comme avant.
  const etat = x.officielle
    ? '<span class="desc" id="catalogueEtat" aria-live="polite"></span>'
    : `<span class="desc" data-source-etat="${id}" aria-live="polite">${esc(etatTexteSource(x))}</span>`;
  const exclus = x.exclus ? `<span class="desc">${esc(PLURIEL('cat.exclus', x.exclus))}</span>` : '';
  const avert = x.officielle ? '' : `<span class="desc source-avert">${esc(t('cat.tierce_avert'))}</span>`;
  const inactive = x.active ? '' : `<span class="desc">${esc(t('cat.inactive'))}</span>`;
  const indisponible = !x.active || !x.cle || catalogueInstallation;
  const agir = x.officielle
    ? `<button class="btn compact" type="button" id="btnCatalogue"${x.active ? '' : ' disabled'}></button>`
    : `<button class="btn compact" type="button" data-source-agir="${id}"${indisponible ? ' disabled' : ''}>${esc(t(libelleAgirSource(x)))}</button>`;
  const gerer =
    !x.officielle && modifiable
      ? `<button class="btn compact only-expert" type="button" data-source-modifier="${id}">${esc(t('cat.modifier'))}</button>
         <button class="btn compact danger only-expert" type="button" data-source-retirer="${id}">${esc(t('cat.retirer'))}</button>`
      : '';
  return `<div class="setrow source-carte${x.active ? '' : ' inactive'}" data-num="2.1" data-source="${id}">
    <span class="rg-bouclier"><svg class="ico i20" aria-hidden="true"><use href="#${x.officielle ? 'shield-check' : 'sec-catalogue'}" /></svg></span>
    <span class="setrow-txt"><span class="num">2.1</span><span class="rg-libelle">
      <b>${nom} ${badge}</b>
      <span class="desc mono">github.com/${esc(x.depot)}</span>
      ${etat}${exclus}${avert}${inactive}
    </span></span>
    <button class="switch" type="button" role="switch" data-source-active="${id}" aria-checked="${x.active}"
      aria-label="${esc(t('cat.activer', { nom: nomSource(x.id) }))}"></button>
    <div class="source-actions">
      <button class="btn compact" type="button" data-source-consulter="${id}"${indisponible ? ' disabled' : ''}>${esc(t('cat.consulter'))}</button>
      ${agir}${gerer}
    </div>
  </div>`;
}

function rendreSources() {
  const zone = document.getElementById('sourcesListe');
  if (!zone || !etatSources) return;
  zone.innerHTML =
    etatSources.sources.map((x) => carteSource(x, etatSources.modifiable)).join('') +
    etatSources.problemes.map((p) => `<p class="ajout-err">${esc(p)}</p>`).join('');
  rendreReglagesCatalogue();
  document.getElementById('sourcesDroits').hidden = etatSources.modifiable;
  document.getElementById('btnSourceAjouter').disabled = !etatSources.modifiable;
}

/** Ne telecharge que l'index signe d'un catalogue ajoute. */
async function verifierSource(id, { silencieux = false } = {}) {
  const ligne = () => document.querySelector(`[data-source-etat="${CSS.escape(id)}"]`);
  if (!silencieux && ligne()) ligne().textContent = t('cat.verification');
  try {
    const b = await invoke('check_source', { id });
    if (b.a_jour) bilansSources.delete(id);
    else bilansSources.set(id, b);
    if (!b.a_jour) catalogueRepousse = false;
    rendreSources();
    if (!silencieux && b.a_jour && ligne()) ligne().textContent = t('cat.a_jour', { v: b.version });
  } catch (e) {
    console.error('Verification du catalogue :', e);
    if (!silencieux && ligne()) ligne().textContent = messageErreurCatalogue(e);
  }
  rendreBandeauCatalogue();
}

/** Installe un catalogue, sans ses actions decochees. L'officiel passe par
 *  installerCatalogue, qui tient a jour l'accueil, la visite et le bandeau. */
async function installerSource(id) {
  if (id === 'officiel') {
    await installerCatalogue();
    return true;
  }
  if (catalogueInstallation || executionEnCours()) return false;
  catalogueInstallation = true;
  rendreSources();
  const ecrire = (texte) => {
    const ligne = document.querySelector(`[data-source-etat="${CSS.escape(id)}"]`);
    if (ligne) ligne.textContent = texte;
    if (sourceOuverte?.id === id) document.getElementById('sourceEtat').textContent = texte;
  };
  ecrire(t('cat.telechargement_debut'));
  const arreterEcoute = await ecouter('catalogue:progress', (ev) => {
    const { fait, total } = ev.payload;
    ecrire(total ? t('cat.telechargement', { f: fait, n: total }) : t('cat.telechargement_debut'));
  });
  let message;
  let ok = true;
  try {
    const r = await invoke('install_source', { id });
    const morceaux = [t('cat.installe', { v: r.version })];
    if (r.copies.length) morceaux.push(t('cat.copies', { f: r.copies.join(', ') }));
    if (r.retires.length) morceaux.push(t('cat.retires_info', { f: r.retires.map(titreElement).join(', ') }));
    message = morceaux.join(' ');
    bilansSources.delete(id);
  } catch (e) {
    console.error('Installation du catalogue :', e);
    message = messageErreurCatalogue(e);
    ok = false;
  } finally {
    arreterEcoute();
    catalogueInstallation = false;
  }
  await chargerSources();
  if (ok) await chargerLots();
  ecrire(message);
  rendreBandeauCatalogue();
  return ok;
}

/** La page « Consulter et choisir » d'un catalogue. */
async function consulterSource(id, { message = '' } = {}) {
  const x = sourceParId(id);
  if (!x || catalogueInstallation) return;
  sourceOuverte = { id, contenu: null, exclus: new Set() };
  document.getElementById('sourceFilNom').textContent = nomSource(id);
  document.getElementById('sourceTitre').textContent = nomSource(id);
  document.getElementById('sourceSous').textContent = x.officielle
    ? t('offre.officiel_desc')
    : `github.com/${x.depot} — ${t('cat.tierce_avert')}`;
  rendreContenuSource();
  afficherSectionReglages('source');
  const etat = document.getElementById('sourceEtat');
  etat.textContent = t('cat.consultation_debut');
  const arreterEcoute = await ecouter('catalogue:progress', (ev) => {
    const { fait, total } = ev.payload;
    if (sourceOuverte?.id === id && total) etat.textContent = t('cat.consultation', { f: fait, n: total });
  });
  try {
    const contenu = await invoke('source_contents', { id });
    if (sourceOuverte?.id !== id) return;
    sourceOuverte.contenu = contenu;
    sourceOuverte.exclus = new Set(contenu.filter((c) => c.exclu).map((c) => c.id));
    etat.textContent = message;
  } catch (e) {
    console.error('Consultation du catalogue :', e);
    if (sourceOuverte?.id === id) etat.textContent = messageErreurCatalogue(e);
  } finally {
    arreterEcoute();
  }
  rendreContenuSource();
}

const ETATS_ACTION = {
  absent: ['cat.etat_absent_s', 'neutre'],
  installe: ['cat.etat_installe_s', 'low'],
  maj: ['cat.etat_maj_s', 'acc'],
  modifie: ['cat.etat_modifie_s', 'med'],
};

function rendreContenuSource() {
  const o = sourceOuverte;
  const contenu = o?.contenu || [];
  const liste = document.getElementById('sourceListe');
  liste.innerHTML = contenu
    .map((c) => {
      const coche = !o.exclus.has(c.id);
      const [cle, classe] = ETATS_ACTION[c.etat] || ETATS_ACTION.absent;
      const risque = c.risk === 'high' || c.risk === 'medium'
        ? `<span class="badge ${c.risk === 'high' ? 'high' : 'med'}">${esc(t(`risque.${c.risk}`))}</span>`
        : '';
      const desc = texteLangue(c.desc);
      return `<li class="source-action${coche ? '' : ' exclu'}">
        <label>
          <input type="checkbox" data-action-id="${esc(c.id)}"${coche ? ' checked' : ''} />
          <span class="sa-txt">
            <b>${esc(texteLangue(c.title) || c.file)}</b>
            ${desc ? `<span class="desc">${esc(desc)}</span>` : ''}
            <span class="sa-meta"><span class="badge ${classe}">${esc(t(cle))}</span>${risque}${
              c.admin ? `<span class="badge neutre">${esc(t('badge.admin_requis'))}</span>` : ''
            }<span class="muted mono">${esc(c.version)}</span></span>
          </span>
        </label>
      </li>`;
    })
    .join('');
  if (o?.contenu && !contenu.length) liste.innerHTML = `<li class="rg-vide">${esc(t('cat.vide'))}</li>`;
  const coches = contenu.filter((c) => !o.exclus.has(c.id)).length;
  document.getElementById('sourceCompte').textContent = contenu.length ? t('cat.compte', { c: coches, n: contenu.length }) : '';
  const pret = !!o?.contenu && !catalogueInstallation;
  for (const b of ['btnSourceTout', 'btnSourceRien', 'btnSourceAppliquer']) document.getElementById(b).disabled = !pret;
}

/** Retient les actions decochees, puis installe le reste. Une action
 *  decochee n'apparait plus ; son fichier, s'il etait installe, reste la. */
async function appliquerSelectionSource() {
  const o = sourceOuverte;
  if (!o?.contenu || catalogueInstallation || executionEnCours()) return;
  try {
    reglagesActuels = await invoke('set_source_selection', { id: o.id, exclus: [...o.exclus] });
  } catch (e) {
    document.getElementById('sourceEtat').textContent = messageErreurCatalogue(e);
    return;
  }
  document.getElementById('btnSourceAppliquer').disabled = true;
  const ok = await installerSource(o.id);
  await chargerLots();
  await chargerSources();
  if (ok) await consulterSource(o.id, { message: t('cat.applique') });
  else rendreContenuSource();
}

function ouvrirFormulaireSource(id = null) {
  sourceModifiee = id;
  const x = id ? sourceParId(id) : null;
  document.getElementById('sourceFormTitre').textContent = x
    ? t('cat.form_modifier_titre', { nom: x.nom })
    : t('cat.ajouter_titre');
  document.getElementById('sourceDepot').value = x ? `https://github.com/${x.depot}` : '';
  document.getElementById('sourceCle').value = x?.cle_publique || '';
  document.getElementById('sourceNom').value = x?.nom || '';
  document.getElementById('btnSourceValider').textContent = t(x ? 'cat.form_enregistrer' : 'cat.form_ajouter');
  document.getElementById('sourceErreur').hidden = true;
  const form = document.getElementById('sourceForm');
  form.hidden = false;
  form.scrollIntoView({ block: 'nearest' });
  document.getElementById('sourceDepot').focus();
}

function fermerFormulaireSource() {
  document.getElementById('sourceForm').hidden = true;
  sourceModifiee = null;
}

async function validerFormulaireSource(ev) {
  ev.preventDefault();
  const depot = document.getElementById('sourceDepot').value.trim();
  const cle = document.getElementById('sourceCle').value.trim();
  const nom = document.getElementById('sourceNom').value.trim();
  const erreur = document.getElementById('sourceErreur');
  const valider = document.getElementById('btnSourceValider');
  if (!depot || !cle) {
    erreur.textContent = t('cat.err_champs');
    erreur.hidden = false;
    return;
  }
  valider.disabled = true;
  valider.textContent = t('cat.form_verification');
  erreur.hidden = true;
  let id = sourceModifiee;
  try {
    if (sourceModifiee) await invoke('update_source', { id: sourceModifiee, nom, depot, cle });
    else id = await invoke('add_source', { depot, cle, nom });
  } catch (e) {
    console.error('Catalogue :', e);
    erreur.textContent = messageErreurCatalogue(e);
    erreur.hidden = false;
    valider.disabled = false;
    valider.textContent = t(sourceModifiee ? 'cat.form_enregistrer' : 'cat.form_ajouter');
    return;
  }
  const ajout = !sourceModifiee;
  valider.disabled = false;
  fermerFormulaireSource();
  await chargerSources();
  await chargerLots();
  const ligne = document.querySelector(`[data-source-etat="${CSS.escape(id)}"]`);
  if (ligne && ajout) ligne.textContent = t('cat.ajoute', { nom: nomSource(id) });
}

async function retirerSource(id) {
  if (!confirm(t('cat.confirmer_retrait', { nom: nomSource(id) }))) return;
  try {
    await invoke('remove_source', { id });
    bilansSources.delete(id);
  } catch (e) {
    console.error('Retrait du catalogue :', e);
    const ligne = document.querySelector(`[data-source-etat="${CSS.escape(id)}"]`);
    if (ligne) ligne.textContent = messageErreurCatalogue(e);
    return;
  }
  reglagesActuels = await invoke('get_settings');
  await chargerSources();
  await chargerLots();
  rendreBandeauCatalogue();
}

/** Desactiver : la source n'est plus interrogee, ses actions n'apparaissent
 *  plus. Reactiver les rend telles quelles. */
async function basculerSource(id) {
  const x = sourceParId(id);
  if (!x) return;
  try {
    reglagesActuels = await invoke('set_source_active', { id, active: !x.active });
  } catch (e) {
    console.error('Activation du catalogue :', e);
    return;
  }
  if (x.active) bilansSources.delete(id);
  await chargerSources();
  await chargerLots();
  rendreBandeauCatalogue();
  const etapeVisible = document.querySelector('.s-step:not([hidden])')?.dataset.s;
  if (modeCourant === 'simple' && etapeVisible === '1') await rendreEtapeChoisir();
}

function cablerSources() {
  document.getElementById('sourcesListe').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || b.disabled) return;
    if (b.id === 'btnCatalogue') {
      if (!etatCatalogue?.installe || bilanCatalogue) installerCatalogue();
      else verifierCatalogue();
      return;
    }
    const d = b.dataset;
    if (d.sourceConsulter) return void consulterSource(d.sourceConsulter);
    if (d.sourceActive) return void basculerSource(d.sourceActive);
    if (d.sourceModifier) return void ouvrirFormulaireSource(d.sourceModifier);
    if (d.sourceRetirer) return void retirerSource(d.sourceRetirer);
    if (d.sourceAgir) {
      const x = sourceParId(d.sourceAgir);
      if (!x?.installe || bilansSources.has(x.id)) installerSource(x.id);
      else verifierSource(x.id);
    }
  });
  document.getElementById('btnSourceAjouter').onclick = () => ouvrirFormulaireSource(null);
  document.getElementById('btnSourceAnnuler').onclick = fermerFormulaireSource;
  document.getElementById('sourceForm').addEventListener('submit', validerFormulaireSource);
  document.getElementById('btnSourcesDroits').onclick = () => {
    fermerReglages();
    ouvrirFenetreDroits();
  };
  document.getElementById('sourceListe').addEventListener('change', (ev) => {
    const c = ev.target.closest('[data-action-id]');
    if (!c || !sourceOuverte) return;
    if (c.checked) sourceOuverte.exclus.delete(c.dataset.actionId);
    else sourceOuverte.exclus.add(c.dataset.actionId);
    rendreContenuSource();
  });
  document.getElementById('btnSourceTout').onclick = () => {
    if (!sourceOuverte) return;
    sourceOuverte.exclus.clear();
    rendreContenuSource();
  };
  document.getElementById('btnSourceRien').onclick = () => {
    if (!sourceOuverte?.contenu) return;
    sourceOuverte.exclus = new Set(sourceOuverte.contenu.map((c) => c.id));
    rendreContenuSource();
  };
  document.getElementById('btnSourceAppliquer').onclick = appliquerSelectionSource;
}

/** Accueil sans aucun script (§16.6) : la liste des catalogues proposes, la
 *  source officielle en tete, et un moyen de continuer sans — l'utilisateur
 *  qui veut deposer ses propres scripts n'a pas a refuser quoi que ce soit
 *  pour arriver a l'application. */
async function rendreOffreCatalogue() {
  document.getElementById('buoysZone').innerHTML = '';
  positionnerBouees();
  document.getElementById('sectAutres').hidden = true;
  document.getElementById('s1Barre').hidden = true;

  const avecCle = !!etatCatalogue?.cle;
  const sans = reglagesActuels?.catalogue_source === 'none' || !avecCle;
  // Un historique ou des reglages de scripts : cet utilisateur vient d'une
  // version qui livrait les scripts dans l'installeur. Ses lots et ses reglages
  // sont intacts (ils portent sur les id, que le catalogue conserve) ; il doit
  // l'apprendre, plutot que de se croire face a une installation neuve.
  const retour =
    (historiqueActuel?.scripts?.length || 0) > 0 || Object.keys(reglagesActuels?.overrides || {}).length > 0;
  document.getElementById('s1Titre').textContent = t(retour && !sans ? 'offre.titre_retour' : 'offre.titre');
  document.getElementById('s1Sous').textContent = t(sans ? 'offre.sous_sans' : retour ? 'offre.sous_retour' : 'offre.sous');

  const carte = avecCle
    ? `<div class="offre-source">
        <div class="ri">${(await iconeSVG('shield-check')) || ''}</div>
        <div class="offre-corps">
          <div class="rt">${esc(t('offre.officiel'))} <span class="badge acc">${esc(t('offre.badge_officiel'))}</span></div>
          <div class="rd">${esc(t('offre.officiel_desc'))}</div>
          <div class="rd discret">${esc(t('offre.vie_privee'))}</div>
        </div>
        <button class="btn primary" type="button" data-offre="installer"${catalogueInstallation ? ' disabled' : ''}>${esc(t('offre.installer'))}</button>
      </div>`
    : '';
  const suite = sans
    ? `<p class="muted offre-note">${esc(t(avecCle ? 'offre.deposer' : 'offre.deposer_seul'))}</p>
       <button class="btn" type="button" data-offre="dossier">${esc(t('offre.ouvrir_dossier'))}</button>`
    : `<button class="btn" type="button" data-offre="sans">${esc(t('offre.continuer_sans'))}</button>
       <p class="muted offre-note">${esc(t('offre.continuer_sans_aide'))}</p>`;
  document.getElementById('recoCard').innerHTML =
    `<div class="offre">${carte}<p class="offre-etat" id="offreEtat" aria-live="polite"></p>${suite}</div>`;
}

/** Des scripts, mais aucun catalogue : ils ne recevront aucune mise a jour.
 *  Une fois par session, jamais par-dessus l'accueil du premier lancement. */
function proposerRappelCatalogue() {
  if (rappelCatalogueMontre || !etatCatalogue?.cle) return;
  if (etatCatalogue.installe || etatCatalogue.probleme) return;
  if (reglagesActuels?.catalogue_reminder_hidden) return;
  // Sans aucun script, c'est l'accueil qui propose le catalogue.
  if (catalogue.size === 0) return;
  if (!document.getElementById('onboarding').hidden) return;
  rappelCatalogueMontre = true;
  document.getElementById('rappelNePlus').checked = false;
  document.getElementById('rappelCatalogue').hidden = false;
}

async function fermerRappelCatalogue() {
  document.getElementById('rappelCatalogue').hidden = true;
  if (!document.getElementById('rappelNePlus').checked) return;
  try {
    reglagesActuels = await invoke('hide_catalogue_reminder');
  } catch (e) {
    console.error('Rappel du catalogue :', e);
  }
}

function cablerCatalogue() {
  document.getElementById('catInstaller').addEventListener('click', (ev) => {
    if (ev.currentTarget.dataset.action === 'voir') {
      sectionReglages = 'catalogue';
      if (!reglagesOuverts()) ouvrirReglages();
      else afficherSectionReglages('catalogue');
      return;
    }
    installerCatalogue();
  });
  document.getElementById('catPlusTard').addEventListener('click', () => {
    catalogueRepousse = true;
    document.getElementById('catBanner').hidden = true;
  });
  cablerSources();
  document.getElementById('setCatalogueSelect').onchange = async (ev) => {
    reglagesActuels = await invoke('set_catalogue_check', { policy: ev.target.value });
  };
  document.getElementById('btnRappelFermer').onclick = fermerRappelCatalogue;
  document.getElementById('btnRappelInstaller').onclick = async () => {
    await fermerRappelCatalogue();
    installerCatalogue();
  };
  document.getElementById('recoCard').addEventListener('click', async (ev) => {
    const bouton = ev.target.closest('[data-offre]');
    if (!bouton) return;
    if (bouton.dataset.offre === 'installer') return void installerCatalogue();
    if (bouton.dataset.offre === 'dossier') return void invoke('open_scripts_folder').catch((e) => console.error(e));
    if (bouton.dataset.offre === 'sans') {
      try {
        reglagesActuels = await invoke('set_catalogue_source', { source: 'none' });
      } catch (e) {
        console.error('Choix du catalogue :', e);
      }
      await rendreEtapeChoisir();
    }
  });
}

/**
 * Reflete l'etat de la simulation (§6.9) : pastille a trois etats, bandeau.
 *
 * La simulation est conservee d'une session a l'autre. Le risque n'est donc
 * plus d'oublier qu'elle est active a la fermeture, mais de croire reel un
 * entretien simule : le bandeau reste affiche tant qu'un seul script l'est.
 */
function appliquerSimulation(bilan) {
  if (bilan) simulation = bilan;
  const { etat, simules, simulables } = simulation;
  document.body.dataset.simulation = etat;

  const pastille = document.getElementById('testPill');
  if (pastille) {
    pastille.setAttribute('aria-pressed', etat === 'activee' ? 'true' : etat === 'partielle' ? 'mixed' : 'false');
    pastille.dataset.tip = t(`simulation.infobulle_${etat}`, { n: simules, total: simulables });
    document.getElementById('testPillText').textContent = t(`simulation.pastille_${etat}`, { n: simules, total: simulables });
  }

  const bandeau = document.getElementById('testBanner');
  if (bandeau) {
    bandeau.hidden = etat === 'desactivee';
    bandeau.textContent = etat === 'activee'
      ? t('simulation.bandeau_activee')
      : t('simulation.bandeau_partielle', { n: simules, total: simulables });
  }
}

async function rafraichirSimulation() {
  try {
    appliquerSimulation(await invoke('simulation_state'));
  } catch (e) {
    console.error('Etat de la simulation illisible :', e);
  }
}

/** L'interrupteur general : simule tout ce qui peut l'etre, ou repasse tout en
 *  reel. Chaque script se regle ensuite a nouveau un par un. */
async function basculerSimulation() {
  try {
    const reglages = await invoke('set_simulation_all', { value: simulation.etat !== 'activee' });
    reglagesActuels = reglages;
    if (etatGroupes) etatGroupes.overrides = reglages.overrides;
  } catch (e) {
    console.error('Simulation non modifiee :', e);
  }
  await rafraichirSimulation();
  rendreDetail();
  // L'etape 2 du mode Simple affiche quels scripts seront simules.
  if (entretienEnCours && !entretienActif && !document.querySelector('.s-step[data-s="2"]').hidden) {
    if (groupeLancement) await rendreEtapeVerifier(groupeLancement);
  }
}

/**
 * Reflete l'etat des droits dans la barre de titre.
 *
 * L'application s'ouvre desormais sans elevation : la pastille doit donc dire
 * les DEUX etats, pas seulement le bon. Une pastille qui disparait quand les
 * droits manquent ne renseigne personne — c'est precisement le moment ou
 * l'information compte.
 */
function appliquerDroits(eleve) {
  estEleve = !!eleve;
  const p = document.getElementById('adminPill');
  if (!p) return;
  p.classList.toggle('ok', estEleve);
  p.classList.toggle('manquant', !estEleve);
  document.getElementById('adminPillText').textContent =
    t(estEleve ? 'chrome.administrateur' : 'chrome.sans_droits');
  p.dataset.tip = t(estEleve ? 'droits.tip_ok' : 'droits.tip_manquant');
}

function ouvrirFenetreDroits() {
  document.getElementById('droitsTitre').textContent =
    t(estEleve ? 'droits.titre_ok' : 'droits.titre_manquant');
  document.getElementById('droitsTexte').textContent =
    t(estEleve ? 'droits.texte_ok' : 'droits.texte_manquant');
  document.getElementById('btnFermerDroits').textContent = t('action.fermer');
  const relancer = document.getElementById('btnRelancerAdmin');
  relancer.hidden = estEleve;
  relancer.textContent = t('droits.relancer');
  document.getElementById('droitsOverlay').hidden = false;
}

/**
 * Echelle de rendu (accessibilite).
 *
 * `zoom` plutot que `font-size` : la feuille de style est en pixels, un
 * changement de taille de police ne redimensionnerait donc ni les boutons, ni
 * les icones, ni les espacements. `zoom` remet tout a l'echelle ET reflue la
 * mise en page, contrairement a `transform: scale` qui laisserait les
 * dimensions d'origine et ferait deborder la fenetre.
 */
function appliquerEchelle(valeur) {
  const n = Number(valeur);
  const echelle = Number.isFinite(n) && n > 0 ? n : 1;
  // `zoom` agrandit tout, y compris ce qui se mesure en unites de fenetre : sous
  // un zoom de 1,5, 100vh vaut 150 % de la hauteur reelle. L'application
  // debordait alors sous l'ecran, emportant le bouton « Continuer », et les
  // fenetres plafonnees en vh debordaient par le haut, croix de fermeture
  // comprise. --echelle permet a ces regles de se compenser (styles.css).
  document.documentElement.style.zoom = String(echelle);
  document.documentElement.style.setProperty('--echelle', String(echelle));
  requestAnimationFrame(positionnerBouees);
}

/**
 * Ouvre ou ferme le journal, ET remet le bouton « Voir le detail technique »
 * en accord avec ce qui est affiche.
 *
 * Le panneau etait ouvert directement par trois endroits differents
 * (`ouvrirTerminal`, `alerterEchecLancement`, `journaliserRefus`) sans que le
 * bouton en soit informe : il continuait d'afficher « Voir » alors que le
 * journal etait deja la, et ne se recalait qu'au premier clic. Une seule
 * fonction porte desormais l'etat.
 */
function afficherJournal(visible) {
  if (!term.panneau) return;
  term.panneau.hidden = !visible;
  synchroniserBoutonDetail();
}

function fermerJournal() {
  afficherJournal(false);
}

function synchroniserBoutonDetail() {
  const bouton = document.getElementById('btnDetailTechnique');
  if (!bouton || !term.panneau) return;
  const ouvert = !term.panneau.hidden;
  bouton.setAttribute('aria-expanded', String(ouvert));
  bouton.innerHTML = `${esc(ouvert ? t('simple.masquer_detail') : t('simple.voir_detail'))} <svg class="ico i14" aria-hidden="true"><use href="#chevron"/></svg>`;
}

function cablerConsole() {
  document.querySelectorAll('#consoleSeg [data-console-mode]').forEach((b) => {
    b.textContent = t(`console.${b.dataset.consoleMode}`);
    b.onclick = () => basculerConsole(b.dataset.consoleMode);
  });
  rendreFiltresJournal();
  // Le journal compact de la colonne est lui-meme le raccourci vers le detail :
  // cliquer sur l'apercu ouvre le panneau complet, ce qu'on attend d'un apercu.
  const compact = document.getElementById('lotsJournal');
  // Sans aucune ligne, basculer en « Étendu » faisait disparaitre l'apercu
  // pour ouvrir un panneau lui-meme vide et masque : tout s'effacait d'un
  // clic. Tant qu'il n'y a rien a lire, l'apercu ne mene nulle part.
  if (compact) {
    compact.onclick = () => {
      const vide = document.getElementById('ljBody')?.classList.contains('vide');
      if (!vide) basculerConsole('etendu');
    };
  }
  document.getElementById('ljKicker').textContent = t('console.journal');
  viderJournalCompact();
  basculerConsole('compact');
}

/** Etat affiche au pied de la colonne : ce qui tourne, ou rien. */
function majEtatJournalCompact() {
  const etat = document.getElementById('ljEtat');
  if (!etat) return;
  etat.textContent = course ? t('console.en_cours') : '';
  etat.classList.toggle('actif', !!course);
}

/** Vrai si l'utilisateur regarde le bas : on ne lui arrache pas son defilement. */
function colleEnBas() {
  const c = term.corps;
  return c.scrollHeight - c.scrollTop - c.clientHeight < 40;
}

/**
 * Heure d'une ligne, au format d'un journal (maquette : `14:32:10`).
 *
 * Le moteur date chaque ligne en millisecondes depuis le debut de
 * l'execution ; on la rapporte a l'heure de depart du run. Un temps ecoule
 * seul (« 1,3 s ») ne dit pas quand quelque chose s'est produit, ce qui est
 * justement ce qu'on cherche en rouvrant un journal.
 */
function heureLigne(at_ms) {
  const d = new Date((departCourse || Date.now()) + at_ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Nombre de lignes gardees dans le journal compact de la colonne. Au-dela,
 *  la colonne deviendrait un second terminal : ce n'est pas son role. */
const LIGNES_COMPACT = 6;

/**
 * Reporte une ligne dans le journal compact du panneau lateral.
 *
 * Volontairement tronque : la colonne est etroite, et ce qu'on veut y lire
 * c'est « ou en est-on », pas le detail. Le detail s'ouvre en « Étendu ».
 */
function ajouterLigneCompacte({ stream, marker, text }) {
  const corps = document.getElementById('ljBody');
  if (!corps) return;
  // Le texte de repos est un noeud texte, pas un element : retirer la classe
  // ne le fait pas disparaitre, il faut vider le conteneur une bonne fois.
  // Sans cela, « Aucune execution pour l'instant. » restait affiche au-dessus
  // des lignes qui arrivaient.
  if (corps.classList.contains('vide')) {
    corps.textContent = '';
    corps.classList.remove('vide');
  }

  const classes = ['ljl', `s-${stream}`, `f-${familleLigne(marker, stream)}`];
  if (marker) classes.push(`m-${marker.toLowerCase()}`);
  const ligne = document.createElement('span');
  ligne.className = classes.join(' ');
  ligne.textContent = text;
  ligne.title = text;
  corps.appendChild(ligne);

  while (corps.childElementCount > LIGNES_COMPACT) corps.firstElementChild.remove();
}

/** Remet le journal compact a son etat de repos, sans le faire disparaitre. */
function viderJournalCompact() {
  const corps = document.getElementById('ljBody');
  if (!corps) return;
  corps.classList.add('vide');
  corps.textContent = t('console.aucune_execution');
}

function ajouterLigne({ at_ms, stream, marker, text }) {
  ajouterLigneCompacte({ stream, marker, text });

  const suivre = colleEnBas();
  const classes = ['tl', `s-${stream}`, `f-${familleLigne(marker, stream)}`];
  if (marker) classes.push(`m-${marker.toLowerCase()}`);

  const ligne = document.createElement('div');
  ligne.className = classes.join(' ');
  ligne.innerHTML = `<span class="t">${heureLigne(at_ms)}</span><span>${esc(text)}</span>`;
  term.corps.appendChild(ligne);

  while (term.corps.childElementCount > LIGNES_MAX) term.corps.firstElementChild.remove();
  if (suivre) term.corps.scrollTop = term.corps.scrollHeight;
}

function ouvrirTerminal(entree, demarre) {
  const tr = entree.meta.translations?.[currentLang()];
  term.titre.textContent = tr?.title || entree.meta.title || entree.id;
  term.sous.textContent = `${demarre.engine} · ${demarre.policy} · pid ${demarre.pid}`;
  term.corps.innerHTML = '';
  // Nouvelle execution : l'apercu de la colonne repart de zero lui aussi,
  // sinon il melangerait les lignes de deux scripts differents.
  viderJournalCompact();
  majEtatJournalCompact();
  term.prog.style.width = '0';
  afficherJournal(true);
  term.stop.hidden = false;
  term.stop.disabled = false;
  term.stop.textContent = t('action.arreter');
  term.log.hidden = true;
  term.log.textContent = t('action.ouvrir_journal');
  // Le chemin est pose des le lancement. Il etait lu depuis `course`, qui
  // vaut null une fois l'execution terminee : le bouton n'apparaissant
  // qu'a ce moment-la, il ne pouvait jamais fonctionner.
  term.log.dataset.path = demarre.log_path || '';
  term.fermer.hidden = true;
  etiqueterFermerJournal();
}

/** « Fermer » du journal : une croix et le mot, comme les autres boutons du
 *  journal qui portent une icone. */
function etiqueterFermerJournal() {
  term.fermer.innerHTML = `<svg class="ico i14" aria-hidden="true"><use href="#x" /></svg>${esc(t('action.fermer'))}`;
}

const PLURIEL = (cle, n) => t(cle, { n, s: n > 1 ? 's' : '' });

/* --- Temoin des changements sensibles (§12.5) ----------------------------
   Le moteur releve, avant et apres chaque script, ce qu'un logiciel
   malveillant modifie pour s'installer ; `script:end` en porte la difference. */

const FAMILLES_TEMOIN = ['tasks', 'services', 'autorun', 'environment', 'defender', 'hosts', 'certificates', 'firewall'];

/** « Programmes de fond de Windows : 2 modifiés, 1 ajouté ». */
function resumeTemoin(changes) {
  return FAMILLES_TEMOIN.map((f) => {
    const ici = changes.filter((c) => c.family === f);
    if (!ici.length) return null;
    const genre = t(`temoin.g.${f}`) === 'f' ? 'f' : 'm';
    const parts = ['added', 'modified', 'removed']
      .map((k) => [k, ici.filter((c) => c.kind === k).length])
      .filter(([, n]) => n)
      .map(([k, n]) => PLURIEL(`temoin.${k}_${genre}`, n));
    return `${t(`temoin.f.${f}`)} : ${parts.join(', ')}`;
  }).filter(Boolean);
}

/** Le detail exact, pour le journal (mode Expert, detail technique). */
function journaliserTemoin(changes) {
  for (const c of changes) {
    ajouterLigne({ at_ms: 0, stream: 'stdout', marker: 'WARN', text: `[WARN] ${t('temoin.ligne', { famille: t(`temoin.f.${c.family}`), genre: t(`temoin.k.${c.kind}`), nom: c.name })}` });
  }
}

/** Le bilan du temoin, sous la liste des taches de l'entretien. */
function rendreTemoinBilan() {
  const zone = document.getElementById('temoinBilan');
  const res = entretienEnCours?.resultats || [];
  const touches = res.filter((r) => r.changes?.length);
  const regarde = res.length && res.every((r) => r.watched?.length);
  if (!touches.length) {
    zone.hidden = !regarde;
    zone.className = 'temoin calme';
    zone.innerHTML = regarde ? `${ico('shield-check', 'i16')}<span>${esc(t('temoin.rien'))}</span>` : '';
    return;
  }
  zone.hidden = false;
  zone.className = 'temoin';
  const simules = touches.filter((r) => r.simule);
  zone.innerHTML = `<div class="temoin-h">${ico('warn', 'i16')}<b>${esc(t('temoin.titre'))}</b></div>
    ${simules.map((r) => `<p class="temoin-alerte">${esc(t('temoin.simulation', { titre: titreDe(r.id) }))}</p>`).join('')}
    ${touches.map((r) => `<div class="temoin-action"><b>${esc(titreDe(r.id))}</b><ul>${resumeTemoin(r.changes).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`).join('')}
    <p class="muted temoin-note">${esc(t('temoin.explication'))}</p>`;
}

function titreDe(id) {
  const s = catalogue.get(id);
  return s ? (s.meta.translations?.[currentLang()]?.title || s.meta.title || id) : id;
}

/** Les analyses qui ont modifie Windows, alors qu'elles ne le devaient pas. */
const temoinAnalyses = new Map();

function afficherVerdict(fin) {
  const secondes = (fin.duration_ms / 1000).toFixed(1);
  const bloc = document.createElement('div');

  let ton, titre;
  if (fin.killed) {
    ton = 'warn';
    titre = t('verdict.interrompu');
  } else if (fin.success) {
    ton = 'ok';
    titre = t(fin.analysis ? 'verdict.analyse_terminee' : 'verdict.termine');
  } else {
    ton = 'bad';
    // Le verdict vient du code de sortie, jamais du fait que le script a
    // demarre. C'est le defaut de la v3 que corrige cette ligne.
    titre = t(fin.analysis ? 'verdict.analyse_echec' : 'verdict.echec');
  }

  // Le bloc disait « Echec — code de sortie 1 · 3 reussites · 1 erreur »
  // sans dire de QUOI il parlait, ni d'ou venaient ces nombres. Le titre
  // nomme maintenant le script, et les deux natures de chiffres sont
  // separees : le code de sortie est le verdict du processus, les compteurs
  // viennent des marqueurs que le script a lui-meme ecrits.
  const sujet = term.titre?.textContent || '';
  const marqueurs = [
    fin.counts_ok ? PLURIEL('verdict.reussite', fin.counts_ok) : '',
    fin.counts_warn ? PLURIEL('verdict.avertissement', fin.counts_warn) : '',
    fin.counts_err ? PLURIEL('verdict.erreur', fin.counts_err) : '',
  ].filter(Boolean);

  const details = [
    `${secondes} s`,
    fin.killed ? '' : t('verdict.code_sortie', { code: fin.exit_code ?? '?' }),
    fin.reboot_requested ? t('verdict.redemarrage_necessaire') : '',
  ].filter(Boolean);

  bloc.className = `term-verdict ${ton}`;
  bloc.innerHTML =
    `<b>${esc(titre)}</b>` +
    (sujet ? `<span class="vsujet">${esc(sujet)}</span>` : '') +
    `<span class="vmeta">${esc(details.join(' · '))}</span>` +
    (marqueurs.length
      ? `<span class="vmeta">${esc(marqueurs.join(' · '))} <i>${esc(t('verdict.compte_marqueurs'))}</i></span>`
      : '');
  term.corps.appendChild(bloc);
  term.corps.scrollTop = term.corps.scrollHeight;

  term.prog.style.width = fin.success ? '100%' : term.prog.style.width;
  term.stop.hidden = true;
  term.log.hidden = false;
  term.fermer.hidden = false;
}

/* -------------------------------------------------------------------------
   Confiance a la premiere execution (specification 12.1) — seule exception
   au principe "constater, jamais bloquer" (§5.4) : refuser est ici le
   comportement voulu.
   ------------------------------------------------------------------------- */

/** Resout la promesse ouverte par `assurerApprobation`, ou null hors attente. */
let resolutionApprobation = null;
/** Hash exactement affiche a l'ecran de confiance ouvert — c'est lui qu'on
 *  approuve au clic, jamais un hash relu entre-temps (specification 12.4 :
 *  contenu et hash affiches viennent d'une seule et meme lecture). */
let hashEnApprobation = null;

function ouvrirEcranConfiance(entree, requete) {
  hashEnApprobation = requete.hash;
  const tr = entree.meta.translations?.[currentLang()];
  document.getElementById('trustTitre').textContent = tr?.title || entree.meta.title || entree.id;
  // D'ou vient ce script se lit avant de decider (§16.6) : un catalogue ajoute
  // n'est ni controle ni approuve par le projet WinTool.
  const empreinte = t('trust.sous', { hash: requete.hash.slice(0, 16) });
  document.getElementById('trustSous').textContent =
    entree.origin === 'tierce' ? `${t('trust.tierce', { nom: nomSource(entree.source) })} ${empreinte}` : empreinte;
  document.getElementById('trustCode').textContent = requete.source;

  const zone = document.getElementById('trustAttention');
  if (requete.attention.length) {
    zone.hidden = false;
    zone.innerHTML =
      `<div class="box-h">${esc(t('trust.attention_titre'))}</div>` +
      requete.attention
        .map(
          (p) => `
        <div class="finding warning">
          <span class="ln">${esc(t('trust.ligne'))} ${p.ligne}</span>
          <span class="code">${esc(p.code)}</span>
          <span class="msg">${esc(p.extrait)}</span>
        </div>`
        )
        .join('');
  } else {
    zone.hidden = true;
    zone.innerHTML = '';
  }

  document.getElementById('btnTrustApprouver').textContent = t('trust.approuver');
  document.getElementById('btnTrustAnnuler').textContent = t('trust.annuler');
  document.getElementById('trustOverlay').hidden = false;
}

/** Verifie l'approbation avant de lancer ; montre l'ecran de confiance si
 *  besoin et attend la decision. Renvoie true si le script peut etre lance
 *  (deja approuve, ou approuve a l'instant), false si l'utilisateur refuse.
 *  Une panne de la verification elle-meme n'est jamais bloquante ici : c'est
 *  `run_script` qui reste l'autorite finale (§12.1), refaisant le meme
 *  controle cote Rust et renvoyant `NON_APPROUVE_MARQUEUR` si necessaire. */
async function assurerApprobation(entree) {
  let requete;
  try {
    requete = await invoke('preparer_approbation', { scriptId: entree.id });
  } catch (e) {
    console.error('preparer_approbation a echoue :', e);
    return true;
  }
  if (!requete) return true;
  return new Promise((resolve) => {
    resolutionApprobation = resolve;
    ouvrirEcranConfiance(entree, requete);
  });
}

function cablerConfiance() {
  document.getElementById('btnTrustApprouver').onclick = async () => {
    try {
      await invoke('approve_script', { hash: hashEnApprobation });
    } catch (e) {
      console.error('approve_script a echoue :', e);
    }
    document.getElementById('trustOverlay').hidden = true;
    resolutionApprobation?.(true);
    resolutionApprobation = null;
  };
  document.getElementById('btnTrustAnnuler').onclick = () => {
    document.getElementById('trustOverlay').hidden = true;
    resolutionApprobation?.(false);
    resolutionApprobation = null;
  };
}

/* -------------------------------------------------------------------------
   Lancement
   ------------------------------------------------------------------------- */
/** Un refus de lancement doit se voir : il ne part pas dans la console. */
/**
 * Ecrit un refus de lancement dans le journal, comme s'il venait du script.
 *
 * Un refus arrive AVANT que le processus ne demarre : aucun `script:line`
 * n'est emis, le journal reste donc vide et l'interface se contente d'un
 * « Echoue » muet. C'etait le cas pour toutes les causes de refus — moteur
 * absent, empreinte changee, script non simulable, ligne d'override refusee.
 * Le motif `catch { console.error }` masquait tout, et une application n'a
 * pas de console ouverte.
 */
function journaliserRefus(entree, message) {
  const tr = entree?.meta?.translations?.[currentLang()];
  const titre = tr?.title || entree?.meta?.title || entree?.id || '';
  if (term.panneau) {
    afficherJournal(true);
    if (term.titre) term.titre.textContent = titre;
    if (term.sous) term.sous.textContent = t('verdict.lancement_refuse_sous');
  }
  ajouterLigne({
    at_ms: 0,
    stream: 'stderr',
    marker: 'ERR',
    text: `[ERR] ${titre} — ${message}`,
  });
}

/** Traduit les sentinelles du moteur en phrase comprehensible. */
function messageLancement(brut, entree) {
  const texte = String(brut).replace(/^Error:\s*/, '');
  if (texte.includes('SANS_SIMULATION')) return t('simulation.script_refuse');
  if (texte.includes('ANALYSE_PERIMEE')) return t('an.perimee');
  if (texte.includes('SANS_ANALYSE')) return t('an.sans_analyse');
  if (texte.includes('APPROBATION_SANS_DROITS')) return t('droits.approbation_impossible');
  // Garde des reglages (§12.4) : `REGLAGE_REFUSE:<nature>:<cle>:<detail>`. Le
  // detail peut contenir des deux-points (un chemin) : on ne coupe qu'aux trois
  // premiers.
  if (texte.startsWith('REGLAGE_REFUSE:')) {
    const [, nature, cle, ...reste] = texte.split(':');
    const valeur = reste.join(':');
    const opt = entree?.meta?.options?.find((o) => o.key === cle);
    const option = opt ? libelleOption(entree, opt).label : cle;
    return t(`garde.refus_${nature}`, { option, valeur });
  }
  return texte;
}

function alerterEchecLancement(entree, message) {
  term.titre.textContent = entree.meta.title || entree.id;
  term.sous.textContent = t('verdict.lancement_refuse_sous');
  term.corps.innerHTML = '';
  term.prog.style.width = '0';
  afficherJournal(true);
  term.stop.hidden = true;
  term.log.hidden = true;
  term.fermer.hidden = false;
  etiqueterFermerJournal();

  const bloc = document.createElement('div');
  bloc.className = 'term-verdict bad';
  bloc.innerHTML = `<b>${esc(t('verdict.lancement_refuse_titre'))}</b>${esc(message)}`;
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
      bloc.innerHTML = `<b>${esc(t('verdict.interruption_risquee'))}</b>${esc(issue.message)}`;
      term.corps.appendChild(bloc);
      term.corps.scrollTop = term.corps.scrollHeight;
      term.stop.textContent = t('action.forcer_arret');
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
    if (course.analyse) {
      course.lignes.push(payload);
      majProgressionAnalyse(payload);
    }
    if (payload.step) {
      const [n, total] = payload.step;
      if (total > 0) term.prog.style.width = `${Math.min(100, (n / total) * 100)}%`;
    }
  });

  // Ce qu'une analyse a rapporte, lu contre l'entete par le moteur (§17). Il
  // precede toujours `script:end`.
  await ecouter('script:analysis', ({ payload }) => {
    if (!course?.analyse || payload.run_id !== course.runId) return;
    const entree = catalogue.get(payload.script_id);
    if (!entree) return;
    A.oublier(entree.id);
    analyses.set(entree.id, A.modele(entree, payload.analysis, payload.success));
    heuresAnalyse.set(entree.id, new Date());
  });

  await ecouter('script:end', ({ payload }) => {
    if (!course || payload.run_id !== course.runId) return;
    // Une analyse n'ecrit rien dans l'historique : avoir regarde n'est pas
    // avoir fait (§17.2).
    if (course.analyse) return void finirAnalyse(payload);
    // Le verdict vient du code de sortie (afficherVerdict), pas de killed :
    // un arret propre n'est ni une reussite ni un echec a memoriser comme tel.
    if (!payload.killed) derniersResultats.set(payload.script_id, payload.success ? 'ok' : 'err');

    const entree = catalogue.get(payload.script_id);
    const tr = entree?.meta.translations?.[currentLang()];
    const titre = tr?.title || entree?.meta.title || payload.script_id;
    // Une entree par script execute (specification §14), quel que soit le
    // mode — ne bloque jamais la suite, ne fait que rafraichir "Fait le ...".
    enregistrerExecution(payload, titre, course.simule).then(() => rendreLots());

    if (payload.changes?.length) journaliserTemoin(payload.changes);
    if (course.entretien) {
      const succes = payload.success && !payload.killed;
      entretienEnCours.resultats.push({
        id: payload.script_id, success: succes, simule: course.simule, freed: payload.freed ?? null,
        changes: payload.changes || [], watched: payload.watched || [],
      });
      course = null;
      majEtatJournalCompact();
      // Comportement d'echec (specification §6.2, reglage Expert §8) : par
      // defaut on continue les autres scripts, mais "stop" vide la file pour
      // ne pas enchainer sur la suite d'un lot qui vient d'echouer.
      if (!succes && reglagesActuels?.failure_policy === 'stop') fileEntretien = [];
      majProgression();
      avancerEntretien();
      rendreLots();
      return;
    }

    course = null;
    majEtatJournalCompact();
    document.querySelectorAll('[data-run]').forEach((b) => (b.disabled = false));
    term.stop.dataset.force = '';
    afficherVerdict(payload);
    rendreLots();
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
}

/** Chrome statique : titres, aria-label et textes fixes, tous traduits d'un
 *  coup au demarrage (specification 10 — rien de tout ca n'est en dur dans le HTML). */
function appliquerTraductionsStatiques() {
  document.getElementById('adminPillText').textContent = t('chrome.administrateur');
  document.getElementById('filtreLots').placeholder = t('expert.filtrer');
  document.querySelector('[data-mode-btn="simple"]').textContent = t('mode.simple');
  document.querySelector('[data-mode-btn="expert"]').textContent = t('mode.expert');

  // `data-tip`, pas `title` : l'infobulle native du navigateur a un delai
  // fixe (systeme, pas controlable en CSS) beaucoup trop long pour des
  // boutons a icone seule sans texte — voir `cablerInfobulles`.
  const cible = (id, texte) => {
    const el = document.getElementById(id);
    el.dataset.tip = texte;
    el.setAttribute('aria-label', texte);
  };
  cible('themeBtn', t('chrome.basculer_theme'));
  cible('btnSettings', t('reglages.titre'));
  cible('btnMin', t('chrome.reduire'));
  cible('btnMax', t('chrome.agrandir'));
  cible('btnClose', t('chrome.fermer_fenetre'));

  document.getElementById('crumb1').textContent = t('crumb.choisir');
  document.getElementById('crumb2').textContent = t('crumb.verifier');
  document.getElementById('crumb3').textContent = t('crumb.analyser');
  document.getElementById('crumb4').textContent = t('crumb.entretien');
}

/**
 * Selection d'un lot ou d'un script dans la colonne de gauche (ou depuis la
 * liste des scripts d'un lot, dans le detail) : reconstruit la colonne (pour
 * l'etat aria-current) et le detail.
 */
async function selectionner(type, id) {
  selection = { type, id };
  await rendreLots();
  await rendreDetail();
}

/** Fait apparaitre le champ de saisie d'un nouveau lot. */
function ouvrirCreationLot() {
  const ligne = document.getElementById('ligneNouveauLot');
  ligne.hidden = !ligne.hidden;
  if (!ligne.hidden) document.getElementById('nomNouveauLot').focus();
}

/** Remplace le titre d'un lot par un champ de saisie (specification 4.1 :
 *  le mode Expert permet de renommer un lot, y compris « Entretien
 *  complet », qui n'est pas un cas special). */
function demarrerRenommageLot(id) {
  const h2 = document.querySelector(`h2[data-nom-lot="${CSS.escape(id)}"]`);
  if (!h2) return;
  h2.outerHTML = `<div class="dname-edit"><input type="text" id="inputRenommerLot" data-id="${esc(id)}" value="${esc(h2.textContent)}" /></div>`;
  const input = document.getElementById('inputRenommerLot');
  input.focus();
  input.select();
}

/**
 * Reordonnancement par glisser-deposer : des Lots dans la colonne de gauche,
 * ou des Scripts d'un meme lot dans le detail (specification 6.1 — l'ordre
 * est par lot, glisser un script d'un lot vers un autre n'est pas pris
 * en charge ici, seul le rangement par les puces de lots l'est).
 */
function cablerGlisserDeposer() {
  let dragId = null;
  let dragKind = null;
  let dragLotId = null;

  // Le glisser-deposer et le clic se disputaient la meme cible : la ligne
  // entiere etait `draggable`, donc un clic destine a ouvrir le script
  // demarrait parfois un glissement, et inversement. Desormais la ligne n'est
  // rendue deplacable que le temps d'un appui sur sa poignee.
  document.addEventListener('pointerdown', (ev) => {
    const grip = ev.target.closest('[data-grip]');
    if (!grip) return;
    const ligne = grip.closest('.row[data-lot-drag]');
    if (ligne) ligne.draggable = true;
  });
  const relacher = () => {
    document.querySelectorAll('.row[draggable="true"]').forEach((r) => {
      if (r.dataset.lotDrag) r.draggable = false;
    });
  };
  document.addEventListener('pointerup', relacher);
  document.addEventListener('dragend', relacher);

  document.addEventListener('dragstart', (ev) => {
    const ligne = ev.target.closest('.row[draggable="true"]');
    if (!ligne) return;
    dragKind = ligne.dataset.lot ? 'lot' : 'script';
    dragId = ligne.dataset.lot || ligne.dataset.script;
    dragLotId = ligne.dataset.lotDrag || null;
    ligne.classList.add('dragging');
  });

  document.addEventListener('dragend', (ev) => {
    ev.target.closest?.('.row')?.classList.remove('dragging');
    document.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    dragId = null;
    dragKind = null;
    dragLotId = null;
  });

  document.addEventListener('dragover', (ev) => {
    if (!dragId) return;
    // La cible de depot se reconnait a `data-lot-drag` (elle participe au
    // reordonnancement), PAS a `draggable` : seule la ligne en cours de
    // deplacement porte cet attribut, donc aucune cible n'etait jamais
    // trouvee et le curseur affichait « interdit ».
    const ligne = ev.target.closest('.row[data-lot-drag], .row.lot[data-lot]');
    if (!ligne || ligne.dataset.lot === dragId || ligne.dataset.script === dragId) return;
    if (dragKind === 'script' && ligne.dataset.lotDrag !== dragLotId) return;
    ev.preventDefault();
    const avant = ev.clientY < ligne.getBoundingClientRect().top + ligne.offsetHeight / 2;
    ligne.classList.toggle('drop-before', avant);
    ligne.classList.toggle('drop-after', !avant);
  });

  document.addEventListener('drop', async (ev) => {
    if (!dragId) return;
    // Meme critere qu'au survol : l'appartenance, pas l'etat instantane.
    const cible = ev.target.closest('.row[data-lot-drag], .row.lot[data-lot]');
    if (!cible) return;
    ev.preventDefault();
    const avant = cible.classList.contains('drop-before');

    if (dragKind === 'lot') {
      const cibleId = cible.dataset.lot;
      if (!cibleId || cibleId === dragId || cibleId === NON_CLASSE) return;
      const ordre = etatGroupes.lots.map((g) => g.lot.id);
      ordre.splice(ordre.indexOf(dragId), 1);
      const dest = ordre.indexOf(cibleId);
      ordre.splice(avant ? dest : dest + 1, 0, dragId);
      await invoke('reorder_lots', { order: ordre });
    } else {
      const lotId = cible.dataset.lotDrag;
      if (!lotId || lotId !== dragLotId) return;
      const groupe = etatGroupes.lots.find((g) => g.lot.id === lotId);
      if (!groupe) return;
      const ordre = groupe.scripts.map((s) => s.id);
      const source = ordre.indexOf(dragId);
      if (source < 0) return;
      ordre.splice(source, 1);
      const dest = ordre.indexOf(cible.dataset.script);
      if (dest < 0) return;
      ordre.splice(avant ? dest : dest + 1, 0, dragId);
      await invoke('reorder_lot_scripts', { lotId: lotId, order: ordre });
    }
    await chargerLots();
  });
}

function cablerInteractions() {
  document.getElementById('filtreLots').addEventListener('input', appliquerFiltre);

  document.querySelector('.lots').addEventListener('click', (ev) => {
    const onglet = ev.target.closest('[data-onglet-expert]');
    if (onglet) return void choisirOnglet(onglet.dataset.ongletExpert);

    if (ev.target.closest('#btnAjouterLot')) return void ouvrirCreationLot();

    const lot = ev.target.closest('.row.lot');
    if (lot) return void selectionner('lot', lot.dataset.lot);

    const script = ev.target.closest('.row.script');
    if (script) return void selectionner('script', script.dataset.script);
  });

  document.querySelector('.lots').addEventListener('keydown', async (ev) => {
    if (ev.target.id !== 'nomNouveauLot') return;
    if (ev.key === 'Enter') {
      const nom = ev.target.value.trim();
      if (nom) {
        await invoke('create_lot', { name: nom, icon: 'folder' });
        await chargerLots();
      } else {
        document.getElementById('ligneNouveauLot').hidden = true;
      }
    } else if (ev.key === 'Escape') {
      document.getElementById('ligneNouveauLot').hidden = true;
    }
  });

  const detail = document.querySelector('.detail');

  detail.addEventListener('click', async (ev) => {
    // Analyse (§17) : avant tout le reste, parce que ses interrupteurs et ses
    // cases ne sont pas des reglages a enregistrer.
    const analyse = ev.target.closest('[data-analyser], [data-relancer-an]');
    if (analyse) return void analyserExpert(analyse.dataset.analyser || analyse.dataset.relancerAn);
    if (ev.target.closest('.an-zone')) return void gesteAnalyseExpert(ev);

    // Verifier = re-analyser le contrat (§5.5) ET faire lire le fichier par
    // PowerShell sans l'executer (§6.8). Deux questions differentes, un seul
    // geste, et aucune modification de la machine.
    const verif = ev.target.closest('[data-verifier]');
    if (verif) {
      const id = verif.dataset.verifier;
      const zone = document.getElementById(`verif-${id}`);
      if (!zone) return;
      verif.disabled = true;
      zone.hidden = false;
      zone.className = 'verif';
      zone.textContent = t('action.verification_en_cours');
      try {
        const r = await invoke('check_script', { scriptId: id });
        zone.className = `verif ${r.syntax.parses && !r.findings.length ? 'ok' : 'bad'}`;
        zone.innerHTML = rendreVerification(r);
      } catch (e) {
        zone.className = 'verif bad';
        zone.textContent = String(e);
      }
      verif.disabled = false;
      return;
    }

    // Appartenance d'un script a un lot (§4.1) : puce sur la fiche du
    // script, interrupteur dans la composition d'un lot. Les deux
    // portent `data-membre` + `data-lot` et passent par la meme commande.
    const bascule = ev.target.closest('[data-membre][data-lot]');
    if (bascule) {
      const etait = bascule.getAttribute('aria-checked') === 'true' ||
                    bascule.getAttribute('aria-pressed') === 'true';
      try {
        await invoke('set_lot_script', {
          lotId: bascule.dataset.lot,
          scriptId: bascule.dataset.membre,
          member: !etait,
        });
      } catch (e) {
        console.error('Appartenance non enregistree :', e);
      }
      await chargerLots();
      return void rendreDetail();
    }

    const run = ev.target.closest('[data-run]');
    if (run && !run.disabled) return void lancerDepuisExpert({ type: 'script', id: run.dataset.run });
    const lancerLot = ev.target.closest('[data-lancer-lot]');
    if (lancerLot && !lancerLot.disabled) return void lancerDepuisExpert({ type: 'lot', id: lancerLot.dataset.lancerLot });

    const reinit = ev.target.closest('[data-reinit]');
    if (reinit) {
      try {
        const reglages = await invoke('reset_script_config', { scriptId: reinit.dataset.reinit });
        if (etatGroupes) etatGroupes.overrides = reglages.overrides;
      } catch (e) {
        console.error('Remise aux valeurs du script impossible :', e);
      }
      await rendreLots();
      return void rendreDetail();
    }

    const inter = ev.target.closest('.switch');
    if (inter) {
      inter.setAttribute('aria-checked', inter.getAttribute('aria-checked') !== 'true');
      return void persisterReglage(inter);
    }

    const puce = ev.target.closest('.opt-choices[data-kind="multi"] .chip');
    if (puce) {
      puce.setAttribute('aria-pressed', puce.getAttribute('aria-pressed') !== 'true');
      return void persisterReglage(puce.closest('[data-opt]'));
    }

    const scriptDuLot = ev.target.closest('#scriptsDuLot .row.script');
    if (scriptDuLot) return void selectionner('script', scriptDuLot.dataset.script);

    const ouvrirIcone = ev.target.closest('[data-icone-lot]');
    if (ouvrirIcone) return void ouvrirChoixIcone(ouvrirIcone.dataset.iconeLot);

    const renommer = ev.target.closest('[data-renommer-lot]');
    if (renommer) return void demarrerRenommageLot(renommer.dataset.renommerLot);

    const epingler = ev.target.closest('[data-epingler-lot]');
    if (epingler) {
      const id = epingler.dataset.epinglerLot;
      const groupe = etatGroupes.lots.find((g) => g.lot.id === id);
      if (groupe) await invoke('set_lot_pinned', { id, pinned: !groupe.lot.pinned });
      return void chargerLots();
    }

    const supprimer = ev.target.closest('[data-supprimer-lot]');
    if (supprimer) {
      const id = supprimer.dataset.supprimerLot;
      const groupe = etatGroupes.lots.find((g) => g.lot.id === id);
      const nom = groupe ? nomLot(groupe.lot) : id;
      if (confirm(t('expert.confirmer_suppression', { nom }))) {
        await invoke('delete_lot', { id });
        selection = null;
        await chargerLots();
      }
    }
  });

  detail.addEventListener('input', (ev) => {
    if (ev.target.closest('.an-zone')) gesteAnalyseExpert(ev);
  });

  detail.addEventListener('change', async (ev) => {
    if (ev.target.closest('.an-zone')) return void gesteAnalyseExpert(ev);

    // Nombres, textes et listes deroulantes de $CONFIG : `change` plutot que
    // `input`, donc une ecriture par valeur terminee et non une par frappe.
    const controle = ev.target.closest('[data-opt]');
    if (controle) return void persisterReglage(controle);
  });

  // Renommage d'un lot : Enter valide (par un blur), Echap annule sans
  // enregistrer. Un seul chemin d'ecriture (focusout) evite un double envoi.
  detail.addEventListener('keydown', (ev) => {
    if (ev.target.id !== 'inputRenommerLot') return;
    if (ev.key === 'Enter') ev.target.blur();
    else if (ev.key === 'Escape') {
      ev.target.dataset.annule = '1';
      ev.target.blur();
    }
  });

  // focusout, contrairement a blur, remonte par bubbling : la delegation
  // sur .detail fonctionne comme pour les autres evenements ci-dessus.
  detail.addEventListener('focusout', async (ev) => {
    if (ev.target.id !== 'inputRenommerLot') return;
    const annule = ev.target.dataset.annule === '1';
    const id = ev.target.dataset.id;
    const nom = ev.target.value.trim();
    if (!annule && nom) await invoke('rename_lot', { id, name: nom });
    await chargerLots();
  });

  cablerGlisserDeposer();

  term.stop.onclick = () => arreter(term.stop.dataset.force === '1');
  term.fermer.onclick = () => fermerJournal();
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

/* -------------------------------------------------------------------------
   Mode Simple — assistant en trois etapes (specification 2, 3, 15)
   ------------------------------------------------------------------------- */

let modeCourant = 'simple';
/** Scripts restants a lancer dans l'entretien en cours, dans l'ordre. */
let fileEntretien = [];
/** { lotId, total, resultats: [{id, success}] }, ou null hors entretien. */
let entretienEnCours = null;
/** Vrai du lancement d'un entretien a son bilan, enchainements compris. Ni
 *  `course`, nul le temps de lancer le script suivant, ni `entretienEnCours`,
 *  garde pour le bilan et jamais remis a nul, ne le disent. La mise a jour
 *  s'en sert : son installeur ferme l'application. */
let entretienActif = false;
/** Lot actuellement selectionne a l'etape 1 — un clic choisit, il ne
 *  fait pas avancer tout seul (le mockup de reference confirme ce modele :
 *  choisir puis Continuer, pas un saut immediat). */
let selectionSimpleId = null;
/** {n, total} du [STEP] en cours pendant l'entretien, pour la mini barre de
 *  progression de la tache active (voir cablerMoteur). */
let etapeEntretienActuelle = null;

function basculerMode(mode, { etape = 1 } = {}) {
  modeCourant = mode;
  if (mode !== 'simple') retirerVaguesArriere();
  document.body.dataset.mode = mode;
  document.querySelector('.simple').hidden = mode !== 'simple';
  document.querySelector('.expert').hidden = mode !== 'expert';
  document.querySelectorAll('#modeSeg [data-mode-btn]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.modeBtn === mode));
  });
  if (mode === 'simple') {
    if (etape) afficherEtapeSimple(etape);
  } else majMaree();
  // Les reglages restent ouverts, sur la meme section si elle existe dans ce
  // mode (§8) : changer de mode ne demande plus de les quitter.
  if (reglagesOuverts()) {
    const recherche = document.getElementById('rgRecherche').value;
    if (recherche.trim()) rechercherReglages(recherche);
    else afficherSectionReglages(sectionReglages);
  }
}

function majRepere(etape) {
  // Les reperes disent le chemin de CE lancement : « Analyser » disparait
  // quand aucune action retenue ne sait analyser, « Choisir » et « Verifier »
  // quand on vient de l'Expert, qui a deja choisi et regle.
  const g = etape > 1 ? groupeLancement : null;
  const depuisExpert = !!(g && entretienEnCours?.depuisExpert);
  const analyse = !g || scriptsRetenus(g).some((x) => x.meta.scan);
  const masque = { 1: depuisExpert, 2: depuisExpert, 3: !analyse, 4: false };
  for (let i = 1; i <= 4; i++) {
    const ligne = document.getElementById(`crumb${i}`)?.parentElement;
    if (!ligne) continue;
    ligne.hidden = masque[i];
    ligne.classList.toggle('actif', i === etape);
    ligne.classList.toggle('done', i < etape);
  }
}

function afficherEtapeSimple(n) {
  document.querySelectorAll('.s-step').forEach((el) => {
    el.hidden = Number(el.dataset.s) !== n;
  });
  majRepere(n);
  if (n === 1) rendreEtapeChoisir();
  else {
    retirerVaguesArriere();
    majMaree();
  }
}

/** Etape 1 : le lot epingle en grand, les autres en bouees sur une
 *  ligne d'eau (max 6 par ligne, specification 15.2 — le flex-wrap ci-dessous
 *  fait naturellement une deuxieme ligne au-dela). Un lot vide est
 *  masque en mode Simple (specification 14). Un clic selectionne ; Continuer
 *  fait avancer. */
/** Duree grossiere d'un lot, dans les mots de la specification 7 : un ordre de
 *  grandeur, jamais une promesse. */
function minutesLot(groupe) {
  const total = scriptsSimples(groupe).reduce((n, s) => n + (MINUTES_PAR_DUREE[s.meta.duration] || 2), 0);
  return Math.max(1, total);
}

async function rendreEtapeChoisir() {
  document.getElementById('s1Titre').textContent = t('s1.titre');
  document.getElementById('s1Sous').textContent = t('s1.sous');

  // Un lot dont tous les scripts sont desactives n'a rien a proposer : il ne
  // s'affiche pas plutot que de mener a un entretien vide.
  const dispo = etatGroupes ? etatGroupes.lots.filter((g) => scriptsSimples(g).length > 0) : [];
  const zoneReco = document.getElementById('recoCard');
  const zoneBuoys = document.getElementById('buoysZone');
  const sectAutres = document.getElementById('sectAutres');
  const btnContinuer = document.getElementById('btnContinuerChoix');
  const barre = document.getElementById('s1Barre');
  // La fleche fait partie du bouton dans la maquette : elle dit qu'on avance
  // d'une etape, la ou un libelle seul pourrait passer pour un bouton d'action.
  btnContinuer.innerHTML =
    `${esc(t('simple.continuer'))}<svg class="ico" aria-hidden="true"><use href="#arrow-right" /></svg>`;

  // Aucun script du tout : ce n'est pas qu'il manque un lot, c'est qu'il n'y a
  // encore rien a ranger. L'accueil propose alors le catalogue (§16.6).
  if (catalogue.size === 0 && !etatCatalogue?.installe) return void (await rendreOffreCatalogue());

  if (!dispo.length) {
    zoneReco.innerHTML = `<p class="muted">${esc(t('simple.aucun_lot'))}</p>`;
    zoneBuoys.innerHTML = '';
    positionnerBouees();
    sectAutres.hidden = true;
    barre.hidden = true;
    return;
  }

  const epinglee = dispo.find((g) => g.lot.pinned) || dispo[0];
  const autres = dispo.filter((g) => g !== epinglee);
  if (!selectionSimpleId || !dispo.some((g) => g.lot.id === selectionSimpleId)) {
    selectionSimpleId = epinglee.lot.id;
  }

  const iconeReco = (await iconeSVG(epinglee.lot.icon)) || '';
  zoneReco.innerHTML = `
    <div class="reco" data-lot="${esc(epinglee.lot.id)}" aria-current="${selectionSimpleId === epinglee.lot.id}">
      <div class="ri">${iconeReco}</div>
      <div>
        <div class="rt">${esc(nomLot(epinglee.lot))} <span class="badge acc">${esc(t('simple.recommande'))}</span></div>
        <div class="rd">${esc(epinglee.lot.description || t('simple.on_s_occupe_de_tout'))} — ${esc(PLURIEL('simple.duree_estimee', minutesLot(epinglee)))}</div>
      </div>
    </div>`;

  sectAutres.hidden = !autres.length;
  sectAutres.textContent = t('simple.autres_domaines');

  const buoys = await Promise.all(
    autres.map(async (g, i) => {
      const icone = (await iconeSVG(g.lot.icon)) || '';
      const actif = selectionSimpleId === g.lot.id;
      return `
        <button class="buoy" type="button" data-lot="${esc(g.lot.id)}" aria-current="${actif}">
          <span class="bi">${icone}</span>
          <span class="blabel">
            <span class="bt">${esc(nomLot(g.lot))}</span>
            <span class="bd">${esc(t('simple.duree_courte', { n: minutesLot(g) }))}</span>
          </span>
        </button>`;
    })
  );
  zoneBuoys.innerHTML = buoys.join('');
  positionnerBouees();
  // La barre rappelle ce qui est choisi : utile quand le champ a defile et
  // que la bouee choisie n'est plus a l'ecran.
  const choisi = dispo.find((g) => g.lot.id === selectionSimpleId) || epinglee;
  document.getElementById('s1Choisi').innerHTML =
    `${esc(t('s1.choisi'))} <b>${esc(nomLot(choisi.lot))}</b> · ` +
    esc(t('simple.duree_courte', { n: minutesLot(choisi) }));
  barre.hidden = false;
}

/* --- Champ de bouees (etape 1, specification §15.2) ------------------------
   Chaque bouee flotte sur une ligne d'eau REELLEMENT dessinee, et en suit le
   mouvement.

   La vague est ancree au BAS de la scene : sa ligne d'eau (y = 452 dans une
   boite de 760) est toujours a 308 px du bas, quelle que soit la hauteur de la
   fenetre. Les bouees se posent donc par rapport au bas, et a leur position
   horizontale mesuree — pas par rapport au titre, comme avant la 1.1.1 : sur un
   grand ecran, elles flottaient alors a mi-hauteur, loin de l'eau.

   La vague derive : chaque nappe fait deux largeurs de scene et glisse d'une
   largeur en `duree` secondes. Sa longueur d'onde est d'une demi-largeur
   (lambda = W/2) ; vue d'un point fixe, elle monte et descend donc avec une
   periode T = duree / 2. Une bouee qui oscille a cette cadence, dephasee selon
   sa position, epouse la vague en mouvement — avec une animation CSS ordinaire,
   sans calcul a chaque image (voir retardHoule).

   Quand les lots sont nombreux, ils se repartissent en rangees, chacune sur sa
   propre vague, etagees vers le haut et vers l'arriere. Si la fenetre est trop
   basse, le champ ne change pas de forme : il s'allonge sous le reste, la page
   defile, et l'eau defile avec lui (majMaree). */
const VAGUE = {
  ligne: 308,         // px entre le bas de la scene et la ligne d'eau de devant
  amplitude: 37.5,    // px : la courbe dessinee monte de 452 a 414,5 (Bezier, 0,75 x 50)
  ecart: 170,         // px entre deux lignes d'eau
  houleArriere: 0.65, // amplitude de chaque vague plus lointaine : un large paraît plus calme
  duree: 29,          // s : derive de la nappe de devant (.water.surface)
  ralenti: 0.35,      // chaque vague plus loin derive 35 % plus lentement
  attenue: 0.68,      // et s'efface d'autant
  marge: 44,          // px de bord, de chaque cote
  pasMin: 170,        // px par bouee : en dessous, on ouvre une rangee de plus
  pasMax: 230,        // px par bouee : au-dela, la rangee s'etire trop
  parRangee: 8,       // au plus : sur un tres grand ecran, une rangee de seize se lit mal
  flotteur: 29,       // px : demi-hauteur du flotteur (.buoy .bi, 58 px)
  libelle: 46,        // px reserves au-dessus de la rangee du haut pour « Ou choisissez… »
};

function echelleCourante() {
  const e = Number(getComputedStyle(document.documentElement).getPropertyValue('--echelle'));
  return Number.isFinite(e) && e > 0 ? e : 1;
}

/** Le moins de rangees possible, equilibrees. Les rangees se lisent de haut en
 *  bas : celle du haut prend les surplus, pour garder l'ordre des lots. */
function repartirRangees(n, largeur) {
  const capacite = Math.max(1, Math.min(VAGUE.parRangee, Math.floor((largeur - 2 * VAGUE.marge) / VAGUE.pasMin)));
  const rangees = Math.max(1, Math.ceil(n / capacite));
  const base = Math.floor(n / rangees);
  const reste = n % rangees;
  return Array.from({ length: rangees }, (_, k) => base + (k < reste ? 1 : 0));
}

/** La nappe qui porte la rangee de profondeur `d` (0 = devant). */
function vagueDeRang(d) {
  if (d === 0) return document.querySelector('.water.surface:not(.arriere)');
  return document.querySelector(`.water.arriere[data-rang="${d}"]`);
}

function dureeDeRang(d) {
  return VAGUE.duree * (1 + VAGUE.ralenti * d);
}

/** Amplitude de la vague de profondeur `d` (0 = devant). */
function amplitudeDeRang(d) {
  return VAGUE.amplitude * VAGUE.houleArriere ** d;
}

/** Le trace de la nappe de devant (index.html), a une amplitude donnee : quatre
 *  periodes de 590 sur 2360, chacune un arc montant puis un arc descendant. */
function cheminVague(facteur) {
  const y = (dy) => (452 + dy * facteur).toFixed(1);
  let d = 'M0,452';
  for (let x = 0; x < 2360; x += 590) {
    d += ` C${x + 98},${y(-50)} ${x + 197},${y(-50)} ${x + 295},452`;
    d += ` C${x + 393},${y(50)} ${x + 492},${y(50)} ${x + 590},452`;
  }
  return d;
}

/** Cree ou retire les nappes arriere pour qu'il y en ait exactement `n`. */
function assurerVaguesArriere(n) {
  const scene = document.querySelector('.stage');
  if (!scene || !vagueDeRang(0)) return;
  scene.querySelectorAll('.water.arriere').forEach((v) => {
    if (Number(v.dataset.rang) > n) v.remove();
  });
  for (let d = 1; d <= n; d++) {
    if (vagueDeRang(d)) continue;
    const trace = cheminVague(VAGUE.houleArriere ** d);
    // La nappe descend jusqu'au bas de la scene : posee plus haut, son bord
    // inferieur tracait une bande plate au milieu de l'eau de devant. Sa ligne
    // d'eau reste a y = 452 ; seul le bas s'allonge, d'un ecart par rang.
    const bas = 760 + d * VAGUE.ecart;
    const boite = document.createElement('div');
    boite.innerHTML = `<svg class="water surface arriere" data-rang="${d}" viewBox="0 0 2360 ${bas}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${trace} L2360,${bas} L0,${bas} Z" fill="url(#eau)" opacity="0.26" />
      <path d="${trace}" fill="none" stroke="var(--acc)" stroke-width="2.5" opacity="0.55" />
    </svg>`;
    const v = boite.firstElementChild;
    v.style.height = `${bas}px`;
    v.style.opacity = String(VAGUE.attenue ** d);
    v.style.animationDuration = `${dureeDeRang(d)}s`;
    // Derriere toutes les autres : la nappe de devant la recouvre la ou elles
    // se chevauchent.
    scene.insertBefore(v, scene.querySelector('.water'));
  }
}

function retirerVaguesArriere() {
  document.querySelectorAll('.water.arriere').forEach((v) => v.remove());
}

/**
 * Retard d'animation pour qu'une bouee placee en `x` (px depuis le bord gauche
 * de la scene) soit en crete exactement quand la vague l'est sous elle.
 *
 * Sous un point fixe x, la hauteur de la vague vaut -A sin(2 pi (x + v t) / lambda),
 * avec v t / lambda = t / T : crete quand frac(x / lambda + t / T) = 1/4. L'animation
 * de la bouee part de la crete (keyframes `houle`) ; on la decale donc pour que
 * son temps propre soit nul a ce moment-la. `tVague` est l'avance de l'animation
 * de la vague a l'instant ou la bouee est posee : les deux horloges sont alignees
 * meme si la bouee est redessinee bien apres le depart de la vague.
 */
function retardHoule(x, lambda, periode, tVague) {
  let p = (0.25 - x / lambda - tVague / periode) % 1;
  if (p < 0) p += 1;
  return (p - 1) * periode;
}

/** Pose les bouees deja rendues dans #buoysZone, et cree les vagues qui les
 *  portent. A rappeler a chaque redimensionnement et changement d'echelle.
 *
 *  Le champ est toujours pose sur l'eau, au bas de la page. Jusqu'a la 1.2.0,
 *  une fenetre trop basse le renvoyait en rangees ordinaires dans le flux, et
 *  la vague, restee au bas de la fenetre, passait au hasard derriere les
 *  bouees — des la taille d'ouverture avec une douzaine de lots. */
function positionnerBouees() {
  const etape = document.querySelector('.s-step[data-s="1"]');
  const zone = document.getElementById('buoysZone');
  const bouees = zone ? [...zone.querySelectorAll('.buoy')] : [];
  const visible = etape && !etape.hidden && !document.querySelector('.simple').hidden;
  if (!visible || !bouees.length) {
    retirerVaguesArriere();
    if (zone) zone.style.height = '';
    majMaree();
    return;
  }

  const z = echelleCourante();
  const largeur = document.querySelector('.stage').getBoundingClientRect().width / z;
  const tailles = repartirRangees(bouees.length, largeur);
  const R = tailles.length;
  const hauteurChamp = VAGUE.ligne + (R - 1) * VAGUE.ecart + VAGUE.flotteur + VAGUE.amplitude + VAGUE.libelle;

  // « Ou choisissez un domaine precis » vit dans le champ, juste au-dessus de
  // la rangee du haut : hors du champ, il flotterait loin des bouees.
  let libelle = zone.querySelector('.sect-champ');
  if (!libelle) {
    libelle = document.createElement('div');
    libelle.className = 'sect sect-champ';
    zone.prepend(libelle);
  }
  libelle.textContent = document.getElementById('sectAutres').textContent;

  const immobile = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lambda = largeur / 2;

  assurerVaguesArriere(R - 1);
  zone.style.height = `${hauteurChamp}px`;
  libelle.style.top = '0px';

  // La hauteur de champ suppose l'amplitude de devant pour toutes les rangees :
  // c'est un majorant, les vagues lointaines ondulant moins.
  let i = 0;
  tailles.forEach((n, k) => {
    const d = R - 1 - k;                           // 0 = rangee de devant
    const ligne = VAGUE.ligne + d * VAGUE.ecart;   // px depuis le bas
    const amplitude = amplitudeDeRang(d);
    const pas = Math.min(VAGUE.pasMax, Math.max(VAGUE.pasMin, (largeur - 2 * VAGUE.marge) / n));
    // En quinconce : deux rangees de meme effectif seraient alignees, et dans le
    // pire dephasage (arriere au creux, devant en crete) l'etiquette du haut
    // tomberait sur le flotteur du bas. Un demi-pas les ecarte. Des effectifs
    // differents se decalent deja d'eux-memes, par le centrage.
    const devant = tailles[k + 1];
    const decale = devant === n && d % 2 === 1 ? pas / 2 : 0;
    let depart = (largeur - pas * n) / 2 + decale;
    depart = Math.min(depart, largeur - VAGUE.marge - pas * n);
    const periode = dureeDeRang(d) / 2;
    const anim = vagueDeRang(d)?.getAnimations?.()[0];
    const tVague = anim && anim.currentTime != null ? (anim.currentTime / 1000) % dureeDeRang(d) : 0;

    for (let j = 0; j < n; j++, i++) {
      const b = bouees[i];
      const x = depart + (j + 0.5) * pas;
      b.style.left = `${x}px`;
      b.style.top = `${hauteurChamp - ligne - VAGUE.flotteur}px`;
      // Ce qui est devant passe devant : si une bouee lointaine frole une
      // bouee proche, c'est la proche qui la recouvre, comme en vrai.
      b.style.zIndex = String(10 + R - d);
      if (immobile) {
        // Vague immobile : elle reste dans sa position de depart.
        b.classList.remove('houle');
        b.style.transform = `translateY(${-amplitude * Math.sin((2 * Math.PI * x) / lambda)}px)`;
      } else {
        b.classList.add('houle');
        b.style.transform = '';
        b.style.setProperty('--amp', `${amplitude}px`);
        b.style.setProperty('--demi', `${periode / 2}s`);
        b.style.setProperty('--retard', `${retardHoule(x, lambda, periode, tVague)}s`);
      }
    }
  });
  majMaree();
}

/**
 * L'eau suit le champ de bouees. Les nappes sont ancrees au bas de la scene, le
 * champ au bas de la page : quand la page defile — ou que le journal reduit la
 * hauteur de l'etape —, l'eau se decale d'autant, et chaque bouee reste sur sa
 * vague. `translate` se compose avec la derive, qui anime `transform`. Ailleurs
 * qu'a l'etape 1, l'eau reprend sa place.
 */
function majMaree() {
  const scene = document.querySelector('.stage');
  if (!scene) return;
  const etape = document.querySelector('.s-step[data-s="1"]');
  const zone = document.getElementById('buoysZone');
  const actif = etape && !etape.hidden && !document.querySelector('.simple').hidden && zone?.offsetHeight > 0;
  let decalage = 0;
  if (actif) {
    decalage = (zone.getBoundingClientRect().bottom - scene.getBoundingClientRect().bottom) / echelleCourante();
    // La barre « Continuer » ne prend un fond que si quelque chose passe dessous.
    const defile = etape.querySelector('.s-scroll');
    etape.classList.toggle('deborde', defile.scrollHeight > defile.clientHeight + 1);
  }
  scene.style.setProperty('--maree', `${decalage.toFixed(1)}px`);
}

let minuteurBouees = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(minuteurBouees);
  minuteurBouees = requestAnimationFrame(positionnerBouees);
});
let minuteurMaree = 0;
document.querySelector('.s-step[data-s="1"] .s-scroll')?.addEventListener(
  'scroll',
  () => {
    cancelAnimationFrame(minuteurMaree);
    minuteurMaree = requestAnimationFrame(majMaree);
  },
  { passive: true },
);

function selectionnerChoix(id) {
  selectionSimpleId = id;
  rendreEtapeChoisir();
}

async function choisirLot(id) {
  const groupe = etatGroupes?.lots.find((g) => g.lot.id === id);
  if (!groupe || !scriptsSimples(groupe).length) return;
  groupeLancement = groupe;
  exclusLancement = new Set();
  entretienEnCours = { lotId: id, total: scriptsSimples(groupe).length, resultats: [] };
  afficherEtapeSimple(2);
  await rendreEtapeVerifier(groupe);
}

/** Apres « Verifier » : l'analyse si une action retenue sait analyser (§17.2),
 *  sinon l'entretien directement. */
async function suivreVerifier() {
  const groupe = groupeLancement;
  if (!groupe || !scriptsRetenus(groupe).length) return;
  if (scriptsRetenus(groupe).some((s) => s.meta.scan)) {
    afficherEtapeSimple(3);
    await rendreEtapeAnalyse(groupe);
  } else {
    await lancerEntretien();
  }
}

/**
 * « Executer » sur une fiche, « Lancer ce lot » sur un lot : depuis l'Expert,
 * on passe par les memes ecrans que le Simple, a partir de l'analyse — le
 * choix et les reglages, l'Expert les a deja faits. Une analyse deja faite et
 * cochee dans la fiche est reprise telle quelle.
 */
async function lancerDepuisExpert({ type, id }) {
  if (course || entretienActif) return;
  let groupe;
  if (type === 'lot') {
    const g = etatGroupes?.lots.find((x) => x.lot.id === id);
    if (!g) return;
    groupe = { ...g, expert: true };
  } else {
    const entree = catalogue.get(id);
    if (!entree) return;
    groupe = {
      lot: { id: LOT_EXPERT, name: { [currentLang()]: A.titreAction(entree) }, icon: entree.meta.icon, pinned: false, scripts: [id] },
      scripts: [entree],
      missing: [],
      expert: true,
    };
  }
  if (!scriptsSimples(groupe).length) return;
  groupeLancement = groupe;
  exclusLancement = new Set();
  entretienEnCours = { lotId: groupe.lot.id, total: scriptsSimples(groupe).length, resultats: [], depuisExpert: { type, id } };
  basculerMode('simple', { etape: null });
  if (scriptsSimples(groupe).some((s) => s.meta.scan)) {
    afficherEtapeSimple(3);
    await rendreEtapeAnalyse(groupe, { reprendre: true });
  } else {
    await lancerEntretien();
  }
}

/** Fin d'un lancement venu de l'Expert : on y retourne, sur ce qu'on avait ouvert. */
async function retourExpert() {
  const origine = entretienEnCours?.depuisExpert;
  basculerMode('expert');
  if (origine) selection = { type: origine.type, id: origine.id };
  await rendreLots();
  await rendreDetail();
}

/** Etape 2 : recapitulatif, reglages replies, annonce du point de
 *  restauration. Ne modifie rien (specification 2). */
/**
 * Reglages montrables a un debutant, pour un script donne.
 *
 * Filtre volontaire : les options `[hidden]` sont reservees au mode Expert
 * (§5.2), et rien de ce qui suit n'affiche de nom de variable, de type, ni
 * d'anomalie de conformite avec numero de ligne — ce serait trois violations
 * directes des regles de langage du §3.
 */
function reglagesSimples(entree) {
  // La simulation se regle par la pastille, seul controle qu'un debutant doit
  // connaitre ; script par script, c'est l'affaire du mode Expert.
  return (entree.meta.options || []).filter((o) => o.kind !== 'hidden' && !o.hidden && o.key !== CLE_SIMULATION);
}

/**
 * Un reglage, en langage courant.
 *
 * Reutilise `rendreCommande`, donc les memes controles qu'en mode Expert, mais
 * dans une enveloppe sans infobulle technique. Les gestionnaires vivent sur
 * `.simple` (voir `cablerReglagesSimples`) : ceux du mode Expert sont delegues
 * sur `.detail` et ne verraient jamais ces elements.
 */
function rendreReglageSimple(entree, opt) {
  const { label, desc } = libelleOption(entree, opt);
  // Meme cause qu'en mode Expert : une rangee de puces ne retrecit pas et
  // ecrasait le libelle a une colonne d'un mot. Ces reglages-la s'empilent.
  const large = opt.kind === 'multi';
  return `
    <div class="sreg${large ? ' empilee' : ''}" data-cle="${esc(opt.key)}" data-pour="${esc(entree.id)}">
      <div class="sreg-txt">
        <div class="sreg-label">${esc(label)}</div>
        ${desc ? `<div class="sreg-desc">${esc(desc)}</div>` : ''}
      </div>
      <div class="sreg-ctl">${rendreCommande(entree, opt)}</div>
    </div>`;
}

/**
 * Enregistre un reglage modifie depuis le mode Simple.
 *
 * `persisterReglage` ne peut pas servir ici : il exige une `.card[data-id]`
 * (absente du mode Simple) et termine par `rendreDetail()`, qui n'ecrit que
 * dans le panneau Expert invisible. Le resultat aurait ete une interface
 * muette : les boutons repondent, rien n'est enregistre.
 */
async function persisterReglageSimple(el) {
  const bloc = el.closest('[data-pour]');
  if (!bloc) return;
  const scriptId = bloc.dataset.pour;
  try {
    const reglages = await invoke('set_script_config', {
      scriptId,
      key: bloc.dataset.cle,
      value: valeurControle(el),
    });
    if (etatGroupes) etatGroupes.overrides = reglages.overrides;
  } catch (e) {
    console.error('Reglage non enregistre :', e);
  }
}

/** Gestionnaires propres au mode Simple : ceux du mode Expert sont delegues
 *  sur `.detail` et ne voient rien de ce qui est rendu ici. */
function cablerReglagesSimples() {
  const simple = document.getElementById('simple');
  if (!simple) return;

  simple.addEventListener('click', (ev) => {
    const plier = ev.target.closest('[data-deplier]');
    if (plier) {
      const zone = simple.querySelector(`[data-reglages="${CSS.escape(plier.dataset.deplier)}"]`);
      if (zone) {
        zone.hidden = !zone.hidden;
        plier.setAttribute('aria-expanded', String(!zone.hidden));
      }
      return;
    }

    const inter = ev.target.closest('.sreg .switch');
    if (inter) {
      inter.setAttribute('aria-checked', inter.getAttribute('aria-checked') !== 'true');
      return void persisterReglageSimple(inter);
    }

    const puce = ev.target.closest('.sreg .opt-choices .chip');
    if (puce) {
      puce.setAttribute('aria-pressed', puce.getAttribute('aria-pressed') !== 'true');
      return void persisterReglageSimple(puce);
    }
  });

  simple.addEventListener('change', (ev) => {
    const controle = ev.target.closest('.sreg [data-opt]');
    if (controle) persisterReglageSimple(controle);
  });
}

/** Ce que la simulation fera de ce script, en clair, a l'etape 2. */
function marqueSimulation(entree) {
  if (estSimule(entree)) return ` <span class="chip simule">${esc(t('simulation.marque'))}</span>`;
  if (simulation.etat === 'activee' && !estSimulable(entree)) {
    return ` <span class="chip simule refuse">${esc(t('simulation.marque_refuse'))}</span>`;
  }
  return '';
}

async function rendreEtapeVerifier(groupe) {
  analyseSimple = null;
  document.getElementById('recapTitre').textContent = nomLot(groupe.lot);
  document.getElementById('recapAide').textContent = t('simple.recap_aide');
  document.getElementById('recapBoxTitre').textContent = t('simple.recap_titre');

  const lignes = await Promise.all(
    scriptsSimples(groupe).map(async (s) => {
      const tr = s.meta.translations?.[currentLang()];
      const titre = tr?.title || s.meta.title || s.path;
      const icone = (await iconeSVG(s.meta.icon)) || '';
      // Specification §2 : « recapitulatif, reglages replies ». Replies,
      // donc : la ligne ne montre rien de plus qu'avant tant qu'on ne la
      // deplie pas, et le chevron est la seule chose ajoutee a l'ecran.
      const reglables = reglagesSimples(s);
      const retenu = !exclusLancement.has(s.id);
      // Toute la ligne est la cible de la case (56 px, §3) ; le chevron des
      // reglages reste a part.
      return `
        <div class="rrow${retenu ? '' : ' exclu'}" data-script-recap="${esc(s.id)}">
          <label class="rrow-main">
            <input type="checkbox" class="rrow-coche" data-retenir="${esc(s.id)}"${retenu ? ' checked' : ''}
                   aria-label="${esc(t('simple.retenir', { titre }))}">
            <div class="ri">${icone}</div>
            <div class="rt">${esc(titre)}${marqueSimulation(s)}</div>
            <span class="badge">${esc(t(`duree.${s.meta.duration}`))}</span>
          </label>
          ${reglables.length
            ? `<button class="rrow-plus" type="button" data-deplier="${esc(s.id)}"
                       aria-expanded="false" aria-label="${esc(t('simple.avance'))}"
                       data-tip="${esc(t('simple.avance'))}">
                 <svg class="ico i17" aria-hidden="true"><use href="#chevron" /></svg>
               </button>`
            : ''}
        </div>
        ${reglables.length
          ? `<div class="rrow-reglages" data-reglages="${esc(s.id)}" hidden>
               ${reglables.map((o) => rendreReglageSimple(s, o)).join('')}
             </div>`
          : ''}`;
    })
  );
  document.getElementById('recapZone').innerHTML = lignes.join('');
  majVerifier(groupe);
}

/** Ce qui depend des cases de « Verifier » : les annonces, le bouton, les reperes. */
function majVerifier(groupe) {
  const retenus = scriptsRetenus(groupe);
  document.querySelectorAll('[data-script-recap]').forEach((l) => {
    l.classList.toggle('exclu', exclusLancement.has(l.dataset.scriptRecap));
  });

  const note = document.getElementById('restoreNote');
  const besoinRestauration = retenus.some(pointAvant);
  note.hidden = !besoinRestauration;
  if (besoinRestauration) note.textContent = t('simple.point_restauration_annonce');

  // Specification 6.5 : annonce d'avance, jamais declenche au milieu. La
  // source est la case de la 4.2, pas `meta.reboot` : si l'utilisateur a
  // decoche, on ne lui annonce pas un redemarrage qu'il a refuse.
  const noteRedemarrage = document.getElementById('rebootNote');
  const besoinRedemarrer = retenus.some(besoinRedemarrage);
  noteRedemarrage.hidden = !besoinRedemarrer;
  if (besoinRedemarrer) noteRedemarrage.textContent = t('simple.redemarrage_annonce');

  const bouton = document.getElementById('btnSuivantVerifier');
  bouton.disabled = !retenus.length;
  bouton.textContent = !retenus.length ? t('simple.rien_a_lancer')
    : t(retenus.some((s) => s.meta.scan) ? 'simple.analyser' : 'simple.lancer');
  majRepere(2);
}

/* -------------------------------------------------------------------------
   Analyser avant d'agir (specification §17)

   Un script qui se declare analysable (`scan : true`) est lance une premiere
   fois avec WINTOOL_MODE=scan : il mesure et decrit, sans rien modifier. Le
   moteur lit ce qu'il ecrit contre son entete (analyse.rs) ; src/analyse.js en
   fait l'ecran et tient la selection, qui repart vers le script a l'action.
   Une analyse ne vaut que pour la session, et pour le contenu exact du
   fichier qu'elle a lu.
   ------------------------------------------------------------------------- */

/** Les analyses de la session : id de script -> modele (analyse.js). */
const analyses = new Map();
/** Lignes du dernier passage de chaque analyse : le panneau « Progression ». */
const journauxAnalyse = new Map();
/** Heure de chaque analyse, pour l'entete du detail Expert. */
const heuresAnalyse = new Map();
/** Analyse attendue : { runId, scriptId, resoudre }. Une a la fois, comme les executions. */
let attenteAnalyse = null;
/** Analyse du lot en cours en mode Simple : { lotId, ids, echecs, jeton }. */
let analyseSimple = null;

/** L'analyse d'un script vaut tant que son fichier n'a pas change. */
function analyseValide(entree) {
  const m = analyses.get(entree.id);
  return m && m.entree.hash === entree.hash ? m : null;
}

/** Ce que l'analyse ajoute a la configuration d'une action : la selection. */
function configAnalysePour(entree) {
  if (!entree.meta.scan) return {};
  const m = analyseValide(entree);
  return m && m.succes ? A.configAnalyse(m) : {};
}

/**
 * Lance l'analyse d'un script et attend sa fin. Renvoie { succes, refus } ;
 * le modele, lui, arrive dans `analyses` par `script:analysis`.
 * `simple` : sans ouvrir le journal, que le mode Simple cache (§2).
 */
async function analyser(entree, { simple = false } = {}) {
  if (course) return { succes: false, refus: t('an.occupe') };
  const ok = await assurerApprobation(entree);
  if (!ok) return { succes: false, refus: t('verdict.approbation_refusee') };
  let demarre;
  try {
    demarre = await invoke('scan_script', {
      req: {
        script_id: entree.id,
        expected_hash: entree.hash,
        // Les reglages figes valent aussi pour l'analyse : ses [scan] et le
        // reste de sa configuration.
        config: configFigee(entree.id),
        policy: reglagesActuels?.exec_policy || null,
      },
    });
  } catch (e) {
    const raison = messageLancement(e, entree);
    journaliserRefus(entree, raison);
    if (!simple) alerterEchecLancement(entree, raison);
    return { succes: false, refus: raison };
  }
  departCourse = Date.now();
  course = { runId: demarre.run_id, id: entree.id, logPath: demarre.log_path, analyse: true, lignes: [] };
  if (simple) {
    viderJournalCompact();
    term.corps.innerHTML = '';
    term.titre.textContent = A.titreAction(entree);
  } else {
    ouvrirTerminal(entree, demarre);
  }
  majEtatJournalCompact();
  document.querySelectorAll('[data-run], [data-analyser]').forEach((b) => (b.disabled = true));
  return new Promise((resoudre) => {
    attenteAnalyse = { runId: demarre.run_id, scriptId: entree.id, resoudre };
  });
}

function finirAnalyse(fin) {
  // Une analyse promet de ne rien modifier : si le temoin voit le contraire,
  // cela se dit — dans le journal, et la ou l'analyse s'affiche.
  if (fin.changes?.length) {
    temoinAnalyses.set(fin.script_id, fin.changes);
    journaliserTemoin(fin.changes);
  } else {
    temoinAnalyses.delete(fin.script_id);
  }
  const lignes = course?.lignes || [];
  course = null;
  journauxAnalyse.set(fin.script_id, lignes);
  majEtatJournalCompact();
  document.querySelectorAll('[data-run], [data-analyser]').forEach((b) => (b.disabled = false));
  term.stop.dataset.force = '';
  if (!document.getElementById('simple').hidden) {
    term.stop.hidden = true;
  } else {
    afficherVerdict(fin);
  }
  const a = attenteAnalyse;
  attenteAnalyse = null;
  a?.resoudre({ succes: fin.success && !fin.killed, tue: fin.killed });
  rafraichirZonesAnalyse();
}

/* --- Mode Simple : l'etape « Analyser » ----------------------------------- */

/** Les scripts que l'entretien lancera : ceux du mode Simple, moins les
 *  analysables dont rien n'est coche ou dont l'analyse n'a pas abouti. */
function scriptsALancer(groupe) {
  return scriptsRetenus(groupe).filter((s) => {
    if (!s.meta.scan) return true;
    const m = analyseValide(s);
    return !!m && m.succes && A.aFaire(m);
  });
}

/** Les scripts de l'entretien en cours, dans l'ordre ou il les lance. */
function scriptsEntretien(groupe) {
  const ids = entretienEnCours?.lances;
  return ids ? ids.map((id) => catalogue.get(id)).filter(Boolean) : scriptsRetenus(groupe);
}

async function rendreEtapeAnalyse(groupe, { reprendre = false } = {}) {
  document.getElementById('anLotTitre').textContent = nomLot(groupe.lot);
  const visibles = scriptsRetenus(groupe);
  const analysables = visibles.filter((s) => s.meta.scan && !moteurManquant(s.meta));
  const jeton = Symbol('analyse');
  analyseSimple = { lotId: groupe.lot.id, ids: analysables.map((s) => s.id), echecs: [], jeton, rang: 0 };
  A.etatUi().ouverts.clear();

  document.getElementById('anTitre').textContent = t('simple.analyse_titre_encours');
  document.getElementById('anSous').textContent = t('simple.analyse_sous_encours');
  document.getElementById('anProgression').hidden = false;
  document.getElementById('anResume').innerHTML = '';
  document.getElementById('anAutres').innerHTML = '';
  document.getElementById('anRestoreNote').hidden = true;
  document.getElementById('anRebootNote').hidden = true;
  document.getElementById('anTotal').textContent = '';
  const bouton = document.getElementById('btnLancerEntretien');
  bouton.hidden = true;
  majProgressionAnalyse(null);

  for (const [i, s] of analysables.entries()) {
    if (analyseSimple?.jeton !== jeton) return;
    analyseSimple.rang = i;
    majProgressionAnalyse(null);
    // Venu de l'Expert : ce qui y a ete analyse et coche est repris tel quel.
    if (reprendre && analyseValide(s)?.succes) continue;
    const r = await analyser(s, { simple: true });
    if (analyseSimple?.jeton !== jeton) return;
    if (!r.succes) analyseSimple.echecs.push({ id: s.id, raison: r.refus || t('an.analyse_echouee') });
  }
  if (analyseSimple?.jeton !== jeton) return;
  analyseSimple.rang = analysables.length;
  document.getElementById('anProgression').hidden = true;
  document.getElementById('anTitre').textContent = t('simple.analyse_titre');
  document.getElementById('anSous').textContent = t('simple.analyse_sous');
  rendreResumeAnalyse(groupe);
}

/** La barre de l'analyse en cours, en mode Simple : le rang de l'action et,
 *  dans l'action, son [STEP] ou son [PROGRESS]. Jamais le texte anglais. */
function majProgressionAnalyse(ligne) {
  if (!analyseSimple || document.getElementById('anProgression').hidden) return;
  const n = analyseSimple.ids.length || 1;
  const etat = analyseSimple.dansAction ?? 0;
  let dans = etat;
  if (ligne === null) dans = 0;
  else if (ligne.step && ligne.step[1] > 0) dans = Math.min(1, (ligne.step[0] - 1) / ligne.step[1]);
  else if (ligne.marker === 'PROGRESS') dans = Math.min(1, (Number(String(ligne.text).replace(/^\s*\[PROGRESS\]\s*/, '')) || 0) / 100);
  analyseSimple.dansAction = dans;
  const pct = Math.round(((analyseSimple.rang + dans) / n) * 100);
  document.getElementById('anBarre').style.width = `${Math.min(100, pct)}%`;
  const s = catalogue.get(analyseSimple.ids[Math.min(analyseSimple.rang, n - 1)]);
  document.getElementById('anEtape').textContent = s ? A.titreAction(s) : '';
  document.getElementById('anRang').textContent = t('simple.analyse_rang', { n: Math.min(analyseSimple.rang + 1, n), total: n });
  document.getElementById('anPct').textContent = `${Math.min(100, pct)} %`;
}

async function arreterAnalyseSimple() {
  if (!analyseSimple) return;
  analyseSimple.jeton = null;
  // Une analyse ne modifie rien par contrat : elle s'arrete tout de suite.
  if (course?.analyse) {
    try {
      await invoke('cancel_script', { runId: course.runId, force: true });
    } catch (e) {
      console.error(e);
    }
  }
}

function rendreResumeAnalyse(groupe) {
  const g = groupe || groupeLancement;
  if (!g || !analyseSimple) return;
  const modeles = analyseSimple.ids.map((id) => {
    const s = catalogue.get(id);
    const m = s && analyseValide(s);
    return m && m.succes ? m : null;
  }).filter(Boolean);
  const zone = document.getElementById('anResume');
  // Une action seule a l'ecran garde la vue que son script a choisie ; un lot
  // de plusieurs actions est resume par WinTool, en postes.
  zone.innerHTML = modeles.length === 1 && modeles[0].entree.meta.view
    ? `<div class="an-carte">${A.vue(modeles[0], 'simple', { historique: historiqueDe(modeles[0].entree.id) })}</div>`
    : `<div class="an-carte">${A.resume(modeles, { graphe: reglagesActuels?.analysis_chart || 'donut', ...A.etatUi() })}</div>`;
  A.poserPartiels(zone);

  const visibles = scriptsRetenus(g);
  const telsQuels = visibles.filter((s) => !s.meta.scan);
  const reserves = g.expert ? [] : scriptsActifs(g).filter((s) => s.meta.show === 'expert');
  const echecs = analyseSimple.echecs;
  const autres = [];
  if (telsQuels.length) {
    autres.push(`<div class="an-autres-bloc"><b>${esc(t('simple.tels_quels'))}</b><span class="muted">${esc(t('simple.tels_quels_desc'))}</span>
      <ul>${telsQuels.map((s) => `<li>${esc(A.titreAction(s))}</li>`).join('')}</ul></div>`);
  }
  for (const e of echecs) {
    const s = catalogue.get(e.id);
    autres.push(`<p class="an-masques">${esc(t('simple.analyse_echec', { titre: s ? A.titreAction(s) : e.id }))}</p>`);
  }
  for (const id of analyseSimple.ids.filter((x) => temoinAnalyses.has(x))) {
    autres.push(`<p class="temoin-alerte">${esc(t('temoin.analyse', { titre: titreDe(id) }))} ${esc(resumeTemoin(temoinAnalyses.get(id)).join(' · '))}</p>`);
  }
  if (reserves.length) {
    autres.push(`<p class="an-masques">${esc(t(reserves.length > 1 ? 'simple.reservees_expert' : 'simple.reservee_expert', {
      n: reserves.length, liste: reserves.map((s) => `« ${A.titreAction(s)} »`).join(', '),
    }))}</p>`);
  }
  document.getElementById('anAutres').innerHTML = autres.join('');

  const aLancer = scriptsALancer(g);
  const note = document.getElementById('anRestoreNote');
  note.hidden = !aLancer.some(pointAvant);
  if (!note.hidden) note.textContent = t('simple.point_restauration_annonce');
  const noteRedemarrage = document.getElementById('anRebootNote');
  noteRedemarrage.hidden = !aLancer.some(besoinRedemarrage);
  if (!noteRedemarrage.hidden) noteRedemarrage.textContent = t('simple.redemarrage_annonce');

  const tot = A.totalResume(modeles);
  const morceaux = [];
  if (tot.choisi) morceaux.push(t('simple.a_liberer', { taille: A.taille(tot.choisi) }));
  if (tot.reglages) morceaux.push(PLURIEL('an.n_reglages', tot.reglages));
  document.getElementById('anTotal').textContent = morceaux.join(' · ');
  const bouton = document.getElementById('btnLancerEntretien');
  bouton.hidden = false;
  // Un lot qui n'a fait que mesurer (un diagnostic) est termine : il n'y a
  // rien a cocher, donc rien a lancer — le bouton y met fin au lieu de rester
  // grise sur « Rien n'est coché ».
  const rienACocher = !telsQuels.length && modeles.every((m) => !Object.values(m.options)
    .some((o) => !o.def.scan && (o.find || Object.keys(o.finds).length || o.items.length)));
  bouton.dataset.fin = !aLancer.length && rienACocher ? '1' : '';
  bouton.disabled = aLancer.length === 0 && !bouton.dataset.fin;
  bouton.textContent = aLancer.length ? t('simple.lancer')
    : bouton.dataset.fin ? t(entretienEnCours?.depuisExpert ? 'simple.retour_expert' : 'simple.termine_retour')
      : t('simple.rien_a_lancer');
}

/* --- Mode Expert : « Analyser » sur la fiche d'un script ---------------- */

/** Une icone du sprite (src/icons.svg). */
const ico = (nom, classe = '') => `<svg class="ico ${classe}" aria-hidden="true"><use href="#${nom}" /></svg>`;

const PANNEAUX_AN = ['config', 'progress', 'plan', 'payload', 'attention', 'history', 'origin', 'disk'];
/** Panneaux ouverts, par script : ceux que le script propose (## panels), puis
 *  ce que l'utilisateur ajoute ou retire. Retenu pour la session. */
const panneauxOuverts = new Map();
const filtresJournal = new Map();
let espaceDisque = null;

function panneauxDe(entree) {
  if (!panneauxOuverts.has(entree.id)) {
    const proposes = (entree.meta.panels || []).filter((p) => PANNEAUX_AN.includes(p));
    panneauxOuverts.set(entree.id, new Set(proposes.length ? proposes : ['plan']));
  }
  return panneauxOuverts.get(entree.id);
}

function historiqueDe(id) {
  return (historiqueActuel.scripts || []).filter((r) => r.script_id === id);
}

function zoneAnalyseExpert(entree) {
  if (!entree.meta.scan) return '';
  return `<div class="an-zone" id="an-${esc(entree.id)}">${contenuAnalyseExpert(entree)}</div>`;
}

function contenuAnalyseExpert(entree) {
  const m = analyseValide(entree);
  if (!m) return `<p class="an-invite">${ico('scan')}${esc(t('an.invite'))}</p>`;
  const ouverts = panneauxDe(entree);
  const heure = heuresAnalyse.get(entree.id);
  const tete = `<div class="an-tete">
      <span class="an-tete-t"><b>${esc(t('an.analyse_de', { heure: heure ? heure.toLocaleTimeString(currentLang() === 'en' ? 'en-US' : 'fr-FR', { hour: '2-digit', minute: '2-digit' }) : '' }))}</b>
        <span>${esc(A.resumeTotaux(A.totaux(m), m))}</span></span>
      <button class="btn compact" type="button" data-relancer-an="${esc(entree.id)}">${esc(t('an.relancer'))}</button>
    </div>
    ${m.succes ? '' : `<p class="card-warn">${esc(t('an.analyse_echouee'))}</p>`}
    ${m.tronque ? `<p class="card-warn">${esc(t('an.tronquee'))}</p>` : ''}
    ${alerteTemoinAnalyse(entree)}`;
  const puces = PANNEAUX_AN.map((k) => `<button type="button" class="chip${ouverts.has(k) ? ' on' : ''}" data-panneau-an="${esc(entree.id)}|${k}" aria-pressed="${ouverts.has(k)}">${esc(t(`an.p.${k}`))}</button>`).join('');
  const panneaux = PANNEAUX_AN.filter((k) => ouverts.has(k)).map((k) => panneauAnalyse(entree, m, k)).join('');
  return `${tete}<div class="an-grille">
      <div class="an-vue-zone">${A.vue(m, 'expert', { historique: historiqueDe(entree.id) })}</div>
      <aside class="an-panneaux"><div class="an-puces">${puces}</div>${panneaux}</aside>
    </div>`;
}

function valeurAffichee(v) {
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (v === true) return t('an.oui');
  if (v === false) return t('an.non');
  return v == null || v === '' ? '—' : String(v);
}

/** En tete de l'analyse d'une fiche : ce que l'analyse a modifie, s'il y a lieu. */
function alerteTemoinAnalyse(entree) {
  const c = temoinAnalyses.get(entree.id);
  if (!c?.length) return '';
  return `<p class="temoin-alerte">${esc(t('temoin.analyse', { titre: titreDe(entree.id) }))} ${esc(resumeTemoin(c).join(' · '))}</p>`;
}

function panneauAnalyse(entree, m, cle) {
  let corps = '';
  if (cle === 'config') {
    const lignes = (entree.meta.options || []).filter((o) => o.kind !== 'items').map((o) => {
      const fige = optionFigee(entree, o.key);
      return `<span>${esc(libelleOption(entree, o).label)}</span><span class="${fige ? 'an-mod' : ''}">${esc(valeurAffichee(valeurOption(entree, o)))}</span>`;
    });
    corps = lignes.length ? `<div class="an-kv">${lignes.join('')}</div>` : `<span class="muted">${esc(t('an.aucun_reglage'))}</span>`;
  } else if (cle === 'progress') {
    const lignes = journauxAnalyse.get(entree.id) || [];
    const filtre = filtresJournal.get(entree.id) || 'tout';
    const canal = (l) => /^\s*\[LOG\]\s+([A-Za-z][\w-]*)/.exec(l.text)?.[1];
    const canaux = [...new Set(lignes.map(canal).filter(Boolean))];
    const garde = (l) => filtre === 'tout'
      || (filtre === 'etapes' && ['STEP', 'OK', 'WARN', 'ERR'].includes(l.marker))
      || (filtre === 'constats' && ['FIND', 'ITEM', 'METRIC', 'NOTE'].includes(l.marker))
      || canal(l) === filtre;
    const puces = ['tout', 'etapes', 'constats', ...canaux].map((f) => `<button type="button" class="chip${filtre === f ? ' on' : ''}" data-journal-an="${esc(entree.id)}|${esc(f)}" aria-pressed="${filtre === f}">${esc(['tout', 'etapes', 'constats'].includes(f) ? t(`an.j.${f}`) : f)}</button>`).join('');
    const texte = lignes.filter(garde).map((l) => `<span class="an-j-h">${esc(heureLigne(l.at_ms))}</span> <span class="m-${esc((l.marker || '').toLowerCase())}">${esc(l.text)}</span>`).join('\n');
    corps = `<div class="an-puces">${puces}</div><div class="an-journal">${texte || esc(t('an.journal_vide'))}</div>`;
  } else if (cle === 'plan') {
    corps = A.plan(m);
  } else if (cle === 'payload') {
    const cfg = { ...lireConfigCarte(entree), ...configAnalysePour(entree) };
    corps = `<div class="an-journal">WINTOOL_CONFIG = ${esc(JSON.stringify(cfg, null, 2))}</div>`;
  } else if (cle === 'attention') {
    const points = entree.attention || [];
    corps = points.length
      ? `${points.map((p) => `<div class="an-attention">${ico('warn', 'i14')}<span><code>${esc(p.extrait || p.code)}</code> — ${esc(t('an.ligne', { n: p.ligne }))}</span></div>`).join('')}<p class="muted an-petit">${esc(t('an.attention_note'))}</p>`
      : `<span class="muted">${esc(t('an.attention_vide'))}</span>`;
  } else if (cle === 'history') {
    const h = historiqueDe(entree.id);
    const lignes = h.slice(-6).reverse().map((r) => `<span>${esc(r.at.slice(0, 10))}</span><span>${esc(r.freed != null ? A.taille(r.freed) : r.success ? t('tache.reussi') : t('tache.echoue'))}${r.simulated ? ` · ${esc(t('simulation.marque'))}` : ''}</span>`);
    corps = `${A.historique(h)}${lignes.length ? `<div class="an-kv an-espace">${lignes.join('')}</div>` : ''}`;
  } else if (cle === 'origin') {
    const origine = { official: t('an.origine_officiel'), tierce: t('an.origine_tierce', { source: nomSource(entree.source) || entree.source || '' }), user: t('an.origine_perso') }[entree.origin] || entree.origin;
    corps = `<div class="an-kv"><span>${esc(t('an.source'))}</span><span>${esc(origine)}</span><span>${esc(t('an.fichier'))}</span><span>${esc(entree.path)}</span>
      <span>${esc(t('an.empreinte'))}</span><span>${esc(entree.hash.slice(0, 16))}…</span>
      <span>${esc(t('an.accord'))}</span><span>${esc(t(entree.verified ? 'an.accord_signe' : 'an.accord_approuve'))}</span></div>`;
  } else if (cle === 'disk') {
    if (!espaceDisque) {
      invoke('disk_space').then((d) => { espaceDisque = d; rafraichirZonesAnalyse(); }).catch(() => {});
      corps = `<span class="muted">…</span>`;
    } else {
      const choisi = A.totaux(m).choisi;
      const pc = (v) => `${(v / espaceDisque.total) * 100}%`;
      const utilise = espaceDisque.total - espaceDisque.libre;
      corps = `<div class="an-disque"><i class="utilise" style="width:${pc(Math.max(0, utilise - choisi))}"></i><i class="libere" style="width:${pc(Math.min(choisi, utilise))}"></i><i class="libre" style="width:${pc(espaceDisque.libre)}"></i></div>
        <p class="muted an-petit">${esc(t('an.disque_apres', { lecteur: espaceDisque.lecteur, libre: A.taille(espaceDisque.libre), apres: A.taille(espaceDisque.libre + choisi) }))}</p>`;
    }
  }
  return `<section class="an-panneau"><div class="an-panneau-h">${esc(t(`an.p.${cle}`))}</div><div class="an-panneau-b">${corps}</div></section>`;
}

/** La configuration que la fiche montre, comme `lireConfig` au lancement. */
function lireConfigCarte(entree) {
  const carte = document.querySelector(`.card[data-id="${CSS.escape(entree.id)}"]`);
  return carte ? lireConfig(carte) : configFigee(entree.id);
}

/** Redessine ce qui montre une analyse : le resume Simple, la fiche Expert. */
function rafraichirZonesAnalyse({ garderFocus = false } = {}) {
  const champ = garderFocus && document.activeElement?.matches?.('[data-a-cherche]') ? document.activeElement : null;
  const position = champ?.selectionStart;
  if (analyseSimple && !document.getElementById('analyseZone').hidden && document.getElementById('anProgression').hidden) {
    rendreResumeAnalyse();
  }
  document.querySelectorAll('.an-zone[id^="an-"]').forEach((z) => {
    const entree = catalogue.get(z.id.slice(3));
    if (!entree) return;
    z.innerHTML = contenuAnalyseExpert(entree);
    A.poserPartiels(z);
  });
  if (champ) {
    const nouveau = document.querySelector('[data-a-cherche]');
    nouveau?.focus();
    if (nouveau && position != null) nouveau.setSelectionRange(position, position);
  }
}

async function analyserExpert(id) {
  const entree = catalogue.get(id);
  if (!entree) return;
  await analyser(entree);
  rafraichirZonesAnalyse();
}

/** Un geste dans une zone d'analyse de l'Expert. */
function gesteAnalyseExpert(ev) {
  const panneau = ev.target.closest('[data-panneau-an]');
  if (panneau && ev.type === 'click') {
    const [id, cle] = panneau.dataset.panneauAn.split('|');
    const entree = catalogue.get(id);
    if (!entree) return;
    const ouverts = panneauxDe(entree);
    ouverts.has(cle) ? ouverts.delete(cle) : ouverts.add(cle);
    return void rafraichirZonesAnalyse();
  }
  const journal = ev.target.closest('[data-journal-an]');
  if (journal && ev.type === 'click') {
    const [id, filtre] = journal.dataset.journalAn.split('|');
    filtresJournal.set(id, filtre);
    return void rafraichirZonesAnalyse();
  }
  if (A.agir(ev, analyses)) rafraichirZonesAnalyse({ garderFocus: ev.type === 'input' });
}

/** Message honnete pour chacun des refus attendus (specification 6.4) —
 *  jamais un succes maquille. `resultat` est soit une chaine (variante unite
 *  de RestoreOutcome), soit `{ failed: "..." }` (variante avec message). */
function messageRestauration(resultat) {
  if (resultat === 'created') return t('simple.point_restauration_cree');
  if (resultat === 'throttled_recent') return t('simple.point_restauration_frequence');
  if (resultat === 'protection_disabled') return t('simple.point_restauration_protection');
  if (resultat === 'service_disabled') return t('simple.point_restauration_service');
  // Le message brut de Windows n'a rien a faire sous les yeux d'un debutant :
  // il part au journal (detail technique, mode Expert), et l'ecran dit
  // seulement qu'aucun point n'a ete cree.
  return t('simple.point_restauration_echec');
}

/** Le detail technique d'un echec, pour le journal : jamais « [object Object] ». */
function detailRestauration(resultat) {
  if (resultat && typeof resultat === 'object' && 'failed' in resultat) return String(resultat.failed);
  if (typeof resultat === 'string' && !['created', 'throttled_recent', 'protection_disabled', 'service_disabled'].includes(resultat)) return resultat;
  return null;
}

/** Estimation grossiere, jamais precise (specification §7 : ne pretend pas
 *  savoir ce qu'on ne sait pas) — juste de quoi donner un ordre de grandeur
 *  a partir de la duree grossiere declaree par chaque script restant. */
const MINUTES_PAR_DUREE = { fast: 1, medium: 3, slow: 8 };
function estimerMinutesRestantes(groupe) {
  const faits = new Set(entretienEnCours.resultats.map((r) => r.id));
  const restants = scriptsEntretien(groupe).filter((s) => !faits.has(s.id));
  return Math.max(1, restants.reduce((total, s) => total + (MINUTES_PAR_DUREE[s.meta.duration] || 2), 0));
}

/** Le resultat du point de restauration : une phrase a l'ecran, le detail
 *  brut au journal. */
function noterRestauration(resultat) {
  document.getElementById('tasksBilanDetail').textContent = messageRestauration(resultat);
  const detail = detailRestauration(resultat);
  const ligne = (marker, texte) => ajouterLigne({ at_ms: 0, stream: 'stdout', marker, text: `[${marker}] ${texte}` });
  if (resultat === 'created') ligne('OK', t('simple.point_restauration_cree'));
  else ligne('WARN', detail ? `${t('simple.point_restauration_echec')} ${detail}` : messageRestauration(resultat));
}

async function lancerEntretien() {
  document.getElementById('riseFill')?.classList.remove('termine');
  const groupe = groupeLancement;
  if (!groupe) return;
  entretienActif = true;
  // Le journal de l'entretien part de zero : il gardait sinon les lignes de la
  // derniere analyse, qui n'ont rien a voir avec ce qui va tourner.
  term.corps.innerHTML = '';
  viderJournalCompact();
  rendreBandeauMaj();
  rendreBandeauCatalogue();

  afficherEtapeSimple(4);
  document.getElementById('s3Titre').textContent = t('s3.titre');
  document.getElementById('riseBadgeLabel').textContent = t('simple.niveau_atteint');
  document.getElementById('btnArreterEntretien').hidden = false;
  document.getElementById('btnArreterEntretien').textContent = t('simple.arreter_apres');
  document.getElementById('btnRetourAccueil').hidden = true;
  document.getElementById('tasksBilan').hidden = false;
  document.getElementById('tasksBilanDetail').textContent = nomLot(groupe.lot);
  document.getElementById('term').hidden = true;
  document.getElementById('temoinBilan').hidden = true;
  const aLancer = scriptsALancer(groupe);
  entretienEnCours.lances = aLancer.map((s) => s.id);
  entretienEnCours.total = aLancer.length;
  fileEntretien = [...aLancer];
  etapeEntretienActuelle = null;
  majProgression();

  // Une action seule lancee depuis l'Expert n'est pas un lot : son
  // historique est celui de l'action, rien de plus.
  if (groupe.lot.id !== LOT_EXPERT) {
    invoke('record_lot_run', {
      lotId: groupe.lot.id,
      lotName: nomLot(groupe.lot),
      scriptIds: aLancer.map((s) => s.id),
    }).catch((e) => console.error("Enregistrement de l'historique impossible :", e));
  }

  const besoinRestauration = aLancer.some(pointAvant);
  if (besoinRestauration) {
    try {
      const resultat = await invoke('create_restore_point', {
        description: `WinTool - ${nomLot(groupe.lot)}`,
      });
      noterRestauration(resultat);
    } catch (e) {
      noterRestauration({ failed: String(e) });
    }
  }

  avancerEntretien();
}

function avancerEntretien() {
  if (!fileEntretien.length) return void terminerEntretien();
  const prochain = fileEntretien.shift();
  lancerScriptEntretien(prochain);
}

async function lancerScriptEntretien(entree) {
  const ok = await assurerApprobation(entree);
  if (!ok) {
    // Un refus n'est pas cache dans la console : c'est un script en moins
    // dans le bilan final, comme n'importe quel autre echec (specification 6.2).
    entretienEnCours.resultats.push({ id: entree.id, success: false, raison: t('verdict.approbation_refusee') });
    majProgression();
    avancerEntretien();
    return;
  }

  try {
    const demarre = await invoke('run_script', {
      req: {
        script_id: entree.id,
        expected_hash: entree.hash,
        // Le mode Expert est le panneau de configuration du mode Simple : ce
        // que l'utilisateur avance y a fige s'applique ici aussi, sinon
        // l'entretien tournerait avec d'autres reglages que ceux affiches.
        // Et apres l'analyse, ce qui est coche (§17).
        config: { ...configFigee(entree.id), ...configAnalysePour(entree) },
        policy: reglagesActuels?.exec_policy || null,
      },
    });
    departCourse = Date.now();
    course = { runId: demarre.run_id, id: entree.id, logPath: demarre.log_path, entretien: true, simule: !!demarre.simulated };
    majProgression();
  } catch (e) {
    // La raison est conservee ET affichee : dans le journal pour le detail,
    // sur la ligne de la tache pour qu'on la voie sans le deplier.
    const raison = messageLancement(e, entree);
    entretienEnCours.resultats.push({ id: entree.id, success: false, raison });
    journaliserRefus(entree, raison);
    majProgression();
    avancerEntretien();
  }
}

/** Arrete l'entretien : le script courant va au bout (specification 6.3, deja
 *  la regle du bouton Arreter), mais aucun autre ne sera enchaine ensuite. */
async function arreterEntretien() {
  fileEntretien = [];
  if (course?.entretien) await arreter(false);
  else terminerEntretien();
}

function terminerEntretien() {
  entretienActif = false;
  rendreBandeauMaj();
  rendreBandeauCatalogue();
  // L'eau redescend : elle disait « en cours » alors que tout etait fini, et
  // restait a mi-hauteur sur l'ecran de bilan.
  document.getElementById('riseFill')?.classList.add('termine');
  document.getElementById('btnArreterEntretien').hidden = true;
  document.getElementById('btnRetourAccueil').hidden = false;
  document.getElementById('btnRetourAccueil').textContent = t(entretienEnCours?.depuisExpert ? 'simple.retour_expert' : 'simple.termine_retour');
  document.getElementById('s3Sous').textContent = t('s3.sous_fini');
  const ok = entretienEnCours.resultats.filter((r) => r.success).length;
  const total = entretienEnCours.resultats.length;
  document.getElementById('tasksBilan').hidden = false;
  document.getElementById('tasksBilan').textContent = t('simple.bilan_titre');
  const simules = entretienEnCours.resultats.filter((r) => r.simule).length;
  rendreTemoinBilan();
  document.getElementById('tasksBilanDetail').textContent = t(total === 1 ? 'simple.bilan_detail_un' : 'simple.bilan_detail', { ok, total })
    + (simules ? ` ${t('simulation.bilan', { n: simules })}` : '')
    + bilanLibere();
}

/**
 * Ce qui a ete libere (§17.2) : le chiffre que les scripts ont annonce par
 * `[FREED]` ; a defaut, l'estimation de l'analyse, precedee de « environ ».
 * Un chiffre estime n'est jamais presente comme mesure.
 */
function bilanLibere() {
  let mesure = 0, estime = 0, aMesure = false, aEstime = false;
  for (const r of entretienEnCours.resultats) {
    if (!r.success || r.simule) continue;
    if (r.freed != null) { mesure += r.freed; aMesure = true; continue; }
    const m = analyses.get(r.id);
    const choisi = m ? A.totaux(m).choisi : 0;
    if (choisi) { estime += choisi; aEstime = true; }
  }
  if (!aMesure && !aEstime) return '';
  if (aMesure && !aEstime) return ` · ${t('bilan.libere', { taille: A.taille(mesure) })}`;
  return ` · ${t('bilan.libere_environ', { taille: A.taille(mesure + estime) })}`;
}

/** Icone d'etat d'une tache : coche (reussi), point d'exclamation (echoue),
 *  ou son numero d'ordre pour une tache pas encore commencee — jamais un
 *  symbole qui pretendrait en savoir plus que ce que `derniersResultats` sait
 *  vraiment (specification §7). */
function rendreTachesEntretien() {
  const groupe = groupeLancement;
  if (!groupe) return;
  const lignes = scriptsEntretien(groupe).map((s, i) => {
    const tr = s.meta.translations?.[currentLang()];
    const titre = tr?.title || s.meta.title || s.path;
    const resultat = entretienEnCours.resultats.find((r) => r.id === s.id);
    const actif = course?.entretien && course.id === s.id;
    let etat = '';
    if (resultat) etat = resultat.success ? 'ok' : 'err';
    else if (actif) etat = 'run';

    let icone = String(i + 1);
    let resultatTxt = `<span class="tres">${esc(t('simple.tache_en_attente'))}</span>`;
    let barre = '';
    if (etat === 'ok') {
      icone = '<svg class="ico" aria-hidden="true"><use href="#check"/></svg>';
      resultatTxt = `<span class="tres ok">${esc(t('tache.reussi'))}</span>`;
    } else if (etat === 'err') {
      icone = '<svg class="ico" aria-hidden="true"><use href="#warn"/></svg>';
      resultatTxt = resultat?.raison
        ? `<span class="tres err" data-tip="${esc(resultat.raison)}">${esc(t('tache.echoue'))}</span>`
        : `<span class="tres err">${esc(t('tache.echoue'))}</span>`;
    } else if (etat === 'run') {
      resultatTxt = `<span class="tres">${esc(t('tache.encours'))}</span>`;
      const [n, total] = etapeEntretienActuelle || [];
      if (total) barre = `<div class="tbar"><i style="width:${Math.min(100, (n / total) * 100)}%"></i></div>`;
    }

    return `
      <div class="task${etat === 'run' ? ' encours' : ''}">
        <span class="dt ${etat}">${icone}</span>
        <div class="tbody"><div class="tt">${esc(titre)}</div>${barre}</div>
        ${resultatTxt}
      </div>`;
  });
  document.getElementById('tasksList').innerHTML = lignes.join('');
}

function majProgression() {
  const groupe = groupeLancement;
  const total = entretienEnCours?.total || 1;
  const fait = entretienEnCours?.resultats.length || 0;
  const pct = Math.round((fait / total) * 100);
  document.getElementById('riseFill').style.height = `${pct}%`;
  document.getElementById('ringPct').textContent = `${pct}%`;
  document.getElementById('risePct').textContent = `${pct} %`;
  if (fait < total) {
    document.getElementById('tasksBilan').textContent = t('simple.progression', { fait, total });
  }
  if (groupe && fait < total) {
    document.getElementById('s3Sous').textContent = t('s3.sous_restant', { n: estimerMinutesRestantes(groupe) });
  }
  rendreTachesEntretien();
}

/** Bascule le journal partage (specification §2 : masque par defaut derriere
 *  ce lien) — pas un second journal construit exprès pour le mode Simple. */
function basculerDetailTechnique() {
  afficherJournal(term.panneau.hidden);
}

function cablerModeEtSimple() {
  document.querySelectorAll('#modeSeg [data-mode-btn]').forEach((b) => {
    b.onclick = () => {
      const mode = b.dataset.modeBtn;
      // Depuis les reglages, le mode deja actif ramene a son accueil : sans
      // cela, le bouton ne faisait rien de visible et semblait casse.
      if (mode === modeCourant && reglagesOuverts()) {
        fermerReglages();
        // Un entretien en cours garde son ecran : on ne quitte que les reglages.
        if (mode === 'simple' && !entretienActif) {
          arreterAnalyseSimple();
          afficherEtapeSimple(1);
        }
        return;
      }
      basculerMode(mode);
    };
  });

  document.querySelector('.simple').addEventListener('click', (ev) => {
    const reco = ev.target.closest('.reco[data-lot]');
    if (reco) return void selectionnerChoix(reco.dataset.lot);

    const buoy = ev.target.closest('.buoy[data-lot]');
    if (buoy) return void selectionnerChoix(buoy.dataset.lot);

    if (ev.target.closest('#btnContinuerChoix')) return void choisirLot(selectionSimpleId);
    const retour = ev.target.closest('[data-s-back]');
    if (retour) {
      arreterAnalyseSimple();
      // Venu de l'Expert, il n'y a pas d'etape « Verifier » derriere soi.
      if (entretienEnCours?.depuisExpert) return void retourExpert();
      return void afficherEtapeSimple(Number(retour.dataset.sBack) || 1);
    }
    if (ev.target.closest('#btnSuivantVerifier')) return void suivreVerifier();
    // Les gestes du resume de l'analyse (§17) : cases, chevrons, interrupteurs.
    if (ev.target.closest('#anResume') && A.agir(ev, analyses)) return void rendreResumeAnalyse();
    const lancerOuFinir = ev.target.closest('#btnLancerEntretien');
    if (lancerOuFinir) {
      if (!lancerOuFinir.dataset.fin) return void lancerEntretien();
      if (entretienEnCours?.depuisExpert) return void retourExpert();
      return void afficherEtapeSimple(1);
    }
    if (ev.target.closest('#btnArreterEntretien')) return void arreterEntretien();
    if (ev.target.closest('#btnRetourAccueil')) {
      if (entretienEnCours?.depuisExpert) return void retourExpert();
      return void afficherEtapeSimple(1);
    }
    if (ev.target.closest('#btnDetailTechnique')) return void basculerDetailTechnique();
  });

  // « Verifier » : une case par action, pour ce lancement seulement.
  document.getElementById('recapZone').addEventListener('change', (ev) => {
    const caseRetenir = ev.target.closest('[data-retenir]');
    if (!caseRetenir || !groupeLancement) return;
    if (caseRetenir.checked) exclusLancement.delete(caseRetenir.dataset.retenir);
    else exclusLancement.add(caseRetenir.dataset.retenir);
    majVerifier(groupeLancement);
  });

  document.getElementById('anResume').addEventListener('change', (ev) => {
    if (A.agir(ev, analyses)) rendreResumeAnalyse();
  });

  afficherJournal(false);
}

/* -------------------------------------------------------------------------
   Accueil et Reglages (specification 8, 13)
   ------------------------------------------------------------------------- */

/** Derniers reglages connus : lus une fois au demarrage, puis tenus a jour a
 *  chaque commande qui les modifie — evite un aller-retour reseau/IPC avant
 *  chaque lancement d'entretien pour connaitre la politique en vigueur. */
let reglagesActuels = null;

/** Dernier historique connu (§9/§14) : rafraichi apres chaque script execute,
 *  pour que "Fait le ..." (§7) reste a jour sans le recharger a chaque rendu. */
let historiqueActuel = { lots: [], scripts: [] };

/** Le plus recent enregistrement pour ce script, ou undefined. Les entrees
 *  sont ajoutees dans l'ordre chronologique : le dernier du tableau est le
 *  plus recent. */
function derniereExecution(scriptId) {
  // Une execution simulee n'a rien modifie : elle ne compte pas comme « Fait le ».
  const trouves = historiqueActuel.scripts.filter((r) => r.script_id === scriptId && !r.simulated);
  return trouves[trouves.length - 1];
}

/** "Fait le 18 septembre" (§7) : une date de lancement constatee, jamais une
 *  preuve que l'effet est toujours en place — l'interface ne pretend pas le
 *  contraire ailleurs non plus. */
function libelleFait(record) {
  if (!record) return t('histo.jamais_fait');
  const date = new Date(record.at.replace(' ', 'T'));
  const formatte = new Intl.DateTimeFormat(currentLang() === 'fr' ? 'fr-FR' : 'en-US', {
    day: 'numeric',
    month: 'long',
  }).format(date);
  return t('histo.fait_le', { date: formatte });
}

async function rafraichirHistorique() {
  try {
    historiqueActuel = await invoke('get_history');
  } catch (e) {
    console.error('get_history a echoue :', e);
  }
}

/** Appele apres chaque script:end, quel que soit le mode : la granularite de
 *  l'historique est "une entree par script execute", sans exception. */
async function enregistrerExecution(payload, titre, simule) {
  try {
    await invoke('record_script_run', {
      scriptId: payload.script_id,
      title: titre,
      success: payload.success && !payload.killed,
      killed: payload.killed,
      durationMs: payload.duration_ms,
      simulated: !!simule,
      freed: payload.freed ?? null,
      changes: payload.changes || [],
    });
    await invoke('enforce_log_cap');
  } catch (e) {
    console.error("Enregistrement de l'historique impossible :", e);
  }
  await rafraichirHistorique();
}

function rendreHistorique() {
  const zone = document.getElementById('historiqueZone');
  const totalScripts = historiqueActuel.scripts.length;
  const totalLots = historiqueActuel.lots.length;
  if (!totalScripts && !totalLots) {
    zone.innerHTML = `<div class="box-b"><p class="muted">${esc(t('histo.vide'))}</p></div>`;
    return;
  }

  const lignesLots = [...historiqueActuel.lots]
    .reverse()
    .slice(0, 20)
    .map(
      (c) => `
      <div class="rrow">
        <div class="rt">${esc(t('histo.lot_lance', { nom: c.lot_name, n: c.script_ids.length }))}</div>
        <span class="muted mono">${esc(c.at)}</span>
      </div>`
    )
    .join('');

  const lignesScripts = [...historiqueActuel.scripts]
    .reverse()
    .slice(0, 40)
    .map((s) => {
      const etat = s.killed ? t('histo.interrompu') : s.success ? t('histo.reussi') : t('histo.echoue');
      const simule = s.simulated ? ` <span class="chip simule">${esc(t('simulation.marque'))}</span>` : '';
      return `
      <div class="rrow">
        <div class="rt">${esc(s.title)} — ${esc(etat)}${simule}</div>
        <span class="muted mono">${esc(s.at)}</span>
      </div>`;
    })
    .join('');

  zone.innerHTML = `
    <div class="box-h">${esc(t('histo.titre'))}</div>
    <div class="box-b list">${lignesLots}${lignesScripts}</div>`;
}

function appliquerTraductionsReglages() {
  // Textes fixes de la page : la cle est dans l'attribut data-i18n.
  document.querySelectorAll('#settingsPage [data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.getElementById('tbReglages').textContent = t('reglages.titre');
  document.getElementById('rgRecherche').placeholder = t('reglages.rechercher');
  document.getElementById('setVisiteLabel').textContent = t('reglages.visite');
  document.getElementById('btnRevoirVisite').textContent = t('reglages.visite_btn');
  if (!document.getElementById('onboarding').hidden) rendreVisite();

  document.getElementById('setTitre').textContent = t('reglages.titre');
  document.getElementById('navGeneral').textContent = t('reglages.nav_general');
  document.getElementById('navExpert').textContent = t('reglages.nav_execution');
  document.getElementById('navOutils').textContent = t('reglages.nav_outils');
  document.getElementById('navConfig').textContent = t('reglages.nav_config');
  document.getElementById('navHisto').textContent = t('reglages.nav_histo');
  document.getElementById('secGeneralTitre').textContent = t('reglages.nav_general');
  document.getElementById('secOutilsTitre').textContent = t('reglages.nav_outils');
  document.getElementById('secConfigTitre').textContent = t('reglages.nav_config');
  document.getElementById('secHistoTitre').textContent = t('reglages.nav_histo');
  document.getElementById('setThemeLabel').textContent = t('reglages.theme');
  document.querySelector('#setThemeSeg [data-set-theme="light"]').textContent = t('onb.theme_clair');
  document.querySelector('#setThemeSeg [data-set-theme="dark"]').textContent = t('onb.theme_sombre');
  document.querySelector('#setThemeSeg [data-set-theme="system"]').textContent = t('onb.theme_systeme');
  document.getElementById('setLangueLabel').textContent = t('reglages.langue');
  document.getElementById('setMajLabel').textContent = t('reglages.maj_comportement');
  document.getElementById('setGrapheLabel').textContent = t('reglages.graphique');
  document.getElementById('setAccentLabel').textContent = t('reglages.accent');
  document.querySelectorAll('#setAccentChoix [data-set-accent]').forEach((b) => {
    b.setAttribute('aria-label', t(`accent.${b.dataset.setAccent}`));
    b.title = t(`accent.${b.dataset.setAccent}`);
  });
  document.querySelectorAll('#setGrapheSelect option').forEach((o) => { o.textContent = t(`graphe.${o.value}`); });
  document.querySelector('#setMajSelect [value="propose"]').textContent = t('reglages.maj_proposer');
  document.querySelector('#setMajSelect [value="never"]').textContent = t('reglages.maj_jamais');
  document.getElementById('setMajVerifLabel').textContent = t('reglages.maj_verifier');
  document.getElementById('btnVerifierMaj').textContent = t('reglages.maj_verifier_btn');
  rendreBandeauMaj();

  document.getElementById('navCatalogue').textContent = t('reglages.nav_catalogue');
  document.getElementById('secCatalogueTitre').textContent = t('reglages.nav_catalogue');
  document.getElementById('filCatalogue').textContent = t('reglages.nav_catalogue');
  document.getElementById('sourceDepot').placeholder = t('cat.form_depot_ph');
  document.getElementById('sourceCle').placeholder = t('cat.form_cle_ph');
  rendreSources();
  if (sourceOuverte) {
    document.getElementById('sourceFilNom').textContent = nomSource(sourceOuverte.id);
    document.getElementById('sourceTitre').textContent = nomSource(sourceOuverte.id);
    rendreContenuSource();
  }
  document.getElementById('setCatalogueVerifLabel').textContent = t('cat.verif_label');
  document.querySelector('#setCatalogueSelect [value="startup"]').textContent = t('cat.verif_startup');
  document.querySelector('#setCatalogueSelect [value="manual"]').textContent = t('cat.verif_manual');
  rendreReglagesCatalogue();
  rendreBandeauCatalogue();
  document.getElementById('rappelTitre').textContent = t('rappel.titre');
  document.getElementById('rappelTexte').textContent = t('rappel.texte');
  document.getElementById('rappelNePlusLabel').textContent = t('rappel.ne_plus');
  document.getElementById('btnRappelFermer').textContent = t('rappel.fermer');
  document.getElementById('btnRappelInstaller').textContent = t('rappel.installer');

  document.getElementById('setSectionExpert').textContent = t('reglages.nav_execution');
  document.getElementById('filExecution').textContent = t('reglages.nav_execution');
  document.getElementById('setEchecLabel').textContent = t('reglages.echec_comportement');
  document.querySelector('#setEchecSelect [value="continue"]').textContent = t('reglages.echec_continuer');
  document.querySelector('#setEchecSelect [value="stop"]').textContent = t('reglages.echec_arreter');
  document.getElementById('setJournauxLabel').textContent = t('reglages.taille_journaux');
  document.getElementById('setPolitiqueLabel').textContent = t('reglages.politique_execution');
  // La difference entre les trois politiques n'est pas devinable depuis leur
  // nom : l'explication vit dans une bulle plutot que dans un libelle a
  // rallonge (§8 — les reglages restent lisibles d'un coup d'oeil).
  const aide = document.getElementById('aidePolitique');
  if (aide) aide.dataset.tip = t('reglages.politique_aide');
  document.getElementById('setNumerosLabel').textContent = t('reglages.numeros_reglages');
  document.getElementById('setProtegesLabel').textContent = t('reglages.proteges');
  document.getElementById('protegesDroitsTexte').textContent = t('reglages.proteges_droits');
  document.getElementById('btnProtegesDroits').textContent = t('reglages.proteges_relancer');
  document.getElementById('protegesAjoutChemin').placeholder = t('garde.ajouter_placeholder');
  document.getElementById('btnProtegesAjouter').textContent = t('garde.ajouter');
  rendreResumeProteges();
  rendrePlanProteges();
  document.getElementById('setEchelleLabel').textContent = t('reglages.echelle');
  document.getElementById('btnOuvrirDossierReglages').textContent = t('reglages.btn_ouvrir');
  document.getElementById('btnReanalyserReglages').textContent = t('reglages.btn_reanalyser');
  document.getElementById('btnRapportConformite').textContent = t(
    document.getElementById('conformiteZone').hidden ? 'reglages.btn_afficher' : 'reglages.btn_masquer',
  );
  document.getElementById('btnExporterConfig').textContent = t('reglages.btn_exporter');
  document.getElementById('btnImporterConfig').textContent = t('reglages.btn_importer');
  document.getElementById('btnReinitialiserConfig').textContent = t('reglages.btn_reinitialiser');
  // Une recherche en cours se refait dans la nouvelle langue.
  const recherche = document.getElementById('rgRecherche').value;
  if (reglagesOuverts() && recherche.trim()) rechercherReglages(recherche);
}

/** Reflete `reglages` dans les commandes de l'ecran Reglages, sans rien
 *  ecrire : ouvrir l'ecran ne doit jamais modifier quoi que ce soit. */
function remplirFormulaireReglages(reglages) {
  document.querySelectorAll('#setThemeSeg [data-set-theme]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.setTheme === reglages.theme));
  });
  document.querySelectorAll('#setLangueSeg [data-set-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.setLang === reglages.lang));
  });
  document.getElementById('setMajSelect').value = reglages.update_policy;
  document.getElementById('setGrapheSelect').value = reglages.analysis_chart || 'donut';
  document.querySelectorAll('#setAccentChoix [data-set-accent]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.setAccent === (reglages.accent || 'orange')));
  });
  document.getElementById('setCatalogueSelect').value = reglages.catalogue_check || 'startup';
  rendreReglagesCatalogue();
  document.getElementById('setEchecSelect').value = reglages.failure_policy;
  document.getElementById('setJournauxInput').value = reglages.log_cap_mb;
  document.getElementById('setPolitiqueSelect').value = reglages.exec_policy;
  document.getElementById('setEchelleSelect').value = String(reglages.ui_scale ?? 1);
  appliquerNumerosReglages(reglages.show_setting_numbers);
  appliquerEchelle(reglages.ui_scale ?? 1);
}

/** La numerotation des reglages (« 2.3 ») se pose sur <body> : une seule
 *  regle CSS la masque partout, plutot que de toucher chaque ligne. */
function appliquerNumerosReglages(actif) {
  document.body.classList.toggle('sans-numeros', !actif);
  const bouton = document.getElementById('setNumerosToggle');
  if (bouton) bouton.setAttribute('aria-checked', String(!!actif));
}

/* -------------------------------------------------------------------------
   Reglages (specification §8) : une page de WinTool, pas une fenetre posee
   dessus. La barre de titre reste active : Simple / Expert se change sans
   quitter les reglages, et l'on reste sur la meme section — sauf si elle est
   reservee au mode Expert et que l'on passe en Simple.
   ------------------------------------------------------------------------- */

/** Section affichee : `general`, `catalogue`, `expert`, `proteges`, `outils`,
 *  `config` ou `histo`. Gardee d'une ouverture a l'autre. */
let sectionReglages = 'general';

function reglagesOuverts() {
  return !document.getElementById('settingsPage').hidden;
}

function ouvrirReglages() {
  rendreEmplacementsProteges();
  remplirFormulaireReglages(reglagesActuels);
  document.getElementById('exportResultat').hidden = true;
  document.getElementById('importResultat').hidden = true;
  document.getElementById('conformiteZone').hidden = true;
  document.getElementById('btnRapportConformite').textContent = t('reglages.btn_afficher');
  document.getElementById('protegesErreur').hidden = true;
  document.getElementById('rgRecherche').value = '';
  fermerFormulaireSource();
  // La page d'un catalogue se rouvre sur la liste : son contenu a pu changer.
  if (sectionReglages === 'source') sectionReglages = 'catalogue';
  chargerSources();
  document.getElementById('settingsPage').hidden = false;
  document.body.classList.add('reglages-ouverts');
  document.getElementById('btnSettings').setAttribute('aria-pressed', 'true');
  afficherSectionReglages(sectionReglages);
}

function fermerReglages() {
  document.getElementById('settingsPage').hidden = true;
  document.body.classList.remove('reglages-ouverts');
  document.getElementById('btnSettings').setAttribute('aria-pressed', 'false');
  // La fenetre a pu changer de taille pendant que la page couvrait la scene.
  requestAnimationFrame(positionnerBouees);
}

/** Une section reservee au mode Expert n'existe pas en mode Simple. */
function sectionVisible(id) {
  const page = document.querySelector(`[data-rg-page="${id}"]`);
  return !!page && !(modeCourant === 'simple' && page.classList.contains('only-expert'));
}

/** Affiche une section ; `ligne` (ex. « 3.2 ») la fait defiler jusqu'a ce
 *  reglage, qui s'illumine un instant — c'est la qu'aboutit une recherche. */
async function afficherSectionReglages(id, { ligne } = {}) {
  if (!sectionVisible(id)) id = 'general';
  sectionReglages = id;
  document.querySelectorAll('[data-rg-page]').forEach((page) => {
    page.hidden = page.dataset.rgPage !== id;
  });
  document.getElementById('rgResultats').hidden = true;
  // La page du plan du disque appartient a la section 3, celle d'un catalogue
  // a la section 2.
  const menu = { proteges: 'expert', source: 'catalogue' }[id] || id;
  document.querySelectorAll('#setNav [data-rg-section]').forEach((b) => {
    b.setAttribute('aria-current', b.dataset.rgSection === menu ? 'page' : 'false');
  });
  document.getElementById('setScroll').scrollTop = 0;
  if (id === 'histo') {
    await rafraichirHistorique();
    rendreHistorique();
  }
  if (ligne) {
    const el = document.querySelector(`[data-rg-page="${id}"] [data-num="${ligne}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.remove('eclair');
      void el.offsetWidth; // relance l'animation
      el.classList.add('eclair');
    }
  }
}

const sansAccents = (texte) => texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Cherche dans les libelles et les explications des sections visibles : on
 *  tape « journaux », on arrive au reglage 3.2. */
function rechercherReglages(texte) {
  const q = sansAccents(texte.trim());
  if (!q) return void afficherSectionReglages(sectionReglages);
  const trouves = [];
  document.querySelectorAll('[data-rg-page]').forEach((page) => {
    if (!sectionVisible(page.dataset.rgPage)) return;
    const section = page.querySelector('.rg-h h1 span:not(.num)')?.textContent || '';
    page.querySelectorAll('.setrow[data-num]').forEach((ligne) => {
      const libelle = ligne.querySelector('.rg-libelle b')?.textContent.trim() || '';
      const desc = ligne.querySelector('.desc')?.textContent.trim() || '';
      if (sansAccents(`${libelle} ${desc}`).includes(q)) {
        trouves.push({ page: page.dataset.rgPage, icone: page.dataset.rgIcone, section, num: ligne.dataset.num, libelle, desc });
      }
    });
  });
  document.querySelectorAll('[data-rg-page]').forEach((page) => {
    page.hidden = true;
  });
  document.querySelectorAll('#setNav [data-rg-section]').forEach((b) => b.setAttribute('aria-current', 'false'));
  const lignes = trouves
    .map(
      (r) => `
      <button class="rg-resultat" type="button" data-rg-aller="${esc(r.page)}" data-rg-ligne="${esc(r.num)}">
        <span class="rg-i"><svg class="ico i17" aria-hidden="true"><use href="#${esc(r.icone)}" /></svg></span>
        <span class="rg-resultat-txt"><small>${esc(r.section)}</small>
          <b><span class="num">${esc(r.num)}</span> ${esc(r.libelle)}</b><small>${esc(r.desc)}</small></span>
        <svg class="ico i16" aria-hidden="true"><use href="#chevron-right" /></svg>
      </button>`,
    )
    .join('');
  const zone = document.getElementById('rgResultats');
  zone.innerHTML = `
    <header class="rg-h">
      <span class="rg-gi"><svg class="ico i24" aria-hidden="true"><use href="#search" /></svg></span>
      <div><h1>« ${esc(texte.trim())} »</h1>
        <p>${esc(trouves.length ? PLURIEL('reglages.resultats', trouves.length) : t('reglages.resultats_aucun'))}</p></div>
    </header>
    <div class="rg-cartes">${lignes || `<p class="rg-vide">${esc(t('reglages.resultats_aide'))}</p>`}</div>`;
  zone.hidden = false;
  document.getElementById('setScroll').scrollTop = 0;
}

/** `lib::EmplacementsProteges`, tel que lu a l'ouverture des Reglages. */
let gardeActuelle = null;

/** Emplacements proteges (§12.4) : une ligne de resume dans la section 3, le
 *  plan du disque dans sa propre page. La liste vit dans HKLM : sans droits
 *  administrateur, elle se lit mais ne se modifie pas. */
async function rendreEmplacementsProteges() {
  try {
    gardeActuelle = await invoke('protected_paths');
  } catch (e) {
    console.error('Emplacements proteges :', e);
    return;
  }
  rendreResumeProteges();
  rendrePlanProteges();
}

/** La ligne 3.5 : verte si tout est protege, orange — avec les noms — sinon. */
function rendreResumeProteges() {
  const p = gardeActuelle;
  if (!p) return;
  const retires = p.integres.filter((i) => p.retires.includes(i.id));
  document.getElementById('protegesResume').classList.toggle('alerte', retires.length > 0);
  document.getElementById('protegesResumeIcone').setAttribute('href', retires.length ? '#shield-off' : '#shield-check');
  const ajouts = p.ajouts.length ? PLURIEL('garde.ajouts', p.ajouts.length) : t('garde.ajouts_aucun');
  document.getElementById('protegesResumeTexte').textContent = retires.length
    ? `${PLURIEL('garde.resume_retires', retires.length)} : ${retires.map((i) => t(`garde.court.${i.id}`)).join(', ')}`
    : t('garde.resume_ok', { n: p.integres.length, ajouts });
}

/** Le plan du disque : ou un script peut agir, et ou il ne le peut pas. Un
 *  bouclier par emplacement protege ; le profil de l'utilisateur et le profil
 *  public, autorises, montrent pourquoi C:\Users est protege sans l'etre pour
 *  lui. Les ajouts se rangent sous leur lecteur. */
function rendrePlanProteges() {
  const p = gardeActuelle;
  if (!p) return;
  const integre = Object.fromEntries(p.integres.map((i) => [i.id, i]));
  const actif = (id) => !p.retires.includes(id);
  const nom = (chemin) => chemin.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || chemin;
  const icone = (n) => `<svg class="ico i14" aria-hidden="true"><use href="#${n}" /></svg>`;
  const lignes = [];
  const etat = (id) => {
    const on = actif(id);
    return `<button class="etat ${on ? 'on' : 'off'}" type="button" data-garde-bascule="${esc(id)}"
      aria-pressed="${on}"${p.modifiable ? '' : ' disabled'}>${icone(on ? 'shield-check' : 'shield-off')}${esc(
        t(on ? 'garde.protege' : 'garde.ouvert'),
      )}</button>`;
  };
  const libre = `<span class="etat libre">${esc(t('garde.autorise'))}</span>`;
  const noeud = (niveau, ic, titre, sous, droite, { id, cls = '' } = {}) => {
    const off = id && !actif(id);
    const tres = id && integre[id]?.tres_sensible;
    lignes.push(`<li class="d-noeud n${niveau} ${cls}${off ? ' off' : ''}">
      <span class="d-ico">${icone(off ? 'shield-off' : ic)}</span>
      <span class="d-nom"><b>${esc(titre)}</b>${
        tres ? `<span class="cadenas" data-tip="${esc(t('garde.tres_sensible'))}">${icone('lock')}</span>` : ''
      }${sous ? `<span class="muted">${esc(sous)}</span>` : ''}</span>
      <span class="d-droite">${droite}</span>
      ${off && tres ? `<span class="d-alerte">${icone('warn')} ${esc(t('garde.alerte_ouvert'))}</span>` : ''}
    </li>`);
  };
  const ajout = (chemin, k, titre) =>
    noeud(
      1,
      'folder',
      titre,
      t('garde.votre_ajout'),
      `<span class="etat on">${icone('shield-check')}${esc(t('garde.protege'))}</span>
       <button class="x" type="button" data-garde-retirer="${k}" aria-label="${esc(t('garde.retirer_ajout', { p: chemin }))}"${
         p.modifiable ? '' : ' disabled'
       }>${icone('x')}</button>`,
    );

  const lecteur = p.lecteur || 'C:';
  const surLecteur = (c) => c.toLowerCase().startsWith(`${lecteur.toLowerCase()}\\`);
  noeud(0, 'hard-drive', `${lecteur}\\`, t('garde.sous_racines'), etat('racines_lecteurs'), { id: 'racines_lecteurs', cls: 'lecteur' });
  const windows = integre.windows?.chemins[0];
  if (windows) noeud(1, 'monitor', nom(windows), '', etat('windows'), { id: 'windows' });
  const pf = integre.program_files?.chemins || [];
  if (pf.length) {
    const autres = pf.length > 1 ? t('garde.et', { x: pf.slice(1).map(nom).join(', ') }) : '';
    noeud(1, 'package', nom(pf[0]), autres, etat('program_files'), { id: 'program_files' });
  }
  const installation = integre.installation?.chemins[0];
  if (installation) {
    const dansPf = pf.some((d) => installation.toLowerCase().startsWith(`${d.toLowerCase()}\\`));
    noeud(dansPf ? 2 : 1, 'logo', nom(installation), dansPf ? '' : installation, etat('installation'), { id: 'installation' });
  }
  const programData = integre.program_data?.chemins[0];
  if (programData) noeud(1, 'database', nom(programData), '', etat('program_data'), { id: 'program_data' });
  const profils = integre.profils?.chemins[0];
  if (profils) {
    noeud(1, 'users', nom(profils), t('garde.sous_profils'), etat('profils'), { id: 'profils' });
    if (p.profil) noeud(2, 'user', t('garde.votre_profil'), nom(p.profil), libre, { cls: 'libre' });
    if (p.public) noeud(2, 'users', nom(p.public), '', libre, { cls: 'libre' });
  }
  const reserves = integre.racine_systeme?.chemins || [];
  if (reserves.length) {
    const exemples = `${reserves.slice(0, 2).map(nom).join(', ')}${reserves.length > 2 ? '…' : ''}`;
    noeud(1, 'folder-lock', t('garde.dossiers_reserves'), exemples, etat('racine_systeme'), { id: 'racine_systeme' });
  }
  p.ajouts.forEach((c, k) => {
    if (surLecteur(c)) ajout(c, k, c.slice(lecteur.length + 1));
  });
  lignes.push(`<li class="d-noeud n1 reste"><span class="d-reste">${esc(t('garde.ailleurs'))}</span></li>`);
  const ailleurs = p.ajouts.map((c, k) => [c, k]).filter(([c]) => !surLecteur(c));
  if (ailleurs.length) {
    noeud(0, 'hard-drive', t('garde.autres_lecteurs'), '', '', { cls: 'lecteur' });
    for (const [c, k] of ailleurs) ajout(c, k, c);
  }
  document.getElementById('protegesPlan').innerHTML = lignes.join('');
  document.getElementById('protegesDroits').hidden = p.modifiable;
  document.getElementById('protegesAjout').hidden = !p.modifiable;
}

/** Enregistre aussitot, comme tous les reglages. Vrai si c'est fait. */
async function enregistrerGarde(retires, ajouts) {
  const erreur = document.getElementById('protegesErreur');
  try {
    await invoke('set_protected_paths', { retires, ajouts });
    erreur.hidden = true;
    return true;
  } catch (e) {
    const texte = String(e).replace(/^Error:\s*/, '');
    if (texte.startsWith('CHEMIN_NON_ABSOLU:')) {
      erreur.textContent = t('reglages.proteges_non_absolu', { p: texte.slice('CHEMIN_NON_ABSOLU:'.length) });
    } else if (texte === 'GARDE_SANS_DROITS') {
      erreur.textContent = t('reglages.proteges_droits');
    } else {
      erreur.textContent = texte;
    }
    erreur.hidden = false;
    return false;
  } finally {
    // L'affichage revient a ce qui est reellement enregistre.
    await rendreEmplacementsProteges();
  }
}

/** Rejoue tout ce que la langue affecte : chrome fixe, colonne Expert, detail,
 *  et l'etape Simple en cours si on y est. Change de langue est rare, un
 *  re-rendu large est donc un choix raisonnable plutot que de traquer chaque
 *  endroit qui affiche du texte. */
async function appliquerLangue(lang) {
  setLang(lang);
  document.documentElement.lang = currentLang();
  appliquerTraductionsStatiques();
  appliquerTraductionsReglages();
  document.querySelectorAll('#consoleSeg [data-console-mode]').forEach((b) => {
    b.textContent = t(`console.${b.dataset.consoleMode}`);
  });
  rendreFiltresJournal();
  await rendreLots();
  await rendreDetail();
  if (modeCourant === 'simple') {
    const etapeVisible = document.querySelector('.s-step:not([hidden])')?.dataset.s;
    if (etapeVisible === '1') await rendreEtapeChoisir();
  }
}

function cablerOnboarding() {
  const page = document.getElementById('onbPage');
  // Delegation : le contenu de la page est rendu a chaque etape.
  page.addEventListener('click', async (ev) => {
    const langue = ev.target.closest('[data-onb-lang]');
    if (langue) {
      visite.lang = langue.dataset.onbLang;
      setLang(visite.lang);
      document.documentElement.lang = currentLang();
      return void rendreVisite();
    }
    const theme = ev.target.closest('[data-onb-theme]');
    if (theme) {
      visite.theme = theme.dataset.onbTheme;
      appliquerTheme(visite.theme, false);
      return void rendreVisite();
    }
    if (ev.target.closest('[data-onb="installer"]')) return void installerCatalogue();
  });
  document.getElementById('btnOnbRetour').onclick = () => {
    if (visite.etape > visite.premiere) {
      visite.etape -= 1;
      rendreVisite();
    }
  };
  document.getElementById('btnOnbSuivant').onclick = () => {
    if (visite.etape < presentation.pages.length - 1) {
      visite.etape += 1;
      rendreVisite();
    } else {
      terminerVisite();
    }
  };
  document.getElementById('btnOnbPasser').onclick = terminerVisite;
  document.getElementById('btnRevoirVisite').onclick = () => {
    fermerReglages();
    ouvrirVisite({ depuisReglages: true });
  };
}

/* -------------------------------------------------------------------------
   Premier demarrage (specification §13)

   Quatre pages, pour quelqu'un qui n'a jamais ouvert un terminal autant que
   pour un habitue. Chaque page : une illustration animee, l'essentiel en trois
   phrases tres courtes avec une icone chacune, puis « En savoir plus », replie,
   pour le detail — toujours sans jargon.
   ------------------------------------------------------------------------- */

/** Le contenu de la presentation : `src/presentation.json` (§13), modifiable
 *  sans toucher au code — voir docs/PRESENTATION.md. Il est embarque dans
 *  l'executable, et c'est voulu : un fichier modifiable apres installation
 *  pourrait faire dire a WinTool « desactivez votre antivirus ». */
let presentation = { format: 1, pages: [] };

async function chargerPresentation() {
  if (presentation.pages.length) return;
  try {
    const reponse = await fetch('presentation.json');
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    presentation = await reponse.json();
  } catch (e) {
    console.error('Presentation illisible :', e);
  }
}

/** Un texte de la presentation, dans la langue courante ; le francais sinon.
 *  `{n}`, `{s}`… se remplacent comme dans t(). */
function textePresentation(textes, valeurs = {}) {
  const brut = (textes && (textes[currentLang()] || textes.fr)) || '';
  return brut.replace(/\{(\w+)\}/g, (m, k) => (k in valeurs ? String(valeurs[k]) : m));
}

/** Etat de la visite. `premiere` : on ne revient pas avant (relancee depuis les
 *  Reglages, elle commence apres la page de bienvenue : langue et apparence
 *  sont deja reglees). */
let visite = { etape: 0, premiere: 0, depuisReglages: false, lang: 'fr', theme: 'system' };

async function ouvrirVisite({ depuisReglages = false } = {}) {
  await chargerPresentation();
  const pages = presentation.pages;
  const premiere = depuisReglages ? Math.max(0, pages.findIndex((p) => p.type !== 'bienvenue')) : 0;
  if (!pages.length) {
    // Sans contenu, pas de visite : l'application reste utilisable.
    if (!depuisReglages) await terminerVisite();
    return;
  }
  visite = {
    etape: premiere,
    premiere,
    depuisReglages,
    lang: reglagesActuels?.lang || currentLang(),
    theme: reglagesActuels?.theme || 'system',
  };
  document.getElementById('onboarding').hidden = false;
  rendreVisite();
}

async function terminerVisite() {
  document.getElementById('onboarding').hidden = true;
  if (visite.depuisReglages) return;
  try {
    reglagesActuels = await invoke('complete_onboarding', { theme: visite.theme, lang: visite.lang });
  } catch (e) {
    console.error('Fin de la visite :', e);
  }
  await appliquerLangue(visite.lang);
  appliquerTheme(visite.theme, false);
  proposerRappelCatalogue();
}

/** Les illustrations : du HTML et du CSS seulement, animes par styles.css.
 *  `presentation.json` en choisit une par page ; `icone` affiche une seule
 *  grande icone Lucide, pour une page qui n'a pas d'illustration a elle. */
function illustrationVisite(page, icones) {
  switch (page.illustration) {
    case 'principe':
      return `<div class="onb-illu illu-principe" aria-hidden="true">
        <div class="mini mini-simple">
          <span class="mini-titre">${esc(t('mode.simple'))}</span>
          <span class="mini-bouton">${icones.sparkles}</span>
          <span class="mini-vague"></span>
        </div>
        <div class="mini mini-expert">
          <span class="mini-titre">${esc(t('mode.expert'))}</span>
          <span class="mini-ligne"></span><span class="mini-ligne"></span><span class="mini-ligne"></span>
          <span class="mini-terminal"><i></i><i></i><i></i></span>
        </div>
      </div>`;
    case 'catalogue':
      return `<div class="onb-illu illu-catalogue" aria-hidden="true">
        <span class="illu-colis">${icones.package}</span>
        <span class="illu-sceau">${icones['shield-check']}</span>
        <span class="illu-ecran">${icones.monitor}</span>
      </div>`;
    case 'securite':
      return `<div class="onb-illu illu-securite" aria-hidden="true">
        <span class="illu-doc"><i></i><i></i><i class="suspect"></i><i></i><i></i></span>
        <span class="illu-loupe">${icones.search}</span>
        <span class="illu-bouclier">${icones.shield}</span>
      </div>`;
    case 'icone':
      return `<div class="onb-illu illu-icone" aria-hidden="true"><span>${icones[page.icone] || ''}</span></div>`;
    default:
      return '';
  }
}

/** Le bouton du catalogue officiel, sur la page qui le demande : l'installer
 *  d'ici, ou constater qu'il l'est deja. */
function actionCatalogueVisite(action) {
  if (!etatCatalogue?.cle) return '';
  if (etatCatalogue.installe) {
    const n = etatCatalogue.installe.scripts;
    return `<p class="onb-action ok">${esc(textePresentation(action.installe, { n, s: n > 1 ? 's' : '' }))}</p>`;
  }
  return `<div class="onb-action">
    <button class="btn primary" type="button" data-onb="installer"${catalogueInstallation ? ' disabled' : ''}>${esc(textePresentation(action.installer))}</button>
    <span class="muted">${esc(textePresentation(action.plus_tard))}</span>
    <p class="onb-etat" id="onbCatalogueEtat" aria-live="polite"></p>
  </div>`;
}

async function rendreVisite() {
  const pages = presentation.pages;
  const donnees = pages[visite.etape];
  if (!donnees) return;
  const page = document.getElementById('onbPage');
  const derniere = visite.etape === pages.length - 1;

  // Points d'etape : ceux que cette visite parcourt reellement.
  const pas = pages.slice(visite.premiere);
  document.getElementById('onbPas').innerHTML = pas
    .map((_, i) => `<span class="${i + visite.premiere === visite.etape ? 'actif' : ''}"></span>`)
    .join('');
  document.getElementById('onbPas').setAttribute(
    'aria-label',
    t('onb.etape', { n: visite.etape - visite.premiere + 1, total: pas.length }),
  );

  if (donnees.type === 'bienvenue') {
    const choix = (attr, valeur, actuelle, libelle) =>
      `<button type="button" data-${attr}="${valeur}" aria-pressed="${valeur === actuelle}">${esc(libelle)}</button>`;
    page.innerHTML = `
      <div class="onb-mark"><svg class="ico i28" aria-hidden="true"><use href="#logo" /></svg></div>
      <h1 id="onbTitre">${esc(textePresentation(donnees.titre))}</h1>
      <p class="onb-text">${esc(textePresentation(donnees.texte))}</p>
      <div class="onb-choices">
        <div class="grp">
          <span class="lbl">${esc(t('onb.langue'))}</span>
          <div class="seg">${choix('onb-lang', 'fr', visite.lang, 'Français')}${choix('onb-lang', 'en', visite.lang, 'English')}</div>
        </div>
        <div class="grp">
          <span class="lbl">${esc(t('onb.theme'))}</span>
          <div class="seg">${choix('onb-theme', 'light', visite.theme, t('onb.theme_clair'))}${choix('onb-theme', 'dark', visite.theme, t('onb.theme_sombre'))}${choix('onb-theme', 'system', visite.theme, t('onb.theme_systeme'))}</div>
        </div>
      </div>`;
  } else {
    const essentiel = donnees.essentiel || [];
    // Les icones des illustrations, plus celles que la page nomme.
    const noms = [
      ...new Set([
        ...essentiel.map((e) => e.icone),
        ...(donnees.icone ? [donnees.icone] : []),
        'sparkles', 'package', 'shield-check', 'monitor', 'search', 'shield',
      ]),
    ];
    const icones = Object.fromEntries(await Promise.all(noms.map(async (n) => [n, (await iconeSVG(n)) || ''])));
    const rapide = essentiel
      .map((e) => `<li><span class="onb-puce">${icones[e.icone] || ''}</span><span>${esc(textePresentation(e.texte))}</span></li>`)
      .join('');
    const detail = (donnees.detail || []).map((d) => `<p>${esc(textePresentation(d))}</p>`).join('');
    page.innerHTML = `
      ${illustrationVisite(donnees, icones)}
      <h1 id="onbTitre">${esc(textePresentation(donnees.titre))}</h1>
      ${rapide ? `<ul class="onb-rapide">${rapide}</ul>` : ''}
      ${donnees.action?.type === 'catalogue' ? actionCatalogueVisite(donnees.action) : ''}
      ${detail ? `<details class="onb-detail"><summary>${esc(t('onb.en_savoir_plus'))}</summary>${detail}</details>` : ''}`;
  }

  const retour = document.getElementById('btnOnbRetour');
  retour.textContent = t('onb.retour');
  retour.hidden = visite.etape === visite.premiere;
  const passer = document.getElementById('btnOnbPasser');
  passer.textContent = t(visite.depuisReglages ? 'onb.fermer' : 'onb.passer');
  passer.hidden = derniere;
  document.getElementById('btnOnbSuivant').textContent = derniere
    ? t(visite.depuisReglages ? 'onb.fermer' : 'onb.commencer')
    : t('onb.suivant');
  // Un lecteur d'ecran annonce la nouvelle page.
  document.getElementById('onbTitre')?.setAttribute('tabindex', '-1');
  document.getElementById('onbTitre')?.focus();
}

function cablerReglages() {
  // La roue dentee ouvre et referme ; elle reste allumee tant que la page est
  // ouverte. « Retour » et Echap ramenent la ou l'on etait.
  document.getElementById('btnSettings').onclick = () => (reglagesOuverts() ? fermerReglages() : ouvrirReglages());
  document.getElementById('btnFermerReglages').onclick = fermerReglages;
  // Menu, fil d'Ariane du plan du disque, resultats de recherche : delegation.
  document.getElementById('settingsPage').addEventListener('click', (ev) => {
    const section = ev.target.closest('[data-rg-section]');
    if (section) {
      document.getElementById('rgRecherche').value = '';
      return void afficherSectionReglages(section.dataset.rgSection);
    }
    const resultat = ev.target.closest('[data-rg-aller]');
    if (resultat) {
      document.getElementById('rgRecherche').value = '';
      afficherSectionReglages(resultat.dataset.rgAller, { ligne: resultat.dataset.rgLigne });
    }
  });
  document.getElementById('rgRecherche').addEventListener('input', (ev) => rechercherReglages(ev.target.value));
  // Echap : d'abord la recherche, puis la page du plan, puis les reglages. Une
  // fenetre ouverte par-dessus (approbation, choix d'icone…) passe avant.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !reglagesOuverts()) return;
    if (document.querySelector('.backdrop:not([hidden])')) return;
    const recherche = document.getElementById('rgRecherche');
    if (recherche.value) {
      recherche.value = '';
      afficherSectionReglages(sectionReglages);
    } else if (sectionReglages === 'proteges') {
      afficherSectionReglages('expert');
    } else if (sectionReglages === 'source') {
      afficherSectionReglages('catalogue');
    } else {
      fermerReglages();
    }
  });

  document.querySelectorAll('#setThemeSeg [data-set-theme]').forEach((b) => {
    b.onclick = async () => {
      appliquerTheme(b.dataset.setTheme);
      reglagesActuels = await invoke('get_settings');
      remplirFormulaireReglages(reglagesActuels);
    };
  });

  document.querySelectorAll('#setLangueSeg [data-set-lang]').forEach((b) => {
    b.onclick = async () => {
      reglagesActuels = await invoke('set_lang', { lang: b.dataset.setLang });
      await appliquerLangue(b.dataset.setLang);
      remplirFormulaireReglages(reglagesActuels);
    };
  });

  document.querySelectorAll('#setAccentChoix [data-set-accent]').forEach((b) => {
    b.onclick = async () => {
      appliquerAccent(b.dataset.setAccent);
      reglagesActuels = await invoke('set_accent', { accent: b.dataset.setAccent });
      remplirFormulaireReglages(reglagesActuels);
      // Les graphiques de l'analyse prennent la couleur d'accent : on les redessine.
      rafraichirZonesAnalyse();
    };
  });
  document.getElementById('setGrapheSelect').onchange = async (ev) => {
    reglagesActuels = await invoke('set_analysis_chart', { chart: ev.target.value });
  };
  document.getElementById('setMajSelect').onchange = async (ev) => {
    reglagesActuels = await invoke('set_update_policy', { policy: ev.target.value });
  };
  document.getElementById('setEchecSelect').onchange = async (ev) => {
    reglagesActuels = await invoke('set_failure_policy', { policy: ev.target.value });
  };
  document.getElementById('setJournauxInput').onchange = async (ev) => {
    const mb = Math.max(0, Number(ev.target.value) || 0);
    reglagesActuels = await invoke('set_log_cap', { mb });
    ev.target.value = mb;
  };
  document.getElementById('setEchelleSelect').onchange = async (ev) => {
    appliquerEchelle(ev.target.value);
    reglagesActuels = await invoke('set_ui_scale', { value: Number(ev.target.value) });
  };
  document.getElementById('setPolitiqueSelect').onchange = async (ev) => {
    reglagesActuels = await invoke('set_exec_policy', { policy: ev.target.value });
  };
  document.getElementById('btnProtegesGerer').onclick = () => afficherSectionReglages('proteges');
  // Chaque geste s'enregistre aussitot, comme les autres reglages. Retirer un
  // emplacement tres sensible se confirme : c'est le geste qui affaiblit le
  // plus la protection.
  document.getElementById('protegesPlan').addEventListener('click', async (ev) => {
    const p = gardeActuelle;
    if (!p) return;
    const bascule = ev.target.closest('[data-garde-bascule]');
    if (bascule && !bascule.disabled) {
      const id = bascule.dataset.gardeBascule;
      const protege = !p.retires.includes(id);
      const integre = p.integres.find((i) => i.id === id);
      if (protege && integre?.tres_sensible && !confirm(t('reglages.proteges_confirmer', { nom: t(`garde.id.${id}`) }))) {
        return;
      }
      const retires = protege ? [...p.retires, id] : p.retires.filter((r) => r !== id);
      return void (await enregistrerGarde(retires, p.ajouts));
    }
    const retirer = ev.target.closest('[data-garde-retirer]');
    if (retirer && !retirer.disabled) {
      const k = Number(retirer.dataset.gardeRetirer);
      await enregistrerGarde(p.retires, p.ajouts.filter((_, i) => i !== k));
    }
  });
  document.getElementById('protegesAjout').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const p = gardeActuelle;
    const champ = document.getElementById('protegesAjoutChemin');
    const chemin = champ.value.trim();
    const erreur = document.getElementById('protegesErreur');
    if (!p || !chemin) return;
    // Dit tout de suite, sous le champ, ce que garde::absolu refuserait.
    let probleme = '';
    if (!/^[A-Za-z]:[\\/]/.test(chemin)) probleme = t('reglages.proteges_non_absolu', { p: chemin });
    else if (p.ajouts.some((a) => a.toLowerCase() === chemin.toLowerCase())) probleme = t('garde.deja', { p: chemin });
    if (probleme) {
      erreur.textContent = probleme;
      erreur.hidden = false;
      return;
    }
    if (await enregistrerGarde(p.retires, [...p.ajouts, chemin])) champ.value = '';
    champ.focus();
  });
  document.getElementById('btnProtegesDroits').onclick = () => {
    fermerReglages();
    ouvrirFenetreDroits();
  };
  document.getElementById('setNumerosToggle').onclick = async (ev) => {
    const actif = ev.currentTarget.getAttribute('aria-checked') !== 'true';
    appliquerNumerosReglages(actif);
    reglagesActuels = await invoke('set_show_setting_numbers', { value: actif });
  };

  document.getElementById('btnOuvrirDossierReglages').onclick = async () => {
    try {
      await invoke('open_scripts_folder');
    } catch (e) {
      console.error("Ouverture du dossier impossible :", e);
    }
  };
  // Re-analyser sans rien dire donnait l'impression que le bouton etait
  // mort : le travail a bien lieu, mais si rien n'a change a l'ecran, rien
  // ne le prouve. On compte et on l'annonce.
  document.getElementById('btnReanalyserReglages').onclick = async (ev) => {
    const bouton = ev.currentTarget;
    const avant = bouton.textContent;
    bouton.disabled = true;
    await chargerLots();
    const n = etatGroupes
      ? etatGroupes.lots.reduce((somme, g) => somme + g.scripts.length, 0) +
        etatGroupes.unclassified.length
      : 0;
    bouton.disabled = false;
    bouton.textContent = PLURIEL('verdict.reanalyse_faite', n);
    setTimeout(() => { bouton.textContent = avant; }, 2600);
  };

  document.getElementById('btnRapportConformite').onclick = (ev) => {
    const zone = document.getElementById('conformiteZone');
    zone.hidden = !zone.hidden;
    ev.currentTarget.textContent = t(zone.hidden ? 'reglages.btn_afficher' : 'reglages.btn_masquer');
    if (!zone.hidden) rendreRapportConformite();
  };

  document.getElementById('btnExporterConfig').onclick = async () => {
    const p = document.getElementById('exportResultat');
    try {
      const chemin = await invoke('export_settings');
      p.textContent = t('reglages.export_fait', { chemin });
    } catch (e) {
      p.textContent = String(e);
    }
    p.hidden = false;
  };

  document.getElementById('btnImporterConfig').onclick = () => document.getElementById('fichierImportConfig').click();
  document.getElementById('fichierImportConfig').onchange = async (ev) => {
    const fichier = ev.target.files?.[0];
    ev.target.value = '';
    if (!fichier) return;
    const p = document.getElementById('importResultat');
    try {
      const texte = await fichier.text();
      reglagesActuels = await invoke('import_settings', { json: texte });
      p.textContent = t('reglages.import_fait');
      remplirFormulaireReglages(reglagesActuels);
      await appliquerLangue(reglagesActuels.lang);
      appliquerTheme(reglagesActuels.theme, false);
      appliquerAccent(reglagesActuels.accent);
      await chargerLots();
    } catch (e) {
      p.textContent = t('reglages.import_echec', { erreur: String(e) });
    }
    p.hidden = false;
  };

  document.getElementById('btnReinitialiserConfig').onclick = async () => {
    if (!confirm(t('reglages.confirmer_reinitialisation'))) return;
    reglagesActuels = await invoke('reset_settings');
    remplirFormulaireReglages(reglagesActuels);
    await appliquerLangue(reglagesActuels.lang);
    appliquerTheme(reglagesActuels.theme, false);
    appliquerAccent(reglagesActuels.accent);
    await chargerLots();
  };
}

/** Rassemble les anomalies deja calculees par le validateur (`meta.findings`,
 *  contract.rs) sur tous les scripts decouverts — pas de nouvelle analyse,
 *  juste un endroit unique pour les lire toutes (specification 8). */
function rendreRapportConformite() {
  const zone = document.getElementById('conformiteZone');
  if (!etatGroupes) {
    zone.innerHTML = '';
    return;
  }
  // Un script figure dans chacun de ses lots, et « Entretien complet » les
  // contient tous : sans dedoublonnage, chaque script en anomalie etait liste
  // au moins deux fois.
  const vus = new Set();
  const tous = [...etatGroupes.lots.flatMap((g) => g.scripts), ...etatGroupes.unclassified]
    .filter((s) => !vus.has(s.id) && vus.add(s.id));
  const avecAnomalies = tous.filter((s) => s.meta.findings?.length);
  const explication = `<p class="muted conformite-expl">${esc(t('reglages.conformite_explication'))}</p>`;

  if (!avecAnomalies.length) {
    zone.innerHTML = `<div class="box-b">${explication}<p class="muted">${esc(t('reglages.conformite_aucune', { n: tous.length }))}</p></div>`;
    return;
  }

  const sections = avecAnomalies.map((s) => {
    const tr = s.meta.translations?.[currentLang()];
    const titre = tr?.title || s.meta.title || s.path;
    return `<div class="box-b"><div class="rrow"><div class="rt">${esc(titre)}</div></div>${rendreAnomalies(s.meta)}</div>`;
  });
  zone.innerHTML = `<div class="box-h">${esc(t('reglages.conformite_titre'))}</div>`
    + `<div class="box-b">${explication}<p class="muted">${esc(t('reglages.conformite_bilan', { n: tous.length, k: avecAnomalies.length }))}</p></div>`
    + sections.join('');
}

/**
 * Infobulles rapides sur `[data-tip]` — remplacent `title`, dont le delai
 * d'apparition est fixe par le systeme (souvent ~1s) et illisible pour un
 * bouton a icone seule qui n'a que ça pour se faire comprendre.
 */
function cablerInfobulles() {
  const bulle = document.getElementById('tooltip');
  let minuteur = null;
  let cibleActuelle = null;

  const positionner = (el) => {
    const r = el.getBoundingClientRect();
    bulle.style.left = `${r.left + r.width / 2}px`;
    bulle.style.top = `${r.bottom + 8}px`;
  };

  document.addEventListener('pointerover', (ev) => {
    const el = ev.target.closest('[data-tip]');
    if (!el || el === cibleActuelle) return;
    cibleActuelle = el;
    clearTimeout(minuteur);
    bulle.classList.remove('on');
    minuteur = setTimeout(() => {
      if (cibleActuelle !== el || !el.dataset.tip) return;
      bulle.textContent = el.dataset.tip;
      positionner(el);
      bulle.hidden = false;
      requestAnimationFrame(() => bulle.classList.add('on'));
    }, 250);
  });

  document.addEventListener('pointerout', (ev) => {
    const el = ev.target.closest('[data-tip]');
    if (!el || el !== cibleActuelle || el.contains(ev.relatedTarget)) return;
    cibleActuelle = null;
    clearTimeout(minuteur);
    bulle.classList.remove('on');
    bulle.hidden = true;
  });
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
  await injecterSprite();
  initTerminal();

  // La fenetre est creee invisible (tauri.conf.json) : on peut charger les
  // reglages et poser langue/theme sans jamais laisser voir un flash de
  // mauvaise langue ou de mauvais theme avant la premiere peinture.
  let reglages = { theme: 'system', lang: 'fr', onboarded: true };
  try {
    reglages = await invoke('get_settings');
  } catch (e) {
    console.error('get_settings a echoue :', e);
  }
  reglagesActuels = reglages;
  setLang(reglages.lang);
  document.documentElement.lang = currentLang();
  appliquerTheme(reglages.theme, false);
  appliquerAccent(reglages.accent);
  appliquerTraductionsStatiques();
  appliquerTraductionsReglages();

  cablerFenetre();
  cablerInteractions();
  cablerModeEtSimple();
  cablerOnboarding();
  cablerReglages();
  cablerConfiance();
  cablerInfobulles();
  cablerConsole();
  cablerReglagesSimples();
  document.getElementById('testPill').onclick = basculerSimulation;
  document.getElementById('adminPill').onclick = ouvrirFenetreDroits;
  document.getElementById('btnFermerDroits').onclick = () => {
    document.getElementById('droitsOverlay').hidden = true;
  };
  document.getElementById('btnRelancerAdmin').onclick = async () => {
    try {
      await invoke('relaunch_elevated');
      // La fenetre elevee met un instant a apparaitre ; si l'utilisateur
      // refuse l'invite UAC, celle-ci reste ouverte et rien n'est perdu.
      setTimeout(() => laFenetre.close(), 1200);
    } catch (e) {
      console.error('Relance impossible :', e);
    }
  };
  document.getElementById('btnFermerIcones').onclick = () => {
    document.getElementById('iconesOverlay').hidden = true;
  };
  document.getElementById('rechercheIcone').addEventListener('input', (ev) => {
    rendreGrilleIcones(ev.target.value);
  });
  // La grille vit dans un calque de premier niveau (`.backdrop`), hors du panneau
  // de detail : le clic n'y remonte pas. Le choix d'une icone se traite donc ici,
  // et nulle part ailleurs.
  document.getElementById('iconesGrille').addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-plus-icones]')) {
      plafondIcones += PAS_ICONES;
      return void rendreGrilleIcones(document.getElementById('rechercheIcone').value, false);
    }

    const choisie = ev.target.closest('[data-choisir-icone]');
    if (!choisie) return;

    const overlay = document.getElementById('iconesOverlay');
    try {
      await invoke('set_lot_icon', { id: overlay.dataset.pour, icon: choisie.dataset.choisirIcone });
    } catch (e) {
      // On laisse le calque ouvert : un refus qui ferme la fenetre sans rien dire
      // se lit comme un enregistrement reussi.
      document.getElementById('iconesCompte').textContent = String(e);
      return;
    }
    overlay.hidden = true;
    await chargerLots();
    rendreDetail();
  });
  document.getElementById('iconesOverlay').addEventListener('click', (ev) => {
    // Clic hors de la carte : on ferme, comme pour les autres superpositions.
    if (ev.target.id === 'iconesOverlay') ev.currentTarget.hidden = true;
  });
  await cablerPauseAnimation();
  await cablerMoteur();
  cablerMaj();
  cablerCatalogue();

  try {
    const infos = await invoke('app_info');
    document.getElementById('version').textContent = infos.version;
    appliquerDroits(infos.elevated);
  } catch (e) {
    console.error('app_info a echoue :', e);
    document.getElementById('version').textContent = '?';
  }

  try {
    appliquerSimulation(await invoke('simulation_state'));
  } catch (e) {
    console.error('simulation_state a echoue :', e);
  }

  try {
    moteurs = await invoke('engines');
  } catch (e) {
    console.error('engines a echoue :', e);
  }

  // Avant les lots : l'accueil a besoin de savoir s'il doit proposer le
  // catalogue plutot que d'annoncer qu'il n'y a rien.
  try {
    etatCatalogue = await invoke('catalogue_state');
  } catch (e) {
    console.error('catalogue_state a echoue :', e);
  }
  // Les noms des catalogues ajoutes servent aux pastilles de provenance.
  await chargerSources();

  await rafraichirHistorique();
  await chargerLots();
  basculerMode('simple');

  if (!reglages.onboarded) ouvrirVisite();

  // La fenetre est creee invisible pour eviter un flash blanc avant la peinture.
  await laFenetre.show();

  // Apres l'affichage, et sans l'attendre : une verification lente ou une
  // machine hors ligne ne doit jamais retarder l'ouverture de la fenetre.
  if (reglages.update_policy !== 'never') verifierMaj({ silencieux: true });
  if (reglagesActuels?.catalogue_check !== 'manual') {
    if (etatCatalogue?.installe && sourceParId('officiel')?.active !== false) verifierCatalogue({ silencieux: true });
    for (const x of etatSources?.sources || []) {
      if (!x.officielle && x.active && x.installe) verifierSource(x.id, { silencieux: true });
    }
  }
  proposerRappelCatalogue();
}

demarrer();
