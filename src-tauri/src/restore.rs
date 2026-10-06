//! Point de restauration Windows avant le lancement d'une categorie
//! (specification 6.4).
//!
//! Regle centrale : les scripts n'en creent jamais eux-memes, seule
//! l'application le fait, une fois par categorie lancee (pas une fois par
//! script). Et surtout : « a traiter explicitement, jamais en silence ». La
//! protection systeme est desactivee par defaut sur beaucoup d'installations
//! Windows 10/11, et Windows refuse plus d'un point par 24h — ces deux refus
//! sont attendus, jamais une erreur bloquante, mais doivent etre rapportes
//! pour ce qu'ils sont, pas maquilles en succes.
//!
//! Implemente via `Checkpoint-Computer` (natif PowerShell, aucune dependance),
//! le meme mecanisme que System Restore expose a l'utilisateur.

use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RestoreOutcome {
    /// Le point a bien ete cree.
    Created,
    /// Windows n'autorise qu'un point par 24h ; un point recent existe deja.
    ThrottledRecent,
    /// La protection systeme est desactivee sur ce volume : rien a creer tant
    /// qu'elle ne l'est pas.
    ProtectionDisabled,
    /// Refus pour une autre raison ; le message brut est conserve pour le
    /// diagnostic, jamais pour accuser un succes qui n'a pas eu lieu.
    Failed(String),
}

/// Cree un point de restauration. Bloquant : `Checkpoint-Computer` prend
/// quelques secondes, ce qui correspond a l'attente deja annoncee a
/// l'utilisateur avant le lancement d'une categorie (specification §2, étape 2).
pub fn creer_point_de_restauration(description: &str) -> Result<RestoreOutcome, String> {
    // Guillemets simples doubles : la seule sequence d'echappement dont
    // PowerShell a besoin a l'interieur d'une chaine deja entre guillemets simples.
    let description_echappee = description.replace('\'', "''");
    let commande = format!(
        "Checkpoint-Computer -Description '{description_echappee}' -RestorePointType MODIFY_SETTINGS"
    );

    // Chemin absolu, lu dans HKLM : ce processus est eleve (specification 12.4).
    let sortie = Command::new(crate::systeme::emplacements().powershell())
        .args(["-NoProfile", "-NonInteractive", "-Command", &commande])
        .output()
        .map_err(|e| format!("lancement de Checkpoint-Computer impossible : {e}"))?;

    if sortie.status.success() {
        return Ok(RestoreOutcome::Created);
    }

    Ok(classer_echec(&String::from_utf8_lossy(&sortie.stderr)))
}

/// Classement du message d'erreur de `Checkpoint-Computer` en l'un des refus
/// attendus. Fonction pure et separee de l'appel process : c'est ce qui la
/// rend testable sans jamais executer `Checkpoint-Computer` (un vrai point de
/// restauration n'est pas un effet de bord qu'un test unitaire doit provoquer).
fn classer_echec(stderr: &str) -> RestoreOutcome {
    let minuscule = stderr.to_lowercase();
    // Message Windows typique : "...system restore point was already created
    // within the past 24 hours...". On ne prete qu'aux mots stables face aux
    // variantes de version/langue plutot qu'a la phrase entiere.
    if minuscule.contains("24 hours") || minuscule.contains("24 heures") {
        RestoreOutcome::ThrottledRecent
    } else if minuscule.contains("system restore") && minuscule.contains("disabled")
        || minuscule.contains("protection") && minuscule.contains("desactiv")
    {
        RestoreOutcome::ProtectionDisabled
    } else {
        RestoreOutcome::Failed(stderr.trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classe_le_refus_par_frequence() {
        let msg = "Checkpoint-Computer : The system restore point could not be created \
                   because a system restore point was already created within the past \
                   24 hours.";
        assert_eq!(classer_echec(msg), RestoreOutcome::ThrottledRecent);
    }

    #[test]
    fn classe_la_protection_desactivee() {
        let msg = "Checkpoint-Computer : System Restore is disabled on this computer.";
        assert_eq!(classer_echec(msg), RestoreOutcome::ProtectionDisabled);
    }

    #[test]
    fn un_message_inconnu_reste_un_echec_signale_pas_cache() {
        let msg = "Une erreur totalement inattendue.";
        assert_eq!(
            classer_echec(msg),
            RestoreOutcome::Failed("Une erreur totalement inattendue.".to_string())
        );
    }
}
