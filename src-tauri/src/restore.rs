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
    /// Le service dont depend la restauration du systeme est desactive.
    ServiceDisabled,
    /// Refus pour une autre raison ; le message brut est conserve pour le
    /// diagnostic, jamais pour accuser un succes qui n'a pas eu lieu.
    Failed(String),
}

/// Cree un point de restauration. Bloquant : `Checkpoint-Computer` prend
/// quelques secondes, ce qui correspond a l'attente deja annoncee a
/// l'utilisateur avant le lancement d'une categorie (specification §2, étape 2).
///
/// Le verdict ne repose pas sur le texte de Windows, qui change avec sa langue :
/// on compare le dernier point avant et apres, et on lit l'identifiant stable de
/// l'erreur (`FullyQualifiedErrorId`). Deux cas que le code de sortie seul ne
/// distinguait pas : Windows **n'echoue pas** quand un point existe deja depuis
/// moins de 24 h — il avertit et ne cree rien —, et la sortie arrivait dans la
/// page de code de la console, d'ou des accents illisibles.
pub fn creer_point_de_restauration(description: &str) -> Result<RestoreOutcome, String> {
    // Guillemets simples doubles : la seule sequence d'echappement dont
    // PowerShell a besoin a l'interieur d'une chaine deja entre guillemets simples.
    let description_echappee = description.replace('\'', "''");
    let commande = format!(
        "$ErrorActionPreference = 'Stop'; \
         [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); \
         function Dernier {{ try {{ (@(Get-ComputerRestorePoint -ErrorAction SilentlyContinue) | Select-Object -Last 1).SequenceNumber }} catch {{ $null }} }}; \
         try {{ \
           $avant = Dernier; \
           Checkpoint-Computer -Description '{description_echappee}' -RestorePointType MODIFY_SETTINGS -WarningAction SilentlyContinue; \
           $apres = Dernier; \
           if ($null -eq $apres) {{ 'WINTOOL:AUCUN' }} elseif ($apres -eq $avant) {{ 'WINTOOL:RECENT' }} else {{ 'WINTOOL:CREE' }} \
         }} catch {{ \
           'WINTOOL:ERREUR ' + $_.FullyQualifiedErrorId; \
           $_.Exception.Message \
         }}"
    );

    // Chemin absolu, lu dans HKLM : ce processus est eleve (specification 12.4).
    let sortie = Command::new(crate::systeme::emplacements().powershell())
        .args(["-NoProfile", "-NonInteractive", "-Command", &commande])
        .output()
        .map_err(|e| format!("lancement de Checkpoint-Computer impossible : {e}"))?;

    let texte = String::from_utf8_lossy(&sortie.stdout);
    if texte.contains("WINTOOL:") {
        return Ok(interpreter(&texte));
    }
    // Le script n'a meme pas pu s'executer : on garde ce que PowerShell a dit.
    Ok(classer_echec(&String::from_utf8_lossy(&sortie.stderr)))
}

/// Lit le verdict ecrit par le script de [`creer_point_de_restauration`].
fn interpreter(sortie: &str) -> RestoreOutcome {
    let mut lignes = sortie
        .lines()
        .map(str::trim)
        .skip_while(|l| !l.starts_with("WINTOOL:"));
    let verdict = lignes.next().unwrap_or_default();
    match verdict {
        "WINTOOL:CREE" => RestoreOutcome::Created,
        "WINTOOL:RECENT" => RestoreOutcome::ThrottledRecent,
        // Aucun point, meme apres une creation sans erreur : la protection du
        // disque systeme est coupee.
        "WINTOOL:AUCUN" => RestoreOutcome::ProtectionDisabled,
        _ => {
            let id = verdict.strip_prefix("WINTOOL:ERREUR").unwrap_or("").trim();
            let message = lignes.collect::<Vec<_>>().join(" ").trim().to_string();
            if id.starts_with("ServiceDisabled") {
                RestoreOutcome::ServiceDisabled
            } else {
                match classer_echec(&message) {
                    RestoreOutcome::Failed(_) if !id.is_empty() => {
                        RestoreOutcome::Failed(format!("{message} ({id})"))
                    }
                    autre => autre,
                }
            }
        }
    }
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
        || minuscule.contains("protection")
            && (minuscule.contains("desactiv") || minuscule.contains("désactiv"))
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
    fn lit_le_verdict_sans_dependre_de_la_langue() {
        assert_eq!(
            interpreter(
                "WINTOOL:CREE
"
            ),
            RestoreOutcome::Created
        );
        assert_eq!(
            interpreter("WINTOOL:RECENT"),
            RestoreOutcome::ThrottledRecent
        );
        assert_eq!(
            interpreter("WINTOOL:AUCUN"),
            RestoreOutcome::ProtectionDisabled
        );
        // La capture de l'utilisateur, 1.4.0 : service desactive, message en
        // francais. C'est l'identifiant qui tranche, pas la phrase.
        let sortie =
            "WINTOOL:ERREUR ServiceDisabled,Microsoft.PowerShell.Commands.CheckpointComputerCommand
                      Impossible d'exécuter cette commande : le service ne peut pas démarrer.";
        assert_eq!(interpreter(sortie), RestoreOutcome::ServiceDisabled);
    }

    #[test]
    fn une_erreur_inconnue_garde_son_message_et_son_identifiant() {
        let sortie = "WINTOOL:ERREUR Autre,Commande
Quelque chose d'imprévu.";
        assert_eq!(
            interpreter(sortie),
            RestoreOutcome::Failed("Quelque chose d'imprévu. (Autre,Commande)".to_string())
        );
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
