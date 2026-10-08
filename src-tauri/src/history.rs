//! Historique des exécutions (specification §9/§14).
//!
//! Granularité retenue par défaut (§14, "hypothèse... pour pouvoir être
//! contestée, pas dissimulée") : **une entrée par lot lancé et une par
//! script exécuté**. Rétention **maximale** — contrairement aux journaux
//! techniques (plafonnés par taille, §9), rien n'est jamais purgé ici. C'est
//! ce qui alimente les affichages "Fait le 18 septembre" (§7) : une date de
//! lancement constatée, jamais une preuve que l'effet est toujours en place.

use crate::discovery;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptRunRecord {
    pub script_id: String,
    /// Capturé au moment du run : survit si le script est renommé ou
    /// supprimé ensuite, contrairement à une simple référence par id.
    pub title: String,
    pub at: String,
    pub success: bool,
    pub killed: bool,
    /// Millisecondes. `u64` et non `u128` : les arguments et les evenements
    /// Tauri transitent par un `serde_json::Value`, dont le type `Number` ne
    /// connait que u64/i64/f64. Un `u128` faisait echouer la deserialisation
    /// de `record_script_run`, et l'historique restait vide sans le dire.
    pub duration_ms: u64,
    /// Execution simulee (§6.9) : rien n'a ete modifie. Elle reste dans
    /// l'historique, mais ne compte jamais comme « Fait le … » (§7).
    /// `default` : les historiques ecrits avant la 1.1.1 n'ont pas ce champ, et
    /// la simulation n'y etait jamais persistante.
    #[serde(default)]
    pub simulated: bool,
    /// Octets reellement liberes, tels que le script les a annonces par
    /// `[FREED]` (§17). Absent si le script ne l'a pas dit : l'historique ne
    /// remplace jamais un chiffre mesure par une estimation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freed: Option<u64>,
}

/// `alias` : jusqu'a la 1.2.1, un lot s'appelait une categorie, et l'historique
/// l'ecrivait `category_id` / `category_name` dans `categories`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LotRunRecord {
    #[serde(alias = "category_id")]
    pub lot_id: String,
    #[serde(alias = "category_name")]
    pub lot_name: String,
    pub at: String,
    pub script_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct History {
    #[serde(default, alias = "categories")]
    pub lots: Vec<LotRunRecord>,
    #[serde(default)]
    pub scripts: Vec<ScriptRunRecord>,
}

pub fn history_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(discovery::base_dir(app)?.join("history.json"))
}

