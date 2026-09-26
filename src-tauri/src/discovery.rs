//! Decouverte des scripts sur le disque.
//!
//! Deux racines, et c'est une decision de securite autant que de rangement
//! (specification 4.3) :
//!
//! ```text
//! <dossier d'installation>\scripts\Default\   scripts livres avec l'application
//! %LOCALAPPDATA%\WinTool\scripts\             scripts de l'utilisateur
//! ├─ MesScripts\                              il organise comme il veut
//! └─ Essais\
//! ```
//!
//! Les scripts livres **restent dans le dossier d'installation** et ne sont pas
//! recopies ailleurs. Program Files n'est pas inscriptible sans elevation : du
//! code lance sous le compte de l'utilisateur ne peut donc pas les remplacer,
//! alors que ce sont precisement ceux qu'un debutant lancera en mode Simple sans
//! les lire. La protection vient des droits du systeme, pas d'un mecanisme qu'il
//! faudrait ecrire et maintenir.
//!
//! Le dossier de l'utilisateur, lui, reste inscriptible — c'est le principe du
//! projet, on depose un `.ps1` et il apparait. C'est aussi pourquoi tout ce qui
//! s'y trouve passe par l'approbation avant premiere execution (§12.1).
//!
//! Une mise a jour remplace `Default\` avec l'application, sans jamais toucher
//! aux scripts de l'utilisateur, qui vivent ailleurs.

use crate::contract::{self, Finding, Script, Severity};
use crate::security::{self, PointAttention};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Serialize)]
pub struct ScriptEntry {
    /// Identifiant resolu : le champ `id` de l'entete, ou a defaut le chemin
    /// relatif. Un chemin change au moindre renommage, l'`id` survit.
    pub id: String,
    /// Chemin relatif a sa propre racine, separateurs normalises.
    pub path: String,
    /// Chemin complet, utilise pour l'execution.
    pub abs_path: String,
    /// `shipped` (livre avec l'application) ou `user`.
    pub origin: &'static str,
    /// Empreinte du contenu : base de l'approbation avant premiere execution
    /// (specification 12.1) et de la detection des modifications.
    pub hash: String,
    /// Faux si le script ne declare pas d'`id` et n'est identifie que par son chemin.
    pub declared_id: bool,
    /// Points d'attention detectes dans le corps du script (specification
    /// 12.2) — liste non exhaustive, jamais un verdict de securite.
    pub attention: Vec<PointAttention>,
    pub meta: Script,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveryResult {
    /// Racine des scripts de l'utilisateur — celle qu'ouvre le bouton du meme nom.
    pub root: String,
    /// Racine des scripts livres, en lecture seule.
    pub shipped_root: String,
    pub scripts: Vec<ScriptEntry>,
    /// Anomalies qui ne visent aucun script en particulier (dossier illisible…).
    pub problems: Vec<String>,
}

/// Dossier de travail de l'application : `%LOCALAPPDATA%\WinTool`.
///
/// Une seule definition, parce que plusieurs modules en ont besoin (scripts de
/// l'utilisateur, journaux) et que deux definitions qui divergent donneraient
/// deux arborescences.
pub fn base_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .local_data_dir()
        .map_err(|e| format!("dossier local introuvable : {e}"))?;
    Ok(sans_prefixe_long(base.join("WinTool")))
}

/// Racine des scripts de l'utilisateur : `%LOCALAPPDATA%\WinTool\scripts`.
pub fn scripts_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(base_dir(app)?.join("scripts"))
}

/// Racine des scripts livres, dans le dossier d'installation.
///
/// Tauri renvoie ici un chemin canonicalise, donc prefixe `\\?\` sous Windows.
/// On le nettoie a la source : tous les chemins derives — ceux qui partent a
/// PowerShell comme ceux affiches dans l'interface — en heritent.
pub fn shipped_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .resolve("scripts/Default", tauri::path::BaseDirectory::Resource)
        .map(sans_prefixe_long)
        .map_err(|e| format!("ressources introuvables : {e}"))
}

