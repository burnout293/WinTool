mod analyse;
mod approval;
mod catalogue;
mod contract;
mod discovery;
mod garde;
mod history;
mod restore;
mod runner;
mod security;
mod settings;
mod simulation;
mod sources;
mod systeme;
mod update;

use serde::Serialize;
use settings::{Lot, Settings};
use std::collections::HashSet;
use std::sync::Arc;
use tauri::Manager;

#[derive(Serialize)]
pub struct AppInfo {
    /// Version lue depuis Cargo.toml : une seule source de verite pour le numero.
    version: String,
    /// Toujours vrai en pratique : le manifeste impose requireAdministrator.
    /// Expose quand meme, parce que l'interface l'affiche et qu'une pastille
    /// qui mentirait serait pire que pas de pastille du tout.
    elevated: bool,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        elevated: is_elevated(),
    }
}

/// Verifie l'elevation reelle du processus courant.
#[cfg(windows)]
fn is_elevated() -> bool {
    // Ouvrir un peripherique disque brut en lecture exige les droits
    // administrateur. C'est sans effet de bord, sans dependance supplementaire
    // et sans processus a lancer.
    //
    // La premiere version utilisait `net session`, qui echoue aussi lorsque le
    // service Serveur est desactive : un faux negatif possible, donc une
    // pastille « Administrateur » qui aurait pu mentir.
    std::fs::OpenOptions::new()
        .read(true)
        .open(r"\\.\PHYSICALDRIVE0")
        .is_ok()
}

#[cfg(not(windows))]
fn is_elevated() -> bool {
    false
}

/// Liste les scripts trouves sur le disque, avec leur contrat lu et leurs
/// anomalies de conformite. Constater, jamais bloquer : un script non conforme
/// est renvoye quand meme, ses anomalies dans `meta.findings`.
#[tauri::command]
fn list_scripts(app: tauri::AppHandle) -> Result<discovery::DiscoveryResult, String> {
    discovery::discover(&app)
}

/// Scripts decouverts, regroupes par lot et par categorie (mode Expert, §2/§4.1).
/// Combine la decouverte (`discovery::discover`) et les reglages utilisateur
/// (`settings::load`) : les deux sont necessaires pour savoir dans quel lot
/// ranger chaque script, donc c'est ici que la jointure se fait, pas cote JS —
/// un seul endroit sait resoudre un lot ou une categorie.
#[tauri::command]
fn list_scripts_grouped(app: tauri::AppHandle) -> Result<GroupedResult, String> {
    let decouverte = discovery::discover(&app)?;
    let reglages = settings::load(&app)?;
    let categories =
        settings::group_by_category(&settings::read_categories(&app)?, &decouverte.scripts);
    let groupes = settings::group_scripts(&reglages, decouverte.scripts);
    let mut problems = systeme::alertes();
    problems.extend(decouverte.problems);
    Ok(GroupedResult {
        root: decouverte.root,
        catalogue_root: decouverte.catalogue_root,
        problems,
        lots: groupes.lots,
        unclassified: groupes.unclassified,
        categories,
        overrides: reglages.overrides,
    })
}

#[derive(Serialize)]
struct GroupedResult {
    root: String,
    catalogue_root: String,
    problems: Vec<String>,
    lots: Vec<settings::LotGroup>,
    /// Scripts rangés dans aucun lot.
    unclassified: Vec<discovery::ScriptEntry>,
    /// Les memes scripts, ranges par categorie (onglet « Scripts » de l'Expert).
    categories: Vec<settings::CategoryBucket>,
    /// Ce que l'utilisateur a fige, script par script (§4.2). Envoye **a cote**
    /// des metadonnees, jamais fusionne dedans : l'interface a besoin des deux
    /// pour distinguer « le script dit 5 » de « vous avez impose 5 », et pour
    /// savoir quoi proposer d'annuler.
    overrides: std::collections::BTreeMap<String, settings::ScriptOverride>,
}

/// Chemin de la racine des scripts, pour le bouton « Ouvrir le dossier ».
#[tauri::command]
fn scripts_root(app: tauri::AppHandle) -> Result<String, String> {
    discovery::scripts_root(&app).map(|p| p.to_string_lossy().to_string())
}

/// Interpreteurs PowerShell presents sur la machine (specification 6.7).
/// L'interface s'en sert pour signaler d'avance un script qui exige
/// PowerShell 7 alors qu'il n'est pas installe.
#[tauri::command]
fn engines() -> runner::Engines {
    runner::engines()
}

/// Sentinelle renvoyee par `run_script` quand le script n'est pas approuve
/// (specification 12.1) : distincte des erreurs ordinaires pour que le
/// frontend sache proposer la fenetre de confiance plutot qu'un message
/// d'erreur generique.
const NON_APPROUVE: &str = "NON_APPROUVE";

/// Vrai si ce script peut s'executer sans passer par l'ecran de confiance.
/// Un script du catalogue officiel l'est implicitement **si son empreinte est
/// celle que declare l'index signe** (§16.4) : c'est la signature qui fonde la
/// confiance, pas le dossier, inscriptible. Tout le reste doit figurer dans le
/// magasin par son hash exact (§12.1) : toute modification du fichier change
/// le hash et invalide l'approbation.
fn script_approuve(entree: &discovery::ScriptEntry) -> Result<bool, String> {
    if entree.origin == "official" && entree.verified {
        return Ok(true);
    }
    let store = approval::load()?;
    Ok(approval::is_approved(&store, &entree.hash))
}

/// Relance WinTool avec les droits administrateur, puis ferme l'instance
/// courante.
///
/// Passe par `Start-Process -Verb RunAs`, qui declenche l'invite UAC standard.
/// Le chemin de l'executable voyage par une variable d'environnement et non
/// dans le texte de la commande : aucun caractere du chemin ne peut en changer
/// le sens (meme regle que pour `WINTOOL_CONFIG` et l'analyse de syntaxe).
#[tauri::command]
fn relaunch_elevated(app: tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("executable introuvable : {e}"))?;
    let moteurs = runner::engines();
    let shell = moteurs
        .winps
        .or(moteurs.pwsh)
        .ok_or("aucun interpreteur PowerShell pour relancer")?;

    let mut commande = std::process::Command::new(shell);
    commande
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Process -FilePath $env:WINTOOL_EXE -Verb RunAs",
        ])
        .env("WINTOOL_EXE", &exe)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        commande.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    commande
        .spawn()
        .map_err(|e| format!("relance impossible : {e}"))?;

    // On ne ferme pas immediatement : si l'utilisateur refuse l'invite UAC,
    // il doit retrouver l'application telle qu'il l'a laissee. La fermeture
    // est declenchee par l'interface une fois la nouvelle fenetre apparue.
    let _ = app;
    Ok(())
}

