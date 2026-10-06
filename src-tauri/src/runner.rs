//! Execution d'un script, avec restitution de la sortie en direct.
//!
//! Ce module corrige le defaut le plus grave de la v3 : elle annoncait un
//! succes des lors que le processus avait demarre, jamais selon ce qu'il avait
//! reellement fait. Ici **le verdict vient du code de sortie du processus**
//! (specification 5.3), et la sortie remonte ligne par ligne pendant
//! l'execution au lieu d'etre inventee.
//!
//! Enchainement :
//!   1. les valeurs choisies sont serialisees en JSON ;
//!   2. ce JSON est pose **dans** `WINTOOL_CONFIG` — la variable contient les
//!      valeurs, jamais le chemin d'un fichier (specification 5.2) ;
//!   3. **le script original est execute tel quel** — ni reecriture, ni copie
//!      temporaire, contrairement a la v3 ;
//!   4. deux fils lisent stdout et stderr et publient chaque ligne ;
//!   5. a la fin, le bilan porte le vrai code de sortie et la duree.
//!
//! Le moteur ne connait pas Tauri : il publie sur un [`Sortie`], dont
//! l'implementation vers l'interface n'est qu'un adaptateur de quatre lignes.
//! C'est ce qui permet de le verifier de bout en bout — vrai processus, vraie
//! sortie, vrai code de retour — sans fenetre ni interface a piloter a la main.
//!
//! Ce que ce module ne fait jamais : `-EncodedCommand`, ni aucun autre moyen de
//! soustraire le script au scan AMSI que Windows effectue deja
//! (specification 12.3). Le script est passe par `-File`, en clair.

use crate::discovery;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Runtime};

#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Empeche l'apparition d'une fenetre de console noire derriere l'application.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Seule la lecture est partagee : tant que nous tenons ce handle, aucun autre
/// processus ne peut ecrire dans le fichier, le renommer ni le supprimer.
#[cfg(windows)]
const FILE_SHARE_READ: u32 = 0x0000_0001;

/// Marqueurs de la specification 5.3. Toute autre balise en debut de ligne est
/// laissee telle quelle : le moteur affiche, il ne censure pas.
const MARQUEURS: [&str; 8] = [
    "INFO", "OK", "WARN", "ERR", "STEP", "CKPT", "REBOOT", "DONE",
];

/// Politiques d'execution admises (specification 6.7). Elles ne s'appliquent
/// qu'au processus enfant : la politique de la machine n'est ni lue ni modifiee.
const POLITIQUES: [&str; 3] = ["Bypass", "RemoteSigned", "Unrestricted"];

// ---------------------------------------------------------------------------
// Interpreteurs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct Engines {
    /// Windows PowerShell 5.1, present nativement sur tout Windows 10/11.
    pub winps: Option<String>,
    /// PowerShell 7+, installe separement.
    pub pwsh: Option<String>,
}

/// Cherche un executable dans les emplacements connus puis dans le `PATH`.
///
/// On resout un chemin absolu plutot que de laisser Windows chercher : le
/// processus est eleve, et s'en remettre a l'ordre du `PATH` reviendrait a
/// laisser n'importe quel dossier inscriptible qui y figure decider quel
/// interpreteur recoit les droits administrateur.
fn chercher(nom: &str, connus: &[PathBuf]) -> Option<String> {
    for c in connus {
        if c.is_file() {
            return Some(c.to_string_lossy().to_string());
        }
    }
    let chemin = std::env::var_os("PATH")?;
    for dossier in std::env::split_paths(&chemin) {
        let candidat = dossier.join(nom);
        if candidat.is_file() {
            return Some(candidat.to_string_lossy().to_string());
        }
    }
    None
}

pub fn engines() -> Engines {
    let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let winps = chercher(
        "powershell.exe",
        &[PathBuf::from(&sysroot)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe")],
    );

    let mut connus = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(var) {
            // Les versions majeures futures s'installent dans un dossier frere ;
            // on ne les devine pas, le PATH prendra le relais.
            for v in ["7", "8"] {
                connus.push(
                    PathBuf::from(&base)
                        .join("PowerShell")
                        .join(v)
                        .join("pwsh.exe"),
                );
            }
        }
    }
    let pwsh = chercher("pwsh.exe", &connus);

    Engines { winps, pwsh }
}

