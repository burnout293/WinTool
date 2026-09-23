mod contract;
mod discovery;
mod runner;

use serde::Serialize;
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

/// Lance un script. Rend la main immediatement : la suite arrive par les
/// evenements `script:line` puis `script:end`.
#[tauri::command]
fn run_script(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<runner::Runner>>,
    req: runner::RunRequest,
) -> Result<runner::RunStarted, String> {
    // Un `Arc` plutot qu'un etat emprunte : le fil qui attend la fin du
    // processus doit pouvoir liberer l'emplacement bien apres le retour de
    // cette commande.
    runner::run_script(&app, state.inner().clone(), req)
}

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
    tauri_plugin_opener::open_path(verifie.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(Arc::new(runner::Runner::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_scripts,
            scripts_root,
            engines,
            run_script,
            cancel_script,
            run_status,
            open_log
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