/// Etat de l'interrupteur general de simulation, deduit des scripts (§6.9).
#[tauri::command]
fn simulation_state(app: tauri::AppHandle) -> Result<simulation::Bilan, String> {
    let decouverte = discovery::discover(&app)?;
    let reglages = settings::load(&app)?;
    Ok(simulation::bilan(
        &reglages,
        decouverte.scripts.iter().map(|s| (s.id.as_str(), &s.meta)),
    ))
}

/// L'interrupteur general : regle la simulation de tous les scripts qui savent
/// se simuler. Chacun se regle ensuite a nouveau un par un, comme n'importe
/// quelle option, par `set_script_config`.
#[tauri::command]
fn set_simulation_all(app: tauri::AppHandle, value: bool) -> Result<Settings, String> {
    let decouverte = discovery::discover(&app)?;
    with_settings(&app, |s| {
        simulation::tout_regler(
            s,
            decouverte.scripts.iter().map(|e| (e.id.as_str(), &e.meta)),
            value,
        );
        Ok(())
    })
}

/// Sentinelle : la simulation est activee et ce script ne sait pas se simuler,
/// il n'a pas ete lance. Distincte d'une erreur ordinaire pour que l'interface
/// puisse l'expliquer plutot que d'afficher un message technique.
const SANS_SIMULATION: &str = "SANS_SIMULATION";

/// Sentinelle : on demande l'analyse d'un script qui ne se declare pas
/// analysable (`scan : true`, §17).
const SANS_ANALYSE: &str = "SANS_ANALYSE";

/// Analyse un script (§17) : WinTool lui demande ce qu'il ferait, avec
/// `WINTOOL_MODE=scan`. Rend la main immediatement ; la suite arrive par
/// `script:line`, puis `script:analysis` et `script:end`.
///
/// Analyser, c'est executer (§17.4) : l'approbation et la garde des reglages
/// s'appliquent exactement comme pour l'action. Que l'analyse ne modifie rien
/// est une promesse de l'auteur, que WinTool ne peut pas verifier.
#[tauri::command]
fn scan_script(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<runner::Runner>>,
    memoire: tauri::State<'_, Arc<analyse::Memoire>>,
    mut req: runner::RunRequest,
) -> Result<runner::RunStarted, String> {
    let decouverte = discovery::discover(&app)?;
    let entree = decouverte
        .scripts
        .iter()
        .find(|s| s.id == req.script_id)
        .cloned()
        .ok_or_else(|| format!("Script introuvable : {}", req.script_id))?;
    if !entree.meta.scan {
        return Err(SANS_ANALYSE.to_string());
    }
    if !script_approuve(&entree)? {
        return Err(NON_APPROUVE.to_string());
    }
    // Une liste [items] n'existe qu'apres l'analyse : rien a lui transmettre.
    req.config.retain(|cle, _| {
        entree
            .meta
            .options
            .iter()
            .any(|o| &o.key == cle && o.kind != "items")
    });
    let zones = zones_protegees(&app)?;
    let e = systeme::emplacements();
    req.config = garde::verifier_config(&entree.meta, &req.config, &zones, e, &e.system32())
        .map_err(|r| r.message())?;
    runner::run_analysis(
        &app,
        state.inner().clone(),
        req,
        entree,
        memoire.inner().clone(),
    )
}

/// Lance un script. Rend la main immediatement : la suite arrive par les
/// evenements `script:line` puis `script:end`.
#[tauri::command]
fn run_script(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<runner::Runner>>,
    memoire: tauri::State<'_, Arc<analyse::Memoire>>,
    mut req: runner::RunRequest,
) -> Result<runner::RunStarted, String> {
    // La seule exception au principe "constater, jamais bloquer" (§5.4,
    // §12.1) : ici, refuser est le comportement voulu, pas un defaut a
    // corriger. On retrouve l'origine par une nouvelle decouverte plutot que
    // de faire porter ce champ par `RunRequest`, pour ne pas avoir a faire
    // confiance a ce que le frontend affirme sur un script qu'il ne controle
    // pas.
    //
    // Une seule decouverte, et c'est l'entree qu'elle a approuvee qui part au
    // moteur, avec son empreinte : le moteur verrouille le fichier et refuse
    // tout contenu different. Avant la 1.2, le moteur refaisait sa propre
    // decouverte : deux substitutions rapides du fichier, l'une avant
    // l'approbation, l'autre avant la seconde decouverte, faisaient executer
    // un contenu que personne n'avait approuve.
    let decouverte = discovery::discover(&app)?;
    let entree = decouverte
        .scripts
        .iter()
        .find(|s| s.id == req.script_id)
        .cloned()
        .ok_or_else(|| format!("Script introuvable : {}", req.script_id))?;
    let mut simule = false;
    if !script_approuve(&entree)? {
        return Err(NON_APPROUVE.to_string());
    }

    // Garde des reglages (§12.4) : ils viennent de settings.json, que tout
    // programme sous le compte de l'utilisateur peut reecrire, et partent a un
    // script eleve. Chaque valeur doit avoir le type que le script declare, et
    // aucun texte libre ne doit viser un emplacement protege. C'est un refus,
    // pas un constat : il s'agit d'execution avec les droits administrateur.
    let reglages = settings::load(&app)?;
    let zones = zones_protegees(&app)?;
    let e = systeme::emplacements();
    req.config = garde::verifier_config(&entree.meta, &req.config, &zones, e, &e.system32())
        .map_err(|r| r.message())?;

    // Une selection [items] (§17) : des ids que le script interpretera lui-meme
    // — un chemin, une application. Seuls ceux que sa derniere analyse, sur ce
    // contenu exact du fichier, a annonces lui sont renvoyes : un id fabrique
    // ailleurs que par l'analyse n'atteint jamais un script eleve.
    for o in entree.meta.options.iter().filter(|o| o.kind == "items") {
        if let Some(v) = req.config.get(&o.key) {
            let ids: Vec<String> = v
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            memoire.verifier(&entree.id, &entree.hash, &o.key, &ids)?;
        }
    }

    // Simulation (§6.9). Ce sont les reglages enregistres qui decident, pas
    // la configuration envoyee par l'interface : la valeur de `SafeTest`
    // est imposee ici, si bien que ce qui s'execute est toujours ce que les
    // reglages annoncent.
    //
    // **Simulation activee, script sans `SafeTest` : refus.** Lui injecter
    // une cle qu'il n'utilise pas ajouterait une entree inerte a sa table,
    // et il modifierait la machine pendant que l'interface annonce une
    // simulation. Un refus visible vaut mieux qu'une garantie fausse
    // (§12.2 : ne jamais laisser croire a une protection absente).
    let general = simulation::bilan(
        &reglages,
        decouverte.scripts.iter().map(|s| (s.id.as_str(), &s.meta)),
    );
    match simulation::decision(&reglages, &entree.id, &entree.meta, &general) {
        simulation::Decision::Refuser => return Err(SANS_SIMULATION.to_string()),
        simulation::Decision::Simuler => {
            req.config
                .insert(simulation::CLE.to_string(), serde_json::Value::Bool(true));
            simule = true;
        }
        simulation::Decision::Reel => {
            if simulation::simulable(&entree.meta) {
                req.config
                    .insert(simulation::CLE.to_string(), serde_json::Value::Bool(false));
            }
        }
    }

    // Un `Arc` plutot qu'un etat emprunte : le fil qui attend la fin du
    // processus doit pouvoir liberer l'emplacement bien apres le retour de
    // cette commande.
    let mut demarre = runner::run_script(&app, state.inner().clone(), req, entree)?;
    demarre.simulated = simule;
    Ok(demarre)
}

