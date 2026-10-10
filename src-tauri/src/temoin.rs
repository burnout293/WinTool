//! Temoin des changements sensibles (specification §12.5).
//!
//! Aucun bac a sable n'est possible pour un script administrateur (§12) :
//! WinTool ne peut pas l'*empecher* de toucher aux taches planifiees ou au
//! demarrage de Windows. Il peut en revanche **relever, avant et apres chaque
//! script**, ce qu'un logiciel malveillant modifie pour s'installer
//! durablement, et **le dire dans le bilan** : « ce script a cree la tache
//! planifiee X ».
//!
//! Tout se lit dans le registre ou sur le disque, sans PowerShell, donc vite,
//! et rien ne s'ecrit. Une famille qui ne se lit pas (droits, cle absente) est
//! dite non relevee : le bilan ne pretend jamais avoir surveille ce qu'il n'a
//! pas pu lire.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// Ce que le temoin surveille. L'ordre est celui du bilan.
pub const FAMILLES: [&str; 8] = [
    "tasks",
    "services",
    "autorun",
    "environment",
    "defender",
    "hosts",
    "certificates",
    "firewall",
];

/// Un releve : pour chaque famille lue, un nom -> une empreinte de son contenu.
#[derive(Debug, Clone, Default)]
pub struct Releve {
    entrees: BTreeMap<&'static str, BTreeMap<String, String>>,
}

impl Releve {
    /// Les familles effectivement lues.
    pub fn lues(&self) -> Vec<String> {
        self.entrees.keys().map(|f| f.to_string()).collect()
    }

    fn noter(&mut self, famille: &'static str, nom: String, empreinte: String) {
        self.entrees
            .entry(famille)
            .or_default()
            .insert(nom, empreinte);
    }

