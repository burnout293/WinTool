//! Magasin des scripts approuves avant premiere execution (specification
//! 12.1/12.4).
//!
//! Un script livre (`Default\`, deja verifie en CI, §5.4) est implicitement
//! approuve : sa protection vient des droits du systeme (installation
//! perMachine, dossier non inscriptible sans elevation), pas de ce magasin.
//! Tout le reste — script utilisateur, ou script livre dont le hash a change
//! depuis l'installation — doit y figurer avant sa toute premiere execution.
//!
//! Le fichier vit dans `%ProgramData%`, inscriptible seulement par un
//! administrateur : un magasin ecrit dans le dossier utilisateur serait
//! decoratif, puisqu'un script malveillant pourrait y ajouter son propre
//! hash et se rendre lui-meme "approuve".
//!
//! **Cette garantie tient a une condition** : le dossier doit etre CREE par un
//! processus eleve. Depuis que l'application s'ouvre aussi sans elevation
//! (manifeste asInvoker), un premier lancement non eleve le creerait avec des
//! droits d'ecriture pour l'utilisateur. `lib.rs::approve_script` refuse donc
//! d'ecrire sans droits administrateur — mieux vaut pas de magasin qu'un
//! magasin qui ne protege rien.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ApprovalStore {
    pub hashes: BTreeSet<String>,
}

pub fn path() -> Result<PathBuf, String> {
    let program_data =
        std::env::var("ProgramData").map_err(|_| "variable ProgramData introuvable".to_string())?;
    Ok(PathBuf::from(program_data)
        .join("WinTool")
        .join("approved.json"))
}

/// Un fichier absent ou illisible n'est pas une erreur : c'est simplement
/// qu'aucun script n'a encore ete approuve (meme esprit que `settings::load` —
/// constater, jamais planter).
pub fn load_from(chemin: &Path) -> ApprovalStore {
    fs::read_to_string(chemin)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_to(chemin: &Path, store: &ApprovalStore) -> Result<(), String> {
    if let Some(parent) = chemin.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("creation de {} : {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(chemin, json).map_err(|e| format!("ecriture de {} : {e}", chemin.display()))
}

pub fn load() -> Result<ApprovalStore, String> {
    Ok(load_from(&path()?))
}

pub fn save(store: &ApprovalStore) -> Result<(), String> {
    save_to(&path()?, store)
}

pub fn is_approved(store: &ApprovalStore, hash: &str) -> bool {
    store.hashes.contains(hash)
}

pub fn approve(store: &mut ApprovalStore, hash: String) {
    store.hashes.insert(hash);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_hash_jamais_vu_n_est_pas_approuve() {
        let store = ApprovalStore::default();
        assert!(!is_approved(&store, "abc123"));
    }

    #[test]
    fn approuver_puis_relire_survit_a_l_ecriture() {
        let dir =
            std::env::temp_dir().join(format!("wintool-test-approval-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let chemin = dir.join("approved.json");
        let _ = fs::remove_file(&chemin);

        let mut store = load_from(&chemin);
        assert!(!is_approved(&store, "hash-x"));
        approve(&mut store, "hash-x".to_string());
        save_to(&chemin, &store).unwrap();

        let relu = load_from(&chemin);
        assert!(is_approved(&relu, "hash-x"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_fichier_absent_ou_corrompu_ne_bloque_pas() {
        let store = load_from(Path::new("D:/chemin/qui/n/existe/pas/approved.json"));
        assert!(store.hashes.is_empty());
    }
}