/// Le contenu et le hash affiches a l'ecran de confiance viennent de la
/// meme lecture, sous le meme verrou de partage — jamais une lecture separee
/// qui laisserait une fenetre de substitution entre "ce qui est montre" et
/// "ce qui est approuve" (specification 12.4, regle de lecture unique).
#[derive(Serialize)]
struct ApprobationRequise {
    hash: String,
    source: String,
    attention: Vec<security::PointAttention>,
}

/// Ce qu'il faut montrer a l'utilisateur pour approuver ce script (contenu,
/// hash, points d'attention), ou `None` s'il n'a pas besoin d'approbation.
#[tauri::command]
fn preparer_approbation(
    app: tauri::AppHandle,
    script_id: String,
) -> Result<Option<ApprobationRequise>, String> {
    let decouverte = discovery::discover(&app)?;
    let Some(entree) = decouverte.scripts.iter().find(|s| s.id == script_id) else {
        return Ok(None);
    };
    if script_approuve(entree)? {
        return Ok(None);
    }

    // Une seule lecture pour le hash affiche et le contenu affiche (§12.4) :
    // les recalculer tous les deux depuis les memes octets ferme la fenetre
    // ou l'un montrerait autre chose que ce dont l'autre repond.
    let octets = std::fs::read(&entree.abs_path)
        .map_err(|e| format!("lecture de {} : {e}", entree.abs_path))?;
    let texte = String::from_utf8_lossy(&octets);
    let texte = texte.strip_prefix('\u{feff}').unwrap_or(&texte);

    Ok(Some(ApprobationRequise {
        hash: discovery::sha256_hex(&octets),
        attention: security::detecter(texte),
        source: texte.to_string(),
    }))
}

/// Approuve un script par son hash exact (specification 12.1). Toute
/// modification ulterieure du fichier change le hash et invalide cette
/// approbation d'elle-meme, sans rien a faire ici.
#[tauri::command]
fn approve_script(hash: String) -> Result<(), String> {
    // Le magasin ne vaut que par les droits du dossier qui l'abrite. Depuis
    // que l'application s'ouvre sans elevation (manifeste asInvoker), un
    // premier lancement non eleve CREERAIT `%ProgramData%\WinTool\` avec des
    // droits d'ecriture pour l'utilisateur — et n'importe quel programme
    // tournant sous son compte pourrait alors y inscrire sa propre empreinte
    // pour se declarer approuve. Le magasin deviendrait decoratif, ce que le
    // §12.4 dit explicitement vouloir eviter.
    //
    // On refuse donc d'ecrire sans droits, plutot que de creer un magasin qui
    // ne protege rien. Approuver un script est une decision de securite : la
    // demander en administrateur est coherent.
    if !is_elevated() {
        return Err(APPROBATION_SANS_DROITS.to_string());
    }
    approval::enregistrer(&hash)
}

/// Les emplacements proteges : la liste integree, moins ce que l'utilisateur
/// en a retire, plus ce qu'il y a ajoute (`garde`, lue dans HKLM).
fn zones_protegees<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<garde::Zones, String> {
    let profil = app
        .path()
        .home_dir()
        .map_err(|e| format!("profil introuvable : {e}"))?;
    let installation = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    Ok(garde::Zones::nouvelles(
        systeme::emplacements(),
        &profil,
        installation.as_deref(),
        &garde::charger(),
    ))
}

#[derive(Serialize)]
struct EmplacementsProteges {
    integres: Vec<garde::Integre>,
    retires: Vec<String>,
    ajouts: Vec<String>,
    /// Faux sans droits administrateur : la liste se lit, elle ne se modifie
    /// pas (elle vit dans HKLM).
    modifiable: bool,
    /// Le lecteur du systeme (`C:`), le profil de l'utilisateur et le profil
    /// public : le plan du disque des Reglages les montre comme autorises.
    lecteur: String,
    profil: Option<String>,
    public: String,
}

/// Les emplacements proteges, pour les Reglages.
#[tauri::command]
fn protected_paths(app: tauri::AppHandle) -> EmplacementsProteges {
    let installation = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let config = garde::charger();
    let e = systeme::emplacements();
    EmplacementsProteges {
        integres: garde::integres(e, installation.as_deref()),
        retires: config.retires,
        ajouts: config.ajouts,
        modifiable: is_elevated(),
        lecteur: e.lecteur.clone(),
        profil: app.path().home_dir().ok().map(|p| p.display().to_string()),
        public: e.public.display().to_string(),
    }
}

/// Sentinelle : modifier la liste demande les droits administrateur.
const GARDE_SANS_DROITS: &str = "GARDE_SANS_DROITS";

/// Remplace les changements de l'utilisateur a la liste : emplacements integres
/// retires, emplacements ajoutes. En administrateur seulement, comme toute
/// ecriture dans HKLM — et c'est le but : un programme sans droits ne doit pas
/// pouvoir retirer un emplacement a la place de l'utilisateur.
#[tauri::command]
fn set_protected_paths(retires: Vec<String>, ajouts: Vec<String>) -> Result<(), String> {
    if !is_elevated() {
        return Err(GARDE_SANS_DROITS.to_string());
    }
    let mut config = garde::ConfigGarde::default();
    for r in retires {
        if !garde::IDS_INTEGRES.contains(&r.as_str()) {
            return Err(format!("emplacement integre inconnu : {r}"));
        }
        if !config.retires.contains(&r) {
            config.retires.push(r);
        }
    }
    for p in ajouts.iter().map(|p| p.trim().trim_matches('"').trim()) {
        if p.is_empty() {
            continue;
        }
        if !garde::absolu(p) {
            return Err(format!("CHEMIN_NON_ABSOLU:{p}"));
        }
        if !config.ajouts.iter().any(|x| x.eq_ignore_ascii_case(p)) {
            config.ajouts.push(p.to_string());
        }
    }
    garde::enregistrer(&config)
}

