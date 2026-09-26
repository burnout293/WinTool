mod approval;
mod contract;
mod discovery;
mod history;
mod restore;
mod runner;
mod security;
mod settings;
mod update;

use serde::Serialize;
use settings::{Category, Settings};
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

/// Scripts decouverts, regroupes par categorie resolue (mode Expert, §2/§4.2).
/// Combine la decouverte (`discovery::discover`) et les reglages utilisateur
/// (`settings::load`) : les deux sont necessaires pour savoir dans quel lot
/// ranger chaque script, donc c'est ici que la jointure se fait, pas cote JS —
/// un seul endroit sait resoudre une categorie.
#[tauri::command]
fn list_scripts_grouped(app: tauri::AppHandle) -> Result<GroupedResult, String> {
    let decouverte = discovery::discover(&app)?;
    let reglages = settings::load(&app)?;
    let groupes = settings::group_scripts(&reglages, decouverte.scripts);
    Ok(GroupedResult {
        root: decouverte.root,
        shipped_root: decouverte.shipped_root,
        problems: decouverte.problems,
        categories: groupes.categories,
        unclassified: groupes.unclassified,
        overrides: reglages.overrides,
    })
}

#[derive(Serialize)]
struct GroupedResult {
    root: String,
    shipped_root: String,
    problems: Vec<String>,
    categories: Vec<settings::CategoryGroup>,
    unclassified: Vec<discovery::ScriptEntry>,
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
/// Un script livre (`Default\`, verifie en CI, §5.4) l'est implicitement — sa
/// protection vient des droits du systeme (§4.3), pas de ce magasin. Tout le
/// reste doit figurer dans le magasin par son hash exact (§12.1) : toute
/// modification du fichier change le hash et invalide l'approbation.
fn script_approuve(origin: &str, hash: &str) -> Result<bool, String> {
    if origin == "shipped" {
        return Ok(true);
    }
    let store = approval::load()?;
    Ok(approval::is_approved(&store, hash))
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

/// Cle d'option par laquelle un script declare savoir se simuler.
/// Convention documentee dans `docs/FORMAT_SCRIPT.md`.
const CLE_TEST: &str = "SafeTest";

/// Mode test global.
///
/// **En memoire de session uniquement, jamais dans `settings.json`.** Un mode
/// test qui survivrait au redemarrage ferait passer un entretien reel pour une
/// simulation : c'est exactement l'erreur qu'on ne peut pas se permettre. Au
/// prochain lancement, WinTool repart donc toujours en mode reel.
#[derive(Default)]
pub struct ModeTest(std::sync::atomic::AtomicBool);

impl ModeTest {
    fn actif(&self) -> bool {
        self.0.load(std::sync::atomic::Ordering::Relaxed)
    }
}

#[tauri::command]
fn test_mode(state: tauri::State<'_, Arc<ModeTest>>) -> bool {
    state.actif()
}

#[tauri::command]
fn set_test_mode(state: tauri::State<'_, Arc<ModeTest>>, value: bool) -> bool {
    state.0.store(value, std::sync::atomic::Ordering::Relaxed);
    value
}

/// Sentinelle : ce script ne sait pas se simuler, il n'a pas ete lance.
/// Distincte d'une erreur ordinaire pour que l'interface puisse l'expliquer
/// plutot que d'afficher un message technique.
const SANS_MODE_TEST: &str = "SANS_MODE_TEST";

/// Lance un script. Rend la main immediatement : la suite arrive par les
/// evenements `script:line` puis `script:end`.
#[tauri::command]
fn run_script(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<runner::Runner>>,
    mode_test: tauri::State<'_, Arc<ModeTest>>,
    mut req: runner::RunRequest,
) -> Result<runner::RunStarted, String> {
    // La seule exception au principe "constater, jamais bloquer" (§5.4,
    // §12.1) : ici, refuser est le comportement voulu, pas un defaut a
    // corriger. On retrouve l'origine par une nouvelle decouverte plutot que
    // de faire porter ce champ par `RunRequest`, pour ne pas avoir a faire
    // confiance a ce que le frontend affirme sur un script qu'il ne controle
    // pas.
    let decouverte = discovery::discover(&app)?;
    if let Some(entree) = decouverte.scripts.iter().find(|s| s.id == req.script_id) {
        if !script_approuve(entree.origin, &entree.hash)? {
            return Err(NON_APPROUVE.to_string());
        }

        // Mode test : on impose `SafeTest` a la configuration, ce qui ecrase la
        // valeur venue de l'interface sans rien ecrire dans les reglages.
        //
        // **On refuse si le script ne declare pas cette option.** Injecter une
        // cle qu'il n'utilise pas ajouterait une entree inerte a sa table et le
        // script modifierait la machine pendant que l'interface annonce une
        // simulation. Un refus visible vaut mieux qu'une garantie fausse
        // (§12.2 : ne jamais laisser croire a une protection absente).
        if mode_test.actif() {
            let declare = entree.meta.options.iter().any(|o| o.key == CLE_TEST);
            if !declare {
                return Err(SANS_MODE_TEST.to_string());
            }
            req.config
                .insert(CLE_TEST.to_string(), serde_json::Value::Bool(true));
        }
    }

    // Un `Arc` plutot qu'un etat emprunte : le fil qui attend la fin du
    // processus doit pouvoir liberer l'emplacement bien apres le retour de
    // cette commande.
    runner::run_script(&app, state.inner().clone(), req)
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
    if script_approuve(entree.origin, &entree.hash)? {
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
    let mut store = approval::load()?;
    approval::approve(&mut store, hash);
    approval::save(&store)
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
/// par categorie lancee. L'horodatage vient du serveur, pas du client — le
/// frontend fournit les faits constates, jamais l'heure.
#[tauri::command]
fn record_script_run(
    app: tauri::AppHandle,
    script_id: String,
    title: String,
    success: bool,
    killed: bool,
    duration_ms: u64,
) -> Result<(), String> {
    history::record_script_run(
        &app,
        history::ScriptRunRecord {
            script_id,
            title,
            success,
            killed,
            duration_ms,
            at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        },
    )
}

#[tauri::command]
fn record_category_run(
    app: tauri::AppHandle,
    category_id: String,
    category_name: String,
    script_ids: Vec<String>,
) -> Result<(), String> {
    history::record_category_run(
        &app,
        history::CategoryRunRecord {
            category_id,
            category_name,
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

/// Point de restauration avant le lancement d'une categorie (specification
/// §6.4). C'est l'app qui decide de le creer (le frontend sait deja, via
/// `reversible` sur chaque script, si la categorie en a besoin) ; cette
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

/// Nouvelle categorie utilisateur (§4.1) : un seul nom, dans la langue actuelle de
/// l'interface — pas de traduction automatique, contrairement aux categories d'usine.
#[tauri::command]
fn create_category(app: tauri::AppHandle, name: String, icon: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        let lang = s.lang.clone();
        let id = format!(
            "user-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_millis()
        );
        s.categories.push(Category {
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

/// Renomme une categorie dans la langue actuelle. Une categorie d'usine perd alors
/// sa traduction dans l'autre langue : un nom tape a la main ne se traduit pas tout
/// seul (meme regle que pour une categorie creee par l'utilisateur, §10).
#[tauri::command]
fn rename_category(app: tauri::AppHandle, id: String, name: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        let lang = s.lang.clone();
        let cat = s
            .categories
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| format!("categorie introuvable : {id}"))?;
        cat.name = std::collections::BTreeMap::from([(lang, name)]);
        Ok(())
    })
}

/// Reordonne la liste des categories (glisser-deposer en mode Expert). Les ids absents
/// de `order` gardent leur position relative a la fin, par tolerance envers un appel
/// fait a partir d'une liste legerement perimee cote frontend.
#[tauri::command]
fn reorder_categories(app: tauri::AppHandle, order: Vec<String>) -> Result<Settings, String> {
    with_settings(&app, |s| {
        let mut reste: Vec<Category> = std::mem::take(&mut s.categories);
        let mut classees = Vec::with_capacity(reste.len());
        for id in &order {
            if let Some(pos) = reste.iter().position(|c| &c.id == id) {
                classees.push(reste.remove(pos));
            }
        }
        classees.append(&mut reste);
        s.categories = classees;
        Ok(())
    })
}

/// Supprime une categorie sans jamais supprimer de fichier de script (§14, hypothese
/// retenue). Les scripts qui la referencaient retombent en "Non classe" a la prochaine
/// resolution, sans bookkeeping supplementaire a faire ici.
#[tauri::command]
fn delete_category(app: tauri::AppHandle, id: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.categories.retain(|c| c.id != id);
        Ok(())
    })
}

/// Classement manuel d'un script dans une categorie (§4.2/§5.1) : fige definitivement
/// ce rangement, plus aucune Re-analyse ni changement de `category:` ne le deplacera.
#[tauri::command]
fn assign_script_category(
    app: tauri::AppHandle,
    script_id: String,
    category_id: String,
) -> Result<Settings, String> {
    with_settings(&app, |s| {
        let over = s.overrides.entry(script_id).or_default();
        // Rangement exclusif : remplace toute la liste. Conserve pour les
        // appelants qui veulent « deplacer » plutot que « cocher ».
        over.categories = Some(if category_id == settings::NON_CLASSE {
            Vec::new()
        } else {
            vec![category_id]
        });
        over.category_locked = None;
        Ok(())
    })
}

/// Coche ou decoche un script dans une categorie (§4.1) sans toucher a ses
/// autres appartenances. C'est ce qu'appelle la liste a bascule du mode Expert.
#[tauri::command]
fn set_category_script(
    app: tauri::AppHandle,
    category_id: String,
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
        settings::set_script_category_membership(s, &script_id, &declaree, &category_id, member);
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
/// Le classement en categorie survit : c'est une autre decision.
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

#[tauri::command]
fn set_update_policy(app: tauri::AppHandle, policy: String) -> Result<Settings, String> {
    with_settings(&app, |s| {
        s.update_policy = policy;
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

/// Epingle ou detache une categorie (« Entretien complet » n'est pas un cas
/// special de code, §4.1 : n'importe quelle categorie peut l'etre).
/// Change l'icone d'une categorie.
///
/// Le nom est valide contre la forme d'un identifiant Lucide, la meme que
/// celle appliquee cote interface : le champ finit dans une requete de fichier
/// (`icons/<nom>.svg`) dont le resultat est insere dans la page, et un nom
/// libre ouvrirait la porte a un chemin remontant hors du dossier.
#[tauri::command]
fn set_category_icon(app: tauri::AppHandle, id: String, icon: String) -> Result<Settings, String> {
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
            .categories
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| format!("categorie introuvable : {id}"))?;
        cat.icon = icon;
        Ok(())
    })
}

#[tauri::command]
fn set_category_pinned(
    app: tauri::AppHandle,
    id: String,
    pinned: bool,
) -> Result<Settings, String> {
    with_settings(&app, |s| {
        if !s.categories.iter().any(|c| c.id == id) {
            return Err(format!("categorie introuvable : {id}"));
        }
        // EXCLUSIF. Le mode Simple n'affiche qu'une seule grande carte, et il
        // la choisit par `find(pinned)` : avec deux categories principales,
        // c'est l'ordre de la liste qui tranchait en silence. Designer une
        // principale retire donc le drapeau a toutes les autres.
        for c in s.categories.iter_mut() {
            c.pinned = pinned && c.id == id;
        }
        Ok(())
    })
}

/// Reordonne les scripts d'une seule categorie (glisser-deposer, §6.1 : l'ordre
/// est par categorie, pas global — un script dans deux lots peut y avoir une
/// position differente).
#[tauri::command]
fn reorder_category_scripts(
    app: tauri::AppHandle,
    category_id: String,
    order: Vec<String>,
) -> Result<Settings, String> {
    with_settings(&app, |s| {
        let cat = s
            .categories
            .iter_mut()
            .find(|c| c.id == category_id)
            .ok_or_else(|| format!("categorie introuvable : {category_id}"))?;
        cat.scripts = order;
        Ok(())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(Arc::new(runner::Runner::default()));
            app.manage(Arc::new(ModeTest::default()));
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
            test_mode,
            set_test_mode,
            check_script,
            cancel_script,
            run_status,
            open_log,
            open_scripts_folder,
            preparer_approbation,
            approve_script,
            create_restore_point,
            record_script_run,
            record_category_run,
            get_history,
            enforce_log_cap,
            get_settings,
            create_category,
            rename_category,
            reorder_categories,
            delete_category,
            assign_script_category,
            set_category_script,
            set_script_config,
            set_script_flag,
            reset_script_config,
            reorder_category_scripts,
            set_category_pinned,
            set_category_icon,
            set_theme,
            set_lang,
            set_update_policy,
            set_failure_policy,
            set_show_setting_numbers,
            set_ui_scale,
            set_exec_policy,
            set_log_cap,
            complete_onboarding,
            reset_settings,
            export_settings,
            import_settings
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
