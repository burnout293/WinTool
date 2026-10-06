//! Simulation (specification §6.9).
//!
//! Un script sait se simuler s'il declare l'option `SafeTest` : il montre
//! alors ce qu'il ferait, sans rien modifier. Que ce script soit simule ou non
//! est un reglage ordinaire, enregistre dans sa configuration comme n'importe
//! quelle autre option, et **conserve d'une session a l'autre** : c'est le
//! choix de l'utilisateur, qui regle la simulation script par script.
//!
//! L'interrupteur general n'a pas d'etat propre. Il se deduit des scripts :
//! desactive si aucun script simulable n'est simule, active s'ils le sont
//! tous, partiel sinon. Le basculer revient a regler tous les scripts d'un coup.
//!
//! Avant la 1.1.1, le mode test etait un etat de session, perdu a la
//! fermeture, pour qu'un entretien reel ne passe jamais pour une simulation.
//! La persistance inverse le risque : croire reel un entretien simule. D'ou
//! deux garde-fous, assures ailleurs mais decides ici :
//! - chaque execution porte `simulated`, et une execution simulee n'est jamais
//!   comptee comme « fait » (§7) ;
//! - quand la simulation est **activee** — l'intention « rien de reel » est
//!   alors sans ambiguite —, un script qui ne sait pas se simuler est refuse,
//!   plutot que lance pour de vrai pendant que l'interface annonce l'inverse.

use crate::contract::{DefaultValue, Script};
use crate::settings::{self, Settings};
use serde::Serialize;

/// Cle d'option par laquelle un script declare savoir se simuler. Le nom reste
/// celui du contrat de script (`docs/FORMAT_SCRIPT.md`) ; l'interface, elle,
/// parle partout de « simulation » et impose son propre libelle.
pub const CLE: &str = "SafeTest";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Etat {
    Desactivee,
    Partielle,
    Activee,
}

/// Ce que l'interrupteur general affiche.
#[derive(Debug, Clone, Serialize)]
pub struct Bilan {
    pub etat: Etat,
    /// Scripts qui declarent savoir se simuler.
    pub simulables: usize,
    /// Parmi eux, ceux qui le sont actuellement.
    pub simules: usize,
}

/// Ce qu'il advient d'un script au moment de le lancer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Lance avec `SafeTest = true` : il ne modifie rien.
    Simuler,
    /// Lance normalement.
    Reel,
    /// Non lance : la simulation est activee et ce script ne sait pas se simuler.
    Refuser,
}

pub fn simulable(meta: &Script) -> bool {
    meta.options.iter().any(|o| o.key == CLE)
}

/// Une valeur de configuration lue comme un booleen, quelle que soit la forme
/// sous laquelle elle a ete enregistree : `true`, `"True"`, `1`.
fn vrai(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::String(s) => s.eq_ignore_ascii_case("true"),
        serde_json::Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0),
        _ => false,
    }
}

/// Ce script est-il simule ? La valeur enregistree fait foi ; a defaut, la
/// valeur par defaut que le script declare ; a defaut, non.
pub fn simule(reglages: &Settings, id: &str, meta: &Script) -> bool {
    if !simulable(meta) {
        return false;
    }
    if let Some(v) = reglages.overrides.get(id).and_then(|o| o.config.get(CLE)) {
        return vrai(v);
    }
    meta.options
        .iter()
        .find(|o| o.key == CLE)
        .and_then(|o| o.default.as_ref())
        .is_some_and(|d| matches!(d, DefaultValue::Bool(true)))
}

pub fn bilan<'a>(
    reglages: &Settings,
    scripts: impl IntoIterator<Item = (&'a str, &'a Script)>,
) -> Bilan {
    let (mut simulables, mut simules) = (0, 0);
    for (id, meta) in scripts {
        if simulable(meta) {
            simulables += 1;
            if simule(reglages, id, meta) {
                simules += 1;
            }
        }
    }
    let etat = if simules == 0 {
        Etat::Desactivee
    } else if simules == simulables {
        Etat::Activee
    } else {
        Etat::Partielle
    };
    Bilan {
        etat,
        simulables,
        simules,
    }
}

pub fn decision(reglages: &Settings, id: &str, meta: &Script, general: &Bilan) -> Decision {
    if simulable(meta) {
        if simule(reglages, id, meta) {
            Decision::Simuler
        } else {
            Decision::Reel
        }
    } else if general.etat == Etat::Activee {
        Decision::Refuser
    } else {
        Decision::Reel
    }
}

