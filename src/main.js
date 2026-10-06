/**
 * WinTool - amorce de l'interface.
 *
 * Modules ES natifs, aucun bundler : Tauri sert src/ en fichiers statiques.
 * C'est volontaire et coherent avec le principe du projet - on depose un
 * fichier, ca marche, sans etape de build.
 */

import { t, setLang, currentLang } from './i18n.js';

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

/** Dernier resultat de `list_scripts_grouped` : categories + Non classe. */
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

/** Nom affiche d'une categorie : langue courante, sinon la base disponible —
 *  meme regle de repli que les traductions de script. */
function nomCategorie(cat) {
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

/** Champ de l'override correspondant a chaque booleen WinTool (specification 4.2). */
const CHAMP_BOOLEEN = { restore: 'reversible_ack', reboot: 'reboot_ack', enabled: 'enabled' };

/** Vrai des que quelque chose est fige pour ce script — hors classement en
 *  categorie, qui se defait par sa propre liste deroulante. */
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
    // L'origine n'est pas decorative : un script livre vit dans le dossier
    // d'installation, que du code non eleve ne peut pas modifier. Un script
    // perso vit dans un dossier inscriptible, d'ou l'approbation.
    etiquette(t('badge.livre'), 'acc', entree.origin === 'shipped'),
    etiquette(t('badge.perso'), 'neutre', entree.origin !== 'shipped'),
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
  const nom = nomCategorie(cat);
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

/** Reconstruit toute la colonne de gauche (Lots puis Scripts a plat) et
 *  reapplique le filtre en cours, s'il y en a un. */
async function rendreLots() {
  const zone = document.getElementById('lotsRows');

  const lignesLots = await Promise.all(
    etatGroupes.categories.map((g) => rendreRowLot(g.category, scriptsActifs(g).length))
  );
  const lotNonClasse = { id: NON_CLASSE, icon: 'folder', name: { [currentLang()]: t('expert.non_classe') } };
  const ligneNonClasse = await rendreRowLot(lotNonClasse, etatGroupes.unclassified.length, { draggable: false });

  const scriptsAPlat = [];
  for (const g of etatGroupes.categories) scriptsAPlat.push(...g.scripts);
  scriptsAPlat.push(...etatGroupes.unclassified);
  const lignesScripts = scriptsAPlat.map((s) => rendreRowScript(s));

  zone.innerHTML = `
    <div class="ghead">
      <span>${esc(t('expert.lots'))}</span>
      <button class="iconbtn" id="btnAjouterCategorie" type="button" data-tip="${esc(t('expert.ajouter_categorie'))}">
        <svg class="ico" aria-hidden="true"><use href="#plus" /></svg>
      </button>
    </div>
    <div class="row" id="ligneNouvelleCategorie" hidden>
      <input type="text" id="nomNouvelleCategorie" placeholder="${esc(t('expert.nom_categorie_invite'))}" />
    </div>
    ${lignesLots.join('')}
    ${ligneNonClasse}
    <div class="ghead ghead-2"><span>${esc(t('expert.scripts'))}</span></div>
    ${lignesScripts.join('')}`;

  appliquerFiltre();
}

function appliquerFiltre() {
  const champ = document.getElementById('filtreLots');
  const q = champ.value.trim().toLowerCase();
  document.querySelectorAll('#lotsRows .row[data-nom]').forEach((el) => {
    el.hidden = q.length > 0 && !el.dataset.nom.includes(q);
  });
}

async function rendreDetailLot(id) {
  const estNonClasse = id === NON_CLASSE;
  const groupe = estNonClasse ? null : etatGroupes.categories.find((g) => g.category.id === id);
  if (!estNonClasse && !groupe) {
    selection = null;
    return `<div class="empty-detail">${esc(t('expert.aucune_selection'))}</div>`;
  }

  const cat = estNonClasse
    ? { id: NON_CLASSE, icon: 'folder', name: { [currentLang()]: t('expert.non_classe') }, pinned: false }
    : groupe.category;
  const scripts = estNonClasse ? etatGroupes.unclassified : groupe.scripts;
  const manquants = estNonClasse ? [] : groupe.missing;
  const icone = (await iconeSVG(cat.icon)) || '';
  const nom = nomCategorie(cat);

  const actions = estNonClasse
    ? ''
    : `
    <div class="dact">
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
 * Icones proposees pour une categorie.
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
  const groupeActuel = etatGroupes.categories.find((g) => g.scripts.some((s) => s.id === entree.id));
  const actuelle = groupeActuel ? groupeActuel.category.id : NON_CLASSE;

  // Une liste deroulante ne peut exprimer qu'un seul rangement ; la §4.1 en
  // autorise plusieurs. Chaque categorie est donc une puce a bascule, et
  // l'etat « dans aucune » se lit a l'absence de puce allumee.
  const dedans = new Set(
    etatGroupes.categories
      .filter((g) => !g.category.aggregate && g.scripts.some((x) => x.id === entree.id))
      .map((g) => g.category.id)
  );

  const puces = etatGroupes.categories
    .filter((g) => !g.category.aggregate)
    .map(
      (g) => `
      <button class="chip" type="button" aria-pressed="${dedans.has(g.category.id)}"
              data-membre="${esc(entree.id)}" data-lot="${esc(g.category.id)}">
        ${esc(nomCategorie(g.category))}
      </button>`
    )
    .join('');

  const ligneCategorie = `
    <div class="cat-row">
      <label>${esc(t('expert.categories_label'))}</label>
      <div class="cat-puces">${puces}</div>
      ${dedans.size === 0 ? `<span class="muted">${esc(t('expert.non_classe'))}</span>` : ''}
    </div>`;

  return rendreCarte(entree, { sousBadges: ligneCategorie });
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
      `<b>${esc(t('chrome.livres_titre'))}</b> <span class="muted">${esc(t('chrome.lecture_seule'))}</span><br />` +
      `${esc(etatGroupes.shipped_root)}<br /><br />` +
      `<b>${esc(t('chrome.perso_titre'))}</b><br />${esc(etatGroupes.root)}`;

    if (etatGroupes.problems?.length) {
      soucis.hidden = false;
      soucis.innerHTML = etatGroupes.problems
        .map((p) => `<div class="finding error"><span class="code">DOSSIER</span><span class="msg">${esc(p)}</span></div>`)
        .join('');
    }

    for (const g of etatGroupes.categories) for (const s of g.scripts) catalogue.set(s.id, s);
    for (const s of etatGroupes.unclassified) catalogue.set(s.id, s);

    // Une categorie supprimee, ou un script disparu, invalide une selection
    // qui pointait dessus : on retombe sur l'etat neutre plutot que de garder
    // une reference perimee.
    if (selection?.type === 'script' && !catalogue.has(selection.id)) selection = null;
    if (
      selection?.type === 'lot' &&
      selection.id !== NON_CLASSE &&
      !etatGroupes.categories.some((g) => g.category.id === selection.id)
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
  if (entretienEnCours && !entretienActif && document.querySelector('[data-script-recap]')) {
    const groupe = etatGroupes?.categories.find((g) => g.category.id === entretienEnCours.categorieId);
    if (groupe) await rendreEtapeVerifier(groupe);
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

  const classes = ['ljl', `s-${stream}`];
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
  const classes = ['tl', `s-${stream}`];
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
  term.fermer.textContent = t('action.fermer');
}

const PLURIEL = (cle, n) => t(cle, { n, s: n > 1 ? 's' : '' });

function afficherVerdict(fin) {
  const secondes = (fin.duration_ms / 1000).toFixed(1);
  const bloc = document.createElement('div');

  let ton, titre;
  if (fin.killed) {
    ton = 'warn';
    titre = t('verdict.interrompu');
  } else if (fin.success) {
    ton = 'ok';
    titre = t('verdict.termine');
  } else {
    ton = 'bad';
    // Le verdict vient du code de sortie, jamais du fait que le script a
    // demarre. C'est le defaut de la v3 que corrige cette ligne.
    titre = t('verdict.echec');
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
  document.getElementById('trustSous').textContent = t('trust.sous', { hash: requete.hash.slice(0, 16) });
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
async function lancer(id) {
  if (course) return;
  const entree = catalogue.get(id);
  if (!entree) return;

  const ok = await assurerApprobation(entree);
  if (!ok) return;

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
        policy: reglagesActuels?.exec_policy || null,
      },
    });

    departCourse = Date.now();
    course = { runId: demarre.run_id, id, logPath: demarre.log_path, simule: !!demarre.simulated };
    if (bouton) bouton.disabled = true;
    document.querySelectorAll('[data-run]').forEach((b) => (b.disabled = true));
    ouvrirTerminal(entree, demarre);
    rendreLots(); // pastille "en cours" dans la colonne de gauche
  } catch (e) {
    // Filet de securite : `assurerApprobation` a du montrer l'ecran de
    // confiance juste avant, ce refus ne devrait donc jamais arriver — sauf
    // si l'approbation a echoue en silence (voir le commentaire ci-dessus).
    if (String(e).includes(NON_APPROUVE_MARQUEUR)) {
      const reessayer = await assurerApprobation(entree);
      if (reessayer) return void lancer(id);
      return;
    }
    // Le journal garde la trace, le panneau explique : les deux, parce qu'un
    // refus qu'on ne peut pas relire plus tard est un refus a moitie dit.
    const raison = messageLancement(e);
    journaliserRefus(entree, raison);
    alerterEchecLancement(entree, raison);
  }
}

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
function messageLancement(brut) {
  const texte = String(brut);
  if (texte.includes('SANS_SIMULATION')) return t('simulation.script_refuse');
  if (texte.includes('APPROBATION_SANS_DROITS')) return t('droits.approbation_impossible');
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
  term.fermer.textContent = t('action.fermer');

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
    if (payload.step) {
      const [n, total] = payload.step;
      if (total > 0) term.prog.style.width = `${Math.min(100, (n / total) * 100)}%`;
    }
  });

  await ecouter('script:end', ({ payload }) => {
    if (!course || payload.run_id !== course.runId) return;
    // Le verdict vient du code de sortie (afficherVerdict), pas de killed :
    // un arret propre n'est ni une reussite ni un echec a memoriser comme tel.
    if (!payload.killed) derniersResultats.set(payload.script_id, payload.success ? 'ok' : 'err');

    const entree = catalogue.get(payload.script_id);
    const tr = entree?.meta.translations?.[currentLang()];
    const titre = tr?.title || entree?.meta.title || payload.script_id;
    // Une entree par script execute (specification §14), quel que soit le
    // mode — ne bloque jamais la suite, ne fait que rafraichir "Fait le ...".
    enregistrerExecution(payload, titre, course.simule).then(() => rendreLots());

    if (course.entretien) {
      const succes = payload.success && !payload.killed;
      entretienEnCours.resultats.push({ id: payload.script_id, success: succes, simule: course.simule });
      course = null;
      majEtatJournalCompact();
      // Comportement d'echec (specification §6.2, reglage Expert §8) : par
      // defaut on continue les autres scripts, mais "stop" vide la file pour
      // ne pas enchainer sur la suite d'une categorie qui vient d'echouer.
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
  document.getElementById('crumb3').textContent = t('crumb.entretien');
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

/** Fait apparaitre le champ de saisie d'une nouvelle categorie. */
function ouvrirCreationCategorie() {
  const ligne = document.getElementById('ligneNouvelleCategorie');
  ligne.hidden = !ligne.hidden;
  if (!ligne.hidden) document.getElementById('nomNouvelleCategorie').focus();
}

/** Remplace le titre d'un lot par un champ de saisie (specification 4.1 :
 *  le mode Expert permet de renommer une categorie, y compris « Entretien
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
 * est par categorie, glisser un script d'un lot vers un autre n'est pas pris
 * en charge ici, seul le classement via le selecteur de categorie l'est).
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
      const ordre = etatGroupes.categories.map((g) => g.category.id);
      ordre.splice(ordre.indexOf(dragId), 1);
      const dest = ordre.indexOf(cibleId);
      ordre.splice(avant ? dest : dest + 1, 0, dragId);
      await invoke('reorder_categories', { order: ordre });
    } else {
      const lotId = cible.dataset.lotDrag;
      if (!lotId || lotId !== dragLotId) return;
      const groupe = etatGroupes.categories.find((g) => g.category.id === lotId);
      if (!groupe) return;
      const ordre = groupe.scripts.map((s) => s.id);
      const source = ordre.indexOf(dragId);
      if (source < 0) return;
      ordre.splice(source, 1);
      const dest = ordre.indexOf(cible.dataset.script);
      if (dest < 0) return;
      ordre.splice(avant ? dest : dest + 1, 0, dragId);
      await invoke('reorder_category_scripts', { categoryId: lotId, order: ordre });
    }
    await chargerLots();
  });
}

function cablerInteractions() {
  document.getElementById('filtreLots').addEventListener('input', appliquerFiltre);

  document.querySelector('.lots').addEventListener('click', (ev) => {
    if (ev.target.closest('#btnAjouterCategorie')) return void ouvrirCreationCategorie();

    const lot = ev.target.closest('.row.lot');
    if (lot) return void selectionner('lot', lot.dataset.lot);

    const script = ev.target.closest('.row.script');
    if (script) return void selectionner('script', script.dataset.script);
  });

  document.querySelector('.lots').addEventListener('keydown', async (ev) => {
    if (ev.target.id !== 'nomNouvelleCategorie') return;
    if (ev.key === 'Enter') {
      const nom = ev.target.value.trim();
      if (nom) {
        await invoke('create_category', { name: nom, icon: 'folder' });
        await chargerLots();
      } else {
        document.getElementById('ligneNouvelleCategorie').hidden = true;
      }
    } else if (ev.key === 'Escape') {
      document.getElementById('ligneNouvelleCategorie').hidden = true;
    }
  });

  const detail = document.querySelector('.detail');

  detail.addEventListener('click', async (ev) => {
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

    // Appartenance d'un script a une categorie (§4.1) : puce sur la fiche du
    // script, interrupteur dans la composition d'une categorie. Les deux
    // portent `data-membre` + `data-lot` et passent par la meme commande.
    const bascule = ev.target.closest('[data-membre][data-lot]');
    if (bascule) {
      const etait = bascule.getAttribute('aria-checked') === 'true' ||
                    bascule.getAttribute('aria-pressed') === 'true';
      try {
        await invoke('set_category_script', {
          categoryId: bascule.dataset.lot,
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
    if (run && !run.disabled) return void lancer(run.dataset.run);

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
      const groupe = etatGroupes.categories.find((g) => g.category.id === id);
      if (groupe) await invoke('set_category_pinned', { id, pinned: !groupe.category.pinned });
      return void chargerLots();
    }

    const supprimer = ev.target.closest('[data-supprimer-lot]');
    if (supprimer) {
      const id = supprimer.dataset.supprimerLot;
      const groupe = etatGroupes.categories.find((g) => g.category.id === id);
      const nom = groupe ? nomCategorie(groupe.category) : id;
      if (confirm(t('expert.confirmer_suppression', { nom }))) {
        await invoke('delete_category', { id });
        selection = null;
        await chargerLots();
      }
    }
  });

  detail.addEventListener('change', async (ev) => {

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
    if (!annule && nom) await invoke('rename_category', { id, name: nom });
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
/** { categorieId, total, resultats: [{id, success}] }, ou null hors entretien. */
let entretienEnCours = null;
/** Vrai du lancement d'un entretien a son bilan, enchainements compris. Ni
 *  `course`, nul le temps de lancer le script suivant, ni `entretienEnCours`,
 *  garde pour le bilan et jamais remis a nul, ne le disent. La mise a jour
 *  s'en sert : son installeur ferme l'application. */
let entretienActif = false;
/** Categorie actuellement selectionnee a l'etape 1 — un clic choisit, il ne
 *  fait pas avancer tout seul (le mockup de reference confirme ce modele :
 *  choisir puis Continuer, pas un saut immediat). */
let selectionSimpleId = null;
/** {n, total} du [STEP] en cours pendant l'entretien, pour la mini barre de
 *  progression de la tache active (voir cablerMoteur). */
let etapeEntretienActuelle = null;

function basculerMode(mode) {
  modeCourant = mode;
  if (mode !== 'simple') retirerVaguesArriere();
  document.body.dataset.mode = mode;
  document.querySelector('.simple').hidden = mode !== 'simple';
  document.querySelector('.expert').hidden = mode !== 'expert';
  document.querySelectorAll('#modeSeg [data-mode-btn]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.modeBtn === mode));
  });
  if (mode === 'simple') afficherEtapeSimple(1);
}

function majRepere(etape) {
  for (let i = 1; i <= 3; i++) {
    const ligne = document.getElementById(`crumb${i}`)?.parentElement;
    if (!ligne) continue;
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
  else retirerVaguesArriere();
}

/** Etape 1 : la categorie epinglee en grand, les autres en bouees sur une
 *  ligne d'eau (max 6 par ligne, specification 15.2 — le flex-wrap ci-dessous
 *  fait naturellement une deuxieme ligne au-dela). Une categorie vide est
 *  masquee en mode Simple (specification 14). Un clic selectionne ; Continuer
 *  fait avancer. */
/** Duree grossiere d'un lot, dans les mots de la specification 7 : un ordre de
 *  grandeur, jamais une promesse. */
function minutesLot(groupe) {
  const total = scriptsActifs(groupe).reduce((n, s) => n + (MINUTES_PAR_DUREE[s.meta.duration] || 2), 0);
  return Math.max(1, total);
}

async function rendreEtapeChoisir() {
  document.getElementById('s1Titre').textContent = t('s1.titre');
  document.getElementById('s1Sous').textContent = t('s1.sous');

  // Un lot dont tous les scripts sont desactives n'a rien a proposer : il ne
  // s'affiche pas plutot que de mener a un entretien vide.
  const dispo = etatGroupes ? etatGroupes.categories.filter((g) => scriptsActifs(g).length > 0) : [];
  const zoneReco = document.getElementById('recoCard');
  const zoneBuoys = document.getElementById('buoysZone');
  const sectAutres = document.getElementById('sectAutres');
  const btnContinuer = document.getElementById('btnContinuerChoix');
  // La fleche fait partie du bouton dans la maquette : elle dit qu'on avance
  // d'une etape, la ou un libelle seul pourrait passer pour un bouton d'action.
  btnContinuer.innerHTML =
    `${esc(t('simple.continuer'))}<svg class="ico" aria-hidden="true"><use href="#arrow-right" /></svg>`;

  if (!dispo.length) {
    zoneReco.innerHTML = `<p class="muted">${esc(t('simple.aucune_categorie'))}</p>`;
    zoneBuoys.innerHTML = '';
    retirerVaguesArriere();
    sectAutres.hidden = true;
    btnContinuer.hidden = true;
    return;
  }

  const epinglee = dispo.find((g) => g.category.pinned) || dispo[0];
  const autres = dispo.filter((g) => g !== epinglee);
  if (!selectionSimpleId || !dispo.some((g) => g.category.id === selectionSimpleId)) {
    selectionSimpleId = epinglee.category.id;
  }

  const iconeReco = (await iconeSVG(epinglee.category.icon)) || '';
  zoneReco.innerHTML = `
    <div class="reco" data-lot="${esc(epinglee.category.id)}" aria-current="${selectionSimpleId === epinglee.category.id}">
      <div class="ri">${iconeReco}</div>
      <div>
        <div class="rt">${esc(nomCategorie(epinglee.category))} <span class="badge acc">${esc(t('simple.recommande'))}</span></div>
        <div class="rd">${esc(epinglee.category.description || t('simple.on_s_occupe_de_tout'))} — ${esc(PLURIEL('simple.duree_estimee', minutesLot(epinglee)))}</div>
      </div>
    </div>`;

  sectAutres.hidden = !autres.length;
  sectAutres.textContent = t('simple.autres_domaines');

  const buoys = await Promise.all(
    autres.map(async (g, i) => {
      const icone = (await iconeSVG(g.category.icon)) || '';
      const actif = selectionSimpleId === g.category.id;
      return `
        <button class="buoy" type="button" data-lot="${esc(g.category.id)}" aria-current="${actif}">
          <span class="bi">${icone}</span>
          <span class="blabel">
            <span class="bt">${esc(nomCategorie(g.category))}</span>
            <span class="bd">${esc(t('simple.duree_courte', { n: minutesLot(g) }))}</span>
          </span>
        </button>`;
    })
  );
  zoneBuoys.innerHTML = buoys.join('');
  positionnerBouees();
  btnContinuer.hidden = false;
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
   propre vague, etagees vers le haut et vers l'arriere. */
const VAGUE = {
  ligne: 308,         // px entre le bas de la scene et la ligne d'eau de devant
  amplitude: 37.5,    // px : la courbe dessinee monte de 452 a 414,5 (Bezier, 0,75 x 50)
  ecart: 170,         // px entre deux lignes d'eau
  houleArriere: 0.65, // amplitude de chaque vague plus lointaine : un large paraît plus calme
  duree: 29,          // s : derive de la nappe de devant (.water.surface)
  ralenti: 0.35,      // chaque vague plus loin derive 35 % plus lentement
  attenue: 0.68,      // et s'efface d'autant
  marge: 44,          // px de bord, de chaque cote
  pasMin: 150,        // px par bouee : en dessous, on ouvre une rangee de plus
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
    const boite = document.createElement('div');
    boite.innerHTML = `<svg class="water surface arriere" data-rang="${d}" viewBox="0 0 2360 760" preserveAspectRatio="none" aria-hidden="true">
      <path d="${trace} L2360,760 L0,760 Z" fill="url(#eau)" opacity="0.26" />
      <path d="${trace}" fill="none" stroke="var(--acc)" stroke-width="2.5" opacity="0.55" />
    </svg>`;
    const v = boite.firstElementChild;
    v.style.bottom = `${d * VAGUE.ecart}px`;
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
 *  portent. A rappeler a chaque redimensionnement et changement d'echelle. */
function positionnerBouees() {
  const etape = document.querySelector('.s-step[data-s="1"]');
  const zone = document.getElementById('buoysZone');
  const bouees = zone ? [...zone.querySelectorAll('.buoy')] : [];
  const visible = etape && !etape.hidden && !document.querySelector('.simple').hidden;
  if (!visible || !bouees.length) {
    retirerVaguesArriere();
    return;
  }

  const z = echelleCourante();
  const scene = document.querySelector('.stage').getBoundingClientRect();
  const largeur = scene.width / z;
  const hauteur = scene.height / z;
  const tailles = repartirRangees(bouees.length, largeur);
  const R = tailles.length;
  const hauteurChamp = VAGUE.ligne + (R - 1) * VAGUE.ecart + VAGUE.flotteur + VAGUE.amplitude + VAGUE.libelle;

  // Le champ ne doit jamais recouvrir le titre ni la carte recommandee. S'il ne
  // tient pas — fenetre basse, echelle forte, beaucoup de rangees —, les bouees
  // restent dans le flux de la page, qui defile : rien n'est jamais inaccessible.
  const sect = document.getElementById('sectAutres');
  const basFlux = (sect.getBoundingClientRect().top - scene.top) / z;
  const flottant = hauteur - hauteurChamp >= basFlux + 8;
  zone.classList.toggle('flottant', flottant);
  etape.classList.toggle('champ-flottant', flottant);

  let libelle = zone.querySelector('.sect-champ');
  if (!libelle) {
    libelle = document.createElement('div');
    libelle.className = 'sect sect-champ';
    zone.prepend(libelle);
  }
  libelle.textContent = sect.textContent;

  const immobile = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lambda = largeur / 2;

  if (!flottant) {
    retirerVaguesArriere();
    zone.style.height = '';
    bouees.forEach((b) => {
      b.style.left = b.style.top = b.style.zIndex = '';
      b.style.transform = '';
      b.classList.remove('houle');
    });
    return;
  }

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
}

let minuteurBouees = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(minuteurBouees);
  minuteurBouees = requestAnimationFrame(positionnerBouees);
});

function selectionnerChoix(id) {
  selectionSimpleId = id;
  rendreEtapeChoisir();
}

async function choisirCategorie(id) {
  const groupe = etatGroupes?.categories.find((g) => g.category.id === id);
  if (!groupe || !scriptsActifs(groupe).length) return;
  entretienEnCours = { categorieId: id, total: scriptsActifs(groupe).length, resultats: [] };
  afficherEtapeSimple(2);
  await rendreEtapeVerifier(groupe);
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
  document.getElementById('recapTitre').textContent = nomCategorie(groupe.category);
  document.getElementById('recapBoxTitre').textContent = t('simple.recap_titre');

  const lignes = await Promise.all(
    scriptsActifs(groupe).map(async (s) => {
      const tr = s.meta.translations?.[currentLang()];
      const titre = tr?.title || s.meta.title || s.path;
      const icone = (await iconeSVG(s.meta.icon)) || '';
      // Specification §2 : « recapitulatif, reglages replies ». Replies,
      // donc : la ligne ne montre rien de plus qu'avant tant qu'on ne la
      // deplie pas, et le chevron est la seule chose ajoutee a l'ecran.
      const reglables = reglagesSimples(s);
      return `
        <div class="rrow" data-script-recap="${esc(s.id)}">
          <div class="ri">${icone}</div>
          <div class="rt">${esc(titre)}${marqueSimulation(s)}</div>
          <span class="badge">${esc(t(`duree.${s.meta.duration}`))}</span>
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

  const note = document.getElementById('restoreNote');
  const besoinRestauration = scriptsActifs(groupe).some(besoinPointRestauration);
  note.hidden = !besoinRestauration;
  if (besoinRestauration) note.textContent = t('simple.point_restauration_annonce');

  // Specification 6.5 : annonce d'avance, jamais declenche au milieu. La
  // source est la case de la 4.2, pas `meta.reboot` : si l'utilisateur a
  // decoche, on ne lui annonce pas un redemarrage qu'il a refuse.
  const noteRedemarrage = document.getElementById('rebootNote');
  const besoinRedemarrer = scriptsActifs(groupe).some(besoinRedemarrage);
  noteRedemarrage.hidden = !besoinRedemarrer;
  if (besoinRedemarrer) noteRedemarrage.textContent = t('simple.redemarrage_annonce');

  document.getElementById('btnLancerEntretien').textContent = t('simple.lancer');
}

/** Message honnete pour chacun des refus attendus (specification 6.4) —
 *  jamais un succes maquille. `resultat` est soit une chaine (variante unite
 *  de RestoreOutcome), soit `{ failed: "..." }` (variante avec message). */
function messageRestauration(resultat) {
  if (resultat === 'created') return t('simple.point_restauration_cree');
  if (resultat === 'throttled_recent') return t('simple.point_restauration_frequence');
  if (resultat === 'protection_disabled') return t('simple.point_restauration_protection');
  // `String(objet)` donne « [object Object] » — a montrer a un debutant, c'est
  // pire que pas de message du tout. Toute forme inattendue retombe donc sur
  // un texte lisible plutot que sur le nom d'un type JavaScript.
  let erreur;
  if (resultat && typeof resultat === 'object') {
    erreur = 'failed' in resultat ? String(resultat.failed) : t('simple.point_restauration_inconnu');
  } else {
    erreur = String(resultat ?? t('simple.point_restauration_inconnu'));
  }
  return t('simple.point_restauration_echec', { erreur });
}

/** Estimation grossiere, jamais precise (specification §7 : ne pretend pas
 *  savoir ce qu'on ne sait pas) — juste de quoi donner un ordre de grandeur
 *  a partir de la duree grossiere declaree par chaque script restant. */
const MINUTES_PAR_DUREE = { fast: 1, medium: 3, slow: 8 };
function estimerMinutesRestantes(groupe) {
  const faits = new Set(entretienEnCours.resultats.map((r) => r.id));
  const restants = scriptsActifs(groupe).filter((s) => !faits.has(s.id));
  return Math.max(1, restants.reduce((total, s) => total + (MINUTES_PAR_DUREE[s.meta.duration] || 2), 0));
}

async function lancerEntretien() {
  document.getElementById('riseFill')?.classList.remove('termine');
  const groupe = etatGroupes?.categories.find((g) => g.category.id === entretienEnCours?.categorieId);
  if (!groupe) return;
  entretienActif = true;
  rendreBandeauMaj();

  afficherEtapeSimple(3);
  document.getElementById('s3Titre').textContent = t('s3.titre');
  document.getElementById('riseBadgeLabel').textContent = t('simple.niveau_atteint');
  document.getElementById('btnArreterEntretien').hidden = false;
  document.getElementById('btnArreterEntretien').textContent = t('simple.arreter_apres');
  document.getElementById('btnRetourAccueil').hidden = true;
  document.getElementById('tasksBilan').hidden = false;
  document.getElementById('tasksBilanDetail').textContent = nomCategorie(groupe.category);
  document.getElementById('term').hidden = true;
  fileEntretien = scriptsActifs(groupe);
  etapeEntretienActuelle = null;
  majProgression();

  invoke('record_category_run', {
    categoryId: groupe.category.id,
    categoryName: nomCategorie(groupe.category),
    scriptIds: scriptsActifs(groupe).map((s) => s.id),
  }).catch((e) => console.error("Enregistrement de l'historique impossible :", e));

  const besoinRestauration = scriptsActifs(groupe).some(besoinPointRestauration);
  if (besoinRestauration) {
    try {
      const resultat = await invoke('create_restore_point', {
        description: `WinTool - ${nomCategorie(groupe.category)}`,
      });
      document.getElementById('tasksBilanDetail').textContent = messageRestauration(resultat);
    } catch (e) {
      document.getElementById('tasksBilanDetail').textContent = messageRestauration({ failed: String(e) });
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
        config: configFigee(entree.id),
        policy: reglagesActuels?.exec_policy || null,
      },
    });
    departCourse = Date.now();
    course = { runId: demarre.run_id, id: entree.id, logPath: demarre.log_path, entretien: true, simule: !!demarre.simulated };
    majProgression();
  } catch (e) {
    // La raison est conservee ET affichee : dans le journal pour le detail,
    // sur la ligne de la tache pour qu'on la voie sans le deplier.
    const raison = messageLancement(e);
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
  // L'eau redescend : elle disait « en cours » alors que tout etait fini, et
  // restait a mi-hauteur sur l'ecran de bilan.
  document.getElementById('riseFill')?.classList.add('termine');
  document.getElementById('btnArreterEntretien').hidden = true;
  document.getElementById('btnRetourAccueil').hidden = false;
  document.getElementById('btnRetourAccueil').textContent = t('simple.termine_retour');
  document.getElementById('s3Sous').textContent = t('s3.sous_fini');
  const ok = entretienEnCours.resultats.filter((r) => r.success).length;
  const total = entretienEnCours.resultats.length;
  document.getElementById('tasksBilan').hidden = false;
  document.getElementById('tasksBilan').textContent = t('simple.bilan_titre');
  const simules = entretienEnCours.resultats.filter((r) => r.simule).length;
  document.getElementById('tasksBilanDetail').textContent = t('simple.bilan_detail', { ok, total })
    + (simules ? ` ${t('simulation.bilan', { n: simules })}` : '');
}