/// Un fichier absent ou corrompu n'est pas une erreur : un historique vide,
/// pas un blocage (même esprit que `settings::load`).
pub fn load_from(chemin: &Path) -> History {
    fs::read_to_string(chemin)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_to(chemin: &Path, history: &History) -> Result<(), String> {
    if let Some(parent) = chemin.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("creation de {} : {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    fs::write(chemin, json).map_err(|e| format!("ecriture de {} : {e}", chemin.display()))
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<History, String> {
    Ok(load_from(&history_path(app)?))
}

fn save<R: Runtime>(app: &AppHandle<R>, history: &History) -> Result<(), String> {
    save_to(&history_path(app)?, history)
}

pub fn record_script_run<R: Runtime>(
    app: &AppHandle<R>,
    record: ScriptRunRecord,
) -> Result<(), String> {
    let mut h = load(app)?;
    h.scripts.push(record);
    save(app, &h)
}

pub fn record_lot_run<R: Runtime>(app: &AppHandle<R>, record: LotRunRecord) -> Result<(), String> {
    let mut h = load(app)?;
    h.lots.push(record);
    save(app, &h)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dossier_test(nom: &str) -> PathBuf {
        std::env::temp_dir().join(format!("wintool-test-history-{nom}-{}", std::process::id()))
    }

    /// Regression : `duration_ms` etait un `u128`, et les arguments de commande
    /// Tauri passent par un `serde_json::Value` dont `Number` ne connait que
    /// u64/i64/f64. `record_script_run` echouait donc silencieusement et
    /// l'historique restait vide alors que les scripts tournaient.
    #[test]
    fn une_entree_survit_a_l_aller_retour_json() {
        let record = ScriptRunRecord {
            script_id: "set-dns".into(),
            title: "Configurer DNS".into(),
            at: "2026-09-24T23:11:55Z".into(),
            success: true,
            killed: false,
            duration_ms: 1_420,
            simulated: true,
            freed: Some(795_278_422),
        };
        // `to_value` puis `from_value` : exactement le chemin d'une commande.
        let valeur = serde_json::to_value(&record).expect("serialisation");
        let relu: ScriptRunRecord = serde_json::from_value(valeur).expect("deserialisation");
        assert_eq!(relu.duration_ms, 1_420);
        assert_eq!(relu.freed, Some(795_278_422));
        assert_eq!(relu.script_id, "set-dns");
        assert!(
            relu.simulated,
            "une execution simulee doit le rester apres relecture"
        );
    }

    /// Un historique ecrit par la 1.1.0 n'a pas le champ `simulated` : il doit
    /// se relire tel quel, chaque entree etant alors une execution reelle — la
    /// simulation n'etait jamais persistante avant la 1.1.1.
    #[test]
    fn un_historique_d_avant_la_simulation_persistante_se_relit() {
        let ancien = r#"{"scripts":[{"script_id":"s1","title":"T","at":"2026-10-01 10:00:00",
                        "success":true,"killed":false,"duration_ms":10}],"categories":[]}"#;
        let h: History = serde_json::from_str(ancien).expect("historique 1.1.0 illisible");
        assert_eq!(h.scripts.len(), 1);
        assert!(!h.scripts[0].simulated);
    }

    #[test]
    fn un_historique_de_la_1_2_relit_ses_categories_comme_des_lots() {
        let ancien = r#"{"scripts":[],"categories":[{"category_id":"cleaning",
                        "category_name":"Faire le ménage","at":"2026-10-01 10:00:00","script_ids":["s1"]}]}"#;
        let h: History = serde_json::from_str(ancien).expect("historique 1.2 illisible");
        assert_eq!(h.lots.len(), 1);
        assert_eq!(h.lots[0].lot_id, "cleaning");
        assert_eq!(h.lots[0].lot_name, "Faire le ménage");
        assert!(h.scripts.is_empty());
    }

    #[test]
    fn un_historique_absent_est_vide_pas_une_erreur() {
        let h = load_from(Path::new("D:/chemin/qui/n/existe/pas/history.json"));
        assert!(h.scripts.is_empty() && h.lots.is_empty());
    }

    #[test]
    fn accumule_les_entrees_sans_ecraser_les_precedentes() {
        let dir = dossier_test("accumule");
        fs::create_dir_all(&dir).unwrap();
        let chemin = dir.join("history.json");
        let _ = fs::remove_file(&chemin);

        let mut h = load_from(&chemin);
        h.scripts.push(ScriptRunRecord {
            script_id: "s1".into(),
            title: "Premier".into(),
            at: "2026-09-23T10:00:00Z".into(),
            success: true,
            killed: false,
            duration_ms: 100,
            simulated: false,
            freed: None,
        });
        save_to(&chemin, &h).unwrap();

        let mut h2 = load_from(&chemin);
        h2.scripts.push(ScriptRunRecord {
            script_id: "s2".into(),
            title: "Second".into(),
            at: "2026-09-23T10:05:00Z".into(),
            success: false,
            killed: false,
            duration_ms: 50,
            simulated: false,
            freed: None,
        });
        save_to(&chemin, &h2).unwrap();

        let relu = load_from(&chemin);
        assert_eq!(relu.scripts.len(), 2);
        assert_eq!(relu.scripts[0].script_id, "s1");
        assert_eq!(relu.scripts[1].script_id, "s2");

        let _ = fs::remove_dir_all(&dir);
    }
}
