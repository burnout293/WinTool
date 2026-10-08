//! Emplacements du systeme, et environnement des processus que WinTool lance.
//!
//! WinTool tourne eleve et lance des interpreteurs eleves. Tout ce qui designe
//! un executable, un dossier du systeme ou une variable lue par un runtime doit
//! donc venir d'une source que le compte de l'utilisateur **ne peut pas ecrire**
//! (specification 12.4).
//!
//! Les variables d'environnement n'en sont pas une. Celles de l'utilisateur
//! (`HKCU\Environment`) se superposent a celles du systeme, et un processus
//! eleve du meme compte en herite : redefinir `windir` est une technique de
//! contournement de l'UAC documentee, `COR_PROFILER_PATH` fait charger une DLL
//! dans tout PowerShell 5.1, `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` fait lancer un
//! autre moteur que celui de Windows. La base de registre `HKLM`, elle, n'est
//! inscriptible que par un administrateur : c'est d'elle que viennent les
//! chemins ci-dessous.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Ce que le demarrage a du corriger. Une variable d'injection presente, un
/// `TEMP` qui vise le systeme : rien de cela n'arrive par hasard sur un PC de
/// particulier, et l'utilisateur doit le savoir.
static ALERTES: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn signaler(message: String) {
    if let Ok(mut a) = ALERTES.lock() {
        a.push(message);
    }
}

pub fn alertes() -> Vec<String> {
    ALERTES.lock().map(|a| a.clone()).unwrap_or_default()
}

/// Dossiers du systeme, lus dans `HKLM`.
#[derive(Debug, Clone)]
pub struct Emplacements {
    /// `C:\Windows`
    pub windows: PathBuf,
    /// `C:`
    pub lecteur: String,
    pub program_files: PathBuf,
    pub program_files_x86: Option<PathBuf>,
    pub program_data: PathBuf,
    /// `C:\Users`
    pub profils: PathBuf,
    /// `C:\Users\Public`
    pub public: PathBuf,
}

impl Emplacements {
    pub fn system32(&self) -> PathBuf {
        self.windows.join("System32")
    }

    /// `powershell.exe`, toujours celui du systeme.
    pub fn powershell(&self) -> PathBuf {
        self.system32()
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe")
    }
}

const NT: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
const WINDOWS: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion";
const PROFILS: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList";

#[cfg(windows)]
fn lire_hklm(cle: &str, nom: &str) -> Option<String> {
    windows_registry::LOCAL_MACHINE
        .open(cle)
        .ok()?
        .get_string(nom)
        .ok()
}

#[cfg(not(windows))]
fn lire_hklm(_cle: &str, _nom: &str) -> Option<String> {
    None
}

/// `C:\...` : une lettre, deux-points, separateur. Rien de relatif, rien d'UNC.
fn absolu_local(chemin: &str) -> bool {
    let o = chemin.as_bytes();
    o.len() >= 3 && o[0].is_ascii_alphabetic() && o[1] == b':' && (o[2] == b'\\' || o[2] == b'/')
}

/// Developpe une valeur `REG_EXPAND_SZ`. Seules `%SystemDrive%` et
/// `%SystemRoot%` sont admises, et developpees depuis `HKLM` : passer par
/// l'environnement reintroduirait exactement ce qu'on cherche a eviter. Toute
/// autre variable fait rejeter la valeur.
pub fn developper(valeur: &str, windows: &str, lecteur: &str) -> Option<String> {
    let mut resultat = String::new();
    let mut reste = valeur;
    while let Some(debut) = reste.find('%') {
        resultat.push_str(&reste[..debut]);
        let apres = &reste[debut + 1..];
        let fin = apres.find('%')?;
        match apres[..fin].to_ascii_lowercase().as_str() {
            "systemdrive" => resultat.push_str(lecteur),
            "systemroot" => resultat.push_str(windows),
            _ => return None,
        }
        reste = &apres[fin + 1..];
    }
    resultat.push_str(reste);
    Some(resultat)
}

