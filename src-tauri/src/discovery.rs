//! Decouverte des scripts sur le disque.
//!
//! Deux racines, et c'est une decision de securite autant que de rangement
//! (specification 4.3) :
//!
//! ```text
//! %LOCALAPPDATA%\WinTool\sources\officiel\   catalogue officiel (§16)
//! %LOCALAPPDATA%\WinTool\scripts\             scripts de l'utilisateur
//! ├─ MesScripts\                              il organise comme il veut
//! └─ Essais\
//! ```
//!
//! Depuis la 1.2, l'installeur ne livre plus aucun script (§16.1). Les deux
//! dossiers sont inscriptibles sans elevation : ce ne sont plus les droits du
//! systeme qui distinguent un script de confiance, c'est la **signature** du
//! catalogue. Un script du dossier officiel n'est approuve d'office que si
//! l'index signe le nomme et que son empreinte est exactement celle que l'index
//! declare (`verified`). Modifie, il redevient un script ordinaire, soumis a
//! l'approbation avant premiere execution (§12.1) comme tout ce que
//! l'utilisateur depose lui-meme.

use crate::catalogue;
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
    /// `official` (nomme par l'index signe du catalogue officiel) ou `user`.
    pub origin: &'static str,
    /// Vrai pour un script officiel dont l'empreinte est exactement celle que
    /// declare l'index signe : le seul cas d'approbation implicite (§16.4).
    pub verified: bool,
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
    /// Dossier du catalogue officiel.
    pub catalogue_root: String,
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
        // Le chemin tient lieu d'id : il est reserve comme un id declare.
        // Sinon un autre script pourrait declarer ce chemin comme id et
        // partager celui-ci sans qu'aucune collision soit relevee.
        ids_vus.push(id.clone());
    } else if ids_vus.contains(&id) {
        // Le catalogue est parcouru en premier : un script de l'utilisateur ne
        // peut donc pas s'approprier l'id d'un script officiel pour heriter de
        // sa configuration ou de sa place dans les lots.
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
        verified: false,
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

/// Parcourt le dossier du catalogue officiel.
///
/// Les fichiers que l'index signe nomme passent **en premier**, avant tout le
/// reste : ce sont eux qui gardent leur `id` en cas de collision. Sans cet
/// ordre, un fichier depose a cote, au nom choisi pour etre trie avant eux,
/// pourrait s'approprier l'id d'un script officiel — et avec lui sa place dans
/// les lots de l'utilisateur. Il resterait soumis a l'approbation, mais elle lui
/// serait demandee au milieu d'un entretien familier, la ou l'on clique sans
/// lire. Ce qui n'est pas a l'index vient ensuite, comme script ordinaire.
fn parcourir_catalogue(
    racine: &Path,
    index: Option<&catalogue::Index>,
    scripts: &mut Vec<ScriptEntry>,
    ids_vus: &mut Vec<String>,
    problems: &mut Vec<String>,
) {
    if !racine.is_dir() {
        return;
    }
    let mut fichiers = Vec::new();
    collect_ps1(racine, &mut fichiers, problems);
    fichiers.sort();

    let signe = |chemin: &PathBuf| -> Option<String> {
        // Le dossier d'une source est plat : un sous-dossier n'est jamais a l'index.
        if chemin.parent() != Some(racine) {
            return None;
        }
        let nom = chemin.file_name()?.to_str()?;
        catalogue::trouver(index?, nom).map(|e| e.sha256.clone())
    };
    let (officiels, autres): (Vec<PathBuf>, Vec<PathBuf>) =
        fichiers.into_iter().partition(|c| signe(c).is_some());

    for chemin in officiels {
        let attendu = signe(&chemin);
        match lire_entree(&chemin, racine, "official", ids_vus) {
            Ok(mut e) => {
                e.verified = attendu.as_deref() == Some(e.hash.as_str());
                scripts.push(e);
            }
            Err(e) => problems.push(e),
        }
    }
    for chemin in autres {
        match lire_entree(&chemin, racine, "user", ids_vus) {
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
    let racine_catalogue = catalogue::dossier(app)?;
    // L'index installe est re-verifie a chaque decouverte. S'il ne se verifie
    // plus, aucun script du catalogue n'est approuve d'office : on le dit.
    let index = match catalogue::index_local(&racine_catalogue) {
        Ok(i) => i,
        Err(e) => {
            problems.push(format!("Catalogue officiel : {e}"));
            None
        }
    };

    let mut scripts: Vec<ScriptEntry> = Vec::new();
    let mut ids_vus: Vec<String> = Vec::new();

    // Le catalogue d'abord : ses scripts gardent leur id en cas de collision.
    parcourir_catalogue(
        &racine_catalogue,
        index.as_ref(),
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
        catalogue_root: racine_catalogue.to_string_lossy().to_string(),
        scripts,
        problems,
    })
}

// ---------------------------------------------------------------------------
// Tests
//
// `discover` a besoin d'un AppHandle pour resoudre ses deux racines ; le
// parcours, lui, n'en a pas besoin. C'est donc lui qu'on eprouve, avec des
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
        parcourir(&livre.0, "official", &mut scripts, &mut ids, &mut problemes);
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

        assert_eq!(scripts[0].origin, "official");
        assert_eq!(scripts[0].path, "200_SLEEP.ps1");

        // Le parcours de la racine personnelle reste recursif.
        assert_eq!(scripts[1].origin, "user");
        assert_eq!(scripts[1].path, "MesScripts/900_A_MOI.ps1");

        // Le chemin complet permet l'execution sans reconstruire quoi que ce soit.
        assert!(PathBuf::from(&scripts[1].abs_path).is_file());
    }

    #[test]
    fn un_script_perso_ne_peut_pas_prendre_l_id_d_un_script_officiel() {
        let livre = Bac::neuf("livre2");
        let perso = Bac::neuf("perso2");
        let id = "33333333-3333-4333-8333-333333333333";
        livre.poser("200_VRAI.ps1", id, "Le vrai");
        // Meme id, depose dans le dossier inscriptible sans elevation.
        perso.poser("200_IMPOSTEUR.ps1", id, "L'imposteur");

        let (scripts, _) = parcours(&livre, &perso);
        assert_eq!(scripts.len(), 2);

        // Le script officiel garde l'id : c'est lui qui portera la
        // configuration attachee a cet identifiant.
        assert_eq!(scripts[0].id, id);
        assert_eq!(scripts[0].origin, "official");

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
        // Cas reel : le catalogue n'a jamais ete installe.
        parcourir(
            Path::new(
                r"Z:
existe\pas",
            ),
            "official",
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

    // ----- Dossier du catalogue (specification 16.4) ----------------------

    const CLE_ESSAI: &str = include_str!("../fixtures/catalogue/cle-essai.pub");
    const I100: &[u8] = include_bytes!("../fixtures/catalogue/index-1.0.0.json");
    const S100: &[u8] = include_bytes!("../fixtures/catalogue/index-1.0.0.json.sig");
    const A1: &[u8] = include_bytes!("../fixtures/catalogue/scripts/A-v1.txt");
    const B: &[u8] = include_bytes!("../fixtures/catalogue/scripts/B.txt");

    fn catalogue_de_test(bac: &Bac) -> catalogue::Index {
        std::fs::write(bac.0.join("100_A.ps1"), A1).unwrap();
        std::fs::write(bac.0.join("200_B.ps1"), B).unwrap();
        catalogue::verifier_avec(CLE_ESSAI, I100, S100).unwrap()
    }

    fn parcours_catalogue(bac: &Bac, index: Option<&catalogue::Index>) -> Vec<ScriptEntry> {
        let mut scripts = Vec::new();
        let mut ids = Vec::new();
        let mut problemes = Vec::new();
        parcourir_catalogue(&bac.0, index, &mut scripts, &mut ids, &mut problemes);
        scripts
    }

    #[test]
    fn un_script_conforme_a_l_index_signe_est_verifie() {
        let bac = Bac::neuf("cat1");
        let index = catalogue_de_test(&bac);
        let scripts = parcours_catalogue(&bac, Some(&index));
        assert_eq!(scripts.len(), 2);
        assert!(scripts.iter().all(|s| s.origin == "official" && s.verified));
    }

    #[test]
    fn un_script_officiel_modifie_perd_sa_verification() {
        let bac = Bac::neuf("cat2");
        let index = catalogue_de_test(&bac);
        std::fs::write(bac.0.join("200_B.ps1"), b"Write-Output 'pirate'").unwrap();
        let scripts = parcours_catalogue(&bac, Some(&index));
        let b = scripts.iter().find(|s| s.path == "200_B.ps1").unwrap();
        // Toujours a sa place dans le catalogue, mais plus approuve d'office.
        assert_eq!(b.origin, "official");
        assert!(!b.verified);
    }

    #[test]
    fn sans_index_qui_se_verifie_rien_n_est_officiel() {
        let bac = Bac::neuf("cat3");
        catalogue_de_test(&bac);
        let scripts = parcours_catalogue(&bac, None);
        assert_eq!(scripts.len(), 2);
        assert!(scripts.iter().all(|s| s.origin == "user" && !s.verified));
    }

    #[test]
    fn un_fichier_glisse_dans_le_catalogue_reste_un_script_ordinaire() {
        let bac = Bac::neuf("cat4");
        let index = catalogue_de_test(&bac);
        // Trie avant les scripts officiels, et declare l'id de l'un d'eux (a
        // defaut d'id dans l'entete, celui d'un script est son chemin).
        bac.poser("000_INTRUS.ps1", "100_A.ps1", "Intrus");
        bac.poser("sous/200_B.ps1", "", "Cache dans un sous-dossier");

        let scripts = parcours_catalogue(&bac, Some(&index));
        assert_eq!(scripts.len(), 4);

        // Les officiels passent d'abord et gardent leur id.
        let a = scripts.iter().find(|s| s.path == "100_A.ps1").unwrap();
        assert_eq!(a.id, "100_A.ps1");
        assert!(a.verified);

        let intrus = scripts.iter().find(|s| s.path == "000_INTRUS.ps1").unwrap();
        assert_eq!(intrus.origin, "user");
        assert!(!intrus.verified);
        assert_ne!(
            intrus.id, "100_A.ps1",
            "l'intrus a pris l'id d'un script officiel"
        );
        assert!(intrus
            .meta
            .findings
            .iter()
            .any(|f| f.code == "ID_COLLISION"));

        // Meme nom qu'un script de l'index, mais pas a sa place : ordinaire.
        let cache = scripts.iter().find(|s| s.path == "sous/200_B.ps1").unwrap();
        assert_eq!(cache.origin, "user");
    }
}