/// Sentinelle : approbation impossible faute de droits administrateur.
/// L'interface la remplace par une phrase et propose la relance elevee.
const APPROBATION_SANS_DROITS: &str = "APPROBATION_SANS_DROITS";

/// Deuxieme clic sur « Arreter » (specification 6.3). Sans `force`, refuse
/// d'interrompre un script qui s'est declare non interruptible et renvoie
/// `needs_confirmation`.
#[tauri::command]
fn cancel_script(
    state: tauri::State<'_, Arc<runner::Runner>>,
    run_id: String,
    force: bool,
) -> Result<runner::CancelOutcome, String> {
    runner::cancel_script(state.inner(), &run_id, force)
}

/// Ce qui tourne en ce moment, ou rien.
#[tauri::command]
fn run_status(state: tauri::State<'_, Arc<runner::Runner>>) -> Option<runner::Snapshot> {
    state.snapshot()
}

/// Ouvre un journal technique dans l'application associee.
/// Le chemin est verifie : seul un fichier du dossier des journaux est accepte.
#[tauri::command]
fn open_log(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let verifie = runner::verifier_log(&app, &path)?;
    ouvrir_dans_l_explorateur(verifie)
}

/// Ouvre le dossier des scripts de l'utilisateur.
///
/// Passe par Rust et non par le greffon `opener` cote interface : `openPath`
/// exige la permission `opener:allow-open-path`, absente de `opener:default`
/// parce qu'elle autoriserait la page a faire ouvrir n'importe quel fichier.
/// Ici c'est Rust qui choisit le dossier ; l'interface ne fournit aucun chemin,
/// il n'y a donc rien a detourner ni de permission large a accorder.
#[tauri::command]
fn open_scripts_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dossier = discovery::scripts_root(&app)?;
    std::fs::create_dir_all(&dossier).map_err(|e| format!("{} : {e}", dossier.display()))?;
    ouvrir_dans_l_explorateur(dossier)
}

/// Remet un chemin en forme courte avant de le confier au shell.
///
/// `canonicalize` renvoie un chemin prefixe long ; ShellExecute ne sait pas
/// toujours l'ouvrir. Meme cause que le refus de PowerShell sous RemoteSigned
/// (voir `discovery::sans_prefixe_long`).
fn ouvrir_dans_l_explorateur(chemin: std::path::PathBuf) -> Result<(), String> {
    let texte = chemin.to_string_lossy();
    let prefixe_unc = r"\\\\?\UNC\";
    let prefixe = r"\\\\?\";
    let court = if let Some(reste) = texte.strip_prefix(prefixe_unc) {
        format!(r"\\{reste}")
    } else if let Some(reste) = texte.strip_prefix(prefixe) {
        reste.to_string()
    } else {
        texte.to_string()
    };
    tauri_plugin_opener::open_path(court, None::<String>).map_err(|e| e.to_string())
}

/// Ce qu'une verification rapporte : la relecture du contrat ET l'analyse
/// syntaxique, cote a cote. Les deux repondent a des questions differentes —
/// « le fichier respecte-t-il nos conventions » et « PowerShell sait-il le
/// lire » — et un script peut echouer a l'une en reussissant l'autre.
#[derive(Serialize)]
struct VerificationResult {
    script_id: String,
    hash: String,
    findings: Vec<contract::Finding>,
    syntax: runner::CheckResult,
}

/// Ré-analyse un script et verifie sa syntaxe **sans l'executer** (§5.5, §6.8).
#[tauri::command]
fn check_script(app: tauri::AppHandle, script_id: String) -> Result<VerificationResult, String> {
    let decouverte = discovery::discover(&app)?;
    let entree = decouverte
        .scripts
        .into_iter()
        .find(|s| s.id == script_id)
        .ok_or_else(|| format!("Script introuvable : {script_id}"))?;

    let syntax = runner::verifier_syntaxe(std::path::Path::new(&entree.abs_path))?;
    Ok(VerificationResult {
        script_id: entree.id,
        hash: entree.hash,
        findings: entree.meta.findings,
        syntax,
    })
}

/// Historique (specification §9/§14) : une entree par script execute et une
/// par lot lance. L'horodatage vient du serveur, pas du client — le
/// frontend fournit les faits constates, jamais l'heure.
// Les arguments sont ceux que l'interface envoie, un par fait constate : les
// regrouper dans une structure changerait la forme de l'appel IPC sans rien
// rendre plus sur.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn record_script_run(
    app: tauri::AppHandle,
    script_id: String,
    title: String,
    success: bool,
    killed: bool,
    duration_ms: u64,
    // `Option` : un appel qui l'omettrait reste valide, et vaut « reel ».
    simulated: Option<bool>,
    // Ce que le script a annonce par `[FREED]`, s'il l'a fait (§17).
    freed: Option<u64>,
) -> Result<(), String> {
    history::record_script_run(
        &app,
        history::ScriptRunRecord {
            script_id,
            title,
            success,
            killed,
            duration_ms,
            simulated: simulated.unwrap_or(false),
            freed,
            at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        },
    )
}

#[tauri::command]
fn record_lot_run(
    app: tauri::AppHandle,
    lot_id: String,
    lot_name: String,
    script_ids: Vec<String>,
) -> Result<(), String> {
    history::record_lot_run(
        &app,
        history::LotRunRecord {
            lot_id,
            lot_name,
            script_ids,
            at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        },
    )
}

#[tauri::command]
fn get_history(app: tauri::AppHandle) -> Result<history::History, String> {
    history::load(&app)
}

/// A appeler apres un run : applique le plafond de taille des journaux
/// (§9) selon le reglage actuel. Separe de `record_script_run` pour que
/// l'echec de l'un n'empeche jamais l'autre (constater, jamais bloquer).
#[tauri::command]
fn enforce_log_cap(app: tauri::AppHandle) -> Result<(), String> {
    let reglages = settings::load(&app)?;
    runner::appliquer_plafond_journaux(&app, reglages.log_cap_mb)
}

/// Point de restauration avant le lancement d'un lot (specification §6.4).
/// C'est l'app qui decide de le creer (le frontend sait deja, via
/// `reversible` sur chaque script, si le lot en a besoin) ; cette
/// commande ne fait qu'executer l'operation Windows et rapporter ce qui s'est
/// reellement passe.
#[tauri::command]
fn create_restore_point(description: String) -> Result<restore::RestoreOutcome, String> {
    restore::creer_point_de_restauration(&description)
}