/// Retire le prefixe de chemin long (`\\?\`) que Windows ajoute lors d'une
/// canonicalisation.
///
/// Ce prefixe n'est pas cosmetique : PowerShell ne parvient pas a etablir la
/// zone de securite d'un chemin qui le porte. Un chemin normal se resout en
/// `MyComputer`, le meme en `\\?\` se resout en `NoZone` — et sous la
/// politique `RemoteSigned`, PowerShell exige alors une signature et refuse
/// d'executer le script :
///
/// ```text
/// Impossible de charger le fichier \\?\D:\...\600_INSTALL_POWERSHELL_7.ps1.
/// Le fichier n'est pas signe numeriquement.
/// ```
///
/// Sous `Bypass`, la politique par defaut, le probleme ne se voit pas : c'est
/// en choisissant `RemoteSigned` (specification 6.7) que tous les scripts
/// livres deviennent soudain inexecutables.
///
/// Contrepartie assumee : on reperd la capacite d'adresser des chemins de plus
/// de 260 caracteres. Les scripts vivent dans le dossier d'installation ou
/// sous `%LOCALAPPDATA%`, tres loin de cette limite.
fn sans_prefixe_long(chemin: PathBuf) -> PathBuf {
    let texte = chemin.to_string_lossy();
    if let Some(reste) = texte.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{reste}"));
    }
    if let Some(reste) = texte.strip_prefix(r"\\?\") {
        return PathBuf::from(reste.to_string());
    }
    chemin
}

pub(crate) fn sha256_hex(octets: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(octets);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Parcours recursif, sans dependance externe.
fn collect_ps1(dir: &Path, out: &mut Vec<PathBuf>, problems: &mut Vec<String>) {
    let entrees = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            problems.push(format!("{} : {e}", dir.display()));
            return;
        }
    };
    for entree in entrees.flatten() {
        let chemin = entree.path();
        if chemin.is_dir() {
            collect_ps1(&chemin, out, problems);
        } else if chemin.extension().and_then(|e| e.to_str()) == Some("ps1") {
            out.push(chemin);
        }
    }
}

/// Analyse un fichier et en fait une entree, ou explique pourquoi non.
fn lire_entree(
    chemin: &Path,
    racine: &Path,
    origin: &'static str,
    ids_vus: &mut Vec<String>,
) -> Result<ScriptEntry, String> {
    let octets = fs::read(chemin).map_err(|e| format!("{} : {e}", chemin.display()))?;

    // Les scripts sont en UTF-8 avec BOM (voir FORMAT_SCRIPT.md). On le retire
    // avant analyse, sinon il colle au premier caractere de l'entete.
    let texte = String::from_utf8_lossy(&octets);
    let texte = texte.strip_prefix('\u{feff}').unwrap_or(&texte);

    let mut meta = contract::parse(texte);

    let relatif = chemin
        .strip_prefix(racine)
        .unwrap_or(chemin)
        .to_string_lossy()
        .replace('\\', "/");

    let declared_id = !meta.id.trim().is_empty();
    let mut id = if declared_id {
        meta.id.trim().to_string()
    } else {
        relatif.clone()
    };

    if !declared_id {
        meta.findings.push(Finding {
            line: 1,
            severity: Severity::Warning,
            code: "ID_ABSENT".into(),
            message:
                "Pas d'id declare : un renommage ou un deplacement fera perdre la configuration de ce script."
                    .into(),
        });
    } else if ids_vus.contains(&id) {
        // Les scripts livres sont parcourus en premier : un script de
        // l'utilisateur ne peut donc pas s'approprier l'id d'un script livre
        // pour heriter de sa configuration ou de son approbation.
        meta.findings.push(Finding {
            line: 1,
            severity: Severity::Error,
            code: "ID_COLLISION".into(),
            message: format!(
                "L'id '{id}' est deja utilise par un autre script ; celui-ci est identifie par son chemin."
            ),
        });
        id = relatif.clone();
    } else {
        ids_vus.push(id.clone());
    }

    let attention = security::detecter(texte);

    Ok(ScriptEntry {
        id,
        path: relatif,
        abs_path: chemin.to_string_lossy().to_string(),
        origin,
        hash: sha256_hex(&octets),
        declared_id,
        attention,
        meta,
    })
}