/** Icone d'etat d'une tache : coche (reussi), point d'exclamation (echoue),
 *  ou son numero d'ordre pour une tache pas encore commencee — jamais un
 *  symbole qui pretendrait en savoir plus que ce que `derniersResultats` sait
 *  vraiment (specification §7). */
function rendreTachesEntretien() {
  const groupe = etatGroupes?.categories.find((g) => g.category.id === entretienEnCours?.categorieId);
  if (!groupe) return;
  const lignes = scriptsActifs(groupe).map((s, i) => {
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
  const groupe = etatGroupes?.categories.find((g) => g.category.id === entretienEnCours?.categorieId);
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
    b.onclick = () => basculerMode(b.dataset.modeBtn);
  });

  document.querySelector('.simple').addEventListener('click', (ev) => {
    const reco = ev.target.closest('.reco[data-lot]');
    if (reco) return void selectionnerChoix(reco.dataset.lot);

    const buoy = ev.target.closest('.buoy[data-lot]');
    if (buoy) return void selectionnerChoix(buoy.dataset.lot);

    if (ev.target.closest('#btnContinuerChoix')) return void choisirCategorie(selectionSimpleId);
    if (ev.target.closest('[data-s-back]')) return void afficherEtapeSimple(1);
    if (ev.target.closest('#btnLancerEntretien')) return void lancerEntretien();
    if (ev.target.closest('#btnArreterEntretien')) return void arreterEntretien();
    if (ev.target.closest('#btnRetourAccueil')) return void afficherEtapeSimple(1);
    if (ev.target.closest('#btnDetailTechnique')) return void basculerDetailTechnique();
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
let historiqueActuel = { categories: [], scripts: [] };

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
  const totalCategories = historiqueActuel.categories.length;
  if (!totalScripts && !totalCategories) {
    zone.innerHTML = `<div class="box-b"><p class="muted">${esc(t('histo.vide'))}</p></div>`;
    return;
  }

  const lignesCategories = [...historiqueActuel.categories]
    .reverse()
    .slice(0, 20)
    .map(
      (c) => `
      <div class="rrow">
        <div class="rt">${esc(t('histo.categorie_lancee', { nom: c.category_name, n: c.script_ids.length }))}</div>
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
    <div class="box-b list">${lignesCategories}${lignesScripts}</div>`;
}

function appliquerTraductionsReglages() {
  document.getElementById('onbTitre').textContent = t('onb.titre');
  document.getElementById('onbTexte').textContent = t('onb.texte');
  document.getElementById('onbLangueLabel').textContent = t('onb.langue');
  document.getElementById('onbThemeLabel').textContent = t('onb.theme');
  document.querySelector('[data-onb-theme="light"]').textContent = t('onb.theme_clair');
  document.querySelector('[data-onb-theme="dark"]').textContent = t('onb.theme_sombre');
  document.querySelector('[data-onb-theme="system"]').textContent = t('onb.theme_systeme');
  document.getElementById('btnCommencer').textContent = t('onb.commencer');

  document.getElementById('setTitre').textContent = t('reglages.titre');
  document.getElementById('navGeneral').textContent = t('reglages.nav_general');
  document.getElementById('navExpert').textContent = t('reglages.section_expert');
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
  document.querySelector('#setMajSelect [value="propose"]').textContent = t('reglages.maj_proposer');
  document.querySelector('#setMajSelect [value="never"]').textContent = t('reglages.maj_jamais');
  document.getElementById('setMajVerifLabel').textContent = t('reglages.maj_verifier');
  document.getElementById('btnVerifierMaj').textContent = t('reglages.maj_verifier_btn');
  rendreBandeauMaj();

  document.getElementById('setSectionExpert').textContent = t('reglages.section_expert');
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
  document.getElementById('setEchelleLabel').textContent = t('reglages.echelle');
  document.getElementById('btnOuvrirDossierReglages').textContent = t('reglages.dossier_scripts');
  document.getElementById('btnReanalyserReglages').textContent = t('reglages.reanalyser');
  document.getElementById('btnRapportConformite').textContent = t('reglages.rapport_conformite');
  document.getElementById('btnVoirHistorique').textContent = t('histo.voir');
  document.getElementById('btnExporterConfig').textContent = t('reglages.export');
  document.getElementById('btnImporterConfig').textContent = t('reglages.import');
  document.getElementById('btnReinitialiserConfig').textContent = t('reglages.reinitialiser');
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

function ouvrirReglages() {
  remplirFormulaireReglages(reglagesActuels);
  document.getElementById('exportResultat').hidden = true;
  document.getElementById('importResultat').hidden = true;
  document.getElementById('conformiteZone').hidden = true;
  document.getElementById('settingsOverlay').hidden = false;
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
  await rendreLots();
  await rendreDetail();
  if (modeCourant === 'simple') {
    const etapeVisible = document.querySelector('.s-step:not([hidden])')?.dataset.s;
    if (etapeVisible === '1') await rendreEtapeChoisir();
  }
}

function cablerOnboarding() {
  document.querySelectorAll('#onbLangueSeg [data-onb-lang]').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#onbLangueSeg [data-onb-lang]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    };
  });
  document.querySelectorAll('#onbThemeSeg [data-onb-theme]').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#onbThemeSeg [data-onb-theme]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      appliquerTheme(b.dataset.onbTheme, false);
    };
  });

  document.getElementById('btnCommencer').onclick = async () => {
    const lang = document.querySelector('#onbLangueSeg [aria-pressed="true"]')?.dataset.onbLang || 'fr';
    const theme = document.querySelector('#onbThemeSeg [aria-pressed="true"]')?.dataset.onbTheme || 'system';
    reglagesActuels = await invoke('complete_onboarding', { theme, lang });
    await appliquerLangue(lang);
    appliquerTheme(theme, false);
    document.getElementById('onboarding').hidden = true;
  };
}

