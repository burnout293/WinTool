//! Catalogues de scripts (specification §16).
//!
//! WinTool n'embarque plus aucun script : il les recupere depuis des *sources*
//! — la source officielle, le depot WinTool-Catalogue, et celles qu'un
//! administrateur ajoute (`sources.rs`). La separation est d'abord juridique —
//! les scripts ne sont pas sous la licence de WinTool (§16.1) — et ce module la
//! rend reelle dans le fonctionnement. Toutes les sources passent par le meme
//! code ; seule l'officielle a une cle compilee, et seuls ses scripts sont
//! approuves d'office (§16.4).
//!
//! Une release du catalogue publie :
//!
//! ```text
//! index.json        la liste signee : pour chaque script, son fichier, sa
//!                   taille et son empreinte SHA-256
//! index.json.sig    la signature detachee de index.json (minisign, Ed25519)
//! <script>.ps1      un fichier par script, a cote
//! ```
//!
//! Le format de signature est celui des mises a jour de WinTool, mais la cle en
//! est **une autre** : si l'une fuitait, elle ne signerait que son propre
//! domaine. Une cle de catalogue compromise ne fabrique pas de fausse mise a
//! jour de l'application, et inversement.
//!
//! L'ordre ne se discute pas (§16.3). La signature est verifiee **avant** que
//! l'index soit seulement analyse : un index non verifie est une donnee hostile.
//! Un script n'est ecrit qu'apres comparaison de son empreinte avec celle de
//! l'index signe, et tous le sont avant qu'un seul soit ecrit. Une fois
//! installe, l'index est **re-verifie a chaque decouverte** : c'est la
//! signature, et non les droits du dossier, qui fonde l'approbation implicite
//! d'un script officiel (§16.4). Le dossier reste inscriptible sans elevation ;
//! un script modifie apres coup perd simplement cette approbation.

use crate::contract;
use crate::discovery;
use crate::sources::Source;
use base64::Engine as _;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

/// Identifiant de la source officielle : nom de son dossier local, et valeur
/// que son index doit declarer dans `source`.
pub const SOURCE: &str = "officiel";

/// Le depot GitHub qui publie le catalogue officiel, `proprietaire/depot`. Un
/// fork remplace cette constante et `src-tauri/catalogue.pub` (§16.8) : aucune
/// autre adresse n'est cablee ailleurs.
pub const DEPOT: &str = "burnout293/WinTool-Catalogue";

/// L'adresse d'un depot GitHub. Une source n'est jamais qu'un depot : ses
/// releases portent l'index signe et les scripts.
pub fn url_depot(depot: &str) -> String {
    format!("https://github.com/{depot}")
}

/// Cle publique du catalogue, lue par `build.rs` dans `src-tauri/catalogue.pub`
/// et **compilee dans le binaire** (§16.2) : rien sur le disque ne peut la
/// remplacer. Vide si le fichier manque — cas d'un fork qui n'a pas encore
/// genere la sienne. Le catalogue refuse alors tout, plutot que de faire
/// confiance a quoi que ce soit ; et une release refuse de se construire sans.
const CLE_PUBLIQUE: &str = env!("WINTOOL_CATALOGUE_PUB");

pub fn cle_officielle() -> &'static str {
    CLE_PUBLIQUE
}

/// Version du format d'index que cette version de WinTool sait lire.
pub const FORMAT: u32 = 1;

const INDEX: &str = "index.json";
const SIGNATURE: &str = "index.json.sig";

// Plafonds : une source, meme officielle, ne doit pas pouvoir remplir la
// memoire ou le disque. Larges devant l'usage reel (un index de 25 scripts
// pese 8 Ko, le plus gros script 20 Ko).
const TAILLE_MAX_INDEX: u64 = 512 * 1024;
const TAILLE_MAX_SIGNATURE: u64 = 4 * 1024;
const TAILLE_MAX_SCRIPT: u64 = 2 * 1024 * 1024;
const SCRIPTS_MAX: usize = 1000;

/// Codes d'erreur, en tete du message (`CODE: detail`). L'interface traduit
/// le code et garde le detail pour le mode Expert.
pub mod code {
    pub const SANS_CLE: &str = "CATALOGUE_SANS_CLE";
    pub const HORS_LIGNE: &str = "CATALOGUE_HORS_LIGNE";
    pub const INTROUVABLE: &str = "CATALOGUE_INTROUVABLE";
    pub const SIGNATURE: &str = "CATALOGUE_SIGNATURE";
    pub const INVALIDE: &str = "CATALOGUE_INVALIDE";
    pub const FORMAT: &str = "CATALOGUE_FORMAT";
    pub const ANCIEN: &str = "CATALOGUE_ANCIEN";
    pub const EMPREINTE: &str = "CATALOGUE_EMPREINTE";
    pub const ECRITURE: &str = "CATALOGUE_ECRITURE";
    /// Cle publique d'une source tierce illisible.
    pub const CLE: &str = "CATALOGUE_CLE";
    /// Adresse de depot qui n'est pas `proprietaire/depot` sur GitHub.
    pub const DEPOT: &str = "CATALOGUE_DEPOT";
}

fn erreur(code: &str, detail: impl std::fmt::Display) -> String {
    format!("{code}: {detail}")
}

// ---------------------------------------------------------------------------
// L'index
// ---------------------------------------------------------------------------

/// L'index d'une release du catalogue. Les champs inconnus sont ignores : un
/// ajout compatible ne demande pas de nouveau format. Un changement
/// incompatible, lui, incremente `format`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Index {
    pub format: u32,
    /// L'identifiant de la source : un index signe pour une autre source est
    /// refuse, meme si la cle se trouvait etre la meme. A l'ajout d'une source
    /// tierce, c'est lui qui devient son identifiant, et son nom de dossier.
    pub source: String,
    /// Version du catalogue, `X.Y.Z`. Sert a refuser un retour en arriere.
    pub version: String,
    pub published: String,
    /// Etiquette de la release ou vivent les scripts. Les telechargements
    /// visent cette release precise, jamais « la derniere » : entre la lecture
    /// de l'index et celle des scripts, une autre a pu paraitre.
    pub tag: String,
    pub scripts: Vec<Entree>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entree {
    pub id: String,
    /// Nom de fichier nu : ni dossier, ni `..` (§16.3).
    pub file: String,
    pub version: String,
    pub size: u64,
    pub sha256: String,
    /// Titre par langue, pour presenter un script avant de l'avoir telecharge.
    #[serde(default)]
    pub title: BTreeMap<String, String>,
}

/// Noms de peripheriques que Windows reserve, avec ou sans extension.
const RESERVES: [&str; 24] = [
    "CON", "PRN", "AUX", "NUL", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Un nom de fichier qu'une source peut faire ecrire sans risque.
///
/// Liste blanche plutot que liste noire : lettres et chiffres ASCII, point,
/// tiret, souligne. Elle exclut d'office les separateurs, les deux-points (flux
/// NTFS alternatifs), les caracteres interdits par Windows et les homoglyphes.
/// C'est aussi ce que GitHub conserve tel quel dans un nom de fichier de
/// release : un nom accepte ici se telecharge sous ce meme nom.
pub fn nom_sur(nom: &str) -> bool {
    if nom.is_empty() || nom.len() > 100 {
        return false;
    }
    if !nom.starts_with(|c: char| c.is_ascii_alphanumeric()) {
        return false;
    }
    if !nom
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return false;
    }
    if nom.contains("..") || nom.ends_with('.') {
        return false;
    }
    let racine = nom.split('.').next().unwrap_or("");
    !RESERVES.iter().any(|r| r.eq_ignore_ascii_case(racine))
}

