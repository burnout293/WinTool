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
   *   vide       aucun script, rien d'installe : l'accueil propose le catalogue
   *   perso      des scripts a soi, aucun catalogue : le rappel s'affiche
   *   maj        installe, une version 1.1.0 attend
   *   modifie    installe, un script officiel modifie sur le PC
   *   signature  l'installation echoue sur une signature refusee
   *   horsligne  la verification echoue faute de reseau
   */
  const SCENARIO = new URLSearchParams(location.search).get('catalogue') || '';
  let catalogueInstalle = !['vide', 'perso', 'signature'].includes(SCENARIO);
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

  /** Struct `settings::Category`. */
  const categorie = (c) => ({
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
        translations: { fr: { title: titre, desc, options: {}, choices: {} } },
        findings: extra.findings || [],
      },
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

  const TOUT = Object.values(SCRIPTS).flat();
  /** Les scripts presents sur le disque : aucun tant que le catalogue n'est
   *  pas installe, dans le scenario `vide` et ses voisins. */
  const presents = () => (catalogueInstalle || SCENARIO === 'perso' ? TOUT : []);
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
   * dossier et des overrides. Une premiere version de cette fixture ne
   * renvoyait que `categories` et `unclassified` : le pied du panneau affichait
   * alors « Livrés : {chemin} », et le substituant non remplace ressemblait a
   * un defaut d'i18n de l'application. Il ne venait que d'ici.
   */
  // Appartenances modifiees pendant la session de banc : id de script ->
  // ensemble d'id de categories. Reproduit `ScriptOverride.categories`.
  const appartenances = new Map();
  const categoriesDe = (s) => {
    if (appartenances.has(s.id)) return appartenances.get(s.id);
    const d = Object.entries(SCRIPTS).find(([, liste]) => liste.some((x) => x.id === s.id));
    return d ? [d[0]] : [];
  };

  const groupes = () => ({
    root: 'C:\\Users\\Buly\\AppData\\Local\\WinTool\\scripts',
    catalogue_root: CATALOGUE_ROOT,
    problems: [],
    categories: CATS.map((c) => ({
      category: categorie(c),
      scripts: c.aggregate
        ? TOUS.filter((s) => categoriesDe(s).length > 0)
        : TOUS.filter((s) => categoriesDe(s).includes(c.id)),
      missing: [],
    })),
    unclassified: [],
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
    categories: CATS.map(categorie),
    overrides: {},
    show_setting_numbers: false,
    ui_scale: 1,
    catalogue_source: catalogueInstalle ? 'official' : '',
    catalogue_check: 'startup',
    catalogue_reminder_hidden: false,
    // Le banc saute l'accueil par defaut ; `?onboarding=1` le rejoue.
    onboarded: !new URLSearchParams(location.search).has('onboarding'),
  };

  /** Struct `history::History` — un objet, jamais un tableau. */
  const historique = {
    categories: [
      { category_id: 'cleaning', category_name: 'Faire le ménage', at: '2026-09-18T10:12:00Z', script_ids: ['clean-temp'] },
    ],
    scripts: [
      { script_id: 'clean-temp', title: 'Nettoyer les fichiers temporaires', at: '2026-09-18T10:12:00Z', success: true, killed: false, duration_ms: 4200 },
      { script_id: 'set-dns', title: 'Configurer DNS', at: '2026-09-12T19:03:00Z', success: false, killed: false, duration_ms: 2400 },
    ],
  };

  // --- Execution simulee ---------------------------------------------------
  // Le banc rejoue une sortie plausible pour que la progression, les couleurs
  // de marqueur et le bilan soient reellement observables.
  const auditeurs = { 'script:line': [], 'script:end': [], 'catalogue:progress': [] };
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
    if (s && !simulable(s) && bilanSimulation().etat === 'activee') throw new Error('SANS_SIMULATION');
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
    app_info: () => ({ version: '1.1.1', elevated: !new URLSearchParams(location.search).has('sansadmin') }),
    // Mise a jour. ?maj=1.1.1 annonce une version ; ?maj=signature la fait
    // refuser a l'installation ; ?maj=horsligne fait echouer la verification.
    // Sans parametre, WinTool est a jour.
    check_update: async () => {
      const maj = new URLSearchParams(location.search).get('maj');
      if (maj === 'horsligne') throw new Error('error sending request for url (https://github.com/...)');
      if (!maj) return null;
      const version = maj === 'signature' ? '1.1.1' : maj;
      return { version, actuelle: '1.1.1', notes: 'Notes de version', date: '2026-10-01 10:00:00 +00:00:00' };
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
    set_catalogue_source: (a) => { reglages.catalogue_source = a.source; return JSON.parse(JSON.stringify(reglages)); },
    set_catalogue_check: (a) => { reglages.catalogue_check = a.policy; return JSON.parse(JSON.stringify(reglages)); },
    hide_catalogue_reminder: () => { reglages.catalogue_reminder_hidden = true; return JSON.parse(JSON.stringify(reglages)); },
    engines: () => ({ winps: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', pwsh: null }),
    scripts_root: () => 'C:\\Users\\Buly\\AppData\\Local\\WinTool\\scripts',
    get_settings: () => JSON.parse(JSON.stringify(reglages)),
    list_scripts_grouped: () => groupes(),
    get_history: () => JSON.parse(JSON.stringify(historique)),
    run_script: (a) => lancer(a?.req),
    cancel_script: () => {
      if (enCours) enCours.arrete = true;
      return { killed: true, needs_confirmation: false, message: 'Exécution interrompue.' };
    },
    preparer_approbation: () => ({
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
    set_category_script: (a) => {
      const actuelles = categoriesDe({ id: a.scriptId });
      const liste = actuelles.filter((c) => c !== a.categoryId);
      if (a.member) liste.push(a.categoryId);
      appartenances.set(a.scriptId, liste);
      return JSON.parse(JSON.stringify(reglages));
    },
    record_script_run: (a) => {
      historique.scripts.push({
        script_id: a.scriptId, title: a.title, at: '2026-09-25T00:00:00Z',
        success: a.success, killed: a.killed, duration_ms: a.durationMs, simulated: !!a.simulated,
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
    set_category_icon: (a) => {
      const c = CATS.find((x) => x.id === a.id);
      if (c) c.icon = a.icon;
      reglages.categories = CATS.map(categorie);
      return JSON.parse(JSON.stringify(reglages));
    },
    rename_category: (a) => {
      const c = CATS.find((x) => x.id === a.id);
      if (c) { c.fr = a.name; c.en = a.name; }
      reglages.categories = CATS.map(categorie);
      return JSON.parse(JSON.stringify(reglages));
    },
    set_category_pinned: (a) => {
      CATS.forEach((c) => { c.pinned = !!a.pinned && c.id === a.id; });
      reglages.categories = CATS.map(categorie);
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
    // Tout le reste (set_theme, reorder_categories…) n'a pas de retour utile :
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