function cablerReglages() {
  document.getElementById('btnSettings').onclick = ouvrirReglages;
  document.getElementById('btnFermerReglages').onclick = () => {
    document.getElementById('settingsOverlay').hidden = true;
  };

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
      ? etatGroupes.categories.reduce((somme, g) => somme + g.scripts.length, 0) +
        etatGroupes.unclassified.length
      : 0;
    bouton.disabled = false;
    bouton.textContent = PLURIEL('verdict.reanalyse_faite', n);
    setTimeout(() => { bouton.textContent = avant; }, 2600);
  };

  document.getElementById('btnRapportConformite').onclick = () => {
    const zone = document.getElementById('conformiteZone');
    zone.hidden = !zone.hidden;
    if (!zone.hidden) rendreRapportConformite();
  };

  document.getElementById('btnVoirHistorique').onclick = async () => {
    const zone = document.getElementById('historiqueZone');
    zone.hidden = !zone.hidden;
    if (!zone.hidden) {
      await rafraichirHistorique();
      rendreHistorique();
    }
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
  const tous = [...etatGroupes.categories.flatMap((g) => g.scripts), ...etatGroupes.unclassified]
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
      await invoke('set_category_icon', { id: overlay.dataset.pour, icon: choisie.dataset.choisirIcone });
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

  await rafraichirHistorique();
  await chargerLots();
  basculerMode('simple');

  if (!reglages.onboarded) document.getElementById('onboarding').hidden = false;

  // La fenetre est creee invisible pour eviter un flash blanc avant la peinture.
  await laFenetre.show();

  // Apres l'affichage, et sans l'attendre : une verification lente ou une
  // machine hors ligne ne doit jamais retarder l'ouverture de la fenetre.
  if (reglages.update_policy !== 'never') verifierMaj({ silencieux: true });
}

demarrer();
