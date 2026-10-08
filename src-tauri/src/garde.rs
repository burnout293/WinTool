//! Garde des reglages transmis aux scripts (specification 12.4).
//!
//! Les reglages vivent dans `settings.json`, que n'importe quel programme
//! tournant sous le compte de l'utilisateur peut reecrire sans elevation. Or
//! ils partent tels quels a un script lance en administrateur : sans controle,
//! un programme sans droits n'aurait qu'a ecrire `C:\Windows` dans les
//! « dossiers supplementaires » du nettoyage des caches, puis attendre le
//! prochain entretien. WinTool lui aurait tenu l'echelle.
//!
//! Deux controles, juste avant le lancement :
//!
//! 1. **Chaque valeur a le type que le script declare.** Un choix fait partie
//!    de ses choix, une case a cocher est un booleen, un nombre un nombre. Cela
//!    ferme tout ce qui n'est pas du texte libre.
//! 2. **Aucun texte libre ne designe un emplacement protege** : Windows, les
//!    Program Files, ProgramData, les profils des autres, la racine d'un
//!    lecteur, les dossiers caches du systeme — et ce que l'utilisateur ajoute
//!    lui-meme. Chaque chemin est d'abord resolu (jonctions, liens, noms courts,
//!    `..`), puisqu'une liste noire comparee a la lettre se contourne.
//!
//! **La liste est a l'utilisateur.** Il peut en retirer un emplacement — pour un
//! script qui doit verifier les fichiers de Windows, par exemple — et en
//! ajouter. Mais ses changements vivent dans `HKLM\SOFTWARE\WinTool\Garde`, et
//! ne s'ecrivent qu'en administrateur : la liberte de retirer un emplacement ne
//! vaut que si un programme sans droits ne peut pas l'exercer a sa place. Dans
//! `settings.json`, il lui aurait suffi de reecrire le fichier. Retirer un
//! emplacement tres sensible fait l'objet d'un avertissement (interface).

use crate::contract::{DefaultValue, Opt, Script};
use crate::systeme::Emplacements;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

/// Retire le prefixe `\\?\` d'un chemin canonique (voir `discovery`).
fn sans_prefixe(chemin: PathBuf) -> PathBuf {
    let t = chemin.to_string_lossy();
    if let Some(r) = t.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{r}"));
    }
    if let Some(r) = t.strip_prefix(r"\\?\") {
        return PathBuf::from(r.to_string());
    }
    chemin
}

/// Forme comparable d'un chemin : resolu sur disque pour sa partie existante
/// (jonctions, liens, noms courts 8.3, casse reelle), puis complete lexicalement
/// pour le reste, et mis en minuscules — Windows ne distingue pas la casse.
pub fn normaliser(chemin: &Path) -> PathBuf {
    let mut existant = chemin.to_path_buf();
    let mut suite: Vec<std::ffi::OsString> = Vec::new();
    let base = loop {
        if let Ok(c) = std::fs::canonicalize(&existant) {
            break sans_prefixe(c);
        }
        match (
            existant.file_name().map(|f| f.to_os_string()),
            existant.parent(),
        ) {
            (Some(nom), Some(parent)) => {
                suite.push(nom);
                existant = parent.to_path_buf();
            }
            _ => break existant.clone(),
        }
    };
    let mut resultat = base;
    for nom in suite.into_iter().rev() {
        resultat.push(nom);
    }
    // Lexical : `.` et `..` de la partie qui n'existe pas encore.
    let mut propre = PathBuf::new();
    for c in resultat.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                propre.pop();
            }
            autre => propre.push(autre.as_os_str()),
        }
    }
    PathBuf::from(propre.to_string_lossy().to_lowercase())
}

/// La racine d'un lecteur : `C:\`, `D:\`.
fn est_racine(p: &Path) -> bool {
    let mut c = p.components();
    matches!(c.next(), Some(Component::Prefix(_)))
        && matches!(c.next(), Some(Component::RootDir))
        && c.next().is_none()
}