/// Charge les reglages, laisse `f` les modifier, sauvegarde, renvoie le resultat.
/// Chaque commande recharge depuis le disque plutot que de partager un etat en
/// memoire : le fichier est petit, les appels IPC sont sequentiels cote JS, et
/// ca evite un Mutex<Settings> pour un gain de perf qu'aucun usage ne demande
/// encore (§4.1/§4.2 : ces reglages sont des donnees utilisateur, pas un cache).
fn with_settings<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    f: impl FnOnce(&mut Settings) -> Result<(), String>,
) -> Result<Settings, String> {
    let mut s = settings::load(app)?;
    f(&mut s)?;
    settings::save(app, &s)?;
    Ok(s)
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    settings::load(&app)
}

/// Nouveau lot utilisateur (§4.1) : un seul nom, dans la langue actuelle de
/// l'interface — pas de traduction automatique, contrairement aux lots d'usine.
#[tauri::command]
fn create_lot(app: tauri::AppHandle, name: String, icon: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        let lang = s.lang.clone();
        let id = format!(
            "user-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_millis()
        );
        s.lots.push(Lot {
            id,
            name: std::collections::BTreeMap::from([(lang, name)]),
            description: String::new(),
            icon,
            pinned: false,
            scripts: Vec::new(),
            factory_aliases: Vec::new(),
            aggregate: false,
        });
        Ok(())
    })
}

/// Renomme un lot dans la langue actuelle. Un lot d'usine perd alors sa traduction
/// dans l'autre langue : un nom tape a la main ne se traduit pas tout seul (meme
/// regle que pour un lot cree par l'utilisateur, §10).
#[tauri::command]
fn rename_lot(app: tauri::AppHandle, id: String, name: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        let lang = s.lang.clone();
        let cat = s
            .lots
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| format!("lot introuvable : {id}"))?;
        cat.name = std::collections::BTreeMap::from([(lang, name)]);
        Ok(())
    })
}

/// Reordonne la liste des lots (glisser-deposer en mode Expert). Les ids absents
/// de `order` gardent leur position relative a la fin, par tolerance envers un appel
/// fait a partir d'une liste legerement perimee cote frontend.
#[tauri::command]
fn reorder_lots(app: tauri::AppHandle, order: Vec<String>) -> Result<Settings, String> {
    with_settings(&app, |s| {
        let mut reste: Vec<Lot> = std::mem::take(&mut s.lots);
        let mut classees = Vec::with_capacity(reste.len());
        for id in &order {
            if let Some(pos) = reste.iter().position(|c| &c.id == id) {
                classees.push(reste.remove(pos));
            }
        }
        classees.append(&mut reste);
        s.lots = classees;
        Ok(())
    })
}

/// Supprime un lot sans jamais supprimer de fichier de script (§14, hypothese
/// retenue). Les scripts qui le referencaient retombent en "Non classe" a la
/// prochaine resolution, sans bookkeeping supplementaire a faire ici.
#[tauri::command]
fn delete_lot(app: tauri::AppHandle, id: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.lots.retain(|c| c.id != id);
        Ok(())
    })
}

/// Rangement manuel d'un script dans un lot (§4.2/§5.1) : fige definitivement ce
/// rangement, plus aucune Re-analyse ni changement de `category:` ne le deplacera.
#[tauri::command]
fn assign_script_lot(
    app: tauri::AppHandle,
    script_id: String,
    lot_id: String,
) -> Result<Settings, String> {
    with_settings(&app, |s| {
        let over = s.overrides.entry(script_id).or_default();
        // Rangement exclusif : remplace toute la liste. Conserve pour les
        // appelants qui veulent « deplacer » plutot que « cocher ».
        over.lots = Some(if lot_id == settings::NON_CLASSE {
            Vec::new()
        } else {
            vec![lot_id]
        });
        over.lot_locked = None;
        Ok(())
    })
}

/// Coche ou decoche un script dans un lot (§4.1) sans toucher a ses
/// autres appartenances. C'est ce qu'appelle la liste a bascule du mode Expert.
#[tauri::command]
fn set_lot_script(
    app: tauri::AppHandle,
    lot_id: String,
    script_id: String,
    member: bool,
) -> Result<Settings, String> {
    // La suggestion d'entete du script est necessaire pour amorcer la liste a
    // la premiere modification : on la relit a la source plutot que de la faire
    // affirmer par le frontend.
    let decouverte = discovery::discover(&app)?;
    let declaree = decouverte
        .scripts
        .iter()
        .find(|s| s.id == script_id)
        .map(|s| s.meta.category.clone())
        .unwrap_or_default();

    with_settings(&app, |s| {
        settings::set_script_lot_membership(s, &script_id, &declaree, &lot_id, member);
        Ok(())
    })
}

/// Valeur de `$CONFIG` figee par l'utilisateur (§4.2). `value` absent efface
/// l'override et rend le reglage au script — c'est le bouton « revenir au
/// defaut du script », pas un effet de bord.
#[tauri::command]
fn set_script_config(
    app: tauri::AppHandle,
    script_id: String,
    key: String,
    value: Option<serde_json::Value>,
) -> Result<Settings, String> {
    with_settings(&app, |s| {
        settings::set_config_value(s, &script_id, &key, value);
        Ok(())
    })
}

/// L'un des trois booleens WinTool de la §4.2 — `flag` vaut `restore`, `reboot`
/// ou `enabled`. `value` absent rend le reglage a sa valeur initiale.
#[tauri::command]
fn set_script_flag(
    app: tauri::AppHandle,
    script_id: String,
    flag: String,
    value: Option<bool>,
) -> Result<Settings, String> {
    with_settings(&app, |s| settings::set_flag(s, &script_id, &flag, value))
}

/// Rend au script toutes ses valeurs de `$CONFIG` et ses trois booleens (§4.2).
/// Le rangement dans les lots survit : c'est une autre decision.
#[tauri::command]
fn reset_script_config(app: tauri::AppHandle, script_id: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        settings::reset_script_config(s, &script_id);
        Ok(())
    })
}

#[tauri::command]
fn set_theme(app: tauri::AppHandle, theme: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.theme = theme;
        Ok(())
    })
}

#[tauri::command]
fn set_lang(app: tauri::AppHandle, lang: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.lang = lang;
        Ok(())
    })
}

/// Code d'erreur traduit par l'interface : installer pendant une execution.
const MAJ_PENDANT_EXECUTION: &str = "MAJ_PENDANT_EXECUTION";

/// Interroge la derniere release publiee. `None` : a jour.
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<update::Disponible>, String> {
    update::verifier(&app).await
}