/// Un identifiant de source : il devient un nom de dossier. Minuscules,
/// chiffres et tirets, 40 au plus — rien qu'un index puisse detourner en
/// chemin.
pub fn id_source_sur(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 40
        && id.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// `proprietaire/depot`, a partir de ce que l'utilisateur colle : l'adresse
/// complete du depot, avec ou sans `https://`, `www.`, `.git` ou une page du
/// depot derriere (`/releases`…). Les noms suivent les regles de GitHub.
pub fn normaliser_depot(saisie: &str) -> Result<String, String> {
    let refus = || {
        erreur(
            code::DEPOT,
            format!("« {} » n'est pas un depot GitHub", saisie.trim()),
        )
    };
    let mut reste = saisie.trim();
    for prefixe in ["https://", "http://"] {
        if let Some(r) = reste.strip_prefix(prefixe) {
            reste = r;
        }
    }
    reste = reste.strip_prefix("www.").unwrap_or(reste);
    // Une adresse complete doit etre celle de GitHub ; sans adresse, la saisie
    // est deja `proprietaire/depot` (un `gitlab.com/…` echoue plus bas : le
    // point n'est pas permis dans un nom de proprietaire).
    let reste = match reste.strip_prefix("github.com/") {
        Some(r) => r,
        None if saisie.contains("://") => return Err(refus()),
        None => reste,
    };
    let mut morceaux = reste.split('/').filter(|m| !m.is_empty());
    let (Some(proprietaire), Some(depot)) = (morceaux.next(), morceaux.next()) else {
        return Err(refus());
    };
    let depot = depot.strip_suffix(".git").unwrap_or(depot);
    let proprietaire_sur = proprietaire.len() <= 39
        && !proprietaire.starts_with('-')
        && proprietaire
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    let depot_sur = !depot.is_empty()
        && depot.len() <= 100
        && !depot.starts_with('.')
        && !depot.contains("..")
        && depot
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if !proprietaire_sur || !depot_sur {
        return Err(refus());
    }
    Ok(format!("{proprietaire}/{depot}"))
}

/// `X.Y.Z`, trois entiers, rien d'autre.
fn triplet(v: &str) -> Option<(u32, u32, u32)> {
    let parties: Vec<&str> = v.split('.').collect();
    if parties.len() != 3
        || parties
            .iter()
            .any(|p| p.is_empty() || p.len() > 9 || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    Some((
        parties[0].parse().ok()?,
        parties[1].parse().ok()?,
        parties[2].parse().ok()?,
    ))
}

fn hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Analyse un index **deja authentifie**. Privee : la seule porte d'entree est
/// `verifier_pour`, qui ne l'appelle qu'apres la signature.
///
/// `attendu` : l'identifiant de la source dont l'index doit etre. `None`
/// seulement a l'ajout d'une source tierce, quand c'est l'index qui le donne —
/// il doit alors etre un identifiant sur.
fn analyser(octets: &[u8], attendu: Option<&str>) -> Result<Index, String> {
    // Le format d'abord : un index d'un format futur doit dire « mettez WinTool
    // a jour », pas « index illisible ».
    #[derive(Deserialize)]
    struct Entete {
        format: u32,
    }
    let entete: Entete = serde_json::from_slice(octets).map_err(|e| erreur(code::INVALIDE, e))?;
    if entete.format != FORMAT {
        return Err(erreur(
            code::FORMAT,
            format!(
                "index au format {}, cette version de WinTool lit le format {FORMAT}",
                entete.format
            ),
        ));
    }

    let index: Index = serde_json::from_slice(octets).map_err(|e| erreur(code::INVALIDE, e))?;
    let invalide = |m: String| Err(erreur(code::INVALIDE, m));

    match attendu {
        Some(id) if index.source != id => {
            return invalide(format!("index de la source « {} »", index.source));
        }
        None if !id_source_sur(&index.source) => {
            return invalide(format!("identifiant de source « {} » refuse", index.source));
        }
        _ => {}
    }
    if triplet(&index.version).is_none() {
        return invalide(format!(
            "version « {} » hors de la forme X.Y.Z",
            index.version
        ));
    }
    if index.tag.len() > 64 || !nom_sur(&index.tag) {
        return invalide(format!("etiquette de release « {} » refusee", index.tag));
    }
    if index.scripts.len() > SCRIPTS_MAX {
        return invalide(format!("plus de {SCRIPTS_MAX} scripts"));
    }

    let mut fichiers = HashSet::new();
    let mut ids = HashSet::new();
    for e in &index.scripts {
        if !nom_sur(&e.file) || !e.file.to_ascii_lowercase().ends_with(".ps1") || e.file.len() < 5 {
            return invalide(format!("nom de fichier refuse : « {} »", e.file));
        }
        // Windows ne distingue pas la casse : deux entrees qui ne different que
        // par elle ecriraient le meme fichier.
        if !fichiers.insert(e.file.to_ascii_lowercase()) {
            return invalide(format!("fichier declare deux fois : {}", e.file));
        }
        if e.id.trim().is_empty() || e.id.len() > 100 || !ids.insert(e.id.clone()) {
            return invalide(format!("identifiant absent ou en double : {}", e.file));
        }
        if !hex64(&e.sha256) {
            return invalide(format!("empreinte mal formee : {}", e.file));
        }
        if e.size == 0 || e.size > TAILLE_MAX_SCRIPT {
            return invalide(format!("taille hors limites : {}", e.file));
        }
    }
    Ok(index)
}

fn decoder_b64(texte: &str, quoi: &str) -> Result<String, String> {
    let octets = base64::engine::general_purpose::STANDARD
        .decode(texte.trim())
        .map_err(|e| erreur(code::SIGNATURE, format!("{quoi} illisible : {e}")))?;
    String::from_utf8(octets).map_err(|_| erreur(code::SIGNATURE, format!("{quoi} illisible")))
}

/// Une cle publique minisign, sous l'une des formes qu'un editeur publie : le
/// fichier `.pub` enveloppe de base64 (`tauri signer`, catalogue officiel), le
/// fichier `.pub` de `minisign` tel quel, ou sa seule ligne de cle (`RW…`).
pub fn decoder_cle(texte: &str) -> Result<PublicKey, String> {
    let texte = texte.trim();
    let illisible =
        |e: &dyn std::fmt::Display| erreur(code::CLE, format!("cle publique illisible : {e}"));
    if texte.contains("untrusted comment") {
        return PublicKey::decode(texte).map_err(|e| illisible(&e));
    }
    if let Ok(octets) = base64::engine::general_purpose::STANDARD.decode(texte) {
        if let Ok(fichier) = String::from_utf8(octets) {
            if fichier.contains("untrusted comment") {
                return PublicKey::decode(&fichier).map_err(|e| illisible(&e));
            }
        }
    }
    PublicKey::from_base64(texte).map_err(|e| illisible(&e))
}

/// La signature detachee : le fichier `.sig` enveloppe de base64 (`tauri
/// signer`) ou le fichier `.minisig` de `minisign` tel quel.
fn decoder_signature(octets: &[u8]) -> Result<Signature, String> {
    let texte = std::str::from_utf8(octets)
        .map_err(|_| erreur(code::SIGNATURE, "signature illisible"))?
        .trim();
    let fichier = if texte.contains("untrusted comment") {
        texte.to_string()
    } else {
        decoder_b64(texte, "signature")?
    };
    Signature::decode(&fichier)
        .map_err(|e| erreur(code::SIGNATURE, format!("signature illisible : {e}")))
}

/// Verifie la signature de l'index, **puis seulement** l'analyse.
///
/// On exige une signature pre-hachee (`ED`), celle que produisent `tauri
/// signer` et `minisign` ; l'ancien format non pre-hache n'est pas admis.
pub fn verifier_pour(
    cle: &str,
    attendu: Option<&str>,
    index: &[u8],
    signature: &[u8],
) -> Result<Index, String> {
    if cle.trim().is_empty() {
        return Err(erreur(
            code::SANS_CLE,
            "aucune cle publique de catalogue n'est compilee dans cette version",
        ));
    }
    let cle = decoder_cle(cle)?;
    let signature = decoder_signature(signature)?;
    cle.verify(index, &signature, false).map_err(|_| {
        erreur(
            code::SIGNATURE,
            "l'index ne porte pas la signature de cette source",
        )
    })?;
    // Seulement maintenant : l'index est authentique, on peut le lire.
    analyser(index, attendu)
}

/// Verifie un index de la source officielle.
#[cfg(test)]
pub fn verifier_avec(cle_b64: &str, index: &[u8], signature: &[u8]) -> Result<Index, String> {
    verifier_pour(cle_b64, Some(SOURCE), index, signature)
}

#[cfg(test)]
pub fn cle_presente() -> bool {
    !CLE_PUBLIQUE.trim().is_empty()
}

/// L'entree de l'index pour ce nom de fichier, sans egard a la casse.
pub fn trouver<'a>(index: &'a Index, fichier: &str) -> Option<&'a Entree> {
    index
        .scripts
        .iter()
        .find(|e| e.file.eq_ignore_ascii_case(fichier))
}

