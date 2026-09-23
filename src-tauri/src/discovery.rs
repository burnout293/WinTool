//! Decouverte des scripts sur le disque.
//!
//! Emplacement (specification 4.3) : toute l'arborescence vit dans
//! `%LOCALAPPDATA%\WinTool\scripts\`, inscriptible et hors de Program Files.
//! Les sous-dossiers sont libres et le parcours est recursif.
//!
//! ```text
//! %LOCALAPPDATA%\WinTool\scripts\
//! ├─ Default\      scripts livres avec l'application
//! ├─ MesScripts\   l'utilisateur organise comme il veut
//! └─ Essais\
//! ```
//!
//! Une mise a jour ne remplace que `Default\` : les autres sous-dossiers ne sont
//! jamais touches.

use crate::contract::{self, Finding, Script, Severity};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Serialize)]
pub struct ScriptEntry {
    /// Identifiant resolu : le champ `id` de l'entete, ou a defaut le chemin
    /// relatif. Un chemin change au moindre renommage, l'`id` survit.
    pub id: String,
    /// Chemin relatif a la racine des scripts, separateurs normalises.
    pub path: String,
    /// Empreinte du contenu : base de l'approbation avant premiere execution
    /// (specification 12.1) et de la detection des modifications.
    pub hash: String,
    /// Faux si le script ne declare pas d'`id` et n'est identifie que par son chemin.
    pub declared_id: bool,
    pub meta: Script,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveryResult {
    pub root: String,
    pub scripts: Vec<ScriptEntry>,
    /// Anomalies qui ne visent aucun script en particulier (dossier illisible…).
    pub problems: Vec<String>,
}

/// Dossier de travail de l'application : `%LOCALAPPDATA%\WinTool`.
///
/// Une seule definition, parce que trois modules en ont besoin (scripts,
/// journaux, fichiers de configuration d'execution) et que deux definitions qui
/// divergent donneraient deux arborescences.
pub fn base_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .local_data_dir()
        .map_err(|e| format!("dossier local introuvable : {e}"))?;
    Ok(base.join("WinTool"))
}

/// Racine des scripts : `%LOCALAPPDATA%\WinTool\scripts`.
pub fn scripts_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(base_dir(app)?.join("scripts"))
}

fn sha256_hex(octets: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(octets);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Copie `Default\` depuis les ressources livrees si elle est absente.
///
/// Volontairement limite a la creation initiale : le remplacement lors d'une
/// mise a jour, avec sauvegarde des fichiers modifies a la main, releve de
/// l'updater et sera traite avec lui.
fn seed_default<R: Runtime>(app: &AppHandle<R>, root: &Path) -> Result<(), String> {
    let cible = root.join("Default");
    if cible.exists() {
        return Ok(());
    }

    let source = app
        .path()
        .resolve("scripts/Default", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("ressources introuvables : {e}"))?;

    if !source.exists() {
        // En developpement les ressources peuvent ne pas etre en place. Ce n'est
        // pas une erreur : le dossier est simplement cree vide.
        fs::create_dir_all(&cible).map_err(|e| e.to_string())?;
        return Ok(());
    }

    fs::create_dir_all(&cible).map_err(|e| e.to_string())?;
    for entree in fs::read_dir(&source).map_err(|e| e.to_string())? {
        let entree = entree.map_err(|e| e.to_string())?;
        if entree.path().extension().and_then(|e| e.to_str()) == Some("ps1") {
            let nom = entree.file_name();
            fs::copy(entree.path(), cible.join(&nom)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Parcours recursif, sans dependance externe.
fn collect_ps1(dir: &Path, out: &mut Vec<PathBuf>, problems: &mut Vec<String>) {
    let entrees = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            problems.push(format!("{} : {e}", dir.display()));
            return;
        }
    };
    for entree in entrees.flatten() {
        let chemin = entree.path();
        if chemin.is_dir() {
            collect_ps1(&chemin, out, problems);
        } else if chemin.extension().and_then(|e| e.to_str()) == Some("ps1") {
            out.push(chemin);
        }
    }
}

pub fn discover<R: Runtime>(app: &AppHandle<R>) -> Result<DiscoveryResult, String> {
    let root = scripts_root(app)?;
    fs::create_dir_all(&root).map_err(|e| format!("creation de {} : {e}", root.display()))?;

    let mut problems = Vec::new();
    if let Err(e) = seed_default(app, &root) {
        problems.push(format!("amorcage de Default : {e}"));
    }

    let mut fichiers = Vec::new();
    collect_ps1(&root, &mut fichiers, &mut problems);
    // Ordre stable : c'est lui qui decide quel script garde un `id` en collision.
    fichiers.sort();

    let mut scripts: Vec<ScriptEntry> = Vec::new();
    let mut ids_vus: Vec<String> = Vec::new();

    for chemin in fichiers {
        let octets = match fs::read(&chemin) {
            Ok(o) => o,
            Err(e) => {
                problems.push(format!("{} : {e}", chemin.display()));
                continue;
            }
        };

        // Les scripts sont en UTF-8 avec BOM (voir FORMAT_SCRIPT.md). On le
        // retire avant analyse, sinon il colle au premier caractere de l'entete.
        let texte = String::from_utf8_lossy(&octets);
        let texte = texte.strip_prefix('\u{feff}').unwrap_or(&texte);

        let mut meta = contract::parse(texte);

        let relatif = chemin
            .strip_prefix(&root)
            .unwrap_or(&chemin)
            .to_string_lossy()
            .replace('\\', "/");

        let declared_id = !meta.id.trim().is_empty();
        let mut id = if declared_id { meta.id.trim().to_string() } else { relatif.clone() };

        if !declared_id {
            meta.findings.push(Finding {
                line: 1,
                severity: Severity::Warning,
                code: "ID_ABSENT".into(),
                message:
                    "Pas d'id declare : un renommage ou un deplacement fera perdre la configuration de ce script."
                        .into(),
            });
        } else if ids_vus.contains(&id) {
            // Le premier fichier decouvert garde l'id ; les suivants retombent
            // sur leur chemin (specification 4.3).
            meta.findings.push(Finding {
                line: 1,
                severity: Severity::Error,
                code: "ID_COLLISION".into(),
                message: format!("L'id '{id}' est deja utilise par un autre script ; celui-ci est identifie par son chemin."),
            });
            id = relatif.clone();
        }

        if declared_id {
            ids_vus.push(meta.id.trim().to_string());
        }

        scripts.push(ScriptEntry {
            id,
            path: relatif,
            hash: sha256_hex(&octets),
            declared_id,
            meta,
        });
    }

    Ok(DiscoveryResult {
        root: root.to_string_lossy().to_string(),
        scripts,
        problems,
    })
}