/// Telecharge, verifie la signature, installe. Refuse pendant une execution :
/// sous Windows l'installeur ferme l'application, et avec elle le script en
/// cours, au milieu de ce qu'il faisait. Un lot qui enchaine ses scripts est
/// garde cote interface, qui voit l'enchainement ; ici on garde le script.
#[tauri::command]
async fn install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<runner::Runner>>,
) -> Result<(), String> {
    if state.snapshot().is_some() {
        return Err(MAJ_PENDANT_EXECUTION.to_string());
    }
    update::installer(&app).await
}

#[tauri::command]
fn set_update_policy(app: tauri::AppHandle, policy: String) -> Result<Settings, String> {
    if !update::politique_valide(&policy) {
        return Err(format!("politique de mise a jour inconnue : {policy}"));
    }
    with_settings(&app, |s| {
        s.update_policy = policy;
        Ok(())
    })
}

/// Code d'erreur traduit par l'interface : toucher au catalogue pendant une
/// execution. Le script en cours est verrouille en ecriture (§12.4), son
/// remplacement echouerait de toute facon — on le dit avant d'essayer.
const CATALOGUE_PENDANT_EXECUTION: &str = "CATALOGUE_PENDANT_EXECUTION";

/// Les scripts qu'on a decoches dans la page d'une source.
fn exclus_de(reglages: &Settings, id: &str) -> HashSet<String> {
    reglages
        .sources_exclus
        .get(id)
        .map(|v| v.iter().cloned().collect())
        .unwrap_or_default()
}

/// Codes d'erreur des sources, traduits par l'interface.
const SOURCES_SANS_DROITS: &str = "SOURCES_SANS_DROITS";
const SOURCE_INCONNUE: &str = "SOURCE_INCONNUE";
const SOURCE_EXISTE: &str = "SOURCE_EXISTE";
const SOURCE_NOM: &str = "SOURCE_NOM";
const SOURCE_AUTRE_ID: &str = "SOURCE_AUTRE_ID";

fn source_connue(id: &str) -> Result<sources::Source, String> {
    sources::trouver(id).ok_or_else(|| format!("{SOURCE_INCONNUE}: {id}"))
}

/// Etat du catalogue officiel installe (§16) : version, nombre de scripts, et
/// ce qui ne va pas s'il y a lieu.
#[tauri::command]
fn catalogue_state(app: tauri::AppHandle) -> Result<catalogue::Etat, String> {
    catalogue::etat(&app, &sources::officielle())
}

/// Interroge le catalogue officiel et dit ce qu'une installation changerait.
/// Ne telecharge que l'index signe ; aucun script, rien d'ecrit.
#[tauri::command]
async fn check_catalogue(app: tauri::AppHandle) -> Result<catalogue::Bilan, String> {
    check_source(app, catalogue::SOURCE.to_string()).await
}

/// Installe ou met a jour le catalogue officiel.
#[tauri::command]
async fn install_catalogue(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<runner::Runner>>,
) -> Result<catalogue::Installation, String> {
    install_source(app, state, catalogue::SOURCE.to_string()).await
}

/// Une source, telle que la page des catalogues la montre.
#[derive(Serialize)]
struct EtatSource {
    id: String,
    nom: String,
    depot: String,
    /// La cle publique, pour la modifier ; vide pour l'officielle. Pas `cle` :
    /// `catalogue::Etat`, aplati a cote, porte deja un `cle` (une cle est-elle
    /// presente).
    cle_publique: String,
    officielle: bool,
    active: bool,
    /// Nombre de scripts decoches.
    exclus: usize,
    #[serde(flatten)]
    etat: catalogue::Etat,
}

#[derive(Serialize)]
struct EtatSources {
    sources: Vec<EtatSource>,
    /// Entrees du registre ignorees, illisibles ou trafiquees.
    problemes: Vec<String>,
    /// Ajouter, modifier ou retirer une source demande les droits
    /// administrateur : la liste vit dans HKLM (§16.2).
    modifiable: bool,
}

/// Toutes les sources, l'officielle en tete (§16.2, §16.6).
#[tauri::command]
fn sources_state(app: tauri::AppHandle) -> Result<EtatSources, String> {
    let reglages = settings::load(&app)?;
    let (liste, problemes) = sources::toutes();
    let mut etats = Vec::with_capacity(liste.len());
    for source in liste {
        let etat = catalogue::etat(&app, &source)?;
        etats.push(EtatSource {
            active: !reglages.sources_inactives.contains(&source.id),
            exclus: reglages.sources_exclus.get(&source.id).map_or(0, Vec::len),
            cle_publique: if source.officielle {
                String::new()
            } else {
                source.cle.clone()
            },
            id: source.id,
            nom: source.nom,
            depot: source.depot,
            officielle: source.officielle,
            etat,
        });
    }
    Ok(EtatSources {
        sources: etats,
        problemes,
        modifiable: is_elevated(),
    })
}

/// Ce qu'une installation de cette source changerait. Ne telecharge que
/// l'index signe ; aucun script, rien d'ecrit.
#[tauri::command]
async fn check_source(app: tauri::AppHandle, id: String) -> Result<catalogue::Bilan, String> {
    let source = source_connue(&id)?;
    let exclus = exclus_de(&settings::load(&app)?, &id);
    catalogue::examiner(&app, &source, &exclus).await
}

/// Installe ou met a jour une source, sans les scripts decoches. Installer le
/// catalogue officiel, c'est aussi le choisir : le reglage suit.
#[tauri::command]
async fn install_source(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<runner::Runner>>,
    id: String,
) -> Result<catalogue::Installation, String> {
    if state.snapshot().is_some() {
        return Err(CATALOGUE_PENDANT_EXECUTION.to_string());
    }
    let source = source_connue(&id)?;
    let exclus = exclus_de(&settings::load(&app)?, &id);
    let fait = catalogue::installer(&app, &source, &exclus).await?;
    if source.officielle {
        with_settings(&app, |s| {
            s.catalogue_source = "official".to_string();
            Ok(())
        })?;
    }
    Ok(fait)
}