/// Lit les emplacements dans `HKLM`. Une valeur absente ou suspecte retombe sur
/// la valeur par defaut de Windows : une constante ne peut pas avoir ete
/// redefinie par qui que ce soit.
fn lire() -> Emplacements {
    let lu = |cle: &str, nom: &str| lire_hklm(cle, nom).filter(|v| absolu_local(v));

    let windows = lu(NT, "SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    let lecteur = windows[..2].to_string();
    let developpe = |cle: &str, nom: &str, defaut: &str| {
        lire_hklm(cle, nom)
            .and_then(|v| developper(&v, &windows, &lecteur))
            .filter(|v| absolu_local(v))
            .unwrap_or_else(|| format!("{lecteur}{defaut}"))
    };

    Emplacements {
        program_files: PathBuf::from(
            lu(WINDOWS, "ProgramFilesDir").unwrap_or_else(|| format!(r"{lecteur}\Program Files")),
        ),
        program_files_x86: lu(WINDOWS, "ProgramFilesDir (x86)").map(PathBuf::from),
        program_data: PathBuf::from(developpe(PROFILS, "ProgramData", r"\ProgramData")),
        profils: PathBuf::from(developpe(PROFILS, "ProfilesDirectory", r"\Users")),
        public: PathBuf::from(developpe(PROFILS, "Public", r"\Users\Public")),
        windows: PathBuf::from(&windows),
        lecteur,
    }
}

/// Les emplacements du systeme, lus une fois.
pub fn emplacements() -> &'static Emplacements {
    static E: OnceLock<Emplacements> = OnceLock::new();
    E.get_or_init(lire)
}

// ---------------------------------------------------------------------------
// Environnement
// ---------------------------------------------------------------------------

/// Familles de variables qui font charger du code par un runtime ou par
/// WebView2. Aucune n'a d'usage pour WinTool :
///
/// - `COR_*`, `CORECLR_*` : profileurs .NET (outils de diagnostic et de
///   supervision de serveurs). `COR_PROFILER_PATH` charge une DLL dans
///   PowerShell 5.1, `CORECLR_PROFILER_PATH` dans PowerShell 7 ;
/// - `COMPLUS_*`, `DOTNET_*` : reglages fins des runtimes .NET, pour les
///   developpeurs. `DOTNET_STARTUP_HOOKS` charge un assembly au demarrage de
///   PowerShell 7 ; certains `COMPlus_` coupent la telemetrie ETW dont se sert
///   l'antivirus ;
/// - `WEBVIEW2_*` : pour les developpeurs qui deboguent une interface. Elles
///   designent un autre moteur, un autre canal (Canary s'installe dans le
///   profil, donc dans un dossier inscriptible), un port de debogage ou des
///   arguments de lancement.
// Inutilisees en version de developpement, qui garde ces variables (lib.rs).
#[cfg_attr(debug_assertions, allow(dead_code))]
const PREFIXES_RETIRES: [&str; 5] = ["COR_", "CORECLR_", "COMPLUS_", "DOTNET_", "WEBVIEW2_"];

// Inutilisees en version de developpement, qui garde ces variables (lib.rs).
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn a_retirer(nom: &str) -> bool {
    let n = nom.to_ascii_uppercase();
    PREFIXES_RETIRES.iter().any(|p| n.starts_with(p))
}