/// Dossiers caches a la racine du lecteur systeme, reserves au systeme.
/// (Pas `Documents and Settings` : c'est une jonction vers le dossier des
/// profils, qui une fois resolue protegerait aussi le profil de l'utilisateur.
/// Les profils ont leur propre regle.)
const RACINE_SYSTEME: [&str; 6] = [
    "System Volume Information",
    "$Recycle.Bin",
    "Recovery",
    "Boot",
    "Config.Msi",
    "PerfLogs",
];

/// Un emplacement de la liste integree, tel que les Reglages le montrent.
#[derive(Debug, Clone, Serialize)]
pub struct Integre {
    pub id: &'static str,
    pub chemins: Vec<String>,
    /// Le retirer demande une confirmation explicite (interface).
    pub tres_sensible: bool,
}

/// Identifiants des emplacements integres : ce sont eux que `ConfigGarde`
/// retire, pas des chemins, qui changent d'un PC a l'autre.
pub const IDS_INTEGRES: [&str; 7] = [
    "windows",
    "program_files",
    "installation",
    "racines_lecteurs",
    "program_data",
    "profils",
    "racine_systeme",
];

pub fn integres(e: &Emplacements, installation: Option<&Path>) -> Vec<Integre> {
    let texte = |p: &Path| p.display().to_string();
    let mut pf = vec![texte(&e.program_files)];
    pf.extend(e.program_files_x86.as_deref().map(texte));
    vec![
        Integre {
            id: "windows",
            chemins: vec![texte(&e.windows)],
            tres_sensible: true,
        },
        Integre {
            id: "program_files",
            chemins: pf,
            tres_sensible: true,
        },
        Integre {
            id: "installation",
            chemins: installation.map(texte).into_iter().collect(),
            tres_sensible: true,
        },
        Integre {
            id: "racines_lecteurs",
            chemins: Vec::new(),
            tres_sensible: true,
        },
        Integre {
            id: "program_data",
            chemins: vec![texte(&e.program_data)],
            tres_sensible: false,
        },
        Integre {
            id: "profils",
            chemins: vec![texte(&e.profils)],
            tres_sensible: false,
        },
        Integre {
            id: "racine_systeme",
            chemins: RACINE_SYSTEME
                .iter()
                .map(|d| format!(r"{}\{d}", e.lecteur))
                .collect(),
            tres_sensible: false,
        },
    ]
}

/// Ce que l'utilisateur a change a la liste : des emplacements integres retires
/// (par identifiant), des emplacements ajoutes.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ConfigGarde {
    pub retires: Vec<String>,
    pub ajouts: Vec<String>,
}

/// Emplacement de `ConfigGarde`, sous `HKEY_LOCAL_MACHINE` : rien ne s'y ecrit
/// sans elevation (meme raisonnement que le magasin d'approbations).
pub const CLE_GARDE: &str = r"SOFTWARE\WinTool\Garde";

#[cfg(windows)]
pub fn charger_depuis(racine: &windows_registry::Key, chemin: &str) -> ConfigGarde {
    let Ok(cle) = racine.open(chemin) else {
        return ConfigGarde::default();
    };
    let liste = |nom: &str| -> Vec<String> {
        cle.get_multi_string(nom)
            .unwrap_or_default()
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    };
    ConfigGarde {
        retires: liste("Retires"),
        ajouts: liste("Ajouts"),
    }
}

#[cfg(windows)]
pub fn enregistrer_dans(
    racine: &windows_registry::Key,
    chemin: &str,
    c: &ConfigGarde,
) -> Result<(), String> {
    let cle = racine
        .create(chemin)
        .map_err(|e| format!("ouverture de la liste des emplacements proteges : {e}"))?;
    for (nom, valeurs) in [("Retires", &c.retires), ("Ajouts", &c.ajouts)] {
        if valeurs.is_empty() {
            let _ = cle.remove_value(nom);
        } else {
            cle.set_multi_string(nom.to_string(), valeurs.as_slice())
                .map_err(|e| format!("ecriture de la liste des emplacements proteges : {e}"))?;
        }
    }
    Ok(())
}