/// Parcourt une racine et ajoute ce qu'elle contient.
fn parcourir(
    racine: &Path,
    origin: &'static str,
    scripts: &mut Vec<ScriptEntry>,
    ids_vus: &mut Vec<String>,
    problems: &mut Vec<String>,
) {
    if !racine.is_dir() {
        return;
    }
    let mut fichiers = Vec::new();
    collect_ps1(racine, &mut fichiers, problems);
    // Ordre stable : c'est lui qui decide quel script garde un `id` en collision.
    fichiers.sort();

    for chemin in fichiers {
        match lire_entree(&chemin, racine, origin, ids_vus) {
            Ok(e) => scripts.push(e),
            Err(e) => problems.push(e),
        }
    }
}

pub fn discover<R: Runtime>(app: &AppHandle<R>) -> Result<DiscoveryResult, String> {
    let racine_utilisateur = scripts_root(app)?;
    fs::create_dir_all(&racine_utilisateur)
        .map_err(|e| format!("creation de {} : {e}", racine_utilisateur.display()))?;

    let mut problems = Vec::new();
    let racine_livree = match shipped_root(app) {
        Ok(r) => r,
        Err(e) => {
            problems.push(e);
            PathBuf::new()
        }
    };

    let mut scripts: Vec<ScriptEntry> = Vec::new();
    let mut ids_vus: Vec<String> = Vec::new();

    // Les scripts livres d'abord : ils gardent leur id en cas de collision.
    parcourir(
        &racine_livree,
        "shipped",
        &mut scripts,
        &mut ids_vus,
        &mut problems,
    );
    parcourir(
        &racine_utilisateur,
        "user",
        &mut scripts,
        &mut ids_vus,
        &mut problems,
    );

    Ok(DiscoveryResult {
        root: racine_utilisateur.to_string_lossy().to_string(),
        shipped_root: racine_livree.to_string_lossy().to_string(),
        scripts,
        problems,
    })
}

