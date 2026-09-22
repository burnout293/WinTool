mod contract;
mod discovery;

use serde::Serialize;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![app_info, list_scripts, scripts_root])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