#[cfg(windows)]
pub fn charger() -> ConfigGarde {
    charger_depuis(windows_registry::LOCAL_MACHINE, CLE_GARDE)
}

#[cfg(windows)]
pub fn enregistrer(c: &ConfigGarde) -> Result<(), String> {
    enregistrer_dans(windows_registry::LOCAL_MACHINE, CLE_GARDE, c)
}

#[cfg(not(windows))]
pub fn charger() -> ConfigGarde {
    ConfigGarde::default()
}

#[cfg(not(windows))]
pub fn enregistrer(_c: &ConfigGarde) -> Result<(), String> {
    Err("disponible sous Windows seulement".into())
}

/// Les emplacements proteges, resolus une fois.
#[derive(Debug, Clone)]
pub struct Zones {
    proteges: Vec<PathBuf>,
    /// Le dossier des profils, protege sauf dans les exceptions ci-dessous ;
    /// `None` si l'utilisateur l'a retire de la liste.
    profils: Option<PathBuf>,
    /// Le profil de l'utilisateur et le profil public : il peut deja y ecrire
    /// lui-meme, les designer n'apporte rien a un programme malveillant.
    exceptions: Vec<PathBuf>,
    /// La racine de chaque lecteur (`C:\`, `D:\`).
    racines: bool,
}