/// Parmi elles, celles qui font **charger du code** : un profileur, un
/// assembly de demarrage, un autre moteur d'interface. Les autres sont des
/// reglages courants sur un PC de developpeur (`DOTNET_CLI_TELEMETRY_OPTOUT`,
/// `DOTNET_ROOT`...) : on ne les transmet pas, mais leur presence ne merite pas
/// d'alerte.
// Inutilisees en version de developpement, qui garde ces variables (lib.rs).
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn charge_du_code(nom: &str) -> bool {
    let n = nom.to_ascii_uppercase();
    n.starts_with("COR_ENABLE_PROFILING")
        || n.starts_with("COR_PROFILER")
        || n.starts_with("CORECLR_ENABLE_PROFILING")
        || n.starts_with("CORECLR_PROFILER")
        || matches!(
            n.as_str(),
            "DOTNET_STARTUP_HOOKS"
                | "DOTNET_ADDITIONAL_DEPS"
                | "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"
                | "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
                | "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE"
                | "WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER"
                | "WEBVIEW2_USER_DATA_FOLDER"
        )
}

/// Retire de l'environnement du processus les variables d'injection. A appeler
/// **en tout premier**, avant que le moindre fil ou la moindre vue n'existe :
/// WebView2 les lit en creant son moteur, et chaque processus lance en herite.
// Inutilisees en version de developpement, qui garde ces variables (lib.rs).
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn retirer_variables_dangereuses() -> Vec<String> {
    let noms: Vec<String> = std::env::vars_os()
        .filter_map(|(k, _)| k.into_string().ok())
        .filter(|k| a_retirer(k))
        .collect();
    for nom in &noms {
        std::env::remove_var(nom);
    }
    noms
}

/// Les variables du systeme, retablies depuis `HKLM` pour chaque processus
/// lance. Les scripts du catalogue lisent `$env:SystemRoot`, `$env:ProgramData`,
/// `$env:SystemDrive` : redefinies dans le profil, elles leur feraient viser un
/// autre dossier, avec les droits administrateur.
pub fn variables_systeme(e: &Emplacements) -> Vec<(&'static str, OsString)> {
    let s = |p: &Path| p.as_os_str().to_os_string();
    let mut v = vec![
        ("SystemRoot", s(&e.windows)),
        ("windir", s(&e.windows)),
        ("SystemDrive", OsString::from(&e.lecteur)),
        ("ComSpec", s(&e.system32().join("cmd.exe"))),
        ("ProgramFiles", s(&e.program_files)),
        ("ProgramW6432", s(&e.program_files)),
        (
            "CommonProgramFiles",
            s(&e.program_files.join("Common Files")),
        ),
        (
            "CommonProgramW6432",
            s(&e.program_files.join("Common Files")),
        ),
        ("ProgramData", s(&e.program_data)),
        ("ALLUSERSPROFILE", s(&e.program_data)),
        ("PUBLIC", s(&e.public)),
        // CreateProcess et cmd.exe cherchent un executable dans le dossier
        // courant avant les dossiers du systeme, sauf si cette variable existe.
        ("NoDefaultCurrentDirectoryInExePath", OsString::from("1")),
    ];
    if let Some(x86) = &e.program_files_x86 {
        v.push(("ProgramFiles(x86)", s(x86)));
        v.push(("CommonProgramFiles(x86)", s(&x86.join("Common Files"))));
    }
    v
}

/// Environnement impose aux processus lances, prepare au demarrage (voir
/// `preparer_environnement_enfants`). Vide tant qu'il ne l'a pas ete : c'est le
/// cas des tests du moteur, qui n'ont pas d'application autour d'eux.
static ENFANTS: OnceLock<Vec<(String, OsString)>> = OnceLock::new();

pub fn environnement_enfants() -> &'static [(String, OsString)] {
    ENFANTS.get().map(Vec::as_slice).unwrap_or(&[])
}