    fn ouvrir(&mut self, famille: &'static str) {
        self.entrees.entry(famille).or_default();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Changement {
    /// Une de [`FAMILLES`].
    pub family: String,
    /// `added`, `removed` ou `modified`.
    pub kind: String,
    /// Ce qui a change, tel que Windows le nomme : chemin de la tache, nom du
    /// service, valeur de registre, ligne du fichier hosts…
    pub name: String,
}

/// Au-dela, la liste est tronquee : un script qui change des centaines
/// d'elements se signale assez par leur nombre.
const MAX_CHANGEMENTS: usize = 200;

/// Ce qui a change entre deux releves, famille par famille. Une famille
/// absente de l'un des deux n'est pas comparee : on ne sait rien d'elle.
pub fn comparer(avant: &Releve, apres: &Releve) -> Vec<Changement> {
    let mut out = Vec::new();
    for famille in FAMILLES {
        let (Some(a), Some(b)) = (avant.entrees.get(famille), apres.entrees.get(famille)) else {
            continue;
        };
        let noms: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
        for nom in noms {
            let genre = match (a.get(nom), b.get(nom)) {
                (None, Some(_)) => "added",
                (Some(_), None) => "removed",
                (Some(x), Some(y)) if x != y => "modified",
                _ => continue,
            };
            out.push(Changement {
                family: famille.to_string(),
                kind: genre.to_string(),
                name: nom.clone(),
            });
        }
    }
    out.truncate(MAX_CHANGEMENTS);
    out
}

fn empreinte(octets: &[u8]) -> String {
    Sha256::digest(octets)
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

// ---------------------------------------------------------------------------
// Le releve
// ---------------------------------------------------------------------------

/// Releve l'etat de tout ce que le temoin surveille. En lecture seule.
pub fn relever() -> Releve {
    let mut r = Releve::default();
    let emp = crate::systeme::emplacements();
    let windows = emp.windows.clone();
    taches(&mut r, &windows.join("System32").join("Tasks"));
    hosts(
        &mut r,
        &windows
            .join("System32")
            .join("drivers")
            .join("etc")
            .join("hosts"),
    );
    #[cfg(windows)]
    registre::tout(&mut r, &emp.program_data);
    r
}

/// Les taches planifiees : un fichier XML par tache, sous `System32\Tasks`.
fn taches(r: &mut Releve, racine: &Path) {
    if std::fs::read_dir(racine).is_err() {
        return;
    }
    r.ouvrir("tasks");
    let mut pile = vec![racine.to_path_buf()];
    while let Some(dossier) = pile.pop() {
        let Ok(lecture) = std::fs::read_dir(&dossier) else {
            continue;
        };
        for e in lecture.flatten() {
            let p = e.path();
            let Ok(type_) = e.file_type() else { continue };
            // Une jonction ou un lien n'est jamais suivi : le releve reste
            // dans le dossier des taches.
            if type_.is_symlink() {
                continue;
            }
            if type_.is_dir() {
                pile.push(p);
            } else if let Ok(contenu) = std::fs::read(&p) {
                let nom = p
                    .strip_prefix(racine)
                    .map(|x| format!("\\{}", x.to_string_lossy()))
                    .unwrap_or_else(|_| p.to_string_lossy().to_string());
                r.noter("tasks", nom, empreinte(&contenu));
            }
        }
    }
}

/// Le fichier `hosts` : chaque ligne active (ni vide, ni commentaire).
fn hosts(r: &mut Releve, fichier: &Path) {
    let Ok(octets) = std::fs::read(fichier) else {
        return;
    };
    r.ouvrir("hosts");
    for ligne in String::from_utf8_lossy(&octets).lines() {
        let l = ligne.split('#').next().unwrap_or("").trim();
        if l.is_empty() {
            continue;
        }
        let normal = l.split_whitespace().collect::<Vec<_>>().join(" ");
        r.noter("hosts", normal, String::new());
    }
}

#[cfg(windows)]
mod registre {
    use super::{empreinte, Releve};
    use std::path::Path;
    use windows_registry::{Key, Type, Value, CURRENT_USER, LOCAL_MACHINE};

    /// Une valeur, lisible pour les chaines et les nombres, sinon son empreinte.
    fn texte(v: &Value) -> String {
        match v.ty() {
            Type::String | Type::ExpandString | Type::MultiString => {
                String::from_utf16_lossy(v.as_wide())
                    .trim_end_matches('\0')
                    .replace('\0', " ; ")
            }
            Type::U32 => v
                .get(..4)
                .and_then(|b| <[u8; 4]>::try_from(b).ok())
                .map(|b| u32::from_le_bytes(b).to_string())
                .unwrap_or_default(),
            Type::U64 => v
                .get(..8)
                .and_then(|b| <[u8; 8]>::try_from(b).ok())
                .map(|b| u64::from_le_bytes(b).to_string())
                .unwrap_or_default(),
            _ => empreinte(v),
        }
    }

    /// Chaque valeur d'une cle : `prefixe\nom` -> son contenu.
    fn valeurs(
        r: &mut Releve,
        famille: &'static str,
        racine: &Key,
        cle: &str,
        prefixe: &str,
        noms: Option<&[&str]>,
    ) -> bool {
        let Ok(k) = racine.open(cle) else {
            return false;
        };
        let Ok(it) = k.values() else {
            return false;
        };
        r.ouvrir(famille);
        for (nom, v) in it {
            if noms.is_some_and(|n| !n.iter().any(|x| x.eq_ignore_ascii_case(&nom))) {
                continue;
            }
            r.noter(famille, format!("{prefixe}\\{nom}"), texte(&v));
        }
        true
    }

    pub fn tout(r: &mut Releve, program_data: &Path) {
        services(r);
        demarrage(r, program_data);
        // Variables d'environnement : celles du systeme et celles du compte.
        valeurs(
            r,
            "environment",
            LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
            "HKLM",
            None,
        );
        valeurs(r, "environment", CURRENT_USER, "Environment", "HKCU", None);
        // Exclusions de l'antivirus : chaque chemin, extension, processus ou
        // adresse exclu de l'analyse. Souvent illisible meme en administrateur :
        // la famille est alors dite non relevee.
        for sous in ["Paths", "Extensions", "Processes", "IpAddresses"] {
            valeurs(
                r,
                "defender",
                LOCAL_MACHINE,
                &format!(r"SOFTWARE\Microsoft\Windows Defender\Exclusions\{sous}"),
                sous,
                None,
            );
        }
        // Certificats racine de confiance de la machine — pas `AuthRoot`, que
        // Windows met a jour seul.
        for cle in [
            r"SOFTWARE\Microsoft\SystemCertificates\ROOT\Certificates",
            r"SOFTWARE\Policies\Microsoft\SystemCertificates\Root\Certificates",
            r"SOFTWARE\Microsoft\EnterpriseCertificates\Root\Certificates",
        ] {
            sous_cles(r, "certificates", cle);
        }
        // Regles du pare-feu : une valeur par regle, son texte en entier.
        pare_feu(r);
    }

    /// Chaque sous-cle, sans son contenu : un certificat est son empreinte.
    fn sous_cles(r: &mut Releve, famille: &'static str, cle: &str) {
        let Ok(k) = LOCAL_MACHINE.open(cle) else {
            return;
        };
        let Ok(it) = k.keys() else { return };
        r.ouvrir(famille);
        for nom in it {
            r.noter(famille, nom, String::new());
        }
    }

    /// Les services et pilotes : leur commande et leur mode de demarrage.
    fn services(r: &mut Releve) {
        let Ok(racine) = LOCAL_MACHINE.open(r"SYSTEM\CurrentControlSet\Services") else {
            return;
        };
        let Ok(noms) = racine.keys() else { return };
        r.ouvrir("services");
        for nom in noms {
            let Ok(k) = racine.open(&nom) else { continue };
            let image = k.get_string("ImagePath").unwrap_or_default();
            let Ok(depart) = k.get_u32("Start") else {
                // Sans `Start`, ce n'est pas un service : une cle de
                // parametres partages, sans rien qui se lance.
                continue;
            };
            r.noter("services", nom, format!("{depart} {image}"));
        }
    }

    /// Ce qui se lance au demarrage ou a l'ouverture de session.
    fn demarrage(r: &mut Releve, program_data: &Path) {
        for (racine, prefixe, cle) in [
            (
                LOCAL_MACHINE,
                "HKLM",
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            ),
            (
                LOCAL_MACHINE,
                "HKLM",
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce",
            ),
            (
                LOCAL_MACHINE,
                "HKLM",
                r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
            ),
            (
                LOCAL_MACHINE,
                "HKLM",
                r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce",
            ),
            (
                CURRENT_USER,
                "HKCU",
                r"Software\Microsoft\Windows\CurrentVersion\Run",
            ),
            (
                CURRENT_USER,
                "HKCU",
                r"Software\Microsoft\Windows\CurrentVersion\RunOnce",
            ),
        ] {
            let prefixe = format!(r"{prefixe}\{}", cle.rsplit('\\').next().unwrap_or(cle));
            valeurs(r, "autorun", racine, cle, &prefixe, None);
        }
        // Le shell et l'ouverture de session : deux valeurs que les logiciels
        // malveillants detournent, et que rien de legitime ne touche.
        valeurs(
            r,
            "autorun",
            LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon",
            "Winlogon",
            Some(&["Shell", "Userinit"]),
        );
        // Les dossiers « Démarrage » : celui de tous les comptes, et celui-ci.
        let dossiers = [
            program_data.join(r"Microsoft\Windows\Start Menu\Programs\StartUp"),
            std::env::var_os("APPDATA")
                .map(|a| Path::new(&a).join(r"Microsoft\Windows\Start Menu\Programs\Startup"))
                .unwrap_or_default(),
        ];
        for d in dossiers {
            let Ok(lecture) = std::fs::read_dir(&d) else {
                continue;
            };
            r.ouvrir("autorun");
            for e in lecture.flatten() {
                let contenu = std::fs::read(e.path()).unwrap_or_default();
                r.noter(
                    "autorun",
                    e.path().to_string_lossy().to_string(),
                    empreinte(&contenu),
                );
            }
        }
    }

    fn pare_feu(r: &mut Releve) {
        let Ok(k) = LOCAL_MACHINE.open(
            r"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules",
        ) else {
            return;
        };
        let Ok(it) = k.values() else { return };
        r.ouvrir("firewall");
        for (id, v) in it {
            let regle = texte(&v);
            // Le nom lisible de la regle, quand elle en porte un : `Name=…|`.
            let nom = regle
                .split('|')
                .find_map(|c| c.strip_prefix("Name="))
                .filter(|n| !n.starts_with('@'))
                .map(|n| format!("{n} ({id})"))
                .unwrap_or(id);
            r.noter("firewall", nom, empreinte(regle.as_bytes()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn releve(paires: &[(&'static str, &str, &str)]) -> Releve {
        let mut r = Releve::default();
        for f in FAMILLES {
            r.ouvrir(f);
        }
        for (f, n, e) in paires {
            r.noter(f, n.to_string(), e.to_string());
        }
        r
    }

    #[test]
    fn dit_ce_qui_est_ajoute_retire_ou_modifie() {
        let avant = releve(&[
            ("tasks", r"\Maintenance", "a"),
            ("services", "DiagTrack", "2 svchost"),
            ("hosts", "127.0.0.1 localhost", ""),
        ]);
        let apres = releve(&[
            ("tasks", r"\Maintenance", "a"),
            ("tasks", r"\Updater", "b"),
            ("services", "DiagTrack", "4 svchost"),
        ]);
        let c = comparer(&avant, &apres);
        let vu: Vec<(&str, &str, &str)> = c
            .iter()
            .map(|x| (x.family.as_str(), x.kind.as_str(), x.name.as_str()))
            .collect();
        assert_eq!(
            vu,
            vec![
                ("tasks", "added", r"\Updater"),
                ("services", "modified", "DiagTrack"),
                ("hosts", "removed", "127.0.0.1 localhost"),
            ]
        );
    }

    #[test]
    fn une_famille_non_relevee_n_est_jamais_comparee() {
        let mut avant = Releve::default();
        avant.ouvrir("tasks");
        let apres = releve(&[("tasks", r"\Nouvelle", "x"), ("services", "Neuf", "2")]);
        let c = comparer(&avant, &apres);
        assert_eq!(
            c.len(),
            1,
            "seules les taches etaient lues des deux cotes : {c:?}"
        );
        assert_eq!(c[0].name, r"\Nouvelle");
    }

    #[test]
    fn le_fichier_hosts_se_compare_ligne_a_ligne() {
        let d = std::env::temp_dir().join(format!("wintool-temoin-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("hosts");
        std::fs::write(&f, "# commentaire\r\n127.0.0.1   localhost # local\r\n\r\n").unwrap();
        let mut a = Releve::default();
        hosts(&mut a, &f);
        std::fs::write(&f, "127.0.0.1 localhost\r\n0.0.0.0 telemetry.example\r\n").unwrap();
        let mut b = Releve::default();
        hosts(&mut b, &f);
        let _ = std::fs::remove_dir_all(&d);
        let c = comparer(&a, &b);
        assert_eq!(c.len(), 1, "{c:?}");
        assert_eq!(
            (c[0].kind.as_str(), c[0].name.as_str()),
            ("added", "0.0.0.0 telemetry.example")
        );
    }

    /// Sur une vraie machine : le releve lit au moins les services, et deux
    /// releves de suite, sans rien faire entre les deux, ne voient rien changer.
    #[test]
    #[cfg(windows)]
    fn deux_releves_sans_rien_entre_ne_voient_rien() {
        let debut = std::time::Instant::now();
        let a = relever();
        println!(
            "releve en {} ms : {:?}",
            debut.elapsed().as_millis(),
            a.lues()
        );
        assert!(a.lues().contains(&"services".to_string()), "{:?}", a.lues());
        let b = relever();
        let c = comparer(&a, &b);
        assert!(c.is_empty(), "changements fantomes : {c:?}");
    }
}