/// Applique la regle de la specification 6.7.
///
/// `auto` prend le plus recent disponible. `pwsh` demande explicitement ne se
/// replie **jamais** en silence sur 5.1 : un script ecrit pour PowerShell 7
/// planterait en cours de route sur une syntaxe incompatible, ce qui est pire
/// qu'un refus clair avant de commencer.
fn resoudre_moteur(demande: &str, dispo: &Engines) -> Result<(String, String), String> {
    match demande.trim().to_ascii_lowercase().as_str() {
        "pwsh" => dispo
            .pwsh
            .clone()
            .map(|p| ("pwsh".into(), p))
            .ok_or_else(|| {
                "Ce script exige PowerShell 7, qui n'est pas installe sur cette machine. \
             WinTool ne se rabat pas sur PowerShell 5.1 : la syntaxe pourrait ne pas \
             etre comprise et le script s'arreterait en cours de route."
                    .into()
            }),
        "winps" => dispo
            .winps
            .clone()
            .map(|p| ("winps".into(), p))
            .ok_or_else(|| "powershell.exe est introuvable sur cette machine.".to_string()),
        _ => {
            if let Some(p) = dispo.pwsh.clone() {
                Ok(("pwsh".into(), p))
            } else if let Some(p) = dispo.winps.clone() {
                Ok(("winps".into(), p))
            } else {
                Err("Aucun interpreteur PowerShell n'a ete trouve sur cette machine.".into())
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Ce que le moteur publie
// ---------------------------------------------------------------------------

/// Une ligne de sortie, decoupee selon la specification 5.3.
#[derive(Debug, Clone, Serialize)]
pub struct Ligne {
    pub run_id: String,
    /// `stdout` ou `stderr`.
    pub stream: &'static str,
    /// Numero d'ordre d'arrivee. stdout et stderr sont deux tuyaux distincts :
    /// rien ne garantit leur entrelacement, ce compteur donne a l'interface un
    /// ordre d'affichage stable.
    pub seq: u64,
    /// Millisecondes ecoulees depuis le debut de l'execution.
    pub at_ms: u64,
    /// Marqueur reconnu, sans les crochets. Absent si la ligne n'en porte pas.
    pub marker: Option<String>,
    /// Etape courante et total, pour `[STEP] 3/7 ...`.
    pub step: Option<(u32, u32)>,
    /// La ligne complete, marqueur compris : le journal technique doit montrer
    /// ce que le script a reellement ecrit, pas notre reconstruction.
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunEnd {
    pub run_id: String,
    pub script_id: String,
    /// `None` si le processus a ete termine sans code de sortie. Le champ est
    /// optionnel pour que son absence ne puisse pas etre confondue avec un `0`.
    pub exit_code: Option<i32>,
    /// Vrai uniquement si le code de sortie vaut 0. Jamais deduit du fait que
    /// le script a demarre.
    pub success: bool,
    pub killed: bool,
    pub duration_ms: u64,
    pub checkpoint_reached: bool,
    /// Le script a emis `[REBOOT]` : un redemarrage est reellement necessaire.
    pub reboot_requested: bool,
    pub counts_ok: u32,
    pub counts_warn: u32,
    pub counts_err: u32,
    pub log_path: String,
}

/// Destination de ce que le moteur produit.
///
/// Le moteur ne depend pas de Tauri : il publie ici, et c'est l'appelant qui
/// decide ou cela va. En production, vers l'interface ; sous test, vers un
/// collecteur en memoire.
pub trait Sortie: Send + Sync + 'static {
    fn ligne(&self, ligne: Ligne);
    fn fin(&self, fin: RunEnd);
}

/// Adaptateur vers l'interface : les evenements `script:line` et `script:end`.
struct VersInterface<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> Sortie for VersInterface<R> {
    fn ligne(&self, ligne: Ligne) {
        let _ = self.app.emit("script:line", ligne);
    }
    fn fin(&self, fin: RunEnd) {
        let _ = self.app.emit("script:end", fin);
    }
}

// ---------------------------------------------------------------------------
// Lecture de la sortie
// ---------------------------------------------------------------------------

/// Decode une ligne brute.
///
/// PowerShell 7 ecrit en UTF-8. PowerShell 5.1 ecrit dans la page de codes de
/// la console, qui n'est pas UTF-8 : une lecture stricte echouerait et
/// tronquerait la sortie. On retombe alors sur une correspondance octet par
/// octet, qui restitue l'ASCII intact et rend les accents de facon approchee.
/// La sortie des scripts est en anglais (specification 10), donc le cas est rare.
fn decoder(brut: &[u8]) -> String {
    let mut fin = brut.len();
    while fin > 0 && (brut[fin - 1] == b'\n' || brut[fin - 1] == b'\r') {
        fin -= 1;
    }
    let brut = &brut[..fin];
    match std::str::from_utf8(brut) {
        Ok(s) => s.trim_start_matches('\u{feff}').to_string(),
        Err(_) => brut.iter().map(|&b| b as char).collect(),
    }
}

/// Reconnait `[STEP] 3/7 message` et ses voisins.
fn lire_marqueur(ligne: &str) -> (Option<String>, Option<(u32, u32)>) {
    let t = ligne.trim_start();
    let Some(reste) = t.strip_prefix('[') else {
        return (None, None);
    };
    let Some(pos) = reste.find(']') else {
        return (None, None);
    };
    let balise = reste[..pos].trim().to_ascii_uppercase();
    if !MARQUEURS.contains(&balise.as_str()) {
        // Balise inconnue : c'est au validateur de proposer une correction,
        // pas au moteur d'execution. Ici on se contente de ne rien affirmer.
        return (None, None);
    }

    let mut etape = None;
    if balise == "STEP" {
        let apres = reste[pos + 1..].trim_start();
        if let Some(mot) = apres.split_whitespace().next() {
            if let Some((a, b)) = mot.split_once('/') {
                if let (Ok(a), Ok(b)) = (a.trim().parse::<u32>(), b.trim().parse::<u32>()) {
                    etape = Some((a, b));
                }
            }
        }
    }
    (Some(balise), etape)
}

/// Lit jusqu'au saut de ligne sans exiger de l'UTF-8 valide.
///
/// `BufRead::lines` renvoie une erreur des qu'une sequence n'est pas de l'UTF-8
/// et la lecture s'arreterait la : sur une sortie de PowerShell 5.1 encodee
/// dans la page de codes de la console, on perdrait tout le reste du script.
fn lire_jusqua_fin_de_ligne<R: Read>(
    lecteur: &mut BufReader<R>,
    tampon: &mut Vec<u8>,
) -> std::io::Result<usize> {
    use std::io::BufRead;
    lecteur.read_until(b'\n', tampon)
}

// ---------------------------------------------------------------------------
// Etat d'une execution
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
struct Compteurs {
    ok: u32,
    warn: u32,
    err: u32,
}

struct Active {
    run_id: String,
    script_id: String,
    pid: u32,
    /// Le script se declare-t-il tuable sans risque a tout instant ?
    interruptible: bool,
    /// Un `[CKPT]` a-t-il ete franchi ? A partir de la, l'interruption est sure
    /// meme si le script ne se declarait pas interruptible (specification 6.3).
    checkpoint: Arc<AtomicBool>,
    /// Vrai si l'arret vient de nous : le code de sortie ne doit alors pas etre
    /// presente comme un echec du script.
    tue: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub run_id: String,
    pub script_id: String,
    pub pid: u32,
    pub interruptible: bool,
    pub checkpoint_reached: bool,
}

#[derive(Default)]
pub struct Runner {
    /// Un seul emplacement : specification 6.6, une execution a la fois.
    actif: Mutex<Option<Active>>,
    compteur: AtomicU64,
}

impl Runner {
    pub fn snapshot(&self) -> Option<Snapshot> {
        let garde = self.actif.lock().ok()?;
        garde.as_ref().map(|a| Snapshot {
            run_id: a.run_id.clone(),
            script_id: a.script_id.clone(),
            pid: a.pid,
            interruptible: a.interruptible,
            checkpoint_reached: a.checkpoint.load(Ordering::Relaxed),
        })
    }
}

// ---------------------------------------------------------------------------
// Demande et resultat
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RunRequest {
    /// Identifiant resolu par la decouverte.
    pub script_id: String,
    /// Empreinte vue par l'interface au moment de la decouverte.
    ///
    /// Comparee au contenu reel avant le lancement. La specification 5.5 pose
    /// que l'analyse a lieu a la decouverte et pas a chaque instant ; si le
    /// fichier a change depuis, l'interface s'appreterait a lancer autre chose
    /// que ce qu'elle a montre a l'utilisateur. On refuse plutot que de
    /// re-analyser en silence.
    pub expected_hash: String,
    /// Valeurs choisies. Ecrites telles quelles dans le JSON d'override.
    #[serde(default)]
    pub config: BTreeMap<String, serde_json::Value>,
    /// `Bypass` par defaut, au niveau du processus enfant seul.
    #[serde(default)]
    pub policy: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunStarted {
    pub run_id: String,
    pub script_id: String,
    pub engine: String,
    pub engine_path: String,
    pub policy: String,
    pub log_path: String,
    pub pid: u32,
    /// Lance en simulation (§6.9) : il ne modifie rien. Decide par la commande
    /// qui appelle `run_script`, jamais par le moteur, qui ignore tout des
    /// reglages ; c'est elle qui le renseigne apres le lancement.
    pub simulated: bool,
}

/// Le script a lancer, reduit a ce dont l'execution a besoin.
pub struct Cible {
    pub id: String,
    pub titre: String,
    pub chemin: PathBuf,
    pub hash: String,
    /// `auto` | `winps` | `pwsh`, tel que declare dans l'entete.
    pub engine: String,
    pub interruptible: bool,
}

// ---------------------------------------------------------------------------
// Lancement
// ---------------------------------------------------------------------------

fn horodatage_fichier() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string()
}

/// Reduit un texte a ce qui est acceptable dans un nom de fichier Windows.
fn assainir(nom: &str) -> String {
    let filtre: String = nom
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let filtre = filtre.trim_matches('-').to_string();
    if filtre.is_empty() {
        "script".into()
    } else {
        filtre.chars().take(60).collect()
    }
}

/// Chemins de modules PowerShell qu'un utilisateur non eleve ne peut pas ecrire.
///
/// Seuls `System32` et `Program Files` figurent ici. Les dossiers de modules
/// sous `Documents` sont volontairement absents : c'est tout l'objet de la
/// fonction.
fn chemins_modules_systeme(moteur: &str) -> String {
    let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let progfiles = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());

    let mut chemins = vec![PathBuf::from(&sysroot)
        .join("system32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("Modules")];

    if moteur == "pwsh" {
        chemins.push(
            PathBuf::from(&progfiles)
                .join("PowerShell")
                .join("7")
                .join("Modules"),
        );
        chemins.push(PathBuf::from(&progfiles).join("PowerShell").join("Modules"));
    } else {
        chemins.push(
            PathBuf::from(&progfiles)
                .join("WindowsPowerShell")
                .join("Modules"),
        );
    }

    chemins
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(";")
}

/// Cherche la trappe de substitution dans le bloc d'override d'un script.
///
/// Le contrat pose que `WINTOOL_CONFIG` **contient** le JSON (§5.2). Certains
/// scripts gardent un repli de l'ancienne epoque :
///
/// ```powershell
/// $wtJson = $env:WINTOOL_CONFIG
/// if (-not $wtJson.TrimStart().StartsWith('{')) { $wtJson = Get-Content -LiteralPath $wtJson -Raw }
/// ```
///
/// Traduction : « si la variable ne ressemble pas a du JSON, lis le fichier
/// qu'elle designe ». C'est exactement la fenetre de substitution que le §5.2
/// a fermee — un autre processus remplace le fichier entre notre ecriture et
/// la lecture, et ses valeurs entrent dans `$CONFIG` en administrateur.
///
/// Inerte tant que WinTool met du JSON dans la variable. Mais une trappe
/// inerte reste une trappe, et le refus ne coute rien.
///
/// **Portee volontairement etroite** : on ne cherche `Get-Content` que dans
/// les lignes qui parlent de `WINTOOL_CONFIG` ou de la variable qui la porte,
/// jamais ailleurs. Un script qui lit un fichier pour son propre compte n'est
/// pas concerne.
pub fn trappe_de_substitution(source: &str) -> Option<usize> {
    let lignes: Vec<&str> = source.lines().collect();
    // Variables locales qui recoivent WINTOOL_CONFIG : c'est par elles que le
    // repli passe (`$wtJson = $env:WINTOOL_CONFIG`).
    let mut portées: Vec<String> = Vec::new();

    for (i, brute) in lignes.iter().enumerate() {
        let ligne = brute.trim();
        if ligne.starts_with('#') {
            continue;
        }
        let bas = ligne.to_ascii_lowercase();

        if bas.contains("$env:wintool_config") {
            if let Some(gauche) = ligne.split('=').next() {
                let g = gauche.trim();
                if g.starts_with('$') && !g.contains(' ') {
                    portées.push(g.trim_start_matches('$').to_ascii_lowercase());
                }
            }
            if bas.contains("get-content") {
                return Some(i + 1);
            }
        }

        if bas.contains("get-content") && portées.iter().any(|v| mentionne_variable(&bas, v)) {
            return Some(i + 1);
        }
    }
    None
}

/// Vrai si `ligne` utilise la variable PowerShell `nom`, et pas seulement une
/// variable dont le nom commence pareil.
///
/// Une recherche de sous-chaine suffisait a faire refuser un script
/// parfaitement legitime : avec `$c = $env:WINTOOL_CONFIG`, la ligne
/// `Get-Content $config` contient bien `$c`, et le script se voyait accuse de
/// porter la trappe. Un nom de variable s'arrete au premier caractere qui
/// n'est ni alphanumerique ni `_` — on verifie donc ce qui SUIT.
fn mentionne_variable(ligne_minuscule: &str, nom: &str) -> bool {
    let motif = format!("${nom}");
    let mut depuis = 0;
    while let Some(pos) = ligne_minuscule[depuis..].find(&motif) {
        let debut = depuis + pos;
        let apres = debut + motif.len();
        let suivant = ligne_minuscule[apres..].chars().next();
        match suivant {
            Some(c) if c.is_alphanumeric() || c == '_' => {}
            _ => return true,
        }
        depuis = apres;
    }
    false
}

/// Coeur du moteur : lance le processus et publie ce qu'il produit.
///
/// Ne connait ni Tauri ni la decouverte — c'est ce qui le rend verifiable avec
/// un vrai processus, dans un dossier jetable, sans interface.
pub fn lancer(
    cible: Cible,
    config: BTreeMap<String, serde_json::Value>,
    politique_demandee: Option<String>,
    base: &Path,
    runner: Arc<Runner>,
    sortie: Arc<dyn Sortie>,
) -> Result<RunStarted, String> {
    // --- Une seule execution a la fois (specification 6.6) -----------------
    {
        let garde = runner.actif.lock().map_err(|_| "etat interne corrompu")?;
        if let Some(a) = garde.as_ref() {
            return Err(format!(
                "Une execution est deja en cours ({}). Attendez qu'elle se termine ou arretez-la.",
                a.script_id
            ));
        }
    }

    if !cible.chemin.is_file() {
        return Err(format!("Fichier absent : {}", cible.chemin.display()));
    }

    // --- Verrouiller le fichier, puis le verifier ---------------------------
    //
    // Le dossier des scripts est inscriptible par l'utilisateur sans elevation,
    // alors que WinTool, lui, est eleve. Verifier l'empreinte puis lancer
    // `powershell -File <chemin>` laisse un intervalle pendant lequel un
    // processus non eleve peut remplacer le fichier entre les deux : son code
    // s'executerait alors en administrateur. L'intervalle se compte en
    // millisecondes, mais il suffit a qui surveille le dossier.
    //
    // On ouvre donc le fichier en n'autorisant que le partage en lecture, et on
    // garde ce handle ouvert pendant toute l'execution. A partir de cet
    // instant, Windows refuse toute ecriture, tout renommage et toute
    // suppression. L'empreinte est calculee **a partir de ce handle**, donc sur
    // le contenu meme que PowerShell va lire — pas sur une lecture anterieure.
    let mut verrou = {
        let mut ouverture = std::fs::OpenOptions::new();
        ouverture.read(true);
        #[cfg(windows)]
        ouverture.share_mode(FILE_SHARE_READ);
        ouverture
            .open(&cible.chemin)
            .map_err(|e| format!("Ouverture de {} : {e}", cible.chemin.display()))?
    };

    let mut contenu = Vec::new();
    verrou
        .read_to_end(&mut contenu)
        .map_err(|e| format!("Lecture de {} : {e}", cible.chemin.display()))?;
    let empreinte: String = {
        let mut h = Sha256::new();
        h.update(&contenu);
        h.finalize().iter().map(|b| format!("{b:02x}")).collect()
    };

    // La source verrouillee est ce qui va reellement s'executer : c'est le
    // seul endroit ou ce controle a un sens. Le refus est volontaire, et c'est
    // une exception assumee au « constater, jamais bloquer » du §5.4 — au meme
    // titre que l'approbation du §12.1, parce qu'il s'agit d'execution avec
    // les droits administrateur et non de conformite de forme.
    let texte_source = String::from_utf8_lossy(&contenu);
    let texte_source = texte_source
        .strip_prefix('\u{feff}')
        .unwrap_or(&texte_source);
    if let Some(ligne) = trappe_de_substitution(texte_source) {
        return Err(format!(
            "Ce script n'a pas ete lance. Sa ligne d'override (ligne {ligne}) lit encore un \
             FICHIER de configuration, un mecanisme retire pour raison de securite : un autre \
             programme pourrait remplacer ce fichier au moment du lancement. Remplacez ce bloc \
             par ($env:WINTOOL_CONFIG | ConvertFrom-Json) — voir docs/FORMAT_SCRIPT.md."
        ));
    }

    if !cible.hash.is_empty() && empreinte != cible.hash {
        return Err(format!(
            "Le contenu de « {} » ne correspond plus a ce qui a ete analyse.              Le fichier a ete modifie entre-temps ; il n'a pas ete execute.",
            cible.chemin.display()
        ));
    }
    drop(contenu);

    let (nom_moteur, exe) = resoudre_moteur(&cible.engine, &engines())?;

    let politique = politique_demandee.unwrap_or_else(|| "Bypass".into());
    if !POLITIQUES
        .iter()
        .any(|p| p.eq_ignore_ascii_case(&politique))
    {
        return Err(format!(
            "Politique d'execution inconnue : {politique}. Valeurs admises : {}.",
            POLITIQUES.join(", ")
        ));
    }

    // --- Configuration -----------------------------------------------------
    //
    // Le JSON voyage dans la variable d'environnement elle-meme, et non par un
    // fichier dont la variable donnerait le chemin. Un fichier aurait du vivre
    // dans un dossier inscriptible sans elevation, et un processus tiers aurait
    // pu le remplacer entre notre ecriture et la lecture par PowerShell : ses
    // valeurs auraient alors atterri dans `$CONFIG`, en administrateur. Un
    // `Remove-Item $CONFIG.Chemin -Recurse -Force` suffit a mesurer les degats.
    //
    // L'environnement d'un processus deja lance ne peut pas etre modifie de
    // l'exterieur sans privilege de debogage. Il n'y a donc plus d'intervalle
    // a exploiter, parce qu'il n'y a plus de fichier.
    let run_id = format!(
        "run-{}",
        runner.compteur.fetch_add(1, Ordering::Relaxed) + 1
    );

    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    // Windows plafonne une variable d'environnement a 32767 caracteres. Un
    // refus clair vaut mieux qu'une troncature silencieuse qui donnerait au
    // script une configuration a moitie lue.
    if config_json.len() > 30_000 {
        return Err(format!(
            "La configuration de ce script est trop volumineuse ({} caracteres)              pour etre transmise a PowerShell.",
            config_json.len()
        ));
    }

    // --- Journal technique -------------------------------------------------
    let dossier_logs = base.join("logs");
    std::fs::create_dir_all(&dossier_logs).map_err(|e| e.to_string())?;
    let fichier_log = dossier_logs.join(format!(
        "{}-{}.log",
        horodatage_fichier(),
        assainir(&cible.id)
    ));

    let mut journal =
        std::fs::File::create(&fichier_log).map_err(|e| format!("creation du journal : {e}"))?;
    let _ = writeln!(
        journal,
        "WinTool {}\n\
         run        : {run_id}\n\
         script     : {} ({})\n\
         fichier    : {}\n\
         empreinte  : {}\n\
         moteur     : {nom_moteur} — {exe}\n\
         politique  : {politique}\n\
         debut      : {}\n\
         config     : {}\n\
         {}",
        env!("CARGO_PKG_VERSION"),
        cible.titre,
        cible.id,
        cible.chemin.display(),
        empreinte,
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        config_json,
        "-".repeat(72)
    );

    // --- Lancement ---------------------------------------------------------
    let dossier_script = cible.chemin.parent().unwrap_or(base).to_path_buf();
    let mut commande = Command::new(&exe);
    commande
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg(&politique)
        .arg("-File")
        .arg(&cible.chemin)
        .current_dir(&dossier_script)
        .env("WINTOOL_CONFIG", &config_json)
        // `Import-Module Truc` cherche d'abord dans les dossiers de modules de
        // l'utilisateur, sous Documents, inscriptibles sans elevation : y
        // deposer un module du bon nom suffirait a le faire charger en
        // administrateur. Meme raisonnement que `-NoProfile`, qui ferme le
        // profil PowerShell pour exactement la meme raison. L'enfant ne recoit
        // donc que les chemins de modules du systeme.
        //
        // Residu assume : le `PATH` reste intact, donc un script qui appelle un
        // outil sans chemin absolu suit toujours l'ordre du PATH. Le restreindre
        // casserait `winget`, qui vit justement dans un dossier utilisateur.
        .env("PSModulePath", chemins_modules_systeme(&nom_moteur))
        // stdin ferme : un script qui attendrait une saisie echoue tout de
        // suite au lieu de rester bloque sans que rien ne l'indique.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    commande.creation_flags(CREATE_NO_WINDOW);

    let mut enfant = commande
        .spawn()
        .map_err(|e| format!("lancement de {exe} : {e}"))?;

    let pid = enfant.id();
    let flux_sortie = enfant.stdout.take().ok_or("stdout indisponible")?;
    let flux_erreurs = enfant.stderr.take().ok_or("stderr indisponible")?;

    let checkpoint = Arc::new(AtomicBool::new(false));
    let tue = Arc::new(AtomicBool::new(false));
    let reboot = Arc::new(AtomicBool::new(false));

    {
        let mut garde = runner.actif.lock().map_err(|_| "etat interne corrompu")?;
        *garde = Some(Active {
            run_id: run_id.clone(),
            script_id: cible.id.clone(),
            pid,
            interruptible: cible.interruptible,
            checkpoint: checkpoint.clone(),
            tue: tue.clone(),
        });
    }

    let depart = Instant::now();
    let seq = Arc::new(AtomicU64::new(0));
    let compteurs = Arc::new(Mutex::new(Compteurs::default()));
    let journal = Arc::new(Mutex::new(journal));

    let lecteur = |flux: Box<dyn Read + Send>, nom: &'static str| {
        let sortie = sortie.clone();
        let run_id = run_id.clone();
        let seq = seq.clone();
        let compteurs = compteurs.clone();
        let journal = journal.clone();
        let checkpoint = checkpoint.clone();
        let reboot = reboot.clone();
        std::thread::spawn(move || {
            let mut lecteur = BufReader::new(flux);
            let mut tampon = Vec::new();
            loop {
                tampon.clear();
                match lire_jusqua_fin_de_ligne(&mut lecteur, &mut tampon) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                let texte = decoder(&tampon);
                let (marker, step) = lire_marqueur(&texte);

                if let Some(m) = marker.as_deref() {
                    match m {
                        "OK" => compteurs.lock().unwrap().ok += 1,
                        "WARN" => compteurs.lock().unwrap().warn += 1,
                        "ERR" => compteurs.lock().unwrap().err += 1,
                        "CKPT" => checkpoint.store(true, Ordering::Relaxed),
                        "REBOOT" => reboot.store(true, Ordering::Relaxed),
                        _ => {}
                    }
                }

                let at_ms = depart.elapsed().as_millis() as u64;
                if let Ok(mut f) = journal.lock() {
                    let _ = writeln!(f, "{at_ms:>8} {nom:<6} {texte}");
                }

                sortie.ligne(Ligne {
                    run_id: run_id.clone(),
                    stream: nom,
                    seq: seq.fetch_add(1, Ordering::Relaxed),
                    at_ms,
                    marker,
                    step,
                    text: texte,
                });
            }
        })
    };

    let t_out = lecteur(Box::new(flux_sortie), "stdout");
    let t_err = lecteur(Box::new(flux_erreurs), "stderr");

    // --- Attente, dans un fil pour ne pas bloquer l'interface --------------
    {
        let run_id = run_id.clone();
        let script_id = cible.id.clone();
        let chemin_log = fichier_log.clone();
        std::thread::spawn(move || {
            let statut = enfant.wait();
            // Le verrou est relache ici, et pas avant : il a protege le fichier
            // pendant toute la duree de l'execution.
            drop(verrou);
            // Les fils de lecture finissent leur tampon : sans cette attente,
            // les dernieres lignes pourraient arriver apres le bilan.
            let _ = t_out.join();
            let _ = t_err.join();

            let duree = depart.elapsed().as_millis() as u64;
            let exit_code = statut.as_ref().ok().and_then(|s| s.code());
            let tue_par_nous = tue.load(Ordering::Relaxed);
            let c = compteurs
                .lock()
                .map(|c| (c.ok, c.warn, c.err))
                .unwrap_or((0, 0, 0));

            if let Ok(mut f) = journal.lock() {
                let _ = writeln!(
                    f,
                    "{}\nfin        : {}\ncode       : {}\nduree      : {} ms\nverdict    : {}",
                    "-".repeat(72),
                    chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                    exit_code
                        .map(|c| c.to_string())
                        .unwrap_or_else(|| "aucun".into()),
                    duree,
                    if tue_par_nous {
                        "interrompu par l'utilisateur"
                    } else if exit_code == Some(0) {
                        "succes"
                    } else {
                        "echec"
                    }
                );
            }

            // L'emplacement est libere avant d'annoncer la fin : si l'interface
            // enchaine sur le script suivant des reception du bilan, la place
            // doit deja etre libre.
            if let Ok(mut garde) = runner.actif.lock() {
                if garde.as_ref().map(|a| a.run_id == run_id).unwrap_or(false) {
                    *garde = None;
                }
            }

            sortie.fin(RunEnd {
                run_id,
                script_id,
                exit_code,
                success: !tue_par_nous && exit_code == Some(0),
                killed: tue_par_nous,
                duration_ms: duree,
                checkpoint_reached: checkpoint.load(Ordering::Relaxed),
                reboot_requested: reboot.load(Ordering::Relaxed),
                counts_ok: c.0,
                counts_warn: c.1,
                counts_err: c.2,
                log_path: chemin_log.to_string_lossy().to_string(),
            });
        });
    }

    Ok(RunStarted {
        run_id,
        script_id: cible.id,
        engine: nom_moteur,
        engine_path: exe,
        policy: politique,
        log_path: fichier_log.to_string_lossy().to_string(),
        pid,
        simulated: false,
    })
}

/// Entree depuis l'interface : retrouve le script, verifie qu'il n'a pas bouge,
/// puis delegue a [`lancer`].
pub fn run_script<R: Runtime>(
    app: &AppHandle<R>,
    runner: Arc<Runner>,
    req: RunRequest,
) -> Result<RunStarted, String> {
    let decouverte = discovery::discover(app)?;
    let entree = decouverte
        .scripts
        .into_iter()
        .find(|s| s.id == req.script_id)
        .ok_or_else(|| format!("Script introuvable : {}", req.script_id))?;

    if !req.expected_hash.is_empty() && entree.hash != req.expected_hash {
        return Err(format!(
            "Le fichier « {} » a change depuis son analyse. Re-analysez-le avant de le lancer.",
            entree.path
        ));
    }

    let cible = Cible {
        // Le chemin vient de la decouverte, pas de l'interface : il n'y a pas
        // de nom de fichier a reconstruire, donc rien a detourner.
        chemin: PathBuf::from(&entree.abs_path),
        id: entree.id,
        titre: entree.meta.title,
        hash: entree.hash,
        engine: entree.meta.engine,
        interruptible: entree.meta.interruptible,
    };

    lancer(
        cible,
        req.config,
        req.policy,
        &discovery::base_dir(app)?,
        runner,
        Arc::new(VersInterface { app: app.clone() }),
    )
}

// ---------------------------------------------------------------------------
// Verification sans execution
// ---------------------------------------------------------------------------

/// Une erreur de syntaxe relevee par l'analyseur de PowerShell.
#[derive(Debug, Clone, Serialize)]
pub struct ErreurSyntaxe {
    pub line: u32,
    pub column: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckResult {
    /// Vrai si le fichier s'analyse sans erreur. Ne dit **rien** de ce que le
    /// script ferait s'il tournait : voir la note ci-dessous.
    pub parses: bool,
    pub errors: Vec<ErreurSyntaxe>,
    pub engine: String,
}

/// Programme d'analyse. Le chemin arrive par l'environnement, jamais dans le
/// texte : aucun guillemet ni caractere special du chemin ne peut changer le
/// sens de la commande.
const PROGRAMME_ANALYSE: &str = concat!(
    "$ErrorActionPreference='Stop';",
    "$e=$null;",
    "[void][System.Management.Automation.Language.Parser]::ParseFile(",
    "$env:WINTOOL_CHECK_PATH,[ref]$null,[ref]$e);",
    "if($e){$e|ForEach-Object{'{0}|{1}|{2}' -f ",
    "$_.Extent.StartLineNumber,$_.Extent.StartColumnNumber,($_.Message -replace '\r?\n',' ')}}"
);

/// Analyse un script **sans l'executer** (specification 6.8).
///
/// PowerShell lit le fichier et construit son arbre syntaxique, rien de plus :
/// aucune commande du script n'est evaluee, aucun effet de bord n'a lieu.
///
/// **Ce que cela ne dit pas** : qu'un script qui s'analyse tournera sans
/// probleme. Les droits, l'etat de la machine, une applet absente ou une erreur
/// de logique ne se voient qu'a l'execution. C'est un controle de forme, pas un
/// essai a blanc — et l'interface doit le dire ainsi.
pub fn verifier_syntaxe(chemin: &Path) -> Result<CheckResult, String> {
    let (nom_moteur, exe) = resoudre_moteur("auto", &engines())?;

    let mut commande = Command::new(&exe);
    commande
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(PROGRAMME_ANALYSE)
        .env("WINTOOL_CHECK_PATH", chemin)
        .env("PSModulePath", chemins_modules_systeme(&nom_moteur))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    commande.creation_flags(CREATE_NO_WINDOW);

    let sortie = commande
        .output()
        .map_err(|e| format!("analyse impossible : {e}"))?;

    let texte = decoder(&sortie.stdout);
    let mut errors = Vec::new();
    for ligne in texte.lines() {
        let ligne = ligne.trim();
        if ligne.is_empty() {
            continue;
        }
        let mut morceaux = ligne.splitn(3, '|');
        let l = morceaux.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let c = morceaux.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let m = morceaux.next().unwrap_or("").trim().to_string();
        if !m.is_empty() {
            errors.push(ErreurSyntaxe {
                line: l,
                column: c,
                message: m,
            });
        }
    }

    Ok(CheckResult {
        parses: errors.is_empty(),
        errors,
        engine: nom_moteur,
    })
}

// ---------------------------------------------------------------------------
// Interruption
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct CancelOutcome {
    pub killed: bool,
    /// Renseigne quand l'interruption est refusee : l'interface doit alors
    /// demander une confirmation explicite avant de rappeler avec `force`.
    pub needs_confirmation: bool,
    pub message: String,
}

/// Deuxieme clic sur « Arreter » (specification 6.3).
///
/// Le script decide de ce qui est sur : on ne tue que s'il s'est declare
/// interruptible, ou s'il a franchi un `[CKPT]`. Sinon on repond qu'une
/// confirmation explicite est necessaire — et c'est seulement `force` qui
/// passe outre.
pub fn cancel_script(runner: &Runner, run_id: &str, force: bool) -> Result<CancelOutcome, String> {
    let garde = runner.actif.lock().map_err(|_| "etat interne corrompu")?;
    let Some(actif) = garde.as_ref() else {
        return Ok(CancelOutcome {
            killed: false,
            needs_confirmation: false,
            message: "Aucune execution en cours.".into(),
        });
    };
    if actif.run_id != run_id {
        return Err("Cette execution n'est plus celle en cours.".into());
    }

    let sur = actif.interruptible || actif.checkpoint.load(Ordering::Relaxed);
    if !sur && !force {
        return Ok(CancelOutcome {
            killed: false,
            needs_confirmation: true,
            message: "Ce script indique qu'il ne peut pas etre interrompu sans risque : \
                      l'arreter maintenant pourrait laisser Windows dans un etat intermediaire."
                .into(),
        });
    }

    actif.tue.store(true, Ordering::Relaxed);
    tuer_arborescence(actif.pid)?;

    Ok(CancelOutcome {
        killed: true,
        needs_confirmation: false,
        message: if sur {
            "Execution interrompue.".into()
        } else {
            "Execution interrompue malgre l'avertissement du script.".into()
        },
    })
}

/// Termine le processus **et sa descendance**.
///
/// Tuer le seul `powershell.exe` laisserait tourner ce qu'il a lui-meme lance —
/// un `DISM` ou un `sfc` continuerait en arriere-plan alors que l'interface
/// annonce l'arret.
fn tuer_arborescence(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Chemin absolu, comme pour l'interpreteur : `Command::new("taskkill")`
        // laisserait l'ordre du PATH designer l'executable qui recoit les
        // droits administrateur. Il suffit alors d'un `taskkill.exe` depose
        // dans un dossier inscriptible du PATH pour obtenir une elevation au
        // moment ou l'utilisateur clique sur « Arreter ».
        let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let outil = PathBuf::from(sysroot).join("System32").join("taskkill.exe");
        let mut c = Command::new(&outil);
        c.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        c.status().map_err(|e| format!("taskkill : {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        Err("interruption non implementee hors Windows".into())
    }
}

// ---------------------------------------------------------------------------
// Journaux
// ---------------------------------------------------------------------------

pub fn logs_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let d = discovery::base_dir(app)?.join("logs");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// Plafonne le dossier des journaux par taille, pas par ancienneté
/// (specification §9) : c'est la taille qui gêne réellement l'utilisateur, et
/// il serait contradictoire qu'un outil de nettoyage laisse ses propres
/// journaux s'accumuler sans limite. `0` = pas de limite (le réglage par
/// défaut, ajustable, va jusqu'à « Pas de limite »).
pub fn appliquer_plafond_journaux<R: Runtime>(
    app: &AppHandle<R>,
    plafond_mb: u32,
) -> Result<(), String> {
    appliquer_plafond_sur(&logs_dir(app)?, plafond_mb)
}

/// Coeur de `appliquer_plafond_journaux`, separe pour rester testable sur un
/// dossier jetable sans `AppHandle` (meme raison que `settings::load_from`).
fn appliquer_plafond_sur(dossier: &Path, plafond_mb: u32) -> Result<(), String> {
    if plafond_mb == 0 {
        return Ok(());
    }
    let plafond_octets = u64::from(plafond_mb) * 1024 * 1024;

    let mut fichiers: Vec<(PathBuf, u64, std::time::SystemTime)> = std::fs::read_dir(dossier)
        .map_err(|e| format!("{} : {e}", dossier.display()))?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let modifie = meta.modified().ok()?;
            Some((e.path(), meta.len(), modifie))
        })
        .collect();

    let mut total: u64 = fichiers.iter().map(|(_, taille, _)| taille).sum();
    if total <= plafond_octets {
        return Ok(());
    }

    // Le plus ancien d'abord : c'est lui qui part en premier.
    fichiers.sort_by_key(|(_, _, modifie)| *modifie);
    for (chemin, taille, _) in fichiers {
        if total <= plafond_octets {
            break;
        }
        if std::fs::remove_file(&chemin).is_ok() {
            total = total.saturating_sub(taille);
        }
    }
    Ok(())
}

/// Refuse d'ouvrir un chemin qui sortirait du dossier des journaux.
pub fn verifier_log<R: Runtime>(app: &AppHandle<R>, chemin: &str) -> Result<PathBuf, String> {
    let dossier = logs_dir(app)?;
    let canon = Path::new(chemin)
        .canonicalize()
        .map_err(|e| format!("{chemin} : {e}"))?;
    let canon_dossier = dossier.canonicalize().map_err(|e| e.to_string())?;
    if !canon.starts_with(&canon_dossier) {
        return Err("Ce fichier n'est pas un journal de WinTool.".into());
    }
    Ok(canon)
}

// ---------------------------------------------------------------------------
// Tests unitaires
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnait_les_marqueurs() {
        assert_eq!(lire_marqueur("[OK] done").0.as_deref(), Some("OK"));
        assert_eq!(lire_marqueur("[INFO] hello").0.as_deref(), Some("INFO"));
        // Tolerance d'alignement : le contrat autorise des espaces de cadrage.
        assert_eq!(lire_marqueur("[ DONE ] fini").0.as_deref(), Some("DONE"));
        // Une balise inconnue n'est pas un marqueur : c'est au validateur de
        // proposer une correction, pas au moteur de deviner.
        assert_eq!(lire_marqueur("[REBBOT] oups").0, None);
        assert_eq!(lire_marqueur("texte normal").0, None);
        // Un cast PowerShell ne doit pas etre pris pour un marqueur.
        assert_eq!(lire_marqueur("[long] 42").0, None);
    }

    #[test]
    fn lit_la_progression() {
        assert_eq!(lire_marqueur("[STEP] 3/7 Cleaning").1, Some((3, 7)));
        assert_eq!(lire_marqueur("[STEP] Cleaning").1, None);
        // Un `[OK]` ne porte jamais de progression, meme suivi de chiffres.
        assert_eq!(lire_marqueur("[OK] 3/7 done").1, None);
    }

    #[test]
    fn decode_sans_perdre_de_lignes() {
        assert_eq!(decoder(b"bonjour\r\n"), "bonjour");
        assert_eq!(decoder(b"bonjour\n"), "bonjour");
        // Octet invalide en UTF-8 : la ligne doit survivre malgre tout.
        assert_eq!(decoder(&[b'a', 0x82, b'b']).chars().count(), 3);
    }

    #[test]
    fn pwsh_exige_ne_se_replie_jamais() {
        let sans_pwsh = Engines {
            winps: Some(r"C:\powershell.exe".into()),
            pwsh: None,
        };
        // La regle centrale de la specification 6.7.
        assert!(resoudre_moteur("pwsh", &sans_pwsh).is_err());
        // `auto` accepte en revanche de prendre ce qui existe.
        assert_eq!(resoudre_moteur("auto", &sans_pwsh).unwrap().0, "winps");
        assert_eq!(resoudre_moteur("", &sans_pwsh).unwrap().0, "winps");

        let les_deux = Engines {
            winps: Some(r"C:\powershell.exe".into()),
            pwsh: Some(r"C:\pwsh.exe".into()),
        };
        // `auto` prend le plus recent disponible.
        assert_eq!(resoudre_moteur("auto", &les_deux).unwrap().0, "pwsh");
        // `winps` force la 5.1 meme quand 7 est la.
        assert_eq!(resoudre_moteur("winps", &les_deux).unwrap().0, "winps");
    }

    #[test]
    fn assainit_les_noms_de_journaux() {
        assert_eq!(assainir("200_DISABLE_SLEEP"), "200_DISABLE_SLEEP");
        assert_eq!(assainir("Default/200 SLEEP.ps1"), "Default-200-SLEEP-ps1");
        assert_eq!(assainir("///"), "script");
        assert!(assainir(&"a".repeat(200)).len() <= 60);
    }

    #[test]
    fn zero_veut_dire_pas_de_limite() {
        let dir =
            std::env::temp_dir().join(format!("wintool-test-plafond-zero-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.log"), vec![0u8; 1024]).unwrap();
        appliquer_plafond_sur(&dir, 0).unwrap();
        assert!(dir.join("a.log").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn supprime_les_plus_anciens_jusqu_a_repasser_sous_le_plafond() {
        let dir = std::env::temp_dir().join(format!("wintool-test-plafond-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        // Trois journaux d'1 Mo chacun, ecrits dans l'ordre pour garantir des
        // dates de modification croissantes.
        for nom in ["a.log", "b.log", "c.log"] {
            std::fs::write(dir.join(nom), vec![0u8; 1024 * 1024]).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        // Plafond a 2 Mo : le plus ancien (a.log) doit partir, les deux autres rester.
        appliquer_plafond_sur(&dir, 2).unwrap();

        assert!(
            !dir.join("a.log").exists(),
            "le plus ancien doit etre supprime"
        );
        assert!(dir.join("b.log").exists());
        assert!(dir.join("c.log").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn trouve_powershell_sur_cette_machine() {
        // Windows 10/11 livre toujours PowerShell 5.1 : son absence signalerait
        // que la resolution de chemin est cassee, pas que la machine l'est.
        #[cfg(windows)]
        assert!(engines().winps.is_some(), "powershell.exe introuvable");
    }
}

// ---------------------------------------------------------------------------
// Verification de bout en bout
//
// Ces tests lancent reellement PowerShell, dans un dossier jetable. C'est le
// seul moyen de verifier ce que la v3 n'avait jamais verifie : que la sortie
// remonte pendant l'execution, que la configuration atteint le script, et que
// le code de sortie fait foi.
// ---------------------------------------------------------------------------

#[cfg(all(test, windows))]
mod bout_en_bout {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    /// Script minimal, ecrit par le test lui-meme : il ne depend d'aucun
    /// fichier deja present sur la machine.
    const SOURCE: &str = r#"$CONFIG = @{
    Label   = "default"
    Targets = @("temp")
    Fail    = $false
}

# --- WinTool override (ne pas supprimer) ---
if ($env:WINTOOL_CONFIG) {
    ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $CONFIG[$_.Name] = $_.Value }
}

Write-Output "[INFO] label=$($CONFIG.Label)"
$t = @($CONFIG.Targets)
Write-Output "[INFO] targets=$($t -join '+') count=$($t.Count)"
Write-Output "[STEP] 1/2 first"
Write-Output "[CKPT] safe from here"
Write-Output "[OK] first done"
[Console]::Error.WriteLine("deliberate stderr")
Write-Output "[STEP] 2/2 second"
Write-Output "[WARN] nothing to do"
Write-Output "[REBOOT] restart advised"
if ($CONFIG.Fail) {
    Write-Output "[ERR] failing on purpose"
    exit 3
}
Write-Output "[DONE] finished"
exit 0
"#;

    /// Collecte ce que le moteur publie, a la place de l'interface.
    struct Collecteur {
        lignes: Mutex<Vec<Ligne>>,
        tx: Mutex<mpsc::Sender<RunEnd>>,
    }

    impl Sortie for Collecteur {
        fn ligne(&self, ligne: Ligne) {
            self.lignes.lock().unwrap().push(ligne);
        }
        fn fin(&self, fin: RunEnd) {
            let _ = self.tx.lock().unwrap().send(fin);
        }
    }

    /// Dossier jetable : les tests n'ecrivent jamais dans les dossiers reels de
    /// l'utilisateur, et deux tests paralleles ne se marchent pas dessus.
    struct Bac(PathBuf);

    impl Bac {
        fn neuf(nom: &str) -> Bac {
            let d = std::env::temp_dir().join(format!("wintool-test-{}-{nom}", std::process::id()));
            std::fs::create_dir_all(&d).expect("dossier de test");
            Bac(d)
        }

        /// Ecrit le script avec le BOM qu'exige PowerShell 5.1 : sans lui, un
        /// `.ps1` est lu comme de l'ANSI.
        fn poser(&self, nom: &str, source: &str) -> PathBuf {
            let p = self.0.join(nom);
            let mut octets = vec![0xEF, 0xBB, 0xBF];
            octets.extend_from_slice(source.replace('\n', "\r\n").as_bytes());
            std::fs::write(&p, &octets).expect("ecriture du script de test");
            p
        }
    }

    impl Drop for Bac {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Empreinte reelle du fichier, comme la decouverte la calcule.
    fn empreinte(chemin: &Path) -> String {
        let mut h = Sha256::new();
        h.update(std::fs::read(chemin).expect("lecture"));
        h.finalize().iter().map(|b| format!("{b:02x}")).collect()
    }

    fn cible(chemin: PathBuf, interruptible: bool) -> Cible {
        Cible {
            hash: if chemin.is_file() {
                empreinte(&chemin)
            } else {
                String::new()
            },
            id: "test-probe".into(),
            titre: "Sonde de test".into(),
            chemin,
            engine: "auto".into(),
            interruptible,
        }
    }

    fn attelage() -> (Arc<Collecteur>, mpsc::Receiver<RunEnd>) {
        let (tx, rx) = mpsc::channel();
        (
            Arc::new(Collecteur {
                lignes: Mutex::new(Vec::new()),
                tx: Mutex::new(tx),
            }),
            rx,
        )
    }

    #[test]
    fn le_code_de_sortie_fait_foi_et_la_sortie_remonte() {
        let bac = Bac::neuf("exec");
        let script = bac.poser("probe.ps1", SOURCE);
        let (collecteur, rx) = attelage();
        let runner = Arc::new(Runner::default());

        let mut config = BTreeMap::new();
        config.insert("Label".into(), serde_json::json!("injected!"));
        config.insert("Targets".into(), serde_json::json!(["temp", "logs"]));
        // Le script sortira en 3 : c'est tout l'objet de ce test.
        config.insert("Fail".into(), serde_json::json!(true));

        let demarre = lancer(
            cible(script, true),
            config,
            None,
            &bac.0,
            runner.clone(),
            collecteur.clone(),
        )
        .expect("le lancement aurait du reussir");

        assert!(demarre.pid > 0, "aucun processus n'a ete cree");
        assert_eq!(demarre.policy, "Bypass");

        let fin = rx
            .recv_timeout(Duration::from_secs(90))
            .expect("aucun bilan de fin recu");

        // Le point central : le verdict vient du code de sortie, pas du fait
        // que le processus a demarre. C'etait le defaut majeur de la v3.
        assert_eq!(
            fin.exit_code,
            Some(3),
            "le code de sortie du script est perdu"
        );
        assert!(!fin.success, "un exit 3 a ete pris pour un succes");
        assert!(!fin.killed);
        assert_eq!((fin.counts_ok, fin.counts_warn, fin.counts_err), (1, 1, 1));
        assert!(fin.checkpoint_reached, "le [CKPT] n'a pas ete vu");
        assert!(fin.reboot_requested, "le [REBOOT] n'a pas ete vu");

        let lignes = collecteur.lignes.lock().unwrap();
        let tout: Vec<&str> = lignes.iter().map(|l| l.text.as_str()).collect();
        let tout = tout.join("\n");

        // La configuration a bien atteint le script, chaine comme tableau.
        assert!(
            tout.contains("label=injected!"),
            "chaine non injectee :\n{tout}"
        );
        assert!(
            tout.contains("targets=temp+logs") && tout.contains("count=2"),
            "un tableau JSON n'est pas redevenu un tableau PowerShell :\n{tout}"
        );

        // stderr remonte, et il est etiquete comme tel.
        assert!(
            lignes.iter().any(|l| l.stream == "stderr"),
            "rien n'est remonte de stderr"
        );

        // Les marqueurs sont reconnus et la progression lue.
        let steps: Vec<&Ligne> = lignes
            .iter()
            .filter(|l| l.marker.as_deref() == Some("STEP"))
            .collect();
        assert_eq!(steps.len(), 2, "les [STEP] n'ont pas ete reconnus");
        assert_eq!(steps[1].step, Some((2, 2)));

        // Aucun numero d'ordre en double : l'interface peut trier sans ambiguite.
        let mut seqs: Vec<u64> = lignes.iter().map(|l| l.seq).collect();
        let total = seqs.len();
        seqs.sort_unstable();
        seqs.dedup();
        assert_eq!(
            seqs.len(),
            total,
            "deux lignes portent le meme numero d'ordre"
        );

        // Le journal technique porte la sortie et le verdict.
        let contenu = std::fs::read_to_string(&fin.log_path).expect("journal illisible");
        assert!(
            contenu.contains("label=injected!"),
            "le journal ne contient pas la sortie"
        );
        assert!(
            contenu.contains("code       : 3"),
            "le code de sortie n'est pas journalise"
        );
        assert!(contenu.contains("verdict    : echec"));

        // L'emplacement est libere : le script suivant peut demarrer.
        assert!(
            runner.snapshot().is_none(),
            "l'execution terminee occupe encore la place"
        );

        // Aucun fichier de configuration n'est ecrit : le JSON ne passe que par
        // l'environnement, justement pour qu'il n'y ait rien a substituer.
        assert!(
            !bac.0.join("run").exists(),
            "un fichier de configuration a ete ecrit sur le disque"
        );
    }

    #[test]
    fn un_script_qui_reussit_est_annonce_comme_tel() {
        let bac = Bac::neuf("succes");
        let script = bac.poser("probe.ps1", SOURCE);
        let (collecteur, rx) = attelage();

        // Sans valeur injectee pour `Fail`, le script garde son `$false` et
        // sort en 0 : les valeurs par defaut doivent survivre a l'override.
        lancer(
            cible(script, true),
            BTreeMap::new(),
            Some("RemoteSigned".into()),
            &bac.0,
            Arc::new(Runner::default()),
            collecteur.clone(),
        )
        .expect("le lancement aurait du reussir");

        let fin = rx
            .recv_timeout(Duration::from_secs(90))
            .expect("pas de bilan");
        assert_eq!(fin.exit_code, Some(0));
        assert!(fin.success, "un exit 0 n'est pas reconnu comme un succes");

        let lignes = collecteur.lignes.lock().unwrap();
        let tout: Vec<&str> = lignes.iter().map(|l| l.text.as_str()).collect();
        assert!(
            tout.join("\n").contains("label=default"),
            "les valeurs par defaut du script n'ont pas ete respectees"
        );
        assert!(
            lignes.iter().any(|l| l.marker.as_deref() == Some("DONE")),
            "le [DONE] final n'a pas ete vu"
        );
    }

    #[test]
    fn refuse_une_deuxieme_execution_simultanee() {
        let bac = Bac::neuf("concurrence");
        // Un script qui dure, pour que la deuxieme demande arrive pendant la premiere.
        let lent = bac.poser("lent.ps1", "Start-Sleep -Seconds 4\nexit 0\n");
        let (collecteur, rx) = attelage();
        let runner = Arc::new(Runner::default());

        lancer(
            cible(lent.clone(), true),
            BTreeMap::new(),
            None,
            &bac.0,
            runner.clone(),
            collecteur.clone(),
        )
        .expect("le premier lancement aurait du reussir");

        // Specification 6.6 : une seule execution a la fois.
        let refus = lancer(
            cible(lent, true),
            BTreeMap::new(),
            None,
            &bac.0,
            runner.clone(),
            collecteur.clone(),
        );
        assert!(refus.is_err(), "deux executions ont demarre en meme temps");

        // Et l'interruption libere bien la place.
        let instantane = runner
            .snapshot()
            .expect("rien n'est enregistre comme actif");
        let issue = cancel_script(&runner, &instantane.run_id, false).expect("arret");
        assert!(issue.killed, "un script interruptible n'a pas ete arrete");

        let fin = rx
            .recv_timeout(Duration::from_secs(60))
            .expect("pas de bilan");
        assert!(fin.killed, "l'arret n'est pas signale comme tel");
        assert!(
            !fin.success,
            "un script tue ne doit jamais compter comme un succes"
        );
    }

    #[test]
    fn protege_un_script_non_interruptible() {
        let bac = Bac::neuf("protection");
        let lent = bac.poser("lent.ps1", "Start-Sleep -Seconds 4\nexit 0\n");
        let (collecteur, rx) = attelage();
        let runner = Arc::new(Runner::default());

        lancer(
            // Ce script declare ne pas pouvoir etre coupe sans risque.
            cible(lent, false),
            BTreeMap::new(),
            None,
            &bac.0,
            runner.clone(),
            collecteur,
        )
        .expect("lancement");

        let instantane = runner.snapshot().expect("aucun actif");

        // Premier refus : le moteur demande une confirmation explicite
        // (specification 6.3), il ne tue pas.
        let prudent = cancel_script(&runner, &instantane.run_id, false).expect("arret prudent");
        assert!(
            !prudent.killed,
            "un script non interruptible a ete tue sans confirmation"
        );
        assert!(
            prudent.needs_confirmation,
            "aucune confirmation n'a ete demandee"
        );

        // Avec la confirmation explicite, l'arret a lieu.
        let force = cancel_script(&runner, &instantane.run_id, true).expect("arret force");
        assert!(force.killed, "l'arret force n'a pas eu lieu");

        let fin = rx
            .recv_timeout(Duration::from_secs(60))
            .expect("pas de bilan");
        assert!(fin.killed);
    }

    #[test]
    fn refuse_une_politique_inconnue() {
        let bac = Bac::neuf("politique");
        let script = bac.poser("probe.ps1", SOURCE);
        let (collecteur, _rx) = attelage();

        let issue = lancer(
            cible(script, true),
            BTreeMap::new(),
            Some("AllSigned".into()),
            &bac.0,
            Arc::new(Runner::default()),
            collecteur,
        );

        let erreur = issue.expect_err("une politique hors liste doit etre refusee");
        assert!(erreur.contains("AllSigned"), "message inattendu : {erreur}");
    }

    // ----- Verification sans execution (§6.8) ---------------------------

    #[test]
    fn l_analyse_n_execute_rien() {
        let bac = Bac::neuf("analyse-inerte");
        let temoin = bac.0.join("temoin.txt");
        // Ce script cree un fichier DES qu'il tourne. Si le temoin apparait,
        // c'est que la « verification » a en realite execute le script — le
        // defaut le plus grave que cette fonction puisse avoir.
        let source = format!(
            "Set-Content -LiteralPath '{}' -Value 'execute'\nWrite-Output '[DONE] ok'\n",
            temoin.display()
        );
        let script = bac.poser("effet.ps1", &source);

        let r = verifier_syntaxe(&script).expect("analyse");
        assert!(
            r.parses,
            "un script valide a ete signale en erreur : {:?}",
            r.errors
        );
        assert!(
            !temoin.exists(),
            "la verification a EXECUTE le script : le fichier temoin existe"
        );
    }

    #[test]
    fn l_analyse_signale_une_syntaxe_cassee() {
        let bac = Bac::neuf("analyse-cassee");
        // Accolade jamais refermee : PowerShell refuse de construire l'arbre.
        let script = bac.poser("casse.ps1", "if ($true) {\n  Write-Output 'oups'\n");

        let r = verifier_syntaxe(&script).expect("analyse");
        assert!(!r.parses, "une syntaxe invalide est passee pour valide");
        assert!(!r.errors.is_empty(), "aucune erreur rapportee");
        assert!(
            r.errors[0].line > 0,
            "erreur sans numero de ligne exploitable"
        );
    }

    // ----- Trappe de substitution (§5.2) --------------------------------

    #[test]
    fn repere_le_repli_vers_un_fichier() {
        // Forme exacte portee par 14 des 16 scripts livres.
        let src = "$wtJson = $env:WINTOOL_CONFIG\n\
                   if (-not $wtJson.TrimStart().StartsWith('{')) { $wtJson = Get-Content -LiteralPath $wtJson -Raw }\n";
        assert_eq!(trappe_de_substitution(src), Some(2));

        // Forme sur une seule ligne, l'ancienne du guide.
        let direct = "(Get-Content $env:WINTOOL_CONFIG -Raw | ConvertFrom-Json)\n";
        assert_eq!(trappe_de_substitution(direct), Some(1));
    }

    #[test]
    fn laisse_passer_le_contrat_actuel() {
        let bon = "if ($env:WINTOOL_CONFIG) {\n\
                   ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |\n\
                   ForEach-Object { $CONFIG[$_.Name] = $_.Value }\n}\n";
        assert_eq!(trappe_de_substitution(bon), None);
    }

    #[test]
    fn n_accuse_pas_une_variable_au_nom_voisin() {
        // Faux positif reel : `$config` contient `$c`. Une recherche de
        // sous-chaine faisait refuser ce script parfaitement legitime.
        let voisin = "$c = $env:WINTOOL_CONFIG\n\
                      ($c | ConvertFrom-Json).PSObject.Properties | ForEach-Object { }\n\
                      $config = 'C:\\app\\reglages.json'\n\
                      $x = Get-Content -LiteralPath $config -Raw\n";
        assert_eq!(
            trappe_de_substitution(voisin),
            None,
            "faux positif sur un nom voisin"
        );

        // Mais la vraie trappe sur la meme variable courte reste vue.
        let vraie = "$c = $env:WINTOOL_CONFIG\n\
                     if (-not $c.StartsWith('{')) { $c = Get-Content -LiteralPath $c -Raw }\n";
        assert_eq!(
            trappe_de_substitution(vraie),
            Some(2),
            "la vraie trappe echappe au controle"
        );
    }

    #[test]
    fn n_accuse_pas_un_script_qui_lit_ses_propres_fichiers() {
        // Un script de maintenance lit evidemment des fichiers. Le controle ne
        // doit viser QUE la configuration injectee, sinon il devient un piege.
        let legitime = "$liste = Get-Content -LiteralPath 'C:\\hosts' -Raw\n\
                        ($env:WINTOOL_CONFIG | ConvertFrom-Json).PSObject.Properties |\n\
                        ForEach-Object { $CONFIG[$_.Name] = $_.Value }\n";
        assert_eq!(trappe_de_substitution(legitime), None);

        // Meme chose avec une variable homonyme mais sans rapport.
        let homonyme = "$data = 'ailleurs'\n$x = Get-Content $data\n";
        assert_eq!(trappe_de_substitution(homonyme), None);
    }

    #[test]
    fn ignore_un_exemple_en_commentaire() {
        let commente = "# $wt = Get-Content $env:WINTOOL_CONFIG -Raw\n\
                        ($env:WINTOOL_CONFIG | ConvertFrom-Json)\n";
        assert_eq!(trappe_de_substitution(commente), None);
    }

    #[test]
    fn refuse_un_fichier_absent() {
        let bac = Bac::neuf("absent");
        let (collecteur, _rx) = attelage();

        let issue = lancer(
            cible(bac.0.join("nexiste-pas.ps1"), true),
            BTreeMap::new(),
            None,
            &bac.0,
            Arc::new(Runner::default()),
            collecteur,
        );
        assert!(issue.is_err(), "un fichier absent ne doit pas etre lance");
    }

    #[test]
    fn refuse_un_fichier_dont_l_empreinte_ne_correspond_plus() {
        let bac = Bac::neuf("empreinte");
        let script = bac.poser("probe.ps1", SOURCE);
        let (collecteur, _rx) = attelage();

        let mut c = cible(script.clone(), true);
        // Ce qu'aurait vu la decouverte avant que le fichier ne soit remplace.
        c.hash = "0".repeat(64);

        let issue = lancer(
            c,
            BTreeMap::new(),
            None,
            &bac.0,
            Arc::new(Runner::default()),
            collecteur,
        );

        let erreur = issue.expect_err("un contenu different ne doit pas etre execute");
        assert!(
            erreur.contains("ne correspond plus"),
            "message inattendu : {erreur}"
        );
    }

    #[test]
    fn interdit_toute_reecriture_pendant_l_execution() {
        let bac = Bac::neuf("verrou");
        // Assez long pour qu'on tente la substitution pendant l'execution.
        let lent = bac.poser(
            "lent.ps1",
            "Start-Sleep -Seconds 3
exit 0
",
        );
        let (collecteur, rx) = attelage();
        let runner = Arc::new(Runner::default());

        lancer(
            cible(lent.clone(), true),
            BTreeMap::new(),
            None,
            &bac.0,
            runner.clone(),
            collecteur,
        )
        .expect("lancement");

        // C'est l'attaque que le verrou doit rendre impossible : remplacer le
        // script apres sa verification, pour faire executer autre chose avec
        // les droits administrateur.
        let substitution = std::fs::write(&lent, b"whoami");
        assert!(
            substitution.is_err(),
            "le script a pu etre reecrit pendant son execution"
        );
        // Le renommage et la suppression sont bloques par le meme partage.
        assert!(
            std::fs::remove_file(&lent).is_err(),
            "le script a pu etre supprime pendant son execution"
        );

        let fin = rx
            .recv_timeout(Duration::from_secs(60))
            .expect("pas de bilan");
        assert!(fin.success);

        // Le verrou est bien relache une fois l'execution terminee.
        std::fs::write(&lent, b"exit 0").expect("le fichier reste verrouille apres coup");
    }
}
