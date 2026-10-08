/**
 * Faux `window.__TAURI__` pour le banc d'essai de l'interface.
 *
 * L'application impose `requireAdministrator` (specification §12.4) : elle ne
 * peut pas etre lancee depuis un shell non eleve. Ce banc sert donc `src/` tel
 * quel dans un navigateur ordinaire et remplace le seul morceau qui manque —
 * le pont vers Rust.
 *
 * **Les fixtures doivent respecter la forme exacte du backend.** Une forme
 * approximative ne teste que le banc : on diagnostique alors son propre decor.
 * Chaque reponse ci-dessous est calquee sur la struct Rust qui la serialise,
 * nommee en commentaire.
 */

(() => {
  /**
   * Scenario du catalogue (§16), par `?catalogue=` :
   *   (absent)   catalogue 1.0.0 installe, a jour
   *   vide       aucun script, rien d'installe, un historique : l'utilisateur
   *              qui arrive d'une version qui livrait les scripts
   *   neuf       aucun script, rien d'installe, aucun historique : premier lancement
   *   perso      des scripts a soi, aucun catalogue : le rappel s'affiche
   *   maj        installe, une version 1.1.0 attend
   *   modifie    installe, un script officiel modifie sur le PC
   *   signature  l'installation echoue sur une signature refusee
   *   horsligne  la verification echoue faute de reseau
   */
  const SCENARIO = new URLSearchParams(location.search).get('catalogue') || '';
  let catalogueInstalle = !['vide', 'neuf', 'perso', 'signature'].includes(SCENARIO);
  const CATALOGUE_ROOT = 'C:\\Users\\Buly\\AppData\\Local\\WinTool\\sources\\officiel';

  const CATS = [
    { id: 'entretien', fr: 'Entretien complet', en: 'Full maintenance', icon: 'sparkles', pinned: true, aggregate: true },
    { id: 'cleaning', fr: 'Faire le ménage', en: 'Cleaning', icon: 'broom', pinned: false, aggregate: false },
    { id: 'performance', fr: 'Accélérer le PC', en: 'Performance', icon: 'zap', pinned: false, aggregate: false },
    { id: 'privacy', fr: 'Protéger ma vie privée', en: 'Privacy', icon: 'shield', pinned: false, aggregate: false },
    { id: 'apps', fr: 'Retirer les applications', en: 'Applications', icon: 'app-window', pinned: false, aggregate: false },
    { id: 'health', fr: "Vérifier l'état du PC", en: 'Health', icon: 'activity', pinned: false, aggregate: false },
    { id: 'tools', fr: 'Entretien automatique', en: 'Tools', icon: 'wrench', pinned: false, aggregate: false },
  ];

  /** `tools/categories.json` : les categories, qui rangent l'onglet Scripts. */
  const CATEGORIES = [
    { id: 'cleaning', fr: 'Nettoyage', en: 'Cleaning', icon: 'broom' },
    { id: 'performance', fr: 'Performance', en: 'Performance', icon: 'zap' },
    { id: 'privacy', fr: 'Vie privée', en: 'Privacy', icon: 'shield' },
    { id: 'apps', fr: 'Applications', en: 'Applications', icon: 'app-window' },
    { id: 'health', fr: 'Santé', en: 'Health', icon: 'activity' },
    { id: 'tools', fr: 'Outillage', en: 'Tools', icon: 'wrench' },
  ];

  /** Struct `settings::Lot`. */
  const lot = (c) => ({
    id: c.id,
    name: { fr: c.fr, en: c.en },
    description: '',
    icon: c.icon,
    pinned: c.pinned,
    scripts: [],
    factory_aliases: [c.id],
    aggregate: c.aggregate,
  });

  /** Struct `contract::Opt`. */
  const opt = (key, kind, label, desc, def, choices = []) => ({
    key, kind, label, desc, choices, default: def, hidden: kind === 'hidden',
  });

  /** Structs `discovery::ScriptEntry` + `contract::Script`. */
  let n = 0;
  const script = (id, titre, desc, cat, icon, extra = {}) => {
    n += 1;
    return {
      id,
      path: `${String(100 + n)}_${id.toUpperCase()}.ps1`,
      abs_path: `${CATALOGUE_ROOT}\\${String(100 + n)}_${id.toUpperCase()}.ps1`,
      // Struct `discovery::ScriptEntry` : `official` + `verified` depuis la 1.2.
      origin: SCENARIO === 'perso' ? 'user' : 'official',
      verified: SCENARIO !== 'perso' && !(SCENARIO === 'modifie' && id === 'set-dns'),
      hash: (id + 'abcdef0123456789').repeat(4).slice(0, 64),
      declared_id: true,
      meta: {
        id,
        lang: 'en',
        title: titre,
        desc,
        category: cat,
        icon,
        tags: [],
        version: '2.0',
        admin: true,
        risk: extra.risk || 'low',
        duration: extra.duration || 'fast',
        reversible: extra.reversible !== false,
        interruptible: extra.interruptible !== false,
        reboot: !!extra.reboot,
        engine: 'auto',
        options: extra.options || [],
        translations: { fr: { title: titre, desc, options: {}, choices: {}, report: {} } },
        findings: extra.findings || [],
        // Struct `contract::Script`, champs de la 1.4 (§17).
        scan: false, show: '', view: '', view_expert: '', panels: [], report: {},
        ...(extra.meta || {}),
      },
      attention: extra.attention || [],
    };
  };

  const DNS = script('set-dns', 'Configurer DNS', 'Accélère la navigation avec un résolveur rapide', 'performance', 'globe', {
    risk: 'medium',
    options: [
      opt('DnsProvider', 'select', 'Fournisseur DNS', 'Cloudflare · Google · Quad9', 'cloudflare', [
        { value: 'cloudflare', label: 'Cloudflare', desc: '1.1.1.1' },
        { value: 'google', label: 'Google', desc: '8.8.8.8' },
        { value: 'quad9', label: 'Quad9', desc: '9.9.9.9' },
      ]),
      opt('ApplyToIPv6', 'bool', "Appliquer à l'IPv6", 'résolveurs équivalents', true),
      opt('FlushCache', 'hidden', 'Vider le cache', 'après application', true),
      // Deux scripts simulables au moins : sans cela, l'etat « partiel » de la
      // simulation ne s'observe pas sur le banc.
      opt('SafeTest', 'bool', 'Safe test', 'simulates every change', false),
    ],
  });

  const SCRIPTS = {
    cleaning: [
      script('clean-temp', 'Nettoyer les fichiers temporaires', 'Libère de la place sur le disque', 'cleaning', 'trash-2', {
        options: [
          // Reproduit le cas reel de 100_CLEAN_TEMP_FILES : une rangee de
          // puces large, qui ecrasait le libelle avant correction.
          opt('Targets', 'multi', 'Quoi nettoyer', 'un ou plusieurs éléments', ['user', 'windows'], [
            { value: 'user', label: "Fichiers temporaires de l'utilisateur", desc: '' },
            { value: 'windows', label: 'Fichiers temporaires de Windows', desc: '' },
            { value: 'reports', label: "Rapports d'erreur", desc: '' },
          ]),
          opt('AllAccounts', 'bool', 'Tous les comptes', 'sinon uniquement le compte actuel', false),
          opt('MinAgeHours', 'number', 'Ancienneté minimale', 'en heures, les fichiers plus récents sont conservés', 24),
          opt('SafeTest', 'bool', 'Test sans risque', 'simule chaque modification, ne change rien', false),
        ],
      }),
      script('clean-cache', 'Vider les caches des navigateurs', 'Vos favoris ne sont pas touchés', 'cleaning', 'globe'),
    ],
    performance: [
      script('disable-sleep', 'Désactiver la veille', 'Empêche la mise en veille', 'performance', 'moon'),
      DNS,
      script('fast-startup', 'Désactiver le démarrage rapide', 'Évite les redémarrages incomplets', 'performance', 'power', { reboot: true }),
    ],
    privacy: [
      script('telemetry', 'Réduire la télémétrie', 'Réduit ce que Windows transmet', 'privacy', 'shield', { risk: 'medium' }),
      script('ad-tracking', 'Désactiver le suivi publicitaire', 'Supprime l’identifiant de publicité', 'privacy', 'eye-off'),
    ],
    apps: [
      // ?anomalies : deux constats a la decouverte, pour voir le rapport de
      // conformite autrement que vide.
      script('bloatware', 'Retirer les applications inutiles', 'Désinstalle ce que Windows a ajouté', 'apps', 'package-minus', {
        risk: 'high', duration: 'slow', reversible: false,
        findings: new URLSearchParams(location.search).has('anomalies') ? [
          { line: 9, severity: 'error', code: 'VALEUR_INVALIDE', message: "'risk' vaut 'hight' ; valeurs admises : low | medium | high." },
          { line: 47, severity: 'warning', code: 'MARQUEUR_INCONNU', message: "Marqueur '[REBBOT]' inconnu — vouliez-vous dire '[REBOOT]' ?" },
        ] : [],
      }),
    ],
    health: [
      script('sfc', 'Vérifier les fichiers système', 'Contrôle et répare Windows', 'health', 'activity', { duration: 'slow', interruptible: false }),
      script('smart', 'Vérifier la santé du disque', 'Lit les indicateurs SMART', 'health', 'hard-drive'),
    ],
    tools: [
      script('schedule', 'Planifier un entretien', 'Chaque mois, automatiquement', 'tools', 'calendar-clock'),
    ],
  };

  // --- Analyse (§17) --------------------------------------------------------
  // Cinq actions analysables, decrites comme contract.rs les lit : options
  // etiquetees ([group:], [show:], [view:]), bloc REPORT, traductions. Leur
  // analyse est rejouee par `scan_script`, au format de `analyse::Analyse`.
  const optA = (key, kind, label, desc, def, extra = {}) => ({
    key, kind, label, desc, choices: [], default: def, hidden: false,
    keep_one: false, scan: false, group: '', show: '', view: '', ...extra,
  });
  const choixA = (value, label, extra = {}) => ({ value, label, desc: '', group: '', show: '', ...extra });
  const trA = (title, desc, options = {}, choices = {}, report = {}) => ({ fr: { title, desc, options, choices, report } });

  const ANALYSABLES = [
    script('free-space', 'Free up disk space', 'Removes temporary files, downloaded updates and browser caches', 'cleaning', 'trash-2', {
      duration: 'medium', reversible: false,
      options: [
        optA('Targets', 'multi', 'Temporary files', '', ['user', 'windows'], { choices: [
          choixA('user', 'Your temporary files', { group: 'Junk' }),
          choixA('windows', 'Windows temporary files', { group: 'Junk', show: 'expert' }),
          choixA('update', 'Downloaded Windows updates', { group: 'OldUpdates' }),
        ] }),
        optA('RecycleBin', 'bool', 'Empty the recycle bin', '', false, { group: 'Junk' }),
        optA('Browsers', 'items', 'Browser caches', '', [], { view: 'tree' }),
        optA('SafeTest', 'bool', 'Simulate', 'shows what would be done, changes nothing', false),
      ],
      meta: {
        scan: true, view: 'donut', panels: ['plan', 'progress'],
        report: {
          Junk: { kind: 'group', level: '', label: 'Junk files', desc: 'Temporary files and the recycle bin' },
          OldUpdates: { kind: 'group', level: '', label: 'Old Windows updates', desc: 'What Windows keeps after installing them' },
          Cache: { kind: 'label', level: '', label: 'Cache', desc: '' },
          FreeSpace: { kind: 'label', level: '', label: 'Free space on drive C:', desc: '' },
          UpdateNote: { kind: 'note', level: 'warn', label: 'If an update is waiting to be installed, Windows will download it again.', desc: '' },
          Untouched: { kind: 'note', level: 'info', label: 'Your passwords, bookmarks and history are not touched.', desc: '' },
        },
        translations: trA('Faire de la place', 'Supprime les fichiers temporaires, les mises à jour téléchargées et le cache des navigateurs', {
          Targets: ['Fichiers temporaires', ''], RecycleBin: ['Vider la corbeille', ''], Browsers: ['Cache des navigateurs', ''],
        }, {
          'Targets/user': ['Vos fichiers temporaires', ''], 'Targets/windows': ['Fichiers temporaires de Windows', ''],
          'Targets/update': ['Mises à jour de Windows téléchargées', ''],
        }, {
          Junk: ['Fichiers inutiles', 'Fichiers temporaires et corbeille'],
          OldUpdates: ['Anciennes mises à jour de Windows', 'Ce que Windows garde après les avoir installées'],
          Cache: ['Fichiers en cache', ''], FreeSpace: ['Espace libre sur le disque C:', ''],
          UpdateNote: ['Si une mise à jour attend d’être installée, Windows la téléchargera de nouveau.', ''],
          Untouched: ['Vos mots de passe, vos favoris et votre historique ne sont pas touchés.', ''],
        }),
      },
    }),
    script('leftovers', 'Remove leftovers of uninstalled programs', 'Folders and keys left behind', 'cleaning', 'package-x', {
      options: [optA('Leftovers', 'items', 'Leftovers of uninstalled programs', '', [])],
      meta: {
        scan: true, panels: ['plan', 'attention'],
        report: { LowConfidence: { kind: 'note', level: 'info', label: 'Items “to check” may still be used by another program: they are not ticked.', desc: '' } },
        translations: trA('Retirer les restes de programmes', 'Dossiers et clés laissés derrière eux', { Leftovers: ['Restes de programmes désinstallés', ''] }, {}, {
          LowConfidence: ['Les éléments « À vérifier » servent peut-être encore à un autre programme : ils ne sont pas cochés.', ''],
        }),
      },
    }),
    script('duplicates', 'Find duplicate files', 'Keeps one copy of each', 'cleaning', 'copy', {
      options: [optA('Duplicates', 'items', 'Duplicate files', '', [], { keep_one: true })],
      meta: { scan: true, show: 'expert', translations: trA('Trouver les fichiers en double', 'Garde un exemplaire de chacun', { Duplicates: ['Fichiers en double', ''] }) },
    }),
    script('privacy-check', 'Protect my privacy', 'Limits what Windows shares', 'privacy', 'shield', {
      options: [
        optA('Telemetry', 'bool', 'Limit what Windows sends to Microsoft', '', true),
        optA('AdId', 'bool', 'Turn off the advertising ID', '', true),
        optA('Activity', 'bool', 'Do not keep the activity history', '', true),
      ],
      meta: {
        scan: true, view: 'compare', translations: trA('Protéger ma vie privée', 'Limite ce que Windows partage', {
          Telemetry: ['Limiter ce que Windows envoie à Microsoft', ''], AdId: ['Désactiver l’identifiant publicitaire', ''], Activity: ['Ne pas garder l’historique d’activité', ''],
        }),
      },
    }),
    script('disk-health', 'Check disk health', 'Reads the drives’ health indicators', 'health', 'hard-drive', {
      options: [],
      meta: {
        scan: true, view: 'light', panels: ['history'],
        report: {
          Health: { kind: 'label', level: '', label: 'Overall health', desc: '' },
          Temperature: { kind: 'label', level: '', label: 'Temperature', desc: '' },
          Hours: { kind: 'label', level: '', label: 'Power-on hours', desc: '' },
          Backup: { kind: 'note', level: 'warn', label: 'A drive “to watch” can fail without warning: back up what matters.', desc: '' },
        },
        translations: trA('Vérifier la santé des disques', 'Lit les indicateurs de santé des disques', {}, {}, {
          Health: ['État général', ''], Temperature: ['Température', ''], Hours: ['Heures d’utilisation', ''],
          Backup: ['Un disque « à surveiller » peut lâcher sans prévenir : sauvegardez ce qui compte.', ''],
        }),
      },
    }),
  ];
  SCRIPTS.cleaning.push(...ANALYSABLES.slice(0, 3));
  SCRIPTS.privacy.push(ANALYSABLES[3]);
  SCRIPTS.health.push(ANALYSABLES[4]);

  /** Ce que chaque analyse rapporte, au format de `analyse::Analyse`. */
  const ANALYSES = {
    'free-space': {
      lignes: ['[STEP] 1/3 Measuring temporary folders', '[STEP] 2/3 Measuring downloaded Windows updates', '[STEP] 3/3 Looking for browser caches',
        '[LOG] Browsers Google Chrome / Default: 1240 files', '[LOG] Browsers Mozilla Firefox / default-release: 13481 files'],
      analyse: {
        finds: [
          { option: 'Targets', choice: 'user', fields: { size: '647362687', count: '2002' } },
          { option: 'Targets', choice: 'windows', fields: { size: '125829120', count: '1840' } },
          { option: 'RecycleBin', choice: '', fields: { size: '278921216', count: '58' } },
          { option: 'Targets', choice: 'update', fields: { size: '1181116006', count: '96', checked: 'false' } },
        ],
        items: [
          { option: 'Browsers', fields: { id: 'chrome', name: 'Google Chrome', kind: 'browser' } },
          { option: 'Browsers', fields: { id: 'chrome-Default', parent: 'chrome', kind: 'folder', label: 'Cache', name: 'Default', path: 'C:\\Users\\Buly\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache', size: '335544320' } },
          { option: 'Browsers', fields: { id: 'chrome-Profile-1', parent: 'chrome', kind: 'folder', label: 'Cache', name: 'Profile 1', path: 'C:\\Users\\Buly\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 1\\Cache', size: '524288', show: 'expert' } },
          { option: 'Browsers', fields: { id: 'firefox', name: 'Mozilla Firefox', kind: 'browser', locked: 'open' } },
          { option: 'Browsers', fields: { id: 'firefox-default-release', parent: 'firefox', kind: 'folder', label: 'Cache', name: 'default-release', path: 'C:\\Users\\Buly\\AppData\\Local\\Mozilla\\Firefox\\Profiles\\x.default-release\\cache2', size: '183500800', locked: 'open' } },
        ],
        metrics: [{ key: 'FreeSpace', fields: { value: '9', unit: 'pct', health: 'warn', max: '100' } }],
        notes: [{ key: 'UpdateNote', target: 'Targets.update', show: '' }, { key: 'Untouched', target: 'Browsers', show: 'simple' }],
        steps: ['Measuring temporary folders', 'Measuring downloaded Windows updates', 'Looking for browser caches'],
        anomalies: [], truncated: false,
      },
    },
    leftovers: {
      lignes: ['[STEP] 1/2 Listing uninstalled programs', '[LOG] Registry 214 uninstall entries read', '[STEP] 2/2 Looking for leftovers'],
      analyse: {
        finds: [],
        items: [
          { option: 'Leftovers', fields: { id: 'adobe', name: 'Adobe Acrobat Reader DC', kind: 'app' } },
          { option: 'Leftovers', fields: { id: 'adobe-1', parent: 'adobe', kind: 'folder', name: 'ARM', path: 'C:\\ProgramData\\Adobe\\ARM', size: '48234496', confidence: 'high' } },
          { option: 'Leftovers', fields: { id: 'adobe-2', parent: 'adobe', kind: 'registry', name: 'Acrobat Reader', path: 'HKLM\\SOFTWARE\\Adobe\\Acrobat Reader', confidence: 'high', show: 'expert' } },
          { option: 'Leftovers', fields: { id: 'steam', name: 'Steam', kind: 'app' } },
          { option: 'Leftovers', fields: { id: 'steam-1', parent: 'steam', kind: 'folder', name: 'steamapps', path: 'C:\\Program Files (x86)\\Steam\\steamapps', size: '734003200', confidence: 'low' } },
          { option: 'Leftovers', fields: { id: 'steam-2', parent: 'steam', kind: 'folder', name: 'Steam', path: 'C:\\Users\\Buly\\AppData\\Local\\Steam', size: '12582912', confidence: 'high' } },
        ],
        metrics: [], notes: [{ key: 'LowConfidence', target: 'Leftovers', show: '' }],
        steps: ['Listing uninstalled programs', 'Looking for leftovers'], anomalies: ['[ITEM] Leftovers : champ « colour » inconnu — ignoré'], truncated: false,
      },
    },
    duplicates: {
      lignes: ['[STEP] 1/1 Comparing contents'],
      analyse: {
        finds: [],
        items: [
          { option: 'Duplicates', fields: { id: 'd1', group: 'g1', name: 'vacances-001.jpg', path: 'C:\\Users\\Buly\\Pictures', size: '4404019', keep: 'true' } },
          { option: 'Duplicates', fields: { id: 'd2', group: 'g1', name: 'vacances-001.jpg', path: 'C:\\Users\\Buly\\Downloads', size: '4404019' } },
        ],
        metrics: [], notes: [], steps: ['Comparing contents'], anomalies: [], truncated: false,
      },
    },
    'privacy-check': {
      lignes: [],
      analyse: {
        finds: [
          { option: 'Telemetry', choice: '', fields: { state: 'todo' } },
          { option: 'AdId', choice: '', fields: { state: 'ok' } },
          { option: 'Activity', choice: '', fields: { state: 'todo' } },
        ],
        items: [], metrics: [], notes: [], steps: [], anomalies: [], truncated: false,
      },
    },
    'disk-health': {
      lignes: [],
      analyse: {
        finds: [], items: [],
        metrics: [
          { key: 'Health', fields: { value: 'ok', health: 'ok', group: 'Samsung SSD 980' } },
          { key: 'Temperature', fields: { value: '38', unit: 'celsius', health: 'ok', max: '70', group: 'Samsung SSD 980' } },
          { key: 'Hours', fields: { value: '8412', unit: 'hours', group: 'Samsung SSD 980', show: 'expert' } },
          { key: 'Health', fields: { value: 'warn', health: 'warn', group: 'WD Blue' } },
          { key: 'Temperature', fields: { value: '58', unit: 'celsius', health: 'warn', max: '70', group: 'WD Blue' } },
        ],
        notes: [{ key: 'Backup', target: '', show: '' }], steps: [], anomalies: [], truncated: false,
      },
    },
  };

  function analyserBanc(req) {
    const s = TOUS.find((x) => x.id === req?.script_id);
    if (!s?.meta.scan) throw new Error('SANS_ANALYSE');
    const a = ANALYSES[s.id];
    compteur += 1;
    const run_id = `run-${compteur}`;
    enCours = { run_id, script_id: s.id, arrete: false };
    const lignes = a.lignes.length ? a.lignes : ['[STEP] 1/1 Measuring'];
    lignes.forEach((texte, i) => {
      setTimeout(() => {
        if (!enCours || enCours.run_id !== run_id) return;
        const marker = /^\[([A-Z]+)\]/.exec(texte)?.[1] || null;
        const step = /^\[STEP\]\s+(\d+)\/(\d+)/.exec(texte);
        emettre('script:line', { run_id, stream: 'stdout', seq: i, at_ms: i * 300, marker, step: step ? [Number(step[1]), Number(step[2])] : null, text: texte });
      }, 80 + i * 120);
    });
    setTimeout(() => {
      if (!enCours || enCours.run_id !== run_id) return;
      const tue = enCours.arrete;
      enCours = null;
      emettre('script:analysis', { run_id, script_id: s.id, success: !tue, analysis: a.analyse });
      emettre('script:end', {
        run_id, script_id: s.id, exit_code: tue ? null : 0, success: !tue, killed: tue, duration_ms: 900,
        checkpoint_reached: false, reboot_requested: false, freed: null, analysis: true,
        counts_ok: 0, counts_warn: 0, counts_err: 0, log_path: `C:\\Users\\Buly\\AppData\\Local\\WinTool\\logs\\${s.id}-analyse.log`,
      });
    }, 80 + lignes.length * 120 + 200);
    return { run_id, script_id: s.id, engine: 'winps', engine_path: 'powershell.exe', policy: 'Bypass', log_path: '', pid: 4343, simulated: false };
  }

  const TOUT = Object.values(SCRIPTS).flat();
  /** Les scripts presents sur le disque : aucun tant que le catalogue n'est
   *  pas installe, dans le scenario `vide` et ses voisins. */
  const presents = () => {
    if (SCENARIO === 'perso') return TOUT;
    if (!catalogueInstalle || reglages.sources_inactives.includes('officiel')) return [];
    // Les actions decochees dans « Consulter et choisir » n'apparaissent plus.
    const exclus = reglages.sources_exclus.officiel || [];
    return TOUT.filter((x) => !exclus.includes(x.id));
  };
  // `has` autant que `get` : filter, map et forEach testent la presence de
  // chaque indice avant de le lire — sans lui, la liste paraitrait vide.
  const TOUS = new Proxy([], {
    get: (_, k) => Reflect.get(presents(), k),
    has: (_, k) => Reflect.has(presents(), k),
  });

  /**
   * Struct `lib::GroupedResult` — PAS `settings::GroupedScripts`.
   *
   * La commande enrichit le regroupement des deux racines, des anomalies de
   * dossier, des overrides et du rangement par categorie. Une premiere version
   * de cette fixture ne renvoyait que les lots et `unclassified` : le pied du
   * panneau affichait alors « Livrés : {chemin} », et le substituant non
   * remplace ressemblait a un defaut d'i18n de l'application. Il ne venait que
   * d'ici.
   */
  // Appartenances modifiees pendant la session de banc : id de script ->
  // ensemble d'id de lots. Reproduit `ScriptOverride.lots`.
  const appartenances = new Map();
  const lotsDe = (s) => {
    if (appartenances.has(s.id)) return appartenances.get(s.id);
    const d = Object.entries(SCRIPTS).find(([, liste]) => liste.some((x) => x.id === s.id));
    return d ? [d[0]] : [];
  };

  /** Struct `settings::CategoryBucket` : par categorie, les id de scripts. */
  const rubriques = () => {
    const seaux = CATEGORIES.map((c) => ({
      category: { id: c.id, name: { fr: c.fr, en: c.en }, icon: c.icon, aliases: [c.id] },
      scripts: TOUS.filter((s) => s.meta.category === c.id).map((s) => s.id),
    }));
    const autres = TOUS.filter((s) => !CATEGORIES.some((c) => c.id === s.meta.category)).map((s) => s.id);
    seaux.push({ category: { id: 'other', name: { fr: 'Autres', en: 'Other' }, icon: 'folder', aliases: [] }, scripts: autres });
    return seaux.filter((b) => b.scripts.length);
  };

  const groupes = () => ({
    root: 'C:\\Users\\Buly\\AppData\\Local\\WinTool\\scripts',
    catalogue_root: CATALOGUE_ROOT,
    problems: [],
    lots: CATS.map((c) => ({
      lot: lot(c),
      scripts: c.aggregate
        ? TOUS.filter((s) => lotsDe(s).length > 0)
        : TOUS.filter((s) => lotsDe(s).includes(c.id)),
      missing: [],
    })),
    unclassified: TOUS.filter((s) => lotsDe(s).length === 0),
    categories: rubriques(),
    overrides: {},
  });

  /** Struct `settings::Settings`. */
  const reglages = {
    theme: 'system',
    lang: 'fr',
    update_policy: 'propose',
    failure_policy: 'continue',
    log_cap_mb: 200,
    exec_policy: 'bypass',
    lots: CATS.map(lot),
    overrides: {},
    show_setting_numbers: false,
    ui_scale: 1,
    catalogue_source: catalogueInstalle ? 'official' : '',
    catalogue_check: 'startup',
    catalogue_reminder_hidden: false,
    sources_inactives: [],
    sources_exclus: {},
    // Le banc saute l'accueil par defaut ; `?onboarding=1` le rejoue.
    onboarded: !new URLSearchParams(location.search).has('onboarding'),
  };

  /** Struct `history::History` — un objet, jamais un tableau. */
  const historique = {
    lots: [
      { lot_id: 'cleaning', lot_name: 'Faire le ménage', at: '2026-09-18T10:12:00Z', script_ids: ['clean-temp'] },
    ],
    scripts: SCENARIO === 'neuf' ? [] : [
      { script_id: 'clean-temp', title: 'Nettoyer les fichiers temporaires', at: '2026-09-18T10:12:00Z', success: true, killed: false, duration_ms: 4200 },
      { script_id: 'set-dns', title: 'Configurer DNS', at: '2026-09-12T19:03:00Z', success: false, killed: false, duration_ms: 2400 },
    ],
  };

  // --- Execution simulee ---------------------------------------------------
  // Le banc rejoue une sortie plausible pour que la progression, les couleurs
  // de marqueur et le bilan soient reellement observables.
  const auditeurs = { 'script:line': [], 'script:end': [], 'catalogue:progress': [] };
  /** Catalogues ajoutes (`?sources`), et le contenu de celui de Dupont. */
  let tierces = new URLSearchParams(location.search).has('sources')
    ? [{ id: 'dupont', nom: 'Scripts de Dupont', depot: 'dupont/scripts-windows', cle_publique: 'RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3', installe: true }]
    : [];
  const ACTIONS_DUPONT = [
    { id: 'dupont-wifi', file: 'DUPONT_WIFI.ps1', version: '2.1', title: { fr: 'Réparer le Wi-Fi', en: 'Fix Wi-Fi' }, desc: { fr: 'Réinitialise la carte réseau et vide le cache DNS', en: 'Resets the network adapter and flushes DNS' }, category: 'network', risk: 'medium', admin: true, etat: 'installe' },
    { id: 'dupont-teams', file: 'DUPONT_TEAMS.ps1', version: '1.4', title: { fr: 'Vider le cache de Teams', en: 'Clear the Teams cache' }, desc: { fr: 'Libère de la place sans toucher à vos conversations', en: 'Frees space without touching your chats' }, category: 'cleaning', risk: 'low', admin: false, etat: 'maj' },
    { id: 'dupont-export', file: 'DUPONT_EXPORT.ps1', version: '0.9', title: { fr: 'Exporter les mots de passe du navigateur', en: 'Export browser passwords' }, desc: { fr: 'Copie les mots de passe enregistrés dans un fichier', en: 'Copies saved passwords to a file' }, category: 'tools', risk: 'high', admin: true, etat: 'absent' },
  ];
  /** `garde::ConfigGarde` — dans HKLM cote Rust. */
  const garde = { retires: [], ajouts: [] };
  const emettre = (nom, payload) => auditeurs[nom]?.forEach((f) => f({ payload }));

  const LIGNES = [
    [0, 'stdout', 'INFO', null, '[INFO] Target resolver: Cloudflare (1.1.1.1 / 1.0.0.1)'],
    [120, 'stdout', 'STEP', [1, 4], '[STEP] 1/4 Backing up current configuration'],
    [260, 'stdout', 'OK', null, '[OK] Exported to %LOCALAPPDATA%\\WinTool\\backup\\dns.reg'],
    [400, 'stdout', 'CKPT', null, '[CKPT] Backup complete — safe to interrupt from here'],
    [520, 'stdout', 'STEP', [2, 4], '[STEP] 2/4 Applying to Ethernet'],
    [660, 'stdout', 'OK', null, '[OK] Ethernet → 1.1.1.1 / 1.0.0.1'],
    [800, 'stdout', 'STEP', [3, 4], '[STEP] 3/4 Applying to Wi-Fi'],
    [900, 'stdout', 'WARN', null, '[WARN] Wi-Fi adapter disabled — skipped'],
    [1020, 'stderr', 'ERR', null, '[ERR] Bluetooth Network: access denied'],
    [1160, 'stdout', 'STEP', [4, 4], '[STEP] 4/4 Flushing resolver cache'],
    [1300, 'stdout', 'DONE', null, '[DONE] Finished'],
  ];

  let compteur = 0;
  let enCours = null;

  // Simulation (§6.9) : meme regle que simulation.rs, sur les reglages du banc.
  const simulable = (s) => (s.meta.options || []).some((o) => o.key === 'SafeTest');
  const simule = (s) => {
    if (!simulable(s)) return false;
    const v = reglages.overrides[s.id]?.config?.SafeTest;
    if (v !== undefined) return v === true || v === 1 || String(v).toLowerCase() === 'true';
    return s.meta.options.find((o) => o.key === 'SafeTest').default === true;
  };
  const bilanSimulation = () => {
    const simulables = TOUS.filter(simulable).length;
    const simules = TOUS.filter(simule).length;
    const etat = simules === 0 ? 'desactivee' : simules === simulables ? 'activee' : 'partielle';
    return { etat, simulables, simules };
  };

  function lancer(req) {
    const s = TOUS.find((x) => x.id === req?.script_id);
    // Ce que chaque script aurait recu dans WINTOOL_CONFIG : pour verifier
    // depuis la console que la selection de l'analyse part bien avec.
    (window.__BENCH_CONFIGS ||= []).push({ id: req?.script_id, config: req?.config });
    if (s && !simulable(s) && bilanSimulation().etat === 'activee') throw new Error('SANS_SIMULATION');
    // ?garde : la garde des reglages refuse un « dossier » qui vise Windows.
    if (s?.id === 'clean-temp' && new URLSearchParams(location.search).has('garde')) {
      throw new Error('REGLAGE_REFUSE:emplacement:Targets:C:\\Windows\\System32');
    }
    const estSimule = !!s && simule(s);
    compteur += 1;
    const run_id = `run-${compteur}`;
    const script_id = req?.script_id || 'set-dns';
    enCours = { run_id, script_id, arrete: false };

    let seq = 0;
    LIGNES.forEach(([at, stream, marker, step, text]) => {
      setTimeout(() => {
        if (!enCours || enCours.run_id !== run_id || enCours.arrete) return;
        emettre('script:line', { run_id, stream, seq: seq++, at_ms: at, marker, step, text });
      }, at / 4);
    });

    setTimeout(() => {
      if (!enCours || enCours.run_id !== run_id) return;
      const tue = enCours.arrete;
      enCours = null;
      emettre('script:end', {
        run_id, script_id,
        exit_code: tue ? null : 0,
        success: !tue,
        killed: tue,
        duration_ms: 1420,
        checkpoint_reached: true,
        reboot_requested: false,
        // `[FREED]` : seule l'action « Faire de la place » l'annonce sur le banc.
        freed: script_id === 'free-space' ? 917504000 : null,
        analysis: false,
        counts_ok: 2, counts_warn: 1, counts_err: 1,
        log_path: 'C:\\Users\\Buly\\AppData\\Local\\WinTool\\logs\\2026-09-24_101200-set-dns.log',
      });
    }, 1500 / 4);

    return {
      run_id, script_id,
      engine: 'winps',
      engine_path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      policy: 'Bypass',
      log_path: 'C:\\Users\\Buly\\AppData\\Local\\WinTool\\logs\\2026-09-24_101200-set-dns.log',
      pid: 4242,
      simulated: estSimule,
    };
  }

  const REPONSES = {
    app_info: () => ({ version: '1.4.0', elevated: !new URLSearchParams(location.search).has('sansadmin') }),
    // Mise a jour. ?maj=1.1.1 annonce une version ; ?maj=signature la fait
    // refuser a l'installation ; ?maj=horsligne fait echouer la verification.
    // Sans parametre, WinTool est a jour.
    check_update: async () => {
      const maj = new URLSearchParams(location.search).get('maj');
      if (maj === 'horsligne') throw new Error('error sending request for url (https://github.com/...)');
      if (!maj) return null;
      const version = maj === 'signature' ? '1.4.1' : maj;
      return { version, actuelle: '1.4.0', notes: 'Notes de version', date: '2026-10-01 10:00:00 +00:00:00' };
    },
    install_update: async () => {
      const maj = new URLSearchParams(location.search).get('maj');
      const total = 2_300_000;
      for (let recu = 0; recu <= total; recu += 460_000) {
        emettre('update:progress', { recu, total });
        await new Promise((r) => setTimeout(r, 250));
      }
      if (maj === 'signature') throw new Error('Signature verification failed');
      // Le vrai greffon fermerait l'application ici ; le banc ne peut pas.
      throw new Error('banc : l’installeur aurait ete lance et WinTool ferme');
    },
    // Structs `catalogue::Etat`, `Bilan`, `Installation`.
    catalogue_state: () => ({
      cle: true,
      depot: 'https://github.com/burnout293/WinTool-Catalogue',
      dossier: CATALOGUE_ROOT,
      installe: catalogueInstalle ? { version: '1.0.0', published: '2026-10-06', scripts: TOUT.length } : null,
      probleme: null,
    }),
    check_catalogue: async () => {
      await new Promise((r) => setTimeout(r, 400));
      if (SCENARIO === 'horsligne') throw new Error('CATALOGUE_HORS_LIGNE: error sending request');
      const el = (id, file, fr) => ({ id, file, title: { fr, en: fr } });
      if (SCENARIO === 'maj') {
        return {
          version: '1.1.0', published: '2026-10-20', installee: '1.0.0',
          nouveaux: [el('n1', '120_NEW.ps1', 'Nettoyer Teams'), el('n2', '121_NEW.ps1', 'Vider la corbeille')],
          mis_a_jour: [el('set-dns', '102_SET-DNS.ps1', 'Configurer DNS')],
          remplaces: [], retires: [el('smart', '110_SMART.ps1', 'Vérifier la santé du disque')],
          a_jour: false,
        };
      }
      return {
        version: '1.0.0', published: '2026-10-06', installee: catalogueInstalle ? '1.0.0' : null,
        nouveaux: catalogueInstalle ? [] : TOUT.map((x) => el(x.id, x.path, x.meta.title)),
        mis_a_jour: [], remplaces: [], retires: [], a_jour: catalogueInstalle,
      };
    },
    install_catalogue: async () => {
      const total = SCENARIO === 'maj' ? 3 : TOUT.length;
      for (let fait = 0; fait <= total; fait += 1) {
        emettre('catalogue:progress', { fait, total });
        await new Promise((r) => setTimeout(r, 120));
      }
      if (SCENARIO === 'signature') {
        throw new Error("CATALOGUE_SIGNATURE: l'index ne porte pas la signature du catalogue officiel");
      }
      catalogueInstalle = true;
      reglages.catalogue_source = 'official';
      return SCENARIO === 'maj'
        ? { version: '1.1.0', ecrits: 3, copies: [], retires: [{ id: 'smart', file: '110_SMART.ps1', title: { fr: 'Vérifier la santé du disque', en: 'Check disk health' } }] }
        : { version: '1.0.0', ecrits: TOUT.length, copies: [], retires: [] };
    },
    // Catalogues (§16.2). `lib::EtatSources`, `catalogue::Contenu`. Avec
    // `?sources`, un catalogue ajoute, installe : « Scripts de Dupont ».
    sources_state: () => ({
      sources: [
        { id: 'officiel', nom: 'Catalogue officiel', depot: 'burnout293/WinTool-Catalogue', cle_publique: '', officielle: true, installe: catalogueInstalle },
        ...tierces,
      ].map((x) => ({
        ...x,
        officielle: !!x.officielle,
        active: !reglages.sources_inactives.includes(x.id),
        exclus: (reglages.sources_exclus[x.id] || []).length,
        cle: true,
        dossier: `C:\\Users\\Buly\\AppData\\Local\\WinTool\\sources\\${x.id}`,
        installe: x.installe ? { version: x.id === 'officiel' ? '1.0.0' : '2.1.0', published: '2026-10-06', scripts: x.id === 'officiel' ? TOUT.length : ACTIONS_DUPONT.length } : null,
        probleme: null,
      })),
      problemes: [],
      modifiable: !new URLSearchParams(location.search).has('sansadmin'),
    }),
    check_source: async (a) => {
      if (a.id === 'officiel') return REPONSES.check_catalogue();
      await new Promise((r) => setTimeout(r, 400));
      const nouveau = { id: 'dupont-imprimante', file: 'DUPONT_IMPRIMANTE.ps1', title: { fr: 'Débloquer l’imprimante', en: 'Unjam the printer' } };
      return SCENARIO === 'maj'
        ? { version: '2.2.0', published: '2026-10-20', installee: '2.1.0', nouveaux: [nouveau], mis_a_jour: [], remplaces: [], retires: [], a_jour: false }
        : { version: '2.1.0', published: '2026-10-06', installee: '2.1.0', nouveaux: [], mis_a_jour: [], remplaces: [], retires: [], a_jour: true };
    },
    install_source: async (a) => {
      if (a.id === 'officiel') return REPONSES.install_catalogue();
      for (let fait = 0; fait <= 2; fait += 1) {
        emettre('catalogue:progress', { fait, total: 2 });
        await new Promise((r) => setTimeout(r, 200));
      }
      const x = tierces.find((y) => y.id === a.id);
      if (x) x.installe = true;
      return { version: '2.1.0', ecrits: 2, copies: [], retires: [] };
    },
    source_contents: async (a) => {
      const exclus = reglages.sources_exclus[a.id] || [];
      const liste = a.id === 'officiel'
        ? TOUT.map((x) => ({
          id: x.id, file: x.path, version: '1.0', title: { fr: x.meta.title, en: x.meta.title },
          desc: { fr: x.meta.desc, en: x.meta.desc }, category: x.meta.category, risk: x.meta.risk,
          admin: true, etat: catalogueInstalle ? (exclus.includes(x.id) ? 'absent' : 'installe') : 'absent',
        }))
        : ACTIONS_DUPONT;
      for (let fait = 0; fait <= liste.length; fait += 4) {
        emettre('catalogue:progress', { fait, total: liste.length });
        await new Promise((r) => setTimeout(r, 60));
      }
      return liste.map((c) => ({ ...c, exclu: exclus.includes(c.id) }));
    },
    set_source_selection: (a) => {
      if (a.exclus.length) reglages.sources_exclus[a.id] = [...a.exclus];
      else delete reglages.sources_exclus[a.id];
      return JSON.parse(JSON.stringify(reglages));
    },
    set_source_active: (a) => {
      reglages.sources_inactives = reglages.sources_inactives.filter((i) => i !== a.id);
      if (!a.active) reglages.sources_inactives.push(a.id);
      return JSON.parse(JSON.stringify(reglages));
    },
    add_source: async (a) => {
      if (new URLSearchParams(location.search).has('sansadmin')) throw new Error('SOURCES_SANS_DROITS');
      await new Promise((r) => setTimeout(r, 500));
      const m = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(a.depot.trim());
      if (!m) throw new Error(`CATALOGUE_DEPOT: « ${a.depot} » n'est pas un depot GitHub`);
      if (!/^(untrusted comment|RW|dW)/.test(a.cle.trim())) throw new Error('CATALOGUE_CLE: cle publique illisible');
      const id = m[2].toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
      if (id === 'officiel' || tierces.some((x) => x.id === id)) throw new Error(`SOURCE_EXISTE: ${id}`);
      tierces.push({ id, nom: a.nom.trim() || m[2], depot: `${m[1]}/${m[2]}`, cle_publique: a.cle.trim(), installe: false });
      return id;
    },
    update_source: async (a) => {
      await new Promise((r) => setTimeout(r, 300));
      const x = tierces.find((y) => y.id === a.id);
      if (x) Object.assign(x, { nom: a.nom.trim() || x.nom, cle_publique: a.cle.trim() });
      return null;
    },
    remove_source: (a) => {
      tierces = tierces.filter((x) => x.id !== a.id);
      delete reglages.sources_exclus[a.id];
      return null;
    },
    // Emplacements proteges (§12.4). `lib::EmplacementsProteges`.
    protected_paths: () => ({
      integres: [
        { id: 'windows', chemins: ['C:\\Windows'], tres_sensible: true },
        { id: 'program_files', chemins: ['C:\\Program Files', 'C:\\Program Files (x86)'], tres_sensible: true },
        { id: 'installation', chemins: ['C:\\Program Files\\WinTool'], tres_sensible: true },
        { id: 'racines_lecteurs', chemins: [], tres_sensible: true },
        { id: 'program_data', chemins: ['C:\\ProgramData'], tres_sensible: false },
        { id: 'profils', chemins: ['C:\\Users'], tres_sensible: false },
        { id: 'racine_systeme', chemins: ['C:\\System Volume Information', 'C:\\$Recycle.Bin', 'C:\\Recovery'], tres_sensible: false },
      ],
      retires: garde.retires,
      ajouts: garde.ajouts,
      modifiable: !new URLSearchParams(location.search).has('sansadmin'),
      lecteur: 'C:',
      profil: 'C:\\Users\\Buly',
      public: 'C:\\Users\\Public',
    }),
    set_protected_paths: (a) => {
      if (new URLSearchParams(location.search).has('sansadmin')) throw new Error('GARDE_SANS_DROITS');
      const propres = (a.ajouts || []).map((p) => p.trim()).filter(Boolean);
      const mauvais = propres.find((p) => !/^[A-Za-z]:[\\/]/.test(p));
      if (mauvais) throw new Error(`CHEMIN_NON_ABSOLU:${mauvais}`);
      garde.retires = [...(a.retires || [])];
      garde.ajouts = propres;
      return null;
    },
    complete_onboarding: (a) => {
      reglages.onboarded = true;
      reglages.theme = a.theme;
      reglages.lang = a.lang;
      return JSON.parse(JSON.stringify(reglages));
    },
    set_catalogue_source: (a) => { reglages.catalogue_source = a.source; return JSON.parse(JSON.stringify(reglages)); },
    set_catalogue_check: (a) => { reglages.catalogue_check = a.policy; return JSON.parse(JSON.stringify(reglages)); },
    hide_catalogue_reminder: () => { reglages.catalogue_reminder_hidden = true; return JSON.parse(JSON.stringify(reglages)); },
    engines: () => ({ winps: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', pwsh: null }),
    scripts_root: () => 'C:\\Users\\Buly\\AppData\\Local\\WinTool\\scripts',
    get_settings: () => JSON.parse(JSON.stringify(reglages)),
    list_scripts_grouped: () => groupes(),
    get_history: () => JSON.parse(JSON.stringify(historique)),
    run_script: (a) => lancer(a?.req),
    scan_script: (a) => analyserBanc(a?.req),
    disk_space: () => ({ lecteur: 'C:', total: 511_101_108_224, libre: 46_170_898_432 }),
    set_analysis_chart: (a) => { reglages.analysis_chart = a.chart; return JSON.parse(JSON.stringify(reglages)); },
    cancel_script: () => {
      if (enCours) enCours.arrete = true;
      return { killed: true, needs_confirmation: false, message: 'Exécution interrompue.' };
    },
    // Comme approval.rs : un script officiel dont l'empreinte est celle de
    // l'index signe est approuve d'office (§16.4) — rien a demander.
    preparer_approbation: (a) => (TOUS.find((x) => x.id === a?.scriptId)?.verified ? null : {
      script_id: 'set-dns',
      title: 'Configurer DNS',
      path: 'Default/102_SET-DNS.ps1',
      hash: 'a'.repeat(64),
      source: '## WINTOOL:START\n## title : Configurer DNS\n## WINTOOL:END\n\nWrite-Output "[DONE] ok"\n',
      attention: [{ line: 12, pattern: 'Invoke-Expression', message: 'Exécution de code construit à la volée' }],
      previously_approved_at: null,
    }),
    // Enum `restore::RestoreOutcome` : 'created' | 'throttled_recent'
    // | 'protection_disabled' | { failed: "..." }. Jamais un objet libre.
    set_lot_script: (a) => {
      const actuelles = lotsDe({ id: a.scriptId });
      const liste = actuelles.filter((c) => c !== a.lotId);
      if (a.member) liste.push(a.lotId);
      appartenances.set(a.scriptId, liste);
      return JSON.parse(JSON.stringify(reglages));
    },
    record_script_run: (a) => {
      historique.scripts.push({
        script_id: a.scriptId, title: a.title, at: '2026-09-25T00:00:00Z',
        success: a.success, killed: a.killed, duration_ms: a.durationMs, simulated: !!a.simulated,
        ...(a.freed != null ? { freed: a.freed } : {}),
      });
      return null;
    },
    check_script: (a) => ({
      script_id: a.scriptId,
      hash: 'a'.repeat(64),
      findings: a.scriptId === 'bloatware'
        ? [{ line: 42, severity: 'warning', code: 'SORTIE_NON_ANGLAISE', message: 'Message affiché contenant des accents.' }]
        : [],
      syntax: a.scriptId === 'sfc'
        ? { parses: false, engine: 'winps', errors: [{ line: 17, column: 3, message: "Accolade fermante manquante dans le bloc d'instructions." }] }
        : { parses: true, engine: 'winps', errors: [] },
    }),
    // Enregistrement d'un reglage : renvoie bien des `Settings`, sinon
    // `reglages.overrides` leve un TypeError cote interface.
    set_script_config: (a) => {
      const o = (reglages.overrides[a.scriptId] ||= { config: {} });
      o.config[a.key] = a.value;
      window.__BENCH_DERNIER_REGLAGE = { ...a };
      return JSON.parse(JSON.stringify(reglages));
    },
    set_script_flag: (a) => {
      const o = (reglages.overrides[a.scriptId] ||= { config: {} });
      o[a.flag] = a.value;
      return JSON.parse(JSON.stringify(reglages));
    },
    // Mode test : etat de session, comme cote Rust.
    set_lot_icon: (a) => {
      const c = CATS.find((x) => x.id === a.id);
      if (c) c.icon = a.icon;
      reglages.lots = CATS.map(lot);
      return JSON.parse(JSON.stringify(reglages));
    },
    rename_lot: (a) => {
      const c = CATS.find((x) => x.id === a.id);
      if (c) { c.fr = a.name; c.en = a.name; }
      reglages.lots = CATS.map(lot);
      return JSON.parse(JSON.stringify(reglages));
    },
    set_lot_pinned: (a) => {
      CATS.forEach((c) => { c.pinned = !!a.pinned && c.id === a.id; });
      reglages.lots = CATS.map(lot);
      return JSON.parse(JSON.stringify(reglages));
    },
    set_ui_scale: (a) => { reglages.ui_scale = a.value; return JSON.parse(JSON.stringify(reglages)); },
    relaunch_elevated: () => null,
    simulation_state: () => bilanSimulation(),
    set_simulation_all: (a) => {
      TOUS.filter(simulable).forEach((s) => {
        (reglages.overrides[s.id] ||= { config: {} }).config ||= {};
        reglages.overrides[s.id].config.SafeTest = !!a.value;
      });
      return JSON.parse(JSON.stringify(reglages));
    },
    create_restore_point: () => 'created',
    set_show_setting_numbers: (a) => { reglages.show_setting_numbers = !!a.value; return JSON.parse(JSON.stringify(reglages)); },
    export_settings: () => 'C:\\Users\\Buly\\Documents\\wintool-config.json',
    import_settings: () => ({ ok: true, message: 'Configuration importée.' }),
  };

  const invoke = async (cmd, args) => {
    const f = REPONSES[cmd];
    if (f) return f(args);
    // Tout le reste (set_theme, reorder_lots…) n'a pas de retour utile :
    // renvoyer `null` plutot que rejeter evite de masquer un vrai defaut
    // d'interface derriere une erreur du banc.
    return null;
  };

  const fenetre = {
    minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {},
    show: async () => { document.documentElement.dataset.benchVisible = '1'; },
    onFocusChanged: async () => () => {},
  };

  window.__TAURI__ = {
    core: { invoke },
    event: {
      listen: async (nom, f) => {
        (auditeurs[nom] ||= []).push(f);
        return () => {};
      },
    },
    window: { getCurrentWindow: () => fenetre },
    opener: { openPath: async () => {} },
  };

  // Signal de fin pour un pilote automatise : la page previent le serveur
  // quand le demarrage asynchrone est termine. `--dump-dom` rend la main
  // avant, et `--virtual-time-budget` ne le retarde pas.
  window.__BENCH_PRET = new Promise((resolve) => {
    const t = setInterval(() => {
      if (document.documentElement.dataset.benchVisible) {
        clearInterval(t);
        resolve(true);
      }
    }, 50);
  });
})();
