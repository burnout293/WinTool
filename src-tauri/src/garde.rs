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
//! La liste integree ne se retire pas depuis l'interface : tout ce que
//! l'interface pourrait retirer, un programme malveillant pourrait le retirer
//! aussi, en reecrivant le meme fichier. Les ajouts de l'utilisateur, eux,
//! ne font que restreindre davantage.

use crate::contract::{DefaultValue, Opt, Script};
use crate::systeme::Emplacements;
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

/// Les emplacements proteges, resolus une fois.
#[derive(Debug, Clone)]
pub struct Zones {
    proteges: Vec<PathBuf>,
    /// Le dossier des profils, protege sauf dans les exceptions ci-dessous.
    profils: PathBuf,
    /// Le profil de l'utilisateur et le profil public : il peut deja y ecrire
    /// lui-meme, les designer n'apporte rien a un programme malveillant.
    exceptions: Vec<PathBuf>,
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

impl Zones {
    pub fn nouvelles(
        e: &Emplacements,
        profil: &Path,
        installation: Option<&Path>,
        ajouts: &[String],
    ) -> Zones {
        let mut proteges = vec![
            e.windows.clone(),
            e.program_files.clone(),
            e.program_data.clone(),
        ];
        proteges.extend(e.program_files_x86.clone());
        let racine = PathBuf::from(format!(r"{}\", e.lecteur));
        proteges.extend(RACINE_SYSTEME.iter().map(|d| racine.join(d)));
        proteges.extend(installation.map(Path::to_path_buf));
        proteges.extend(
            ajouts
                .iter()
                .map(|a| a.trim())
                .filter(|a| absolu(a))
                .map(PathBuf::from),
        );
        Zones {
            proteges: proteges.iter().map(|p| normaliser(p)).collect(),
            profils: normaliser(&e.profils),
            exceptions: vec![normaliser(profil), normaliser(&e.public)],
        }
    }

    /// Vrai si ce chemin designe un emplacement protege, ou se trouve dedans.
    pub fn protege(&self, chemin: &Path) -> bool {
        let n = normaliser(chemin);
        if est_racine(&n) {
            return true;
        }
        if self.proteges.iter().any(|r| n.starts_with(r)) {
            return true;
        }
        n.starts_with(&self.profils) && !self.exceptions.iter().any(|x| n.starts_with(x))
    }

    /// Les emplacements integres, pour les montrer dans les Reglages. Le dossier
    /// des profils et les racines de lecteur sont decrits par l'interface, dans
    /// sa langue : ils ne figurent pas dans cette liste.
    pub fn integres(e: &Emplacements, installation: Option<&Path>) -> Vec<String> {
        let mut v = vec![
            e.windows.display().to_string(),
            e.program_files.display().to_string(),
        ];
        v.extend(
            e.program_files_x86
                .as_ref()
                .map(|p| p.display().to_string()),
        );
        v.push(e.program_data.display().to_string());
        v.extend(RACINE_SYSTEME.iter().map(|d| format!(r"{}\{d}", e.lecteur)));
        v.extend(installation.map(|p| p.display().to_string()));
        v
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
        Zones::nouvelles(systeme::emplacements(), &profil(), None, ajouts)
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
                    desc: String::new(),
                })
                .collect(),
            default: defaut,
            hidden: kind == "hidden",
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