/// Les variables qui designent les dossiers de l'utilisateur, ramenees dans son
/// profil si elles pointent vers un emplacement protege (`garde`).
///
/// Elles ne peuvent pas venir de `HKLM` : `TEMP` est par nature une variable
/// de l'utilisateur. Mais les scripts du catalogue nettoient `$env:TEMP` avec
/// les droits administrateur : un `TEMP` redefini vers `C:\Windows\System32`
/// ferait vider System32. Le profil, lui, vient de la liste des profils de
/// `HKLM` (dossier connu `Profile`, non redirigeable).
pub fn variables_utilisateur(
    profil: &Path,
    actuelles: &[(&str, Option<OsString>)],
    protege: impl Fn(&Path) -> bool,
) -> Vec<(String, OsString)> {
    let local = profil.join("AppData").join("Local");
    let defauts = [
        ("USERPROFILE", profil.to_path_buf()),
        ("LOCALAPPDATA", local.clone()),
        ("APPDATA", profil.join("AppData").join("Roaming")),
        ("TEMP", local.join("Temp")),
        ("TMP", local.join("Temp")),
    ];
    let mut v = Vec::new();
    for (nom, defaut) in defauts {
        let valeur = actuelles
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(nom))
            .and_then(|(_, v)| v.clone());
        let saine = match &valeur {
            Some(x) => {
                let p = Path::new(x);
                // USERPROFILE n'a qu'une valeur juste : le profil lui-meme.
                if nom == "USERPROFILE" {
                    p == profil
                } else {
                    p.is_absolute() && !protege(p)
                }
            }
            None => false,
        };
        if !saine {
            v.push((nom.to_string(), defaut.into_os_string()));
        }
    }
    v
}

/// Calcule une fois, au demarrage, l'environnement impose a chaque processus
/// lance : variables du systeme retablies, dossiers de l'utilisateur ramenes
/// dans son profil si besoin. Renvoie les noms des variables corrigees.
pub fn preparer_environnement_enfants(
    profil: &Path,
    protege: impl Fn(&Path) -> bool,
) -> Vec<String> {
    let mut v: Vec<(String, OsString)> = variables_systeme(emplacements())
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    let noms = ["USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP"];
    let actuelles: Vec<(&str, Option<OsString>)> =
        noms.iter().map(|n| (*n, std::env::var_os(n))).collect();
    let corrigees = variables_utilisateur(profil, &actuelles, protege);
    let noms_corriges = corrigees.iter().map(|(n, _)| n.clone()).collect();
    v.extend(corrigees);
    let _ = ENFANTS.set(v);
    noms_corriges
}

/// Place sur le disque du systeme (panneau « Espace disque » de l'Expert, §17).
#[derive(Debug, Clone, serde::Serialize)]
pub struct EspaceDisque {
    /// `C:`
    pub lecteur: String,
    pub total: u64,
    /// Ce que le compte courant peut encore ecrire.
    pub libre: u64,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetDiskFreeSpaceExW(
        dossier: *const u16,
        libre_appelant: *mut u64,
        total: *mut u64,
        libre_total: *mut u64,
    ) -> i32;
}

