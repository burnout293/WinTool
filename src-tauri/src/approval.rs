//! Magasin des scripts approuves avant premiere execution (specification
//! 12.1/12.4).
//!
//! Un script du catalogue officiel conforme a l'index signe est implicitement
//! approuve (§16.4) : sa confiance vient de la signature, pas de ce magasin.
//! Tout le reste — script de l'utilisateur, script officiel modifie — doit y
//! figurer, par son empreinte exacte, avant sa toute premiere execution.
//!
//! **Le magasin vit dans la base de registre, sous `HKLM\SOFTWARE\WinTool`.**
//! Jusqu'a la 1.1.1 c'etait un fichier, `%ProgramData%\WinTool\approved.json`.
//! Or `ProgramData` laisse n'importe quel compte y **creer** dossiers et
//! fichiers, et en devenir proprietaire : un programme sans droits pouvait
//! creer ce fichier avant WinTool et y inscrire l'empreinte de son propre
//! script, qu'un entretien lance en administrateur aurait alors execute sans
//! rien demander. `HKLM\SOFTWARE` n'admet, lui, aucune creation ni ecriture sans
//! elevation : il n'y a rien a verrouiller, rien a verifier, et rien qu'un tiers
//! puisse y avoir prepare. Les approbations de l'ancien fichier ne sont pas
//! reprises — rien ne garantit qui l'a ecrit.

use std::collections::BTreeSet;

#[derive(Debug, Default, Clone)]
pub struct ApprovalStore {
    pub hashes: BTreeSet<String>,
}

/// Emplacement du magasin, sous `HKEY_LOCAL_MACHINE`.
pub const CLE: &str = r"SOFTWARE\WinTool\Approbations";

/// Une empreinte SHA-256 en hexadecimal minuscule, rien d'autre.
fn empreinte_valide(h: &str) -> bool {
    h.len() == 64 && h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Lit le magasin sous `racine\chemin`. Une cle absente n'est pas une erreur :
/// c'est simplement qu'aucun script n'a encore ete approuve (constater, jamais
/// planter). Chaque approbation est une valeur nommee par l'empreinte.
#[cfg(windows)]
pub fn charger_depuis(racine: &windows_registry::Key, chemin: &str) -> ApprovalStore {
    let mut store = ApprovalStore::default();
    if let Ok(cle) = racine.open(chemin) {
        if let Ok(valeurs) = cle.values() {
            for (nom, _) in valeurs {
                if empreinte_valide(&nom) {
                    store.hashes.insert(nom);
                }
            }
        }
    }
    store
}

/// Ajoute une approbation. Sous `HKLM`, echoue sans droits administrateur : le
/// systeme refuse l'ecriture, c'est precisement la garantie recherchee.
#[cfg(windows)]
pub fn enregistrer_dans(
    racine: &windows_registry::Key,
    chemin: &str,
    hash: &str,
) -> Result<(), String> {
    if !empreinte_valide(hash) {
        return Err(format!("empreinte invalide : {hash}"));
    }
    let cle = racine
        .create(chemin)
        .map_err(|e| format!("ouverture du magasin d'approbations : {e}"))?;
    let date = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    cle.set_string(hash, date)
        .map_err(|e| format!("ecriture du magasin d'approbations : {e}"))
}

#[cfg(windows)]
pub fn load() -> Result<ApprovalStore, String> {
    Ok(charger_depuis(windows_registry::LOCAL_MACHINE, CLE))
}

#[cfg(windows)]
pub fn enregistrer(hash: &str) -> Result<(), String> {
    enregistrer_dans(windows_registry::LOCAL_MACHINE, CLE, hash)
}

#[cfg(not(windows))]
pub fn load() -> Result<ApprovalStore, String> {
    Ok(ApprovalStore::default())
}

#[cfg(not(windows))]
pub fn enregistrer(_hash: &str) -> Result<(), String> {
    Err("magasin d'approbations disponible sous Windows seulement".into())
}

pub fn is_approved(store: &ApprovalStore, hash: &str) -> bool {
    store.hashes.contains(hash)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use windows_registry::{CURRENT_USER, LOCAL_MACHINE};

    const H: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    /// Une sous-cle jetable de HKCU : les tests n'ont pas les droits sur HKLM,
    /// et c'est le meme code qui ecrit.
    struct CleEssai(String);
    impl CleEssai {
        fn neuve(nom: &str) -> CleEssai {
            // Une cle par test, sans parent commun : les tests tournent en
            // parallele, et le nettoyage de l'un ne doit pas defaire l'autre.
            let c = format!(r"SOFTWARE\WinTool-tests-{}-{nom}", std::process::id());
            let _ = CURRENT_USER.remove_tree(&c);
            CleEssai(c)
        }
    }
    impl Drop for CleEssai {
        fn drop(&mut self) {
            let _ = CURRENT_USER.remove_tree(&self.0);
        }
    }

    #[test]
    fn une_empreinte_jamais_vue_n_est_pas_approuvee() {
        let c = CleEssai::neuve("vide");
        let store = charger_depuis(CURRENT_USER, &c.0);
        assert!(!is_approved(&store, H));
    }

    #[test]
    fn approuver_puis_relire() {
        let c = CleEssai::neuve("relire");
        enregistrer_dans(CURRENT_USER, &c.0, H).unwrap();
        assert!(is_approved(&charger_depuis(CURRENT_USER, &c.0), H));
    }

    #[test]
    fn seules_les_empreintes_bien_formees_comptent() {
        let c = CleEssai::neuve("forme");
        assert!(enregistrer_dans(CURRENT_USER, &c.0, "pas-une-empreinte").is_err());
        let cle = CURRENT_USER.create(&c.0).unwrap();
        cle.set_string("ABCDEF", "x").unwrap();
        assert!(charger_depuis(CURRENT_USER, &c.0).hashes.is_empty());
    }

    #[test]
    fn sans_droits_hklm_refuse_l_ecriture() {
        // La garantie elle-meme : un processus non eleve ne peut pas s'approuver.
        // (Si les tests tournent en administrateur, l'essai n'a pas de sens.)
        let essai = r"SOFTWARE\WinTool-tests-droits";
        if LOCAL_MACHINE.create(essai).is_ok() {
            let _ = LOCAL_MACHINE.remove_tree(essai);
            return;
        }
        assert!(enregistrer_dans(LOCAL_MACHINE, CLE, H).is_err());
    }
}
