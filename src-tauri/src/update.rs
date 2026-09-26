//! Mise à jour (specification §11).
//!
//! Ce module ne contient que la logique testable sans réseau : comparaison
//! de version et vérification de checksum. L'appel réel à l'API GitHub
//! (lister les releases, télécharger l'exécutable et son `.sha256`) manque
//! deux ingrédients que ce projet n'a pas encore : un dépôt GitHub existant
//! (confirmé absent par l'utilisateur le 23/09/2026 — le projet n'est pas
//! encore publié) et un client HTTP, qui n'est **volontairement** pas une
//! dépendance aujourd'hui. En ajouter un maintenant, pour un dépôt qui
//! n'existe pas, serait une dépendance ajoutée pour du code qu'on ne peut ni
//! tester ni utiliser.
//!
//! À compléter quand le dépôt existe : ajouter un client HTTP (`ureq`,
//! plus léger que `reqwest` pour un usage aussi simple), appeler
//! `GET /repos/<propriétaire>/<nom>/releases/latest`, comparer
//! `env!("CARGO_PKG_VERSION")` au `tag_name` reçu via [`version_plus_recente_disponible`],
//! puis vérifier le fichier téléchargé avec [`verifier_checksum`] avant de
//! proposer l'installation — jamais après, et jamais automatiquement
//! (§11 : « détecter et proposer, rien d'installé sans consentement explicite »).

// Pas encore appelees : aucune commande ne les expose tant que le depot
// GitHub n'existe pas (voir le commentaire de module). Le code est pret et
// teste ; seul le branchement reseau manque.
#![allow(dead_code)]

use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::path::Path;

/// Compare deux versions au format `X.Y.Z` (un `v` de tête est toléré). Un
/// segment non numérique vaut 0 plutôt que de faire échouer la comparaison :
/// mieux vaut une comparaison approximative sur un tag mal formé qu'aucune.
pub fn comparer_versions(actuelle: &str, distante: &str) -> Ordering {
    let segments = |s: &str| -> Vec<u64> {
        s.trim_start_matches('v')
            .split('.')
            .map(|p| {
                p.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .unwrap_or(0)
            })
            .collect()
    };
    let a = segments(actuelle);
    let b = segments(distante);
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            Ordering::Equal => continue,
            autre => return autre,
        }
    }
    Ordering::Equal
}

pub fn version_plus_recente_disponible(actuelle: &str, distante: &str) -> bool {
    comparer_versions(actuelle, distante) == Ordering::Less
}

/// Vérifie le contenu d'un fichier téléchargé contre le `.sha256` publié à
/// côté de la release. Ne remplace pas une signature Authenticode (l'exe
/// reste non signé, §11), mais détecte un transit corrompu ou un CDN
/// compromis sans avoir besoin d'un certificat payant.
pub fn verifier_checksum(chemin: &Path, attendu_hex: &str) -> Result<bool, String> {
    let octets =
        std::fs::read(chemin).map_err(|e| format!("lecture de {} : {e}", chemin.display()))?;
    let mut h = Sha256::new();
    h.update(&octets);
    let calcule: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Ok(calcule.eq_ignore_ascii_case(attendu_hex.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecte_une_version_plus_recente() {
        assert!(version_plus_recente_disponible("1.0.0", "1.0.1"));
        assert!(version_plus_recente_disponible("1.0.0", "v1.1.0"));
        assert!(!version_plus_recente_disponible("1.1.0", "1.0.9"));
        assert!(!version_plus_recente_disponible("1.0.0", "1.0.0"));
    }

    #[test]
    fn tolere_un_prefixe_v_et_des_segments_manquants() {
        assert_eq!(comparer_versions("v1.0", "1.0.0"), Ordering::Equal);
        assert_eq!(comparer_versions("1", "1.0.1"), Ordering::Less);
    }

    #[test]
    fn verifie_un_checksum_correct_et_rejette_un_faux() {
        let dir = std::env::temp_dir().join(format!("wintool-test-update-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let chemin = dir.join("fichier.bin");
        std::fs::write(&chemin, b"contenu de test").unwrap();

        let mut h = Sha256::new();
        h.update(b"contenu de test");
        let bon_hash: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();

        assert!(verifier_checksum(&chemin, &bon_hash).unwrap());
        assert!(!verifier_checksum(
            &chemin,
            "0000000000000000000000000000000000000000000000000000000000000000"
        )
        .unwrap());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