// ---------------------------------------------------------------------------
// Tests
//
// `discover` a besoin d'un AppHandle pour resoudre ses deux racines ; le
// parcours, lui, n'en a pas besoin. C'est donc lui qu'on eprouve, avec deux
// racines jetables — et c'est bien la que vit la logique qui compte.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const ENTETE: &str = "## WINTOOL:START
## id            : {ID}
## lang          : en
## title         : {TITRE}
## desc          : Test fixture
## category      : outillage
## icon          : activity
## version       : 1.0
## admin         : false
## risk          : low
## duration      : fast
## reversible    : true
## interruptible : true
## reboot        : false
## engine        : auto
## WINTOOL:END
";

    struct Bac(PathBuf);

    impl Bac {
        fn neuf(nom: &str) -> Bac {
            let d = std::env::temp_dir().join(format!("wintool-dec-{}-{nom}", std::process::id()));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).expect("dossier de test");
            Bac(d)
        }

        fn poser(&self, chemin: &str, id: &str, titre: &str) {
            let p = self.0.join(chemin);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            let corps = ENTETE.replace("{ID}", id).replace("{TITRE}", titre);
            let mut octets = vec![0xEF, 0xBB, 0xBF];
            octets.extend_from_slice(corps.replace('\n', "\r\n").as_bytes());
            std::fs::write(&p, &octets).unwrap();
        }
    }

    impl Drop for Bac {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn parcours(livre: &Bac, perso: &Bac) -> (Vec<ScriptEntry>, Vec<String>) {
        let mut scripts = Vec::new();
        let mut ids = Vec::new();
        let mut problemes = Vec::new();
        parcourir(&livre.0, "shipped", &mut scripts, &mut ids, &mut problemes);
        parcourir(&perso.0, "user", &mut scripts, &mut ids, &mut problemes);
        (scripts, problemes)
    }

    #[test]
    fn distingue_les_deux_racines() {
        let livre = Bac::neuf("livre");
        let perso = Bac::neuf("perso");
        livre.poser(
            "200_SLEEP.ps1",
            "11111111-1111-4111-8111-111111111111",
            "Livre",
        );
        perso.poser(
            "MesScripts/900_A_MOI.ps1",
            "22222222-2222-4222-8222-222222222222",
            "A moi",
        );

        let (scripts, problemes) = parcours(&livre, &perso);
        assert!(problemes.is_empty(), "{problemes:?}");
        assert_eq!(scripts.len(), 2);

        assert_eq!(scripts[0].origin, "shipped");
        assert_eq!(scripts[0].path, "200_SLEEP.ps1");

        // Le parcours de la racine personnelle reste recursif.
        assert_eq!(scripts[1].origin, "user");
        assert_eq!(scripts[1].path, "MesScripts/900_A_MOI.ps1");

        // Le chemin complet permet l'execution sans reconstruire quoi que ce soit.
        assert!(PathBuf::from(&scripts[1].abs_path).is_file());
    }

    #[test]
    fn un_script_perso_ne_peut_pas_prendre_l_id_d_un_script_livre() {
        let livre = Bac::neuf("livre2");
        let perso = Bac::neuf("perso2");
        let id = "33333333-3333-4333-8333-333333333333";
        livre.poser("200_VRAI.ps1", id, "Le vrai");
        // Meme id, depose dans le dossier inscriptible sans elevation.
        perso.poser("200_IMPOSTEUR.ps1", id, "L'imposteur");

        let (scripts, _) = parcours(&livre, &perso);
        assert_eq!(scripts.len(), 2);

        // Le script livre garde l'id : c'est lui qui portera la configuration
        // et l'approbation attachees a cet identifiant.
        assert_eq!(scripts[0].id, id);
        assert_eq!(scripts[0].origin, "shipped");

        // L'autre retombe sur son chemin, et la collision est signalee.
        assert_eq!(scripts[1].id, "200_IMPOSTEUR.ps1");
        assert!(
            scripts[1]
                .meta
                .findings
                .iter()
                .any(|f| f.code == "ID_COLLISION"),
            "la collision d'id n'est pas signalee"
        );
    }

    #[test]
    fn signale_un_script_sans_id_sans_le_rejeter() {
        let livre = Bac::neuf("livre3");
        let perso = Bac::neuf("perso3");
        perso.poser("sans_id.ps1", "", "Sans id");

        let (scripts, _) = parcours(&livre, &perso);
        assert_eq!(scripts.len(), 1, "constater, jamais bloquer");
        assert!(!scripts[0].declared_id);
        // A defaut d'id declare, le chemin fait office d'identifiant.
        assert_eq!(scripts[0].id, "sans_id.ps1");
        assert!(scripts[0]
            .meta
            .findings
            .iter()
            .any(|f| f.code == "ID_ABSENT"));
    }

    #[test]
    fn retire_le_prefixe_qui_casse_la_zone_de_securite() {
        // Un chemin prefixe se resout en zone NoZone cote PowerShell, et
        // RemoteSigned refuse alors d executer un script non signe.
        assert_eq!(
            sans_prefixe_long(PathBuf::from(r"\\?\D:\WinTool\a.ps1")),
            PathBuf::from(r"D:\WinTool\a.ps1")
        );
        // Forme UNC : le prefixe redevient un chemin reseau ordinaire.
        assert_eq!(
            sans_prefixe_long(PathBuf::from(r"\\?\UNC\srv\part\a.ps1")),
            PathBuf::from(r"\\srv\part\a.ps1")
        );
        // Un chemin deja normal n est pas touche.
        assert_eq!(
            sans_prefixe_long(PathBuf::from(r"C:\Program Files\WinTool")),
            PathBuf::from(r"C:\Program Files\WinTool")
        );
    }

    #[test]
    fn une_racine_absente_n_est_pas_une_erreur() {
        let perso = Bac::neuf("perso4");
        let mut scripts = Vec::new();
        let mut ids = Vec::new();
        let mut problemes = Vec::new();
        // Cas reel : l'application lancee depuis un emplacement ou les
        // ressources ne sont pas en place.
        parcourir(
            Path::new(
                r"Z:
existe\pas",
            ),
            "shipped",
            &mut scripts,
            &mut ids,
            &mut problemes,
        );
        parcourir(&perso.0, "user", &mut scripts, &mut ids, &mut problemes);
        assert!(
            problemes.is_empty(),
            "une racine absente ne doit pas alarmer"
        );
    }
}