/// Lit la place du disque du systeme. Une lecture, rien de plus.
pub fn espace_disque() -> Result<EspaceDisque, String> {
    let lecteur = emplacements().lecteur.clone();
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let racine: Vec<u16> = std::ffi::OsStr::new(&format!("{lecteur}\\"))
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let (mut libre, mut total, mut libre_total) = (0u64, 0u64, 0u64);
        // SAFETY : chaine UTF-16 terminee par un zero, et trois pointeurs vers des
        // u64 vivants pendant tout l'appel ; la fonction n'en garde aucun.
        let ok = unsafe {
            GetDiskFreeSpaceExW(racine.as_ptr(), &mut libre, &mut total, &mut libre_total)
        };
        if ok == 0 {
            return Err(format!(
                "place du disque {lecteur} illisible : {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(EspaceDisque {
            lecteur,
            total,
            libre,
        })
    }
    #[cfg(not(windows))]
    {
        Err(format!("place du disque {lecteur} : Windows seulement"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_familles_d_injection_sont_reconnues_sans_egard_a_la_casse() {
        for n in [
            "COR_ENABLE_PROFILING",
            "COR_PROFILER_PATH_64",
            "CORECLR_PROFILER_PATH",
            "COMPlus_ETWEnabled",
            "complus_x",
            "DOTNET_STARTUP_HOOKS",
            "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        ] {
            assert!(a_retirer(n), "{n}");
        }
        for n in [
            "PATH",
            "TEMP",
            "CORE_COUNT",
            "DOTNETCLI",
            "WINTOOL_CONFIG",
            "PSModulePath",
        ] {
            assert!(!a_retirer(n), "{n}");
        }
    }

    #[test]
    fn seules_les_variables_qui_chargent_du_code_alertent() {
        for n in [
            "COR_PROFILER_PATH",
            "cor_enable_profiling",
            "CORECLR_PROFILER_PATH_64",
            "DOTNET_STARTUP_HOOKS",
            "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
        ] {
            assert!(charge_du_code(n), "{n}");
        }
        // Courantes chez un developpeur : retirees, mais sans alarme.
        for n in [
            "DOTNET_CLI_TELEMETRY_OPTOUT",
            "DOTNET_ROOT",
            "COMPlus_TieredCompilation",
        ] {
            assert!(a_retirer(n) && !charge_du_code(n), "{n}");
        }
    }

    #[test]
    fn seules_les_variables_du_systeme_se_developpent() {
        assert_eq!(
            developper(r"%SystemDrive%\Users", r"C:\Windows", "C:").as_deref(),
            Some(r"C:\Users")
        );
        assert_eq!(
            developper(r"%SYSTEMROOT%\Temp", r"D:\Win", "D:").as_deref(),
            Some(r"D:\Win\Temp")
        );
        // Une variable de l'utilisateur ne passe pas : on retombe sur la constante.
        assert_eq!(developper(r"%USERPROFILE%\x", r"C:\Windows", "C:"), None);
        assert_eq!(developper(r"%SystemDrive\x", r"C:\Windows", "C:"), None);
    }

    #[test]
    fn les_emplacements_viennent_de_hklm_et_sont_absolus() {
        let e = emplacements();
        assert!(absolu_local(&e.windows.to_string_lossy()));
        assert!(e.powershell().is_file(), "{}", e.powershell().display());
        assert!(e.program_files.is_dir());
        assert!(e.profils.is_dir());
        assert_eq!(e.lecteur.len(), 2);
    }

    #[test]
    fn lit_la_place_du_disque_du_systeme() {
        let d = espace_disque().expect("place illisible");
        assert!(d.total > 0 && d.libre <= d.total, "{d:?}");
    }

    #[test]
    fn un_temp_redirige_vers_le_systeme_est_ramene_dans_le_profil() {
        let profil = Path::new(r"C:\Users\Moi");
        let protege = |p: &Path| p.starts_with(r"C:\Windows");
        let actuelles = [
            ("USERPROFILE", Some(OsString::from(r"C:\Users\Moi"))),
            (
                "LOCALAPPDATA",
                Some(OsString::from(r"C:\Users\Moi\AppData\Local")),
            ),
            (
                "APPDATA",
                Some(OsString::from(r"C:\Users\Moi\AppData\Roaming")),
            ),
            ("TEMP", Some(OsString::from(r"C:\Windows\System32"))),
            ("TMP", Some(OsString::from("relatif"))),
        ];
        let v = variables_utilisateur(profil, &actuelles, protege);
        let noms: Vec<&str> = v.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(noms, ["TEMP", "TMP"]);
        assert_eq!(v[0].1, OsString::from(r"C:\Users\Moi\AppData\Local\Temp"));
    }

    #[test]
    fn un_profil_usurpe_est_retabli() {
        let profil = Path::new(r"C:\Users\Moi");
        let actuelles = [("USERPROFILE", Some(OsString::from(r"C:\Windows")))];
        let v = variables_utilisateur(profil, &actuelles, |_| false);
        assert!(v
            .iter()
            .any(|(n, x)| n == "USERPROFILE" && x == r"C:\Users\Moi"));
    }
}