/// Refuse un index plus ancien que celui qui est installe.
///
/// Sans ce controle, qui intercepte la connexion pourrait servir un ancien
/// index, authentique et correctement signe, pour ramener un script dont un
/// defaut a ete corrige depuis.
pub fn refuser_retour_arriere(local: Option<&Index>, distant: &Index) -> Result<(), String> {
    let Some(local) = local else { return Ok(()) };
    if triplet(&distant.version) < triplet(&local.version) {
        return Err(erreur(
            code::ANCIEN,
            format!(
                "le catalogue propose la version {}, plus ancienne que la {} installee",
                distant.version, local.version
            ),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Ce qui est installe
// ---------------------------------------------------------------------------

/// `%LOCALAPPDATA%\WinTool\sources\<id>` : un dossier par source, a part
/// des scripts de l'utilisateur. La provenance d'un script se lit dans son
/// chemin, et deux sources ne peuvent pas se marcher dessus.
pub fn dossier_source<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<PathBuf, String> {
    if !id_source_sur(id) {
        return Err(erreur(
            code::INVALIDE,
            format!("identifiant de source « {id} »"),
        ));
    }
    Ok(discovery::base_dir(app)?.join("sources").join(id))
}

/// Le dossier de la source officielle.
pub fn dossier<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    dossier_source(app, SOURCE)
}

fn lire_borne(chemin: &Path, max: u64) -> Result<Vec<u8>, String> {
    let taille = fs::metadata(chemin)
        .map_err(|e| format!("{} : {e}", chemin.display()))?
        .len();
    if taille > max {
        return Err(erreur(
            code::INVALIDE,
            format!("{} depasse {max} octets", chemin.display()),
        ));
    }
    fs::read(chemin).map_err(|e| format!("{} : {e}", chemin.display()))
}

/// L'index installe, **re-verifie** a chaque lecture. `Ok(None)` : rien
/// d'installe. `Err` : un index est la, mais ne se verifie pas — ses scripts
/// perdent alors tous leur approbation implicite.
pub fn index_local_pour(cle: &str, attendu: &str, dossier: &Path) -> Result<Option<Index>, String> {
    let chemin_index = dossier.join(INDEX);
    let chemin_signature = dossier.join(SIGNATURE);
    if !chemin_index.exists() && !chemin_signature.exists() {
        return Ok(None);
    }
    let index = lire_borne(&chemin_index, TAILLE_MAX_INDEX)?;
    let signature = lire_borne(&chemin_signature, TAILLE_MAX_SIGNATURE)?;
    verifier_pour(cle, Some(attendu), &index, &signature).map(Some)
}

#[cfg(test)]
pub fn index_local_avec(cle_b64: &str, dossier: &Path) -> Result<Option<Index>, String> {
    index_local_pour(cle_b64, SOURCE, dossier)
}

#[cfg(test)]
pub fn index_local(dossier: &Path) -> Result<Option<Index>, String> {
    index_local_avec(CLE_PUBLIQUE, dossier)
}

/// Empreinte de chaque `.ps1` du dossier, par nom en minuscules. Le dossier
/// d'une source est plat : ce qui serait range dans un sous-dossier n'est de
/// toute facon pas a l'index.
pub fn empreintes(dossier: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Ok(entrees) = fs::read_dir(dossier) else {
        return out;
    };
    for entree in entrees.flatten() {
        let chemin = entree.path();
        let nom = entree.file_name().to_string_lossy().to_string();
        if chemin.is_file() && nom.to_ascii_lowercase().ends_with(".ps1") {
            if let Ok(octets) = fs::read(&chemin) {
                out.insert(nom.to_ascii_lowercase(), discovery::sha256_hex(&octets));
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Comparer et installer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct Element {
    pub id: String,
    pub file: String,
    pub title: BTreeMap<String, String>,
}

impl From<&Entree> for Element {
    fn from(e: &Entree) -> Self {
        Element {
            id: e.id.clone(),
            file: e.file.clone(),
            title: e.title.clone(),
        }
    }
}

/// Ce que changerait l'installation de l'index distant.
#[derive(Debug, Clone, Serialize)]
pub struct Bilan {
    pub version: String,
    pub published: String,
    /// Version installee, s'il y en a une qui se verifie.
    pub installee: Option<String>,
    /// Absents du disque.
    pub nouveaux: Vec<Element>,
    /// Presents dans leur version officielle precedente.
    pub mis_a_jour: Vec<Element>,
    /// Presents, mais modifies localement : ils seront remplaces, et la
    /// version modifiee gardee a cote.
    pub remplaces: Vec<Element>,
    /// A l'index installe, plus a celui-ci. Ils restent sur le disque — WinTool
    /// ne supprime jamais un script — mais redeviennent des scripts locaux,
    /// soumis a l'approbation du §12.1.
    pub retires: Vec<Element>,
    pub a_jour: bool,
}

/// Ce que changerait l'installation. `exclus` : les scripts que l'utilisateur
/// a decoches dans la page du catalogue ; ils ne comptent ni comme nouveaux ni
/// comme a mettre a jour.
pub fn comparer(
    local: Option<&Index>,
    distant: &Index,
    presents: &HashMap<String, String>,
    exclus: &HashSet<String>,
) -> Bilan {
    let mut nouveaux = Vec::new();
    let mut mis_a_jour = Vec::new();
    let mut remplaces = Vec::new();
    for e in distant.scripts.iter().filter(|e| !exclus.contains(&e.id)) {
        match presents.get(&e.file.to_ascii_lowercase()) {
            None => nouveaux.push(Element::from(e)),
            Some(h) if *h == e.sha256 => {}
            Some(h) => {
                let precedent = local.and_then(|l| trouver(l, &e.file));
                if precedent.is_some_and(|p| p.sha256 == *h) {
                    mis_a_jour.push(Element::from(e));
                } else {
                    remplaces.push(Element::from(e));
                }
            }
        }
    }
    let retires: Vec<Element> = local
        .map(|l| {
            l.scripts
                .iter()
                .filter(|e| trouver(distant, &e.file).is_none())
                .map(Element::from)
                .collect()
        })
        .unwrap_or_default();
    let installee = local.map(|l| l.version.clone());
    let a_jour = nouveaux.is_empty()
        && mis_a_jour.is_empty()
        && remplaces.is_empty()
        && retires.is_empty()
        && installee.as_deref() == Some(distant.version.as_str());
    Bilan {
        version: distant.version.clone(),
        published: distant.published.clone(),
        installee,
        nouveaux,
        mis_a_jour,
        remplaces,
        retires,
        a_jour,
    }
}

/// Les entrees retenues dont le fichier manque ou differe : celles a
/// telecharger.
pub fn a_telecharger<'a>(
    distant: &'a Index,
    presents: &HashMap<String, String>,
    exclus: &HashSet<String>,
) -> Vec<&'a Entree> {
    distant
        .scripts
        .iter()
        .filter(|e| !exclus.contains(&e.id))
        .filter(|e| presents.get(&e.file.to_ascii_lowercase()) != Some(&e.sha256))
        .collect()
}

/// Un script recu correspond-il, octet pour octet, a ce que l'index signe ?
pub fn controler(e: &Entree, octets: &[u8]) -> Result<(), String> {
    if octets.len() as u64 != e.size || discovery::sha256_hex(octets) != e.sha256 {
        return Err(erreur(
            code::EMPREINTE,
            format!(
                "{} ne correspond pas a l'index signe ; rien n'a ete installe",
                e.file
            ),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct Installation {
    pub version: String,
    pub ecrits: usize,
    /// Versions modifiees localement, mises de cote avant remplacement.
    pub copies: Vec<String>,
    /// Sortis du catalogue : toujours sur le disque, mais soumis desormais a
    /// l'approbation du §12.1. L'utilisateur doit l'apprendre maintenant, pas
    /// a la prochaine execution.
    pub retires: Vec<Element>,
}

/// Ecrit dans un fichier voisin puis le renomme par-dessus la cible : un
/// lecteur ne voit jamais un fichier a moitie ecrit.
fn ecrire_atomique(cible: &Path, octets: &[u8]) -> Result<(), String> {
    let temporaire = PathBuf::from(format!("{}.partiel", cible.display()));
    let resultat = fs::write(&temporaire, octets).and_then(|_| fs::rename(&temporaire, cible));
    if let Err(e) = resultat {
        let _ = fs::remove_file(&temporaire);
        return Err(erreur(code::ECRITURE, format!("{} : {e}", cible.display())));
    }
    Ok(())
}

/// Ecrit ce qui a ete recu, deja verifie. Separee du reseau pour s'eprouver
/// sans lui.
///
/// L'index et sa signature sont ecrits **en dernier**. Interrompue en route,
/// l'installation laisse donc des scripts neufs sous l'ancien index : leurs
/// empreintes ne correspondent plus, ils demandent l'accord de l'utilisateur
/// jusqu'a la prochaine installation complete. L'echec penche toujours du cote
/// de la prudence, jamais de celui d'une approbation indue.
pub fn appliquer(
    dossier: &Path,
    local: Option<&Index>,
    presents: &HashMap<String, String>,
    recus: &[(&Entree, Vec<u8>)],
    index_brut: &[u8],
    signature_brute: &[u8],
    horodatage: &str,
) -> Result<Installation, String> {
    // Aucune confiance, pas meme envers l'appelant.
    for (e, octets) in recus {
        controler(e, octets)?;
    }
    fs::create_dir_all(dossier)
        .map_err(|e| erreur(code::ECRITURE, format!("{} : {e}", dossier.display())))?;

    let mut copies = Vec::new();
    for (e, octets) in recus {
        let cible = dossier.join(&e.file);
        if let Some(h) = presents.get(&e.file.to_ascii_lowercase()) {
            let officiel = local
                .and_then(|l| trouver(l, &e.file))
                .is_some_and(|p| p.sha256 == *h);
            if !officiel {
                // Modifie par l'utilisateur : on ne detruit pas son travail. La
                // copie ne finit pas en .ps1, la decouverte l'ignore donc.
                let copie = format!("{}.{horodatage}.bak", e.file);
                fs::rename(&cible, dossier.join(&copie)).map_err(|err| {
                    erreur(code::ECRITURE, format!("{} : {err}", cible.display()))
                })?;
                copies.push(copie);
            }
        }
        ecrire_atomique(&cible, octets)?;
    }
    ecrire_atomique(&dossier.join(SIGNATURE), signature_brute)?;
    ecrire_atomique(&dossier.join(INDEX), index_brut)?;

    // Deja verifie par l'appelant ; seule la liste des scripts sert ici.
    let index: Index = serde_json::from_slice(index_brut).map_err(|e| erreur(code::INVALIDE, e))?;
    let retires = local
        .map(|l| {
            l.scripts
                .iter()
                .filter(|e| trouver(&index, &e.file).is_none())
                .map(Element::from)
                .collect()
        })
        .unwrap_or_default();
    Ok(Installation {
        version: index.version,
        ecrits: recus.len(),
        copies,
        retires,
    })
}

// ---------------------------------------------------------------------------
// Reseau
// ---------------------------------------------------------------------------

/// Client HTTPS : le meme fournisseur cryptographique (ring) et la meme
/// verification des certificats que le greffon de mise a jour.
///
/// Aucun identifiant ne voyage (§16.7) : pas meme le numero de version, que
/// l'en-tete User-Agent pourrait porter. La source apprend qu'une adresse a
/// demande un fichier public, rien de plus.
fn client() -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent("WinTool")
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| erreur(code::HORS_LIGNE, e))
}

/// Telecharge en memoire, sans depasser `max` octets.
async fn telecharger(client: &reqwest::Client, url: &str, max: u64) -> Result<Vec<u8>, String> {
    let mut reponse = client
        .get(url)
        .send()
        .await
        .map_err(|e| erreur(code::HORS_LIGNE, e))?;
    let statut = reponse.status();
    if statut == reqwest::StatusCode::NOT_FOUND {
        return Err(erreur(code::INTROUVABLE, url));
    }
    if !statut.is_success() {
        return Err(erreur(code::HORS_LIGNE, format!("{url} : HTTP {statut}")));
    }
    let trop = || erreur(code::INVALIDE, format!("{url} : plus de {max} octets"));
    if reponse.content_length().is_some_and(|n| n > max) {
        return Err(trop());
    }
    let mut octets = Vec::new();
    while let Some(morceau) = reponse
        .chunk()
        .await
        .map_err(|e| erreur(code::HORS_LIGNE, e))?
    {
        if (octets.len() + morceau.len()) as u64 > max {
            return Err(trop());
        }
        octets.extend_from_slice(&morceau);
    }
    Ok(octets)
}

struct Distant {
    index: Index,
    brut: Vec<u8>,
    signature: Vec<u8>,
}

/// Telecharge l'index de la derniere release d'un depot et le verifie avec
/// `cle`. `attendu` : la source dont l'index doit etre (`None` a l'ajout).
async fn consulter_depot(
    client: &reqwest::Client,
    depot: &str,
    cle: &str,
    attendu: Option<&str>,
) -> Result<Distant, String> {
    if cle.trim().is_empty() {
        // Inutile d'interroger le reseau pour un index qu'on ne saurait pas
        // verifier.
        return Err(erreur(
            code::SANS_CLE,
            "aucune cle publique de catalogue n'est compilee dans cette version",
        ));
    }
    // La cle d'abord : une cle illisible se dit sans aller sur le reseau.
    decoder_cle(cle)?;
    let base = format!("{}/releases/latest/download", url_depot(depot));
    let signature =
        telecharger(client, &format!("{base}/{SIGNATURE}"), TAILLE_MAX_SIGNATURE).await?;
    let brut = telecharger(client, &format!("{base}/{INDEX}"), TAILLE_MAX_INDEX).await?;
    let index = verifier_pour(cle, attendu, &brut, &signature)?;
    Ok(Distant {
        index,
        brut,
        signature,
    })
}

async fn consulter(client: &reqwest::Client, source: &Source) -> Result<Distant, String> {
    consulter_depot(client, &source.depot, &source.cle, Some(&source.id)).await
}

/// L'index d'un depot qu'on s'apprete a ajouter comme source, verifie avec la
/// cle donnee. C'est lui qui dit l'identifiant de la source (`source`).
pub async fn decouvrir(depot: &str, cle: &str) -> Result<Index, String> {
    Ok(consulter_depot(&client()?, depot, cle, None).await?.index)
}

/// L'adresse d'un script dans la release que nomme l'index.
fn url_script(source: &Source, tag: &str, fichier: &str) -> String {
    format!(
        "{}/releases/download/{tag}/{fichier}",
        url_depot(&source.depot)
    )
}

// ---------------------------------------------------------------------------
// Ce que voit l'interface
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct Resume {
    pub version: String,
    pub published: String,
    pub scripts: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Etat {
    /// Une cle publique est compilee : sans elle, rien n'est possible.
    pub cle: bool,
    pub depot: String,
    pub dossier: String,
    pub installe: Option<Resume>,
    /// Un index est present mais ne se verifie pas.
    pub probleme: Option<String>,
}

pub fn etat<R: Runtime>(app: &AppHandle<R>, source: &Source) -> Result<Etat, String> {
    let dossier = dossier_source(app, &source.id)?;
    let (installe, probleme) = match index_local_pour(&source.cle, &source.id, &dossier) {
        Ok(i) => (
            i.map(|i| Resume {
                version: i.version,
                published: i.published,
                scripts: i.scripts.len(),
            }),
            None,
        ),
        Err(e) => (None, Some(e)),
    };
    Ok(Etat {
        cle: !source.cle.trim().is_empty(),
        depot: source.depot.clone(),
        dossier: dossier.to_string_lossy().to_string(),
        installe,
        probleme,
    })
}

/// Interroge le catalogue et dit ce qu'une installation changerait. Ne
/// telecharge que l'index : aucun script, rien d'ecrit.
pub async fn examiner<R: Runtime>(
    app: &AppHandle<R>,
    source: &Source,
    exclus: &HashSet<String>,
) -> Result<Bilan, String> {
    let dossier = dossier_source(app, &source.id)?;
    // Un index local qui ne se verifie plus ne compte pas : on comparera comme
    // si rien n'etait installe, et tout sera reverifie.
    let local = index_local_pour(&source.cle, &source.id, &dossier)
        .ok()
        .flatten();
    let distant = consulter(&client()?, source).await?;
    refuser_retour_arriere(local.as_ref(), &distant.index)?;
    Ok(comparer(
        local.as_ref(),
        &distant.index,
        &empreintes(&dossier),
        exclus,
    ))
}

/// Progression, emise sur `catalogue:progress`.
#[derive(Debug, Clone, Serialize)]
struct Progression {
    fait: usize,
    total: usize,
}

/// Telecharge, verifie et installe la derniere release du catalogue.
///
/// L'index est re-telecharge plutot que repris d'`examiner` : c'est la release
/// publiee *maintenant* qu'on installe. Tous les scripts sont recus et
/// controles en memoire avant que le premier soit ecrit.
pub async fn installer<R: Runtime>(
    app: &AppHandle<R>,
    source: &Source,
    exclus: &HashSet<String>,
) -> Result<Installation, String> {
    let dossier = dossier_source(app, &source.id)?;
    let local = index_local_pour(&source.cle, &source.id, &dossier)
        .ok()
        .flatten();
    let client = client()?;
    let distant = consulter(&client, source).await?;
    refuser_retour_arriere(local.as_ref(), &distant.index)?;

    let presents = empreintes(&dossier);
    let manquants = a_telecharger(&distant.index, &presents, exclus);
    let total = manquants.len();
    let _ = app.emit("catalogue:progress", Progression { fait: 0, total });

    let mut recus = Vec::with_capacity(total);
    for (n, e) in manquants.into_iter().enumerate() {
        let url = url_script(source, &distant.index.tag, &e.file);
        let octets = telecharger(&client, &url, e.size).await?;
        controler(e, &octets)?;
        recus.push((e, octets));
        let _ = app.emit("catalogue:progress", Progression { fait: n + 1, total });
    }

    let horodatage = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    appliquer(
        &dossier,
        local.as_ref(),
        &presents,
        &recus,
        &distant.brut,
        &distant.signature,
        &horodatage,
    )
}

/// Un script d'un catalogue, tel que la page « Consulter et choisir » le
/// montre : ce qu'il fait, et ou il en est sur ce PC.
#[derive(Debug, Clone, Serialize)]
pub struct Contenu {
    pub id: String,
    pub file: String,
    pub version: String,
    /// Titre et description par langue, lus dans l'entete du script.
    pub title: BTreeMap<String, String>,
    pub desc: BTreeMap<String, String>,
    pub category: String,
    pub risk: String,
    pub admin: bool,
    /// `absent`, `installe` (a jour), `maj` (une version plus recente), ou
    /// `modifie` (retouche sur ce PC : il serait remplace, la retouche gardee).
    pub etat: &'static str,
    pub exclu: bool,
}

/// Titre et description d'un script, par langue, d'apres son entete.
fn textes_script(
    octets: &[u8],
) -> (
    contract::Script,
    BTreeMap<String, String>,
    BTreeMap<String, String>,
) {
    let texte = String::from_utf8_lossy(octets);
    let texte = texte.strip_prefix('\u{feff}').unwrap_or(&texte);
    let meta = contract::parse(texte);
    let mut titres = BTreeMap::new();
    let mut descriptions = BTreeMap::new();
    let langue = if meta.lang.trim().is_empty() {
        "fr".to_string()
    } else {
        meta.lang.trim().to_string()
    };
    if !meta.title.trim().is_empty() {
        titres.insert(langue.clone(), meta.title.trim().to_string());
    }
    if !meta.desc.trim().is_empty() {
        descriptions.insert(langue, meta.desc.trim().to_string());
    }
    for (l, tr) in &meta.translations {
        if !tr.title.trim().is_empty() {
            titres.insert(l.clone(), tr.title.trim().to_string());
        }
        if !tr.desc.trim().is_empty() {
            descriptions.insert(l.clone(), tr.desc.trim().to_string());
        }
    }
    (meta, titres, descriptions)
}

/// Le contenu de la derniere release d'un catalogue, script par script, avec
/// son etat sur ce PC. Rien n'est ecrit : un script installe et conforme se lit
/// sur le disque, les autres sont recus en memoire, controles contre l'index
/// signe, lus, et oublies.
pub async fn contenu<R: Runtime>(
    app: &AppHandle<R>,
    source: &Source,
    exclus: &HashSet<String>,
) -> Result<Vec<Contenu>, String> {
    let dossier = dossier_source(app, &source.id)?;
    let local = index_local_pour(&source.cle, &source.id, &dossier)
        .ok()
        .flatten();
    let client = client()?;
    let distant = consulter(&client, source).await?;
    refuser_retour_arriere(local.as_ref(), &distant.index)?;
    let presents = empreintes(&dossier);

    let total = distant.index.scripts.len();
    let _ = app.emit("catalogue:progress", Progression { fait: 0, total });
    let mut liste = Vec::with_capacity(total);
    for (n, e) in distant.index.scripts.iter().enumerate() {
        let present = presents.get(&e.file.to_ascii_lowercase());
        let etat = match present {
            None => "absent",
            Some(h) if *h == e.sha256 => "installe",
            Some(h) => {
                let precedent = local.as_ref().and_then(|l| trouver(l, &e.file));
                if precedent.is_some_and(|p| p.sha256 == *h) {
                    "maj"
                } else {
                    "modifie"
                }
            }
        };
        let octets = if etat == "installe" {
            fs::read(dossier.join(&e.file)).unwrap_or_default()
        } else {
            let recu = telecharger(
                &client,
                &url_script(source, &distant.index.tag, &e.file),
                e.size,
            )
            .await?;
            controler(e, &recu)?;
            recu
        };
        let (meta, mut title, desc) = textes_script(&octets);
        if title.is_empty() {
            title = e.title.clone();
        }
        liste.push(Contenu {
            id: e.id.clone(),
            file: e.file.clone(),
            version: e.version.clone(),
            title,
            desc,
            category: meta.category,
            risk: meta.risk,
            admin: meta.admin,
            etat,
            exclu: exclus.contains(&e.id),
        });
        let _ = app.emit("catalogue:progress", Progression { fait: n + 1, total });
    }
    Ok(liste)
}

// ---------------------------------------------------------------------------
// Tests
//
// Les fixtures de `fixtures/catalogue/` ont ete signees par une cle jetable,
// dont seule la partie publique a ete gardee (`cle-essai.pub`) : la partie
// privee a ete detruite aussitot. `cle-autre.pub` est une seconde cle, qui n'a
// jamais rien signe.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const CLE: &str = include_str!("../fixtures/catalogue/cle-essai.pub");
    const AUTRE_CLE: &str = include_str!("../fixtures/catalogue/cle-autre.pub");
    const I090: &[u8] = include_bytes!("../fixtures/catalogue/index-0.9.0.json");
    const S090: &[u8] = include_bytes!("../fixtures/catalogue/index-0.9.0.json.sig");
    const I100: &[u8] = include_bytes!("../fixtures/catalogue/index-1.0.0.json");
    const S100: &[u8] = include_bytes!("../fixtures/catalogue/index-1.0.0.json.sig");
    const I110: &[u8] = include_bytes!("../fixtures/catalogue/index-1.1.0.json");
    const S110: &[u8] = include_bytes!("../fixtures/catalogue/index-1.1.0.json.sig");
    const A1: &[u8] = include_bytes!("../fixtures/catalogue/scripts/A-v1.txt");
    const A2: &[u8] = include_bytes!("../fixtures/catalogue/scripts/A-v2.txt");
    const B: &[u8] = include_bytes!("../fixtures/catalogue/scripts/B.txt");
    const C: &[u8] = include_bytes!("../fixtures/catalogue/scripts/C.txt");

    struct Bac(PathBuf);

    impl Bac {
        fn neuf(nom: &str) -> Bac {
            let d = std::env::temp_dir().join(format!("wintool-cat-{}-{nom}", std::process::id()));
            let _ = fs::remove_dir_all(&d);
            fs::create_dir_all(&d).unwrap();
            Bac(d)
        }
    }

    impl Drop for Bac {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn v(index: &[u8], sig: &[u8]) -> Index {
        verifier_avec(CLE, index, sig).expect("fixture valide")
    }

    // ----- Signature -----------------------------------------------------

    #[test]
    fn un_index_signe_se_verifie_et_se_lit() {
        let i = v(I100, S100);
        assert_eq!(i.version, "1.0.0");
        assert_eq!(i.tag, "v1.0.0");
        assert_eq!(i.scripts.len(), 2);
        assert_eq!(i.scripts[0].file, "100_A.ps1");
        assert_eq!(i.scripts[0].title["fr"], "Script A");
    }

    #[test]
    fn un_seul_octet_change_et_la_signature_tombe() {
        let mut falsifie = I100.to_vec();
        // Le chiffre de la version : 1.0.0 devient 9.0.0, rien d'autre ne bouge.
        let pos = falsifie.windows(7).position(|w| w == b"\"1.0.0\"").unwrap();
        falsifie[pos + 1] = b'9';
        let e = verifier_avec(CLE, &falsifie, S100).unwrap_err();
        assert!(e.starts_with(code::SIGNATURE), "{e}");
    }

    #[test]
    fn la_signature_d_un_autre_index_ne_vaut_pas() {
        let e = verifier_avec(CLE, I100, S110).unwrap_err();
        assert!(e.starts_with(code::SIGNATURE), "{e}");
    }

    #[test]
    fn une_autre_cle_ne_vaut_pas() {
        let e = verifier_avec(AUTRE_CLE, I100, S100).unwrap_err();
        assert!(e.starts_with(code::SIGNATURE), "{e}");
    }

    #[test]
    fn sans_cle_compilee_tout_est_refuse() {
        let e = verifier_avec("  \n", I100, S100).unwrap_err();
        assert!(e.starts_with(code::SANS_CLE), "{e}");
    }

    #[test]
    fn une_signature_illisible_est_refusee_sans_paniquer() {
        for sig in [
            &b""[..],
            b"pas du base64 !",
            b"\xff\xfe",
            b"dW4gdGV4dGUgcXVlbGNvbnF1ZQ==",
        ] {
            let e = verifier_avec(CLE, I100, sig).unwrap_err();
            assert!(e.starts_with(code::SIGNATURE), "{e}");
        }
    }

    #[test]
    fn un_index_non_signe_n_est_meme_pas_analyse() {
        // Du JSON invalide, mais sous une signature qui ne le couvre pas : si
        // l'analyse passait la premiere, l'erreur serait CATALOGUE_INVALIDE.
        let e = verifier_avec(CLE, b"{ ceci n'est pas du json", S100).unwrap_err();
        assert!(e.starts_with(code::SIGNATURE), "{e}");
    }

    // ----- Contenu de l'index (deja authentifie) -----------------------

    fn index_avec(fichier: &str) -> String {
        format!(
            r#"{{"format":1,"source":"officiel","version":"1.0.0","published":"2026-10-06","tag":"v1.0.0",
               "scripts":[{{"id":"x","file":"{fichier}","version":"1.0","size":10,
               "sha256":"{}"}}]}}"#,
            "a".repeat(64)
        )
    }

    #[test]
    fn les_noms_de_fichier_dangereux_sont_refuses() {
        for nom in [
            "../evil.ps1",
            "..\\\\evil.ps1",
            "sous/dossier.ps1",
            "sous\\\\dossier.ps1",
            "C:evil.ps1",
            "a.ps1:flux",
            "CON.ps1",
            "nul.ps1",
            "Com1.ps1",
            "LPT9.ps1",
            ".cache.ps1",
            "fin.ps1.",
            "accentue-é.ps1",
            "pas-un-script.exe",
            "index.json",
            "",
        ] {
            let e = analyser(index_avec(nom).as_bytes(), Some(SOURCE)).unwrap_err();
            assert!(e.starts_with(code::INVALIDE), "{nom:?} : {e}");
        }
        assert!(analyser(index_avec("100_CLEAN-TEMP.v2.ps1").as_bytes(), Some(SOURCE)).is_ok());
    }

    #[test]
    fn deux_entrees_qui_ne_different_que_par_la_casse_sont_refusees() {
        let brut = format!(
            r#"{{"format":1,"source":"officiel","version":"1.0.0","published":"","tag":"v1",
               "scripts":[
                 {{"id":"a","file":"A.ps1","version":"1","size":1,"sha256":"{h}"}},
                 {{"id":"b","file":"a.PS1","version":"1","size":1,"sha256":"{h}"}}]}}"#,
            h = "b".repeat(64)
        );
        assert!(analyser(brut.as_bytes(), Some(SOURCE))
            .unwrap_err()
            .starts_with(code::INVALIDE));
    }

    #[test]
    fn un_format_futur_demande_une_mise_a_jour_de_wintool() {
        let e = analyser(br#"{"format":2,"tout":"autre chose"}"#, Some(SOURCE)).unwrap_err();
        assert!(e.starts_with(code::FORMAT), "{e}");
    }

    #[test]
    fn l_index_d_une_autre_source_est_refuse() {
        let brut = index_avec("a.ps1").replace("\"officiel\"", "\"un-fork\"");
        assert!(analyser(brut.as_bytes(), Some(SOURCE))
            .unwrap_err()
            .starts_with(code::INVALIDE));
    }

    #[test]
    fn empreinte_et_version_mal_formees_sont_refusees() {
        let majuscules = index_avec("a.ps1").replace(&"a".repeat(64), &"A".repeat(64));
        assert!(analyser(majuscules.as_bytes(), Some(SOURCE)).is_err());
        let version = index_avec("a.ps1").replace("\"1.0.0\"", "\"1.0\"");
        assert!(analyser(version.as_bytes(), Some(SOURCE)).is_err());
        let tag = index_avec("a.ps1").replace("\"v1.0.0\"", "\"../v1\"");
        assert!(analyser(tag.as_bytes(), Some(SOURCE)).is_err());
    }

    #[test]
    fn les_versions_se_comparent_en_nombres() {
        assert!(triplet("1.10.0") > triplet("1.9.0"));
        assert_eq!(triplet("01.0.0"), Some((1, 0, 0)));
        assert_eq!(triplet("+1.0.0"), None);
        assert_eq!(triplet("1.0.0-rc1"), None);
        assert_eq!(triplet("1.0"), None);
    }

    #[test]
    fn un_retour_en_arriere_est_refuse() {
        let ancien = v(I090, S090);
        let actuel = v(I100, S100);
        let e = refuser_retour_arriere(Some(&actuel), &ancien).unwrap_err();
        assert!(e.starts_with(code::ANCIEN), "{e}");
        assert!(refuser_retour_arriere(Some(&actuel), &actuel).is_ok());
        assert!(refuser_retour_arriere(Some(&ancien), &actuel).is_ok());
        assert!(refuser_retour_arriere(None, &ancien).is_ok());
    }

    // ----- Comparer --------------------------------------------------------

    fn presents(fichiers: &[(&str, &[u8])]) -> HashMap<String, String> {
        fichiers
            .iter()
            .map(|(n, o)| (n.to_ascii_lowercase(), discovery::sha256_hex(o)))
            .collect()
    }

    #[test]
    fn premiere_installation_tout_est_nouveau() {
        let b = comparer(None, &v(I100, S100), &HashMap::new(), &HashSet::new());
        assert_eq!(b.nouveaux.len(), 2);
        assert!(b.mis_a_jour.is_empty() && b.remplaces.is_empty() && b.retires.is_empty());
        assert!(!b.a_jour);
        assert_eq!(b.installee, None);
    }

    #[test]
    fn rien_a_faire_quand_tout_correspond() {
        let i = v(I100, S100);
        let b = comparer(
            Some(&i),
            &i,
            &presents(&[("100_A.ps1", A1), ("200_B.ps1", B)]),
            &HashSet::new(),
        );
        assert!(b.a_jour, "{b:?}");
    }

    #[test]
    fn une_nouvelle_version_se_decompose() {
        let local = v(I100, S100);
        let distant = v(I110, S110);
        let b = comparer(
            Some(&local),
            &distant,
            &presents(&[("100_A.ps1", A1), ("200_B.ps1", B)]),
            &HashSet::new(),
        );
        // A change de contenu, C arrive, B quitte le catalogue.
        assert_eq!(
            b.mis_a_jour.iter().map(|e| &e.file[..]).collect::<Vec<_>>(),
            ["100_A.ps1"]
        );
        assert_eq!(
            b.nouveaux.iter().map(|e| &e.file[..]).collect::<Vec<_>>(),
            ["300_C.ps1"]
        );
        assert_eq!(
            b.retires.iter().map(|e| &e.file[..]).collect::<Vec<_>>(),
            ["200_B.ps1"]
        );
        assert!(b.remplaces.is_empty());
        assert_eq!(b.installee.as_deref(), Some("1.0.0"));
        assert!(!b.a_jour);
    }

    #[test]
    fn un_script_modifie_localement_est_annonce_comme_remplace() {
        let local = v(I100, S100);
        let distant = v(I110, S110);
        let b = comparer(
            Some(&local),
            &distant,
            &presents(&[("100_a.PS1", b"modifie a la main"), ("200_B.ps1", B)]),
            &HashSet::new(),
        );
        assert_eq!(
            b.remplaces.iter().map(|e| &e.file[..]).collect::<Vec<_>>(),
            ["100_A.ps1"]
        );
        assert!(b.mis_a_jour.is_empty());
    }

    // ----- Installer -------------------------------------------------------

    #[test]
    fn une_installation_ecrit_les_scripts_puis_l_index_qui_se_reverifie() {
        let bac = Bac::neuf("installe");
        let i = v(I100, S100);
        let recus = vec![(&i.scripts[0], A1.to_vec()), (&i.scripts[1], B.to_vec())];
        let r = appliquer(&bac.0, None, &HashMap::new(), &recus, I100, S100, "t").unwrap();
        assert_eq!(r.version, "1.0.0");
        assert_eq!(r.ecrits, 2);
        assert!(r.copies.is_empty());

        assert_eq!(fs::read(bac.0.join("100_A.ps1")).unwrap(), A1);
        // L'index installe se relit et se reverifie, comme a chaque decouverte.
        assert_eq!(index_local_avec(CLE, &bac.0).unwrap(), Some(i));
        // Aucun fichier temporaire ne traine.
        assert!(!fs::read_dir(&bac.0)
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().ends_with(".partiel")));
    }

    #[test]
    fn un_script_qui_ne_correspond_pas_a_l_index_n_ecrit_rien() {
        let bac = Bac::neuf("refus");
        let i = v(I100, S100);
        // Le premier est bon, le second non : rien du tout ne doit etre ecrit.
        let recus = vec![
            (&i.scripts[0], A1.to_vec()),
            (&i.scripts[1], b"pirate".to_vec()),
        ];
        let e = appliquer(&bac.0, None, &HashMap::new(), &recus, I100, S100, "t").unwrap_err();
        assert!(e.starts_with(code::EMPREINTE), "{e}");
        assert_eq!(fs::read_dir(&bac.0).unwrap().count(), 0);
    }

    #[test]
    fn une_mise_a_jour_garde_la_version_modifiee_par_l_utilisateur() {
        let bac = Bac::neuf("copie");
        let local = v(I100, S100);
        let distant = v(I110, S110);
        let recus = vec![
            (&local.scripts[0], A1.to_vec()),
            (&local.scripts[1], B.to_vec()),
        ];
        appliquer(&bac.0, None, &HashMap::new(), &recus, I100, S100, "t").unwrap();

        // L'utilisateur retouche A.
        fs::write(bac.0.join("100_A.ps1"), b"ma version").unwrap();
        let p = empreintes(&bac.0);
        let manquants = a_telecharger(&distant, &p, &HashSet::new());
        let recus: Vec<_> = manquants
            .into_iter()
            .map(|e| {
                (
                    e,
                    if e.file == "100_A.ps1" {
                        A2.to_vec()
                    } else {
                        C.to_vec()
                    },
                )
            })
            .collect();
        let r = appliquer(
            &bac.0,
            Some(&local),
            &p,
            &recus,
            I110,
            S110,
            "20261006-120000",
        )
        .unwrap();

        assert_eq!(r.copies, ["100_A.ps1.20261006-120000.bak"]);
        assert_eq!(
            r.retires.iter().map(|e| &e.file[..]).collect::<Vec<_>>(),
            ["200_B.ps1"]
        );
        assert_eq!(
            fs::read(bac.0.join("100_A.ps1.20261006-120000.bak")).unwrap(),
            b"ma version"
        );
        assert_eq!(fs::read(bac.0.join("100_A.ps1")).unwrap(), A2);
        // Retire du catalogue, B reste sur le disque.
        assert_eq!(fs::read(bac.0.join("200_B.ps1")).unwrap(), B);
        assert_eq!(
            index_local_avec(CLE, &bac.0).unwrap().unwrap().version,
            "1.1.0"
        );
    }

    #[test]
    fn une_mise_a_jour_ordinaire_ne_fait_pas_de_copie() {
        let bac = Bac::neuf("ordinaire");
        let local = v(I100, S100);
        let distant = v(I110, S110);
        let recus = vec![
            (&local.scripts[0], A1.to_vec()),
            (&local.scripts[1], B.to_vec()),
        ];
        appliquer(&bac.0, None, &HashMap::new(), &recus, I100, S100, "t").unwrap();

        let p = empreintes(&bac.0);
        let recus: Vec<_> = a_telecharger(&distant, &p, &HashSet::new())
            .into_iter()
            .map(|e| {
                (
                    e,
                    if e.file == "100_A.ps1" {
                        A2.to_vec()
                    } else {
                        C.to_vec()
                    },
                )
            })
            .collect();
        assert_eq!(
            recus.len(),
            2,
            "A change, C arrive ; B n'est pas re-telecharge"
        );
        let r = appliquer(&bac.0, Some(&local), &p, &recus, I110, S110, "t").unwrap();
        assert!(r.copies.is_empty());
    }

    #[test]
    fn un_index_local_falsifie_ne_se_verifie_plus() {
        let bac = Bac::neuf("falsifie");
        let i = v(I100, S100);
        let recus = vec![(&i.scripts[0], A1.to_vec()), (&i.scripts[1], B.to_vec())];
        appliquer(&bac.0, None, &HashMap::new(), &recus, I100, S100, "t").unwrap();

        // Un programme sans droits glisse l'empreinte de son propre script dans
        // l'index installe : la signature ne le couvre plus.
        let texte = fs::read_to_string(bac.0.join(INDEX)).unwrap();
        let h = discovery::sha256_hex(A1);
        fs::write(bac.0.join(INDEX), texte.replace(&h, &"0".repeat(64))).unwrap();
        let e = index_local_avec(CLE, &bac.0).unwrap_err();
        assert!(e.starts_with(code::SIGNATURE), "{e}");
    }

    #[test]
    fn rien_d_installe_n_est_pas_une_erreur() {
        let bac = Bac::neuf("vide");
        assert_eq!(index_local_avec(CLE, &bac.0).unwrap(), None);
        assert_eq!(index_local_avec(CLE, &bac.0.join("absent")).unwrap(), None);
    }

    // ----- Sources tierces (specification 16.2) -----------------------------

    /// Le fichier minisign que `tauri signer` enveloppe de base64.
    fn deballe(b64: &[u8]) -> String {
        decoder_b64(std::str::from_utf8(b64).unwrap(), "essai").unwrap()
    }

    #[test]
    fn la_cle_d_un_editeur_se_lit_sous_ses_trois_formes() {
        let fichier = deballe(CLE.as_bytes());
        let ligne = fichier
            .lines()
            .find(|l| l.starts_with("RW"))
            .expect("ligne de cle")
            .to_string();
        for forme in [CLE.to_string(), fichier, ligne] {
            let cle = decoder_cle(&forme).expect("forme refusee");
            let sig = decoder_signature(S100).unwrap();
            assert!(cle.verify(I100, &sig, false).is_ok());
        }
        let e = decoder_cle("pas une cle").unwrap_err();
        assert!(e.starts_with(code::CLE), "{e}");
    }

    #[test]
    fn une_signature_minisign_brute_vaut_l_enveloppee() {
        let brute = deballe(S100);
        assert!(verifier_avec(CLE, I100, brute.as_bytes()).is_ok());
    }

    #[test]
    fn a_l_ajout_c_est_l_index_qui_donne_l_identifiant() {
        let i = verifier_pour(CLE, None, I100, S100).unwrap();
        assert_eq!(i.source, "officiel");
        let brut = index_avec("a.ps1").replace("\"officiel\"", "\"Pas Sur/../x\"");
        assert!(analyser(brut.as_bytes(), None)
            .unwrap_err()
            .starts_with(code::INVALIDE));
        let autre = index_avec("a.ps1").replace("\"officiel\"", "\"dupont\"");
        assert_eq!(analyser(autre.as_bytes(), None).unwrap().source, "dupont");
        assert!(analyser(autre.as_bytes(), Some("martin")).is_err());
    }

    #[test]
    fn un_depot_github_se_reconnait_sous_ses_formes_courantes() {
        for saisie in [
            "dupont/scripts",
            "https://github.com/dupont/scripts",
            "https://github.com/dupont/scripts/",
            "github.com/dupont/scripts.git",
            "https://www.github.com/dupont/scripts/releases",
            "  http://github.com/dupont/scripts  ",
        ] {
            assert_eq!(
                normaliser_depot(saisie).as_deref(),
                Ok("dupont/scripts"),
                "{saisie}"
            );
        }
        for saisie in [
            "",
            "dupont",
            "https://gitlab.com/dupont/scripts",
            "gitlab.com/dupont/scripts",
            "dupont/..",
            "dupont/.cache",
            "-dupont/scripts",
            "du pont/scripts",
            "dupont/scripts?x=1",
        ] {
            let e = normaliser_depot(saisie).unwrap_err();
            assert!(e.starts_with(code::DEPOT), "{saisie} : {e}");
        }
    }

    #[test]
    fn un_script_decoche_n_est_ni_propose_ni_telecharge() {
        let distant = v(I110, S110);
        let exclus: HashSet<String> = distant
            .scripts
            .iter()
            .map(|e| e.id.clone())
            .take(1)
            .collect();
        let b = comparer(None, &distant, &HashMap::new(), &exclus);
        assert_eq!(b.nouveaux.len(), distant.scripts.len() - 1);
        assert!(b.nouveaux.iter().all(|e| !exclus.contains(&e.id)));
        let a = a_telecharger(&distant, &HashMap::new(), &exclus);
        assert_eq!(a.len(), distant.scripts.len() - 1);
    }

    #[test]
    fn un_identifiant_de_source_est_un_nom_de_dossier_sur() {
        for id in ["officiel", "dupont", "scripts-2"] {
            assert!(id_source_sur(id), "{id}");
        }
        for id in [
            "",
            "Dupont",
            "-x",
            "a/b",
            "a..b",
            "con.ps1",
            &"x".repeat(41),
        ] {
            assert!(!id_source_sur(id), "{id}");
        }
    }

    /// Aller-retour avec `tools/construire-index-catalogue.ps1` : l'index que
    /// produit l'outil, signe par `tauri signer`, doit se verifier et se lire
    /// ici. A lancer a la main, avec un index et une cle jetables :
    ///
    /// ```text
    /// WINTOOL_INDEX_ESSAI=<index.json> WINTOOL_CLE_ESSAI=<cle.pub>
    ///   cargo test --lib -- --ignored aller_retour
    /// ```
    #[test]
    #[ignore]
    fn aller_retour_avec_l_outil_de_construction() {
        let index = std::env::var("WINTOOL_INDEX_ESSAI").expect("WINTOOL_INDEX_ESSAI");
        let cle = std::env::var("WINTOOL_CLE_ESSAI").expect("WINTOOL_CLE_ESSAI");
        let cle = fs::read_to_string(cle).unwrap();
        let brut = fs::read(&index).unwrap();
        let signature = fs::read(format!("{index}.sig")).unwrap();
        let i = verifier_avec(&cle, &brut, &signature).expect("index de l'outil refuse");
        assert!(!i.scripts.is_empty());
        assert!(i.scripts.iter().all(|e| !e.title.is_empty()));
    }

    /// Le catalogue officiel publie, par le vrai code reseau (TLS, redirections
    /// de GitHub, plafonds) et la vraie cle compilee, installe dans un dossier
    /// jetable. A lancer a la main avant chaque release de WinTool :
    ///
    /// ```text
    /// cargo test --lib -- --ignored catalogue_publie
    /// ```
    #[test]
    #[ignore]
    fn catalogue_publie_se_telecharge_et_s_installe() {
        let bac = Bac::neuf("publie");
        tauri::async_runtime::block_on(async {
            let client = client().expect("client HTTPS");
            let officielle = crate::sources::officielle();
            let distant = consulter(&client, &officielle)
                .await
                .expect("index officiel");
            let presents = HashMap::new();
            let mut recus = Vec::new();
            for e in a_telecharger(&distant.index, &presents, &HashSet::new()) {
                let url = url_script(&officielle, &distant.index.tag, &e.file);
                let octets = telecharger(&client, &url, e.size)
                    .await
                    .unwrap_or_else(|err| panic!("{} : {err}", e.file));
                recus.push((e, octets));
            }
            let r = appliquer(
                &bac.0,
                None,
                &presents,
                &recus,
                &distant.brut,
                &distant.signature,
                "t",
            )
            .expect("installation");
            assert_eq!(r.ecrits, distant.index.scripts.len());
            let relu = index_local(&bac.0)
                .expect("index installe")
                .expect("present");
            println!(
                "catalogue {} : {} scripts installes et verifies",
                relu.version, r.ecrits
            );
        });
    }

    #[test]
    fn la_cle_officielle_si_presente_est_lisible() {
        // Garde-fou : une cle compilee mais illisible rendrait le catalogue
        // inutilisable en silence, jusqu'au premier essai d'un utilisateur.
        if cle_presente() {
            let texte = decoder_b64(CLE_PUBLIQUE, "cle publique").unwrap();
            assert!(PublicKey::decode(&texte).is_ok(), "catalogue.pub illisible");
            assert_ne!(
                CLE_PUBLIQUE.trim(),
                CLE.trim(),
                "la cle d'essai des tests a ete compilee comme cle officielle"
            );
        }
    }
}
