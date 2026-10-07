//! Les sources de scripts (specification §16.2).
//!
//! La source officielle est compilee dans le binaire : son depot
//! (`catalogue::DEPOT`) et sa cle (`src-tauri/catalogue.pub`). Les sources
//! tierces sont inscrites sous `HKLM\SOFTWARE\WinTool\Sources`, une sous-cle par
//! source : comme le magasin d'approbations, rien ne s'y ecrit sans elevation.
//! Ajouter une source, c'est decider a qui l'on confie l'execution de code en
//! administrateur ; un programme sans droits ne doit pas pouvoir le decider a la
//! place de l'utilisateur.
//!
//! Une source tierce n'est jamais approuvee d'office (§16.4). Sa signature
//! prouve de qui viennent ses scripts — et qu'un compte GitHub pirate ne suffit
//! pas a en publier d'autres en son nom —, ce qui aide a decider, rien de plus.
//!
//! Ce qui est inscrit ici est une **decision de confiance**. Ce qui ne l'est pas
//! vit dans les reglages : une source desactivee, les scripts qu'on a decoches.

use crate::catalogue;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Source {
    /// L'identifiant que declare son index ; le nom de son dossier local.
    pub id: String,
    /// Nom affiche. Celui de la source officielle se traduit cote interface.
    pub nom: String,
    /// `proprietaire/depot` sur GitHub.
    pub depot: String,
    /// La cle publique minisign de l'editeur, telle qu'il la publie.
    pub cle: String,
    pub officielle: bool,
}

/// La source officielle : compilee, jamais lue sur le disque.
pub fn officielle() -> Source {
    Source {
        id: catalogue::SOURCE.to_string(),
        nom: "Catalogue officiel".to_string(),
        depot: catalogue::DEPOT.to_string(),
        cle: catalogue::cle_officielle().to_string(),
        officielle: true,
    }
}

/// Emplacement des sources tierces, sous `HKEY_LOCAL_MACHINE`.
pub const CLE_SOURCES: &str = r"SOFTWARE\WinTool\Sources";

/// Le nom affiche : 1 a 60 caracteres, sans caractere de controle.
pub fn nom_sur(nom: &str) -> bool {
    let n = nom.trim();
    !n.is_empty() && n.chars().count() <= 60 && !n.chars().any(char::is_control)
}

/// Une source tierce est-elle utilisable telle quelle ? Une entree du registre
/// qui ne l'est pas est ignoree et signalee, plutot que de bloquer les autres.
pub fn valider(s: &Source) -> Result<(), String> {
    if !catalogue::id_source_sur(&s.id) || s.id == catalogue::SOURCE {
        return Err(format!("identifiant « {} » refuse", s.id));
    }
    if !nom_sur(&s.nom) {
        return Err(format!("nom « {} » refuse", s.nom));
    }
    if catalogue::normaliser_depot(&s.depot)? != s.depot {
        return Err(format!("depot « {} » mal forme", s.depot));
    }
    catalogue::decoder_cle(&s.cle)?;
    Ok(())
}

#[cfg(windows)]
pub fn tierces_depuis(racine: &windows_registry::Key, chemin: &str) -> (Vec<Source>, Vec<String>) {
    let mut sources = Vec::new();
    let mut problemes = Vec::new();
    let Ok(cle) = racine.open(chemin) else {
        return (sources, problemes);
    };
    let Ok(ids) = cle.keys() else {
        return (sources, problemes);
    };
    for id in ids {
        let Ok(sous) = cle.open(&id) else { continue };
        let s = Source {
            id: id.clone(),
            nom: sous.get_string("Nom").unwrap_or_default(),
            depot: sous.get_string("Depot").unwrap_or_default(),
            cle: sous.get_string("Cle").unwrap_or_default(),
            officielle: false,
        };
        match valider(&s) {
            Ok(()) => sources.push(s),
            Err(e) => problemes.push(format!("Source « {id} » ignoree : {e}")),
        }
    }
    sources.sort_by_key(|s| s.nom.to_lowercase());
    (sources, problemes)
}

#[cfg(windows)]
pub fn enregistrer_dans(
    racine: &windows_registry::Key,
    chemin: &str,
    s: &Source,
) -> Result<(), String> {
    valider(s)?;
    let cle = racine
        .create(format!(r"{chemin}\{}", s.id))
        .map_err(|e| format!("ecriture de la source : {e}"))?;
    for (nom, valeur) in [
        ("Nom", s.nom.trim()),
        ("Depot", &s.depot),
        ("Cle", s.cle.trim()),
    ] {
        cle.set_string(nom, valeur)
            .map_err(|e| format!("ecriture de la source : {e}"))?;
    }
    Ok(())
}

#[cfg(windows)]
pub fn retirer_de(racine: &windows_registry::Key, chemin: &str, id: &str) -> Result<(), String> {
    if !catalogue::id_source_sur(id) {
        return Err(format!("identifiant « {id} » refuse"));
    }
    let cle = racine
        .open(chemin)
        .map_err(|e| format!("liste des sources : {e}"))?;
    cle.remove_tree(id)
        .map_err(|e| format!("retrait de la source : {e}"))
}

