//! Mise a jour de WinTool (specification §11).
//!
//! Le greffon officiel `tauri-plugin-updater` fait le travail delicat, et son
//! code a ete lu avant d'etre retenu :
//!
//! - il telecharge le manifeste `latest.json` de la derniere release publiee.
//!   La requete ne porte que `User-Agent: tauri-plugin-updater/<version>` et
//!   `Accept: application/json` ; notre adresse etant fixe, aucune variable
//!   (`{{current_version}}`, `{{arch}}`...) n'y est substituee. Rien n'identifie
//!   la machine, pas meme la version installee — ce que la licence promet ;
//! - il telecharge l'installeur **en memoire**, verifie sa signature minisign
//!   avec la cle publique de `tauri.conf.json`, et seulement ensuite l'execute.
//!   Rien n'est ecrit ni lance avant la verification ;
//! - `requireSignedVersion` est active : la version annoncee par le manifeste,
//!   qui n'est pas signe, doit egaler celle inscrite dans la partie signee de la
//!   signature. Sans cela, une reponse falsifiee pourrait associer « 9.9.9 » a
//!   un ancien installeur authentique mais vulnerable. Verifie empiriquement :
//!   la CLI 2.11.5 inscrit bien `version:` dans le commentaire signe.
//!
//! Ce module ne fait qu'exposer ce greffon a l'interface, dans le respect du
//! §11 : detecter et proposer, rien d'installe sans un clic.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_updater::UpdaterExt;

/// Une version plus recente, telle que l'interface la presente.
#[derive(Debug, Clone, Serialize)]
pub struct Disponible {
    pub version: String,
    pub actuelle: String,
    /// Notes de version, telles que publiees sur la release.
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Progression du telechargement, emise sur `update:progress`.
#[derive(Debug, Clone, Serialize)]
struct Progression {
    recu: u64,
    total: Option<u64>,
}

/// Politiques admises pour le reglage `update_policy`.
pub const POLITIQUES: [&str; 2] = ["propose", "never"];

pub fn politique_valide(p: &str) -> bool {
    POLITIQUES.contains(&p)
}

/// Interroge la derniere release publiee. `None` : WinTool est a jour.
pub async fn verifier<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Disponible>, String> {
    let maj = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(maj.map(|u| Disponible {
        version: u.version.clone(),
        actuelle: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

/// Telecharge, verifie et installe. Sous Windows, le greffon lance
/// l'installeur puis ferme l'application : cette fonction ne revient donc
/// qu'en cas d'echec.
///
/// On re-interroge le manifeste plutot que de reutiliser le resultat de
/// `verifier` : entre les deux, l'utilisateur a pu laisser l'application
/// ouverte des heures, et c'est la release publiee *maintenant* qu'on installe.
pub async fn installer<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let maj = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "WinTool est deja a jour.".to_string())?;

    let emetteur = app.clone();
    let mut recu: u64 = 0;
    maj.download_and_install(
        move |morceau, total| {
            recu += morceau as u64;
            let _ = emetteur.emit("update:progress", Progression { recu, total });
        },
        || {},
    )
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seules_les_politiques_connues_sont_admises() {
        assert!(politique_valide("propose"));
        assert!(politique_valide("never"));
        // L'interface n'en propose pas d'autre ; une valeur inconnue enregistree
        // serait lue au demarrage sans que personne ne sache quoi en faire.
        assert!(!politique_valide("auto"));
        assert!(!politique_valide(""));
        assert!(!politique_valide("Propose"));
    }
}