/// Le contenu de la derniere release d'une source, script par script, avec
/// son etat sur ce PC — pour la page « Consulter et choisir ». Rien d'ecrit.
#[tauri::command]
async fn source_contents(
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<catalogue::Contenu>, String> {
    let source = source_connue(&id)?;
    let exclus = exclus_de(&settings::load(&app)?, &id);
    catalogue::contenu(&app, &source, &exclus).await
}

/// Retient les scripts decoches d'une source. N'installe rien : c'est
/// `install_source` qui telecharge ce qui est coche.
#[tauri::command]
fn set_source_selection(
    app: tauri::AppHandle,
    id: String,
    exclus: Vec<String>,
) -> Result<Settings, String> {
    source_connue(&id)?;
    if exclus.len() > 1000 || exclus.iter().any(|e| e.is_empty() || e.len() > 100) {
        return Err("selection refusee".to_string());
    }
    with_settings(&app, |s| {
        if exclus.is_empty() {
            s.sources_exclus.remove(&id);
        } else {
            s.sources_exclus.insert(id, exclus);
        }
        Ok(())
    })
}

/// Active ou desactive une source : desactivee, elle n'est plus interrogee et
/// ses scripts n'apparaissent plus (ils restent sur le disque).
#[tauri::command]
fn set_source_active(app: tauri::AppHandle, id: String, active: bool) -> Result<Settings, String> {
    source_connue(&id)?;
    with_settings(&app, |s| {
        s.sources_inactives.retain(|i| *i != id);
        if !active {
            s.sources_inactives.push(id);
        }
        Ok(())
    })
}

/// Le nom donne a une source, ou celui de son depot s'il est vide.
fn nom_de_source(nom: &str, depot: &str) -> Result<String, String> {
    let nom = nom.trim();
    let nom = if nom.is_empty() {
        depot.rsplit('/').next().unwrap_or(depot)
    } else {
        nom
    };
    if !sources::nom_sur(nom) {
        return Err(format!("{SOURCE_NOM}: {nom}"));
    }
    Ok(nom.to_string())
}

/// Ajoute une source tierce : un depot GitHub et la cle publique de son
/// editeur. L'index est telecharge et verifie avec cette cle **avant**
/// l'inscription : une source qui ne se verifie pas n'est jamais ajoutee. C'est
/// son index qui donne l'identifiant de la source. Administrateur seulement.
#[tauri::command]
async fn add_source(depot: String, cle: String, nom: String) -> Result<String, String> {
    if !is_elevated() {
        return Err(SOURCES_SANS_DROITS.to_string());
    }
    let depot = catalogue::normaliser_depot(&depot)?;
    let cle = cle.trim().to_string();
    catalogue::decoder_cle(&cle)?;
    let index = catalogue::decouvrir(&depot, &cle).await?;
    let (connues, _) = sources::toutes();
    if connues.iter().any(|s| s.id == index.source) {
        return Err(format!("{SOURCE_EXISTE}: {}", index.source));
    }
    let source = sources::Source {
        id: index.source,
        nom: nom_de_source(&nom, &depot)?,
        depot,
        cle,
        officielle: false,
    };
    sources::enregistrer(&source)?;
    Ok(source.id)
}

/// Modifie une source tierce. Changer de depot ou de cle, c'est changer
/// d'editeur : le nouvel index doit se verifier, et declarer la meme source.
#[tauri::command]
async fn update_source(id: String, nom: String, depot: String, cle: String) -> Result<(), String> {
    if !is_elevated() {
        return Err(SOURCES_SANS_DROITS.to_string());
    }
    let actuelle = source_connue(&id)?;
    if actuelle.officielle {
        return Err(format!("{SOURCE_INCONNUE}: {id}"));
    }
    let depot = catalogue::normaliser_depot(&depot)?;
    let cle = cle.trim().to_string();
    if depot != actuelle.depot || cle != actuelle.cle {
        catalogue::decoder_cle(&cle)?;
        let index = catalogue::decouvrir(&depot, &cle).await?;
        if index.source != id {
            return Err(format!("{SOURCE_AUTRE_ID}: {}", index.source));
        }
    }
    sources::enregistrer(&sources::Source {
        nom: nom_de_source(&nom, &depot)?,
        id,
        depot,
        cle,
        officielle: false,
    })
}

/// Retire une source tierce. Ses scripts restent sur le disque — WinTool ne
/// supprime jamais un script — mais n'apparaissent plus.
#[tauri::command]
fn remove_source(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !is_elevated() {
        return Err(SOURCES_SANS_DROITS.to_string());
    }
    if source_connue(&id)?.officielle {
        return Err(format!("{SOURCE_INCONNUE}: {id}"));
    }
    sources::retirer(&id)?;
    with_settings(&app, |s| {
        s.sources_inactives.retain(|i| *i != id);
        s.sources_exclus.remove(&id);
        Ok(())
    })
    .map(|_| ())
}

#[tauri::command]
fn set_catalogue_source(app: tauri::AppHandle, source: String) -> Result<Settings, String> {
    if !settings::SOURCES_CATALOGUE.contains(&source.as_str()) {
        return Err(format!("source de catalogue inconnue : {source}"));
    }
    with_settings(&app, |s| {
        s.catalogue_source = source;
        Ok(())
    })
}

#[tauri::command]
fn set_catalogue_check(app: tauri::AppHandle, policy: String) -> Result<Settings, String> {
    if !settings::VERIFICATIONS_CATALOGUE.contains(&policy.as_str()) {
        return Err(format!("verification de catalogue inconnue : {policy}"));
    }
    with_settings(&app, |s| {
        s.catalogue_check = policy;
        Ok(())
    })
}

#[tauri::command]
fn hide_catalogue_reminder(app: tauri::AppHandle) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.catalogue_reminder_hidden = true;
        Ok(())
    })
}

#[tauri::command]
fn set_failure_policy(app: tauri::AppHandle, policy: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.failure_policy = policy;
        Ok(())
    })
}

/// Echelle de rendu de l'interface. Bornee cote Rust pour qu'une valeur
/// aberrante venue d'un fichier edite a la main ne rende pas l'application
/// inutilisable.
#[tauri::command]
fn set_ui_scale(app: tauri::AppHandle, value: f32) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.ui_scale = settings::ui_scale_ou_defaut(value);
        Ok(())
    })
}

/// Graphique du resume de l'analyse en mode Simple (§17).
#[tauri::command]
fn set_analysis_chart(app: tauri::AppHandle, chart: String) -> Result<Settings, String> {
    if !settings::GRAPHIQUES_ANALYSE.contains(&chart.as_str()) {
        return Err(format!("graphique inconnu : {chart}"));
    }
    with_settings(&app, |s| {
        s.analysis_chart = chart;
        Ok(())
    })
}

/// Couleur d'accent de l'interface (§15.4, reglage 1.8).
#[tauri::command]
fn set_accent(app: tauri::AppHandle, accent: String) -> Result<Settings, String> {
    if !settings::ACCENTS.contains(&accent.as_str()) {
        return Err(format!("couleur inconnue : {accent}"));
    }
    with_settings(&app, |s| {
        s.accent = accent;
        Ok(())
    })
}

/// Place libre sur le disque du systeme, pour le panneau « Espace disque » de
/// l'Expert (§17). Une lecture, rien de plus.
#[tauri::command]
fn disk_space() -> Result<systeme::EspaceDisque, String> {
    systeme::espace_disque()
}

/// Affiche ou masque la numerotation des reglages (« 2.3 »).
#[tauri::command]
fn set_show_setting_numbers(app: tauri::AppHandle, value: bool) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.show_setting_numbers = value;
        Ok(())
    })
}