/// Regle la simulation de tous les scripts qui savent se simuler. C'est ce que
/// fait l'interrupteur general ; ensuite, chaque script se regle a nouveau un
/// par un.
pub fn tout_regler<'a>(
    reglages: &mut Settings,
    scripts: impl IntoIterator<Item = (&'a str, &'a Script)>,
    valeur: bool,
) {
    for (id, meta) in scripts {
        if simulable(meta) {
            settings::set_config_value(reglages, id, CLE, Some(serde_json::Value::Bool(valeur)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::parse;

    /// Un script minimal, lu par le vrai parseur. `defaut` : valeur par defaut
    /// de `SafeTest`, ou `None` si le script ne sait pas se simuler.
    fn script(defaut: Option<bool>) -> Script {
        let (decl, conf) = match defaut {
            Some(d) => (
                "## SafeTest : [bool] Safe test\n",
                format!("    SafeTest = ${d}\n"),
            ),
            None => ("", String::new()),
        };
        parse(&format!(
            "## WINTOOL:START\n## id : 00000000-0000-4000-8000-000000000001\n## lang : en\n\
             ## title : T\n## desc : D\n## category : tools\n## icon : wrench\n\
             ## version : 1.0\n## admin : true\n## risk : low\n## duration : fast\n\
             ## reversible : true\n## interruptible : true\n## reboot : false\n\
             ## engine : auto\n## WINTOOL:END\n\n\
             ## WINTOOL:OPTIONS\n## Verbose : [bool] Verbose\n{decl}## WINTOOL:END\n\n\
             $CONFIG = @{{\n    Verbose = $false\n{conf}}}\n"
        ))
    }

    fn reglages() -> Settings {
        settings::default_settings(Vec::new())
    }

    #[test]
    fn un_script_sans_safetest_n_est_jamais_simule() {
        let s = script(None);
        assert!(!simulable(&s));
        let mut r = reglages();
        // Meme si une valeur trainait dans sa configuration.
        settings::set_config_value(&mut r, "a", CLE, Some(serde_json::Value::Bool(true)));
        assert!(!simule(&r, "a", &s));
    }

    #[test]
    fn la_valeur_enregistree_prime_sur_le_defaut_du_script() {
        let s = script(Some(true));
        let mut r = reglages();
        assert!(
            simule(&r, "a", &s),
            "sans reglage, le defaut du script s'applique"
        );
        settings::set_config_value(&mut r, "a", CLE, Some(serde_json::Value::Bool(false)));
        assert!(!simule(&r, "a", &s), "le reglage enregistre fait foi");
    }

    #[test]
    fn une_valeur_enregistree_sous_forme_de_texte_est_bien_lue() {
        let s = script(Some(false));
        let mut r = reglages();
        settings::set_config_value(&mut r, "a", CLE, Some(serde_json::json!("True")));
        assert!(simule(&r, "a", &s));
        settings::set_config_value(&mut r, "a", CLE, Some(serde_json::json!(1)));
        assert!(simule(&r, "a", &s));
    }

    #[test]
    fn l_etat_general_se_deduit_des_scripts() {
        let (a, b, c) = (script(Some(false)), script(Some(false)), script(None));
        let tous = || [("a", &a), ("b", &b), ("c", &c)];
        let mut r = reglages();

        let g = bilan(&r, tous());
        assert_eq!((g.etat, g.simulables, g.simules), (Etat::Desactivee, 2, 0));

        settings::set_config_value(&mut r, "a", CLE, Some(serde_json::Value::Bool(true)));
        assert_eq!(bilan(&r, tous()).etat, Etat::Partielle);

        // Le script qui ne sait pas se simuler ne compte pas : « tous » veut
        // dire tous ceux qui le peuvent.
        settings::set_config_value(&mut r, "b", CLE, Some(serde_json::Value::Bool(true)));
        assert_eq!(bilan(&r, tous()).etat, Etat::Activee);
    }

    #[test]
    fn sans_aucun_script_simulable_la_simulation_est_desactivee() {
        let c = script(None);
        assert_eq!(bilan(&reglages(), [("c", &c)]).etat, Etat::Desactivee);
    }

    #[test]
    fn activee_refuse_les_scripts_qui_ne_savent_pas_se_simuler() {
        let (a, c) = (script(Some(true)), script(None));
        let r = reglages();
        let g = bilan(&r, [("a", &a), ("c", &c)]);
        assert_eq!(g.etat, Etat::Activee);
        assert_eq!(decision(&r, "a", &a, &g), Decision::Simuler);
        assert_eq!(decision(&r, "c", &c, &g), Decision::Refuser);
    }

    #[test]
    fn partielle_laisse_chaque_script_suivre_son_reglage() {
        let (a, b, c) = (script(Some(true)), script(Some(false)), script(None));
        let r = reglages();
        let g = bilan(&r, [("a", &a), ("b", &b), ("c", &c)]);
        assert_eq!(g.etat, Etat::Partielle);
        assert_eq!(decision(&r, "a", &a, &g), Decision::Simuler);
        assert_eq!(decision(&r, "b", &b, &g), Decision::Reel);
        // Choix fait script par script : rien n'annonce que celui-ci serait simule.
        assert_eq!(decision(&r, "c", &c, &g), Decision::Reel);
    }

    #[test]
    fn l_interrupteur_general_regle_tous_les_scripts_simulables() {
        let (a, b, c) = (script(Some(false)), script(Some(true)), script(None));
        let mut r = reglages();
        tout_regler(&mut r, [("a", &a), ("b", &b), ("c", &c)], true);
        assert_eq!(
            bilan(&r, [("a", &a), ("b", &b), ("c", &c)]).etat,
            Etat::Activee
        );
        // Rien n'est ecrit pour un script qui ne sait pas se simuler.
        assert!(!r
            .overrides
            .get("c")
            .is_some_and(|o| o.config.contains_key(CLE)));

        tout_regler(&mut r, [("a", &a), ("b", &b), ("c", &c)], false);
        assert_eq!(
            bilan(&r, [("a", &a), ("b", &b), ("c", &c)]).etat,
            Etat::Desactivee
        );
    }
}