impl Zones {
    pub fn nouvelles(
        e: &Emplacements,
        profil: &Path,
        installation: Option<&Path>,
        config: &ConfigGarde,
    ) -> Zones {
        let actif = |id: &str| !config.retires.iter().any(|r| r == id);
        let mut proteges = Vec::new();
        if actif("windows") {
            proteges.push(e.windows.clone());
        }
        if actif("program_files") {
            proteges.push(e.program_files.clone());
            proteges.extend(e.program_files_x86.clone());
        }
        if actif("program_data") {
            proteges.push(e.program_data.clone());
        }
        if actif("racine_systeme") {
            let racine = PathBuf::from(format!(r"{}\", e.lecteur));
            proteges.extend(RACINE_SYSTEME.iter().map(|d| racine.join(d)));
        }
        if actif("installation") {
            proteges.extend(installation.map(Path::to_path_buf));
        }
        proteges.extend(
            config
                .ajouts
                .iter()
                .map(|a| a.trim())
                .filter(|a| absolu(a))
                .map(PathBuf::from),
        );
        Zones {
            proteges: proteges.iter().map(|p| normaliser(p)).collect(),
            profils: actif("profils").then(|| normaliser(&e.profils)),
            exceptions: vec![normaliser(profil), normaliser(&e.public)],
            racines: actif("racines_lecteurs"),
        }
    }

    /// Vrai si ce chemin designe un emplacement protege, ou se trouve dedans.
    pub fn protege(&self, chemin: &Path) -> bool {
        let n = normaliser(chemin);
        if self.racines && est_racine(&n) {
            return true;
        }
        if self.proteges.iter().any(|r| n.starts_with(r)) {
            return true;
        }
        self.profils
            .as_ref()
            .is_some_and(|p| n.starts_with(p) && !self.exceptions.iter().any(|x| n.starts_with(x)))
    }
}

/// `C:\...` ou `C:/...`.
pub fn absolu(texte: &str) -> bool {
    let o = texte.as_bytes();
    o.len() >= 3 && o[0].is_ascii_alphabetic() && o[1] == b':' && (o[2] == b'\\' || o[2] == b'/')
}

// ---------------------------------------------------------------------------
// Les reglages
// ---------------------------------------------------------------------------

/// Pourquoi un reglage a ete refuse. Le message part a l'interface sous la
/// forme `REGLAGE_REFUSE:<nature>:<cle>:<detail>`, qu'elle traduit.
#[derive(Debug, Clone, PartialEq)]
pub enum Refus {
    Type { cle: String },
    Choix { cle: String, valeur: String },
    Emplacement { cle: String, chemin: String },
}

impl Refus {
    pub fn message(&self) -> String {
        match self {
            Refus::Type { cle } => format!("REGLAGE_REFUSE:type:{cle}:"),
            Refus::Choix { cle, valeur } => format!("REGLAGE_REFUSE:choix:{cle}:{valeur}"),
            Refus::Emplacement { cle, chemin } => {
                format!("REGLAGE_REFUSE:emplacement:{cle}:{chemin}")
            }
        }
    }
}

/// Un nom de fournisseur PowerShell (`HKLM:`, `Env:`, `Cert:`…) : au moins deux
/// caracteres avant les deux-points. Une adresse web (`https://`) n'en est pas
/// un.
fn fournisseur(texte: &str) -> bool {
    let Some(pos) = texte.find(':') else {
        return false;
    };
    let nom = &texte[..pos];
    nom.len() >= 2
        && nom
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        && !texte[pos + 1..].starts_with("//")
}

/// Controle un texte libre. Il peut contenir plusieurs chemins separes par des
/// points-virgules, comme les « dossiers supplementaires » du nettoyage : on
/// examine chaque morceau.
fn verifier_texte(
    cle: &str,
    texte: &str,
    zones: &Zones,
    e: &Emplacements,
    courant: &Path,
) -> Result<(), Refus> {
    let refus = |chemin: &str| Refus::Emplacement {
        cle: cle.to_string(),
        chemin: chemin.to_string(),
    };
    for morceau in texte.split(';') {
        let m = morceau.trim().trim_matches('"').trim();
        if m.is_empty() {
            continue;
        }
        // Chemins de fournisseur PowerShell (registre, certificats...) et
        // chemins de peripherique : rien qu'un reglage de script ait a viser.
        if m.contains("::") || fournisseur(m) {
            return Err(refus(m));
        }
        let slash = m.replace('/', "\\");
        if slash.starts_with(r"\\?\") || slash.starts_with(r"\\.\") {
            return Err(refus(m));
        }
        if let Some(reste) = slash.strip_prefix(r"\\") {
            // Partage reseau. Les partages d'administration (C$, ADMIN$)
            // ramenent aux disques de la machine elle-meme.
            let partage = reste.split('\\').nth(1).unwrap_or("");
            if partage.ends_with('$') {
                return Err(refus(m));
            }
            continue;
        }
        let chemin = if absolu(&slash) {
            PathBuf::from(&slash)
        } else if slash.len() >= 2 && slash.as_bytes()[1] == b':' {
            // `C:dossier` : relatif au dossier courant du lecteur, ambigu.
            return Err(refus(m));
        } else if let Some(r) = slash.strip_prefix('\\') {
            PathBuf::from(format!(r"{}\{r}", e.lecteur))
        } else {
            // Relatif. Les scripts s'executent depuis System32 : « drivers »
            // y designerait System32\drivers. Un mot qui ne designe rien sur
            // le disque (un mot de passe, une adresse) passe.
            let p = courant.join(&slash);
            if p.exists() {
                return Err(refus(&p.display().to_string()));
            }
            continue;
        };
        if zones.protege(&chemin) {
            return Err(refus(m));
        }
    }
    Ok(())
}

/// Le type attendu d'une option sans nature explicite (`hidden`...) : celui de
/// sa valeur par defaut.
fn conforme_au_defaut(v: &Value, defaut: Option<&DefaultValue>) -> bool {
    match (defaut, v) {
        (Some(DefaultValue::Bool(_)), Value::Bool(_)) => true,
        (Some(DefaultValue::Number(_)), Value::Number(_)) => true,
        (Some(DefaultValue::Text(_)), Value::String(_)) => true,
        (Some(DefaultValue::List(_)), Value::Array(a)) => a.iter().all(Value::is_string),
        (None, Value::Bool(_) | Value::Number(_) | Value::String(_)) => true,
        (None, Value::Array(a)) => a.iter().all(Value::is_string),
        _ => false,
    }
}

fn dans_les_choix(opt: &Opt, valeur: &str) -> bool {
    opt.choices.iter().any(|c| c.value == valeur)
}

/// Controle la configuration envoyee a un script, et la renvoie debarrassee
/// des cles que le script ne declare pas (reliquats d'une version precedente :
/// le script ne les lirait pas, autant ne pas les lui passer).
pub fn verifier_config(
    meta: &Script,
    config: &BTreeMap<String, Value>,
    zones: &Zones,
    e: &Emplacements,
    courant: &Path,
) -> Result<BTreeMap<String, Value>, Refus> {
    let mut sortie = BTreeMap::new();
    for (cle, valeur) in config {
        let Some(opt) = meta.options.iter().find(|o| &o.key == cle) else {
            continue;
        };
        let type_refuse = || Refus::Type { cle: cle.clone() };
        match opt.kind.as_str() {
            "bool" => {
                if !valeur.is_boolean() {
                    return Err(type_refuse());
                }
            }
            "number" => {
                if !valeur.is_number() {
                    return Err(type_refuse());
                }
            }
            "select" => {
                let s = valeur.as_str().ok_or_else(type_refuse)?;
                if !dans_les_choix(opt, s) {
                    return Err(Refus::Choix {
                        cle: cle.clone(),
                        valeur: s.to_string(),
                    });
                }
            }
            "multi" => {
                let liste = valeur.as_array().ok_or_else(type_refuse)?;
                for v in liste {
                    let s = v.as_str().ok_or_else(type_refuse)?;
                    if !dans_les_choix(opt, s) {
                        return Err(Refus::Choix {
                            cle: cle.clone(),
                            valeur: s.to_string(),
                        });
                    }
                }
            }
            nature => {
                let attendu_texte = nature == "string";
                if attendu_texte && !valeur.is_string() {
                    return Err(type_refuse());
                }
                if !attendu_texte && !conforme_au_defaut(valeur, opt.default.as_ref()) {
                    return Err(type_refuse());
                }
                match valeur {
                    Value::String(s) => verifier_texte(cle, s, zones, e, courant)?,
                    Value::Array(a) => {
                        for s in a.iter().filter_map(Value::as_str) {
                            verifier_texte(cle, s, zones, e, courant)?;
                        }
                    }
                    _ => {}
                }
            }
        }
        sortie.insert(cle.clone(), valeur.clone());
    }
    Ok(sortie)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::Choice;
    use crate::systeme;

    struct Bac(PathBuf);
    impl Bac {
        fn neuf(nom: &str) -> Bac {
            let d =
                std::env::temp_dir().join(format!("wintool-garde-{}-{nom}", std::process::id()));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).unwrap();
            Bac(d)
        }
    }
    impl Drop for Bac {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn profil() -> PathBuf {
        // Le dossier temporaire vit dans le profil : c'est l'endroit autorise.
        let t = std::env::temp_dir();
        t.ancestors()
            .find(|a| a.parent().is_some_and(|p| p.ends_with("Users")))
            .unwrap()
            .to_path_buf()
    }

    fn zones(ajouts: &[String]) -> Zones {
        let config = ConfigGarde {
            retires: Vec::new(),
            ajouts: ajouts.to_vec(),
        };
        Zones::nouvelles(systeme::emplacements(), &profil(), None, &config)
    }

    fn zones_sans(retires: &[&str]) -> Zones {
        let config = ConfigGarde {
            retires: retires.iter().map(|r| r.to_string()).collect(),
            ajouts: Vec::new(),
        };
        Zones::nouvelles(systeme::emplacements(), &profil(), None, &config)
    }

    fn opt(key: &str, kind: &str, choix: &[&str], defaut: Option<DefaultValue>) -> Opt {
        Opt {
            key: key.into(),
            kind: kind.into(),
            label: key.into(),
            desc: String::new(),
            choices: choix
                .iter()
                .map(|v| Choice {
                    value: v.to_string(),
                    label: v.to_string(),
                    ..Default::default()
                })
                .collect(),
            default: defaut,
            hidden: kind == "hidden",
            ..Default::default()
        }
    }

    fn script(options: Vec<Opt>) -> Script {
        let mut s = crate::contract::parse("## WINTOOL:START\n## id : x\n## WINTOOL:END\n");
        s.options = options;
        s
    }

    fn verifier(s: &Script, cle: &str, v: Value) -> Result<BTreeMap<String, Value>, Refus> {
        let e = systeme::emplacements();
        let config = BTreeMap::from([(cle.to_string(), v)]);
        verifier_config(s, &config, &zones(&[]), e, &e.system32())
    }

    #[test]
    fn les_emplacements_du_systeme_sont_proteges() {
        let z = zones(&[]);
        let e = systeme::emplacements();
        for p in [
            e.windows.clone(),
            e.system32().join("drivers"),
            e.program_files.join("WinTool"),
            e.program_data.join("Microsoft"),
            e.profils.join("Default"),
            PathBuf::from(format!(r"{}\", e.lecteur)),
            PathBuf::from(r"D:\"),
            PathBuf::from(format!(r"{}\System Volume Information", e.lecteur)),
        ] {
            assert!(z.protege(&p), "{}", p.display());
        }
    }

    #[test]
    fn le_profil_de_l_utilisateur_ne_l_est_pas() {
        let z = zones(&[]);
        assert!(!z.protege(&profil().join("Documents")));
        assert!(!z.protege(&std::env::temp_dir()));
        assert!(!z.protege(&systeme::emplacements().public.join("Documents")));
    }

    #[test]
    fn la_casse_et_les_detours_ne_trompent_pas_la_liste() {
        let z = zones(&[]);
        let e = systeme::emplacements();
        let w = e.windows.display().to_string();
        assert!(z.protege(Path::new(&w.to_uppercase())));
        assert!(z.protege(
            &profil()
                .join("..")
                .join("..")
                .join(e.windows.file_name().unwrap())
        ));
        assert!(z.protege(&e.windows.join("n-existe-pas").join("..").join("System32")));
        // Nom court 8.3 de Program Files, quand le systeme en genere.
        let court = PathBuf::from(format!(r"{}\PROGRA~1", e.lecteur));
        if court.exists() {
            assert!(z.protege(&court));
        }
    }

    #[test]
    fn une_jonction_vers_le_systeme_est_resolue() {
        let bac = Bac::neuf("jonction");
        let lien = bac.0.join("lien");
        let e = systeme::emplacements();
        let ok = std::process::Command::new(e.system32().join("cmd.exe"))
            .args(["/c", "mklink", "/J"])
            .arg(&lien)
            .arg(&e.windows)
            .output()
            .is_ok_and(|o| o.status.success());
        if !ok {
            return; // mklink /J indisponible : rien a eprouver ici
        }
        let z = zones(&[]);
        assert!(z.protege(&lien), "la jonction n'a pas ete suivie");
        assert!(z.protege(&lien.join("System32")));
        let _ = std::fs::remove_dir(&lien);
    }

    #[test]
    fn un_emplacement_retire_n_est_plus_protege_et_seulement_lui() {
        let e = systeme::emplacements();
        let z = zones_sans(&["windows", "racines_lecteurs"]);
        assert!(!z.protege(&e.windows.join("System32")));
        assert!(!z.protege(Path::new(r"D:\")));
        // Le reste de la liste tient toujours.
        assert!(z.protege(&e.program_files));
        assert!(z.protege(&e.program_data));
        let z = zones_sans(&["profils"]);
        assert!(!z.protege(&e.profils.join("Default")));
    }

    #[test]
    fn chaque_identifiant_retirable_existe_dans_la_liste() {
        let ids: Vec<&str> = integres(systeme::emplacements(), None)
            .iter()
            .map(|i| i.id)
            .collect();
        assert_eq!(ids, IDS_INTEGRES);
    }

    #[test]
    fn la_liste_modifiee_se_relit_depuis_le_registre() {
        use windows_registry::CURRENT_USER;
        let chemin = format!(r"SOFTWARE\WinTool-tests-{}-garde", std::process::id());
        let _ = CURRENT_USER.remove_tree(&chemin);
        let c = ConfigGarde {
            retires: vec!["windows".into()],
            ajouts: vec![r"D:\Archives".into()],
        };
        enregistrer_dans(CURRENT_USER, &chemin, &c).unwrap();
        assert_eq!(charger_depuis(CURRENT_USER, &chemin), c);
        // Vider une liste efface la valeur, et se relit comme une liste vide.
        enregistrer_dans(CURRENT_USER, &chemin, &ConfigGarde::default()).unwrap();
        assert_eq!(
            charger_depuis(CURRENT_USER, &chemin),
            ConfigGarde::default()
        );
        let _ = CURRENT_USER.remove_tree(&chemin);
    }

    #[test]
    fn les_ajouts_de_l_utilisateur_protegent_aussi() {
        let bac = Bac::neuf("ajout");
        let z = zones(&[bac.0.display().to_string(), "pas un chemin".into()]);
        assert!(z.protege(&bac.0.join("x")));
    }

    #[test]
    fn un_choix_hors_liste_est_refuse() {
        let s = script(vec![opt(
            "Fournisseur",
            "select",
            &["cloudflare", "google"],
            None,
        )]);
        assert!(verifier(&s, "Fournisseur", Value::from("google")).is_ok());
        assert_eq!(
            verifier(&s, "Fournisseur", Value::from("1.2.3.4")),
            Err(Refus::Choix {
                cle: "Fournisseur".into(),
                valeur: "1.2.3.4".into()
            })
        );
        let m = script(vec![opt("Cibles", "multi", &["a", "b"], None)]);
        assert!(verifier(&m, "Cibles", serde_json::json!(["a", "b"])).is_ok());
        assert!(verifier(&m, "Cibles", serde_json::json!(["a", "c"])).is_err());
    }

    #[test]
    fn un_type_inattendu_est_refuse() {
        let s = script(vec![
            opt("Actif", "bool", &[], None),
            opt("Heures", "number", &[], None),
            opt("Cache", "hidden", &[], Some(DefaultValue::Bool(true))),
        ]);
        assert!(verifier(&s, "Actif", Value::Bool(true)).is_ok());
        assert!(verifier(&s, "Actif", Value::from("C:\\Windows")).is_err());
        assert!(verifier(&s, "Heures", Value::from("24")).is_err());
        assert!(verifier(&s, "Cache", Value::from("texte")).is_err());
    }

    #[test]
    fn un_texte_libre_ne_vise_pas_un_emplacement_protege() {
        let s = script(vec![opt(
            "Dossiers",
            "string",
            &[],
            Some(DefaultValue::Text(String::new())),
        )]);
        let e = systeme::emplacements();
        let w = e.windows.display().to_string();
        for v in [
            w.clone(),
            format!(r"{};{w}", profil().join("Cache").display()),
            format!("  \"{w}\"  "),
            w.replace('\\', "/"),
            "drivers".into(),
            r"\Windows".into(),
            "C:Windows".into(),
            r"\\localhost\C$\Windows".into(),
            r"\\?\C:\Windows".into(),
            r"HKLM:\SOFTWARE".into(),
            r"Registry::HKEY_LOCAL_MACHINE".into(),
        ] {
            assert!(
                verifier(&s, "Dossiers", Value::from(v.clone())).is_err(),
                "{v}"
            );
        }
        for v in [
            profil()
                .join("AppData")
                .join("Local")
                .join("Cache")
                .display()
                .to_string(),
            String::new(),
            "mot de passe : 4f!x".into(),
            "https://exemple.org/fichier".into(),
            r"\\nas\sauvegardes\export.zip".into(),
        ] {
            assert!(
                verifier(&s, "Dossiers", Value::from(v.clone())).is_ok(),
                "{v}"
            );
        }
    }

    #[test]
    fn les_cles_inconnues_ne_sont_pas_transmises() {
        let s = script(vec![opt("Actif", "bool", &[], None)]);
        let e = systeme::emplacements();
        let config = BTreeMap::from([
            ("Actif".to_string(), Value::Bool(true)),
            ("Fantome".to_string(), Value::from("C:\\Windows")),
        ]);
        let r = verifier_config(&s, &config, &zones(&[]), e, &e.system32()).unwrap();
        assert_eq!(r.keys().collect::<Vec<_>>(), ["Actif"]);
    }
}