#[cfg(windows)]
pub fn tierces() -> (Vec<Source>, Vec<String>) {
    tierces_depuis(windows_registry::LOCAL_MACHINE, CLE_SOURCES)
}

#[cfg(windows)]
pub fn enregistrer(s: &Source) -> Result<(), String> {
    enregistrer_dans(windows_registry::LOCAL_MACHINE, CLE_SOURCES, s)
}

#[cfg(windows)]
pub fn retirer(id: &str) -> Result<(), String> {
    retirer_de(windows_registry::LOCAL_MACHINE, CLE_SOURCES, id)
}

#[cfg(not(windows))]
pub fn tierces() -> (Vec<Source>, Vec<String>) {
    (Vec::new(), Vec::new())
}

#[cfg(not(windows))]
pub fn enregistrer(_s: &Source) -> Result<(), String> {
    Err("disponible sous Windows seulement".into())
}

#[cfg(not(windows))]
pub fn retirer(_id: &str) -> Result<(), String> {
    Err("disponible sous Windows seulement".into())
}

/// Toutes les sources : l'officielle d'abord, puis les tierces par nom. Les
/// problemes sont les entrees du registre ignorees.
pub fn toutes() -> (Vec<Source>, Vec<String>) {
    let (tierces, problemes) = tierces();
    let mut liste = vec![officielle()];
    liste.extend(tierces);
    (liste, problemes)
}

pub fn trouver(id: &str) -> Option<Source> {
    toutes().0.into_iter().find(|s| s.id == id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const CLE: &str = include_str!("../fixtures/catalogue/cle-essai.pub");

    fn tierce(id: &str) -> Source {
        Source {
            id: id.to_string(),
            nom: "Scripts de Dupont".to_string(),
            depot: "dupont/scripts-windows".to_string(),
            cle: CLE.trim().to_string(),
            officielle: false,
        }
    }

    #[test]
    fn une_source_tierce_valide_passe() {
        assert!(valider(&tierce("dupont")).is_ok());
    }

    #[test]
    fn une_source_ne_peut_pas_se_faire_passer_pour_l_officielle() {
        assert!(valider(&tierce("officiel")).is_err());
    }

    #[test]
    fn identifiant_nom_depot_et_cle_sont_controles() {
        for id in ["", "Dupont", "../x", "a b", "a/b", &"x".repeat(41)] {
            assert!(valider(&tierce(id)).is_err(), "{id:?}");
        }
        let mut s = tierce("dupont");
        s.nom = "  ".into();
        assert!(valider(&s).is_err());
        let mut s = tierce("dupont");
        s.depot = "https://github.com/dupont/scripts-windows".into();
        assert!(valider(&s).is_err(), "le depot s'inscrit normalise");
        let mut s = tierce("dupont");
        s.cle = "pas une cle".into();
        assert!(valider(&s).is_err());
    }

    #[test]
    fn l_officielle_vient_en_premier() {
        let (liste, _) = toutes();
        assert!(liste[0].officielle);
        assert_eq!(liste[0].id, catalogue::SOURCE);
    }

    #[cfg(windows)]
    mod registre {
        use super::*;
        use windows_registry::CURRENT_USER;

        /// Une sous-cle jetable de HKCU : les tests n'ont pas les droits sur HKLM.
        struct Bac(String);

        impl Bac {
            fn neuf(nom: &str) -> Bac {
                let c = format!(r"SOFTWARE\WinTool-tests-{}-{nom}", std::process::id());
                let _ = CURRENT_USER.remove_tree(&c);
                Bac(c)
            }
        }

        impl Drop for Bac {
            fn drop(&mut self) {
                let _ = CURRENT_USER.remove_tree(&self.0);
            }
        }

        #[test]
        fn une_source_s_inscrit_se_relit_et_se_retire() {
            let bac = Bac::neuf("sources");
            enregistrer_dans(CURRENT_USER, &bac.0, &tierce("dupont")).unwrap();
            let (sources, problemes) = tierces_depuis(CURRENT_USER, &bac.0);
            assert!(problemes.is_empty(), "{problemes:?}");
            assert_eq!(sources, vec![tierce("dupont")]);

            retirer_de(CURRENT_USER, &bac.0, "dupont").unwrap();
            assert!(tierces_depuis(CURRENT_USER, &bac.0).0.is_empty());
        }

        #[test]
        fn une_entree_trafiquee_est_ignoree_et_signalee() {
            let bac = Bac::neuf("trafiquee");
            enregistrer_dans(CURRENT_USER, &bac.0, &tierce("dupont")).unwrap();
            // Quelqu'un change la cle a la main : elle ne se decode plus.
            CURRENT_USER
                .create(format!(r"{}\dupont", bac.0))
                .unwrap()
                .set_string("Cle", "RWabc")
                .unwrap();
            let (sources, problemes) = tierces_depuis(CURRENT_USER, &bac.0);
            assert!(sources.is_empty());
            assert_eq!(problemes.len(), 1);
        }

        #[test]
        fn rien_d_inscrit_n_est_pas_une_erreur() {
            let bac = Bac::neuf("vide");
            let (sources, problemes) = tierces_depuis(CURRENT_USER, &bac.0);
            assert!(sources.is_empty() && problemes.is_empty());
        }
    }
}