#[tauri::command]
fn set_exec_policy(app: tauri::AppHandle, policy: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.exec_policy = policy;
        Ok(())
    })
}

#[tauri::command]
fn set_log_cap(app: tauri::AppHandle, mb: u32) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.log_cap_mb = mb;
        Ok(())
    })
}

/// Ecran d'accueil (§13) : theme et langue choisis d'un coup, une seule
/// ecriture plutot que trois commandes separees.
#[tauri::command]
fn complete_onboarding(
    app: tauri::AppHandle,
    theme: String,
    lang: String,
) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.theme = theme;
        s.lang = lang;
        s.onboarded = true;
        Ok(())
    })
}

#[tauri::command]
fn reset_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    settings::reset(&app)
}

#[tauri::command]
fn export_settings(app: tauri::AppHandle) -> Result<String, String> {
    settings::export(&app)
}

#[tauri::command]
fn import_settings(app: tauri::AppHandle, json: String) -> Result<Settings, String> {
    settings::import_from_str(&app, &json)
}

/// Change l'icone d'un lot.
///
/// Le nom est valide contre la forme d'un identifiant Lucide, la meme que
/// celle appliquee cote interface : le champ finit dans une requete de fichier
/// (`icons/<nom>.svg`) dont le resultat est insere dans la page, et un nom
/// libre ouvrirait la porte a un chemin remontant hors du dossier.
#[tauri::command]
fn set_lot_icon(app: tauri::AppHandle, id: String, icon: String) -> Result<Settings, String> {
    let forme_valide = !icon.is_empty()
        && icon.len() <= 64
        && icon
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !icon.starts_with('-')
        && !icon.ends_with('-');
    if !forme_valide {
        return Err(format!("nom d'icone invalide : {icon}"));
    }

    with_settings(&app, |s| {
        let cat = s
            .lots
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| format!("lot introuvable : {id}"))?;
        cat.icon = icon;
        Ok(())
    })
}

/// Epingle ou detache un lot (« Entretien complet » n'est pas un cas special
/// de code, §4.1 : n'importe quel lot peut l'etre).
#[tauri::command]
fn set_lot_pinned(app: tauri::AppHandle, id: String, pinned: bool) -> Result<Settings, String> {
    with_settings(&app, |s| {
        if !s.lots.iter().any(|c| c.id == id) {
            return Err(format!("lot introuvable : {id}"));
        }
        // EXCLUSIF. Le mode Simple n'affiche qu'une seule grande carte, et il
        // la choisit par `find(pinned)` : avec deux lots principaux,
        // c'est l'ordre de la liste qui tranchait en silence. Designer une
        // principale retire donc le drapeau a toutes les autres.
        for c in s.lots.iter_mut() {
            c.pinned = pinned && c.id == id;
        }
        Ok(())
    })
}

/// Reordonne les scripts d'un seul lot (glisser-deposer, §6.1 : l'ordre est
/// par lot, pas global — un script dans deux lots peut y avoir une
/// position differente).
#[tauri::command]
fn reorder_lot_scripts(
    app: tauri::AppHandle,
    lot_id: String,
    order: Vec<String>,
) -> Result<Settings, String> {
    with_settings(&app, |s| {
        let cat = s
            .lots
            .iter_mut()
            .find(|c| c.id == lot_id)
            .ok_or_else(|| format!("lot introuvable : {lot_id}"))?;
        cat.scripts = order;
        Ok(())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // En tout premier, avant le moindre fil et la moindre vue : WebView2 lit
    // ces variables en creant son moteur, et chaque processus lance en herite.
    //
    // Seulement dans la version publiee : une version de developpement
    // (`npm run dev`) les garde, pour qui debogue l'interface avec
    // WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS par exemple. Dans les deux cas,
    // l'environnement de l'utilisateur n'est pas touche : seul ce processus,
    // et ce qu'il lance, ne les recoit pas.
    #[cfg(not(debug_assertions))]
    {
        let suspectes: Vec<String> = systeme::retirer_variables_dangereuses()
            .into_iter()
            .filter(|n| systeme::charge_du_code(n))
            .collect();
        if !suspectes.is_empty() {
            systeme::signaler(format!(
                "Variables d'environnement qui font charger du code dans PowerShell ou dans \
                 l'interface : {}. WinTool ne les transmet pas. Elles servent aux outils de \
                 developpement et de diagnostic ; si vous n'en utilisez pas, une analyse \
                 antivirus est conseillee.",
                suspectes.join(", ")
            ));
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(Arc::new(runner::Runner::default()));
            app.manage(Arc::new(analyse::Memoire::default()));

            // Environnement de chaque script : variables du systeme retablies
            // depuis HKLM, dossiers de l'utilisateur ramenes dans son profil
            // s'ils visent un emplacement protege.
            let handle = app.handle();
            if let (Ok(profil), Ok(zones)) = (handle.path().home_dir(), zones_protegees(handle)) {
                let corrigees =
                    systeme::preparer_environnement_enfants(&profil, |p| zones.protege(p));
                if !corrigees.is_empty() {
                    systeme::signaler(format!(
                        "Variables d'environnement corrigees pour les scripts : {}. Elles visaient \
                         un emplacement du systeme, ou manquaient.",
                        corrigees.join(", ")
                    ));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            relaunch_elevated,
            list_scripts,
            list_scripts_grouped,
            scripts_root,
            engines,
            run_script,
            scan_script,
            set_analysis_chart,
            set_accent,
            disk_space,
            simulation_state,
            set_simulation_all,
            check_script,
            cancel_script,
            run_status,
            open_log,
            open_scripts_folder,
            preparer_approbation,
            approve_script,
            create_restore_point,
            record_script_run,
            record_lot_run,
            get_history,
            enforce_log_cap,
            get_settings,
            create_lot,
            rename_lot,
            reorder_lots,
            delete_lot,
            assign_script_lot,
            set_lot_script,
            set_script_config,
            set_script_flag,
            reset_script_config,
            reorder_lot_scripts,
            set_lot_pinned,
            set_lot_icon,
            set_theme,
            set_lang,
            set_update_policy,
            check_update,
            install_update,
            catalogue_state,
            check_catalogue,
            install_catalogue,
            sources_state,
            check_source,
            install_source,
            source_contents,
            set_source_selection,
            set_source_active,
            add_source,
            update_source,
            remove_source,
            set_catalogue_source,
            set_catalogue_check,
            hide_catalogue_reminder,
            set_failure_policy,
            set_show_setting_numbers,
            set_ui_scale,
            set_exec_policy,
            set_log_cap,
            protected_paths,
            set_protected_paths,
            complete_onboarding,
            reset_settings,
            export_settings,
            import_settings
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
