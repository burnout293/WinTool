//! Réglages et catégories — les données utilisateur de la specification §4 et §8.
//!
//! C'est l'inversion centrale de la refonte v4 : une catégorie n'est plus une étiquette
//! figée dans un script, c'est une donnée que l'utilisateur possède (créée, renommée,
//! réordonnée, supprimée en mode Expert). `category:` dans l'entête d'un script n'est
//! qu'une **suggestion** de rangement, résolue ici contre les catégories connues
//! (`resolve_category`) — jamais un ordre.
//!
//! Ce module ne gère que `settings.json` (`%LOCALAPPDATA%`, rien de sensible, aux côtés
//! des scripts utilisateur et des journaux — `discovery::base_dir`). Le magasin
//! d'approbation de sécurité (`approved.json`, §12.1/§12.4) est volontairement séparé,
//! dans [`crate::approval`] : il vit dans `%ProgramData%`, inscriptible seulement par un
//! administrateur, parce qu'un magasin accessible en écriture à l'utilisateur serait
//! décoratif — un script malveillant pourrait y ajouter son propre hash.

use crate::discovery::{self, ScriptEntry};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

/// Catégorie synthétique pour un script dont `category:` ne correspond à rien de connu
/// (spécification §5.1 : « sinon il part en Non classé »). Jamais persistée : calculée.
pub const NON_CLASSE: &str = "unclassified";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    /// Stable, jamais renommé après création — c'est ce que référencent `scripts[]`
    /// des autres catégories et les overrides, pas la position dans la liste.
    pub id: String,
    /// Une clé par langue affichée (« fr », « en »…). Une catégorie d'usine porte les
    /// deux ; une catégorie créée par l'utilisateur n'a que celle qu'il a tapée — même
    /// règle de repli que les traductions de script (§5.1) : langue absente -> langue
    /// de base.
    pub name: BTreeMap<String, String>,
    #[serde(default)]
    pub description: String,
    pub icon: String,
    #[serde(default)]
    pub pinned: bool,
    /// Ordre manuel d'exécution (§6.1) — par catégorie, pas global.
    #[serde(default)]
    pub scripts: Vec<String>,
    /// Tokens de `category:` qui résolvent vers cette catégorie (ex. `["cleaning","nettoyage"]`).
    /// Vide pour une catégorie utilisateur : aucun script ne peut la viser par suggestion,
    /// seul un classement manuel l'y place (voir `resolve_category`).
    #[serde(default)]
    pub factory_aliases: Vec<String>,
    /// Vrai uniquement pour « Entretien complet » (§4.1) : son `scripts[]` n'est
    /// jamais rempli directement, `group_scripts` le recalcule dynamiquement comme
    /// l'union de tout ce qui est déjà classé ailleurs. Jamais posé par
    /// `create_category` — une catégorie créée par l'utilisateur ne l'est pas.
    #[serde(default)]
    pub aggregate: bool,
}

/// Ce que l'utilisateur a figé pour un script donné (§4.2 : « le script propose,
/// l'humain dispose »). Un champ absent continue de suivre le script.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScriptOverride {
    pub category_locked: Option<String>,
    /// Categories auxquelles ce script appartient (§4.1 : « un script peut
    /// figurer dans plusieurs categories »).
    ///
    /// `None` = l'utilisateur n'a jamais touche au rangement de ce script ;
    /// c'est alors la suggestion de son entete (`category:`) qui s'applique.
    /// `Some(liste)` fait foi, y compris `Some(vide)` qui signifie « retire de
    /// partout, volontairement » — a ne pas confondre avec `None`, sinon la
    /// suggestion d'usine le reclasserait aussitot.
    #[serde(default)]
    pub categories: Option<Vec<String>>,
    #[serde(default)]
    pub config: BTreeMap<String, serde_json::Value>,
    pub reversible_ack: Option<bool>,
    pub reboot_ack: Option<bool>,
    /// Un script desactive reste range dans sa categorie et garde ses reglages :
    /// il est simplement saute pendant l'entretien. `None` vaut active — la
    /// valeur initiale de la §4.2, qui ne depend d'aucune metadonnee.
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub theme: String,
    pub lang: String,
    pub update_policy: String,
    pub failure_policy: String,
    pub log_cap_mb: u32,
    pub exec_policy: String,
    pub categories: Vec<Category>,
    #[serde(default)]
    pub overrides: BTreeMap<String, ScriptOverride>,
    #[serde(default)]
    pub onboarded: bool,
    /// Numerotation discrete de chaque reglage (« 2.3 ») dans le panneau des
    /// Reglages. Utile pour designer une option precisement a l'oral ou par
    /// ecrit, superflue le reste du temps : d'ou le reglage.
    /// `serde(default)` vaut `false` — un fichier de reglages ecrit avant
    /// l'arrivee de ce champ se relit donc sans erreur, numerotation masquee.
    #[serde(default)]
    pub show_setting_numbers: bool,
    /// Echelle de rendu de l'interface (accessibilite).
    ///
    /// `serde(default)` donne `0.0` pour un fichier ecrit avant ce champ :
    /// `ui_scale_ou_defaut` ramene toute valeur hors bornes a 1.0, donc un
    /// ancien fichier se relit sans que l'interface devienne minuscule.
    #[serde(default)]
    pub ui_scale: f32,
    /// Catalogue de scripts retenu (§16.6) : `""` tant que l'utilisateur n'a
    /// rien decide, `official` pour le catalogue officiel, `none` s'il a choisi
    /// de continuer sans. Une preference, pas une decision de confiance : celle-
    /// ci tient a la cle compilee dans le binaire, pas a ce fichier.
    #[serde(default)]
    pub catalogue_source: String,
    /// Quand verifier le catalogue : `startup` (par defaut, `""` compris) ou
    /// `manual`. Dans les deux cas, rien n'est installe sans un clic (§16.5).
    #[serde(default)]
    pub catalogue_check: String,
    /// « Ne plus afficher » sur le rappel des scripts sans source (§16.6) :
    /// respecte definitivement.
    #[serde(default)]
    pub catalogue_reminder_hidden: bool,
    /// Sources desactivees, par identifiant (§16.2) : ni interrogees, ni
    /// montrees — leurs scripts restent sur le disque. Une preference : la
    /// decision de confiance, elle, est l'inscription de la source (HKLM).
    #[serde(default)]
    pub sources_inactives: Vec<String>,
    /// Par source, les scripts que l'utilisateur a decoches dans la page du
    /// catalogue : ni telecharges, ni montres. Les scripts qu'une nouvelle
    /// version ajoute arrivent coches ; on ne retient que les refus.
    #[serde(default)]
    pub sources_exclus: BTreeMap<String, Vec<String>>,
}

/// Valeurs admises pour `catalogue_source` une fois la decision prise.
pub const SOURCES_CATALOGUE: [&str; 2] = ["official", "none"];
/// Valeurs admises pour `catalogue_check`.
pub const VERIFICATIONS_CATALOGUE: [&str; 2] = ["startup", "manual"];

/// Echelle utilisable, bornee. Au-dela de 2x l'interface ne tient plus dans
/// une fenetre de taille raisonnable ; en deca de 1x elle devient illisible,
/// ce qui serait l'inverse du service rendu.
pub fn ui_scale_ou_defaut(v: f32) -> f32 {
    if v.is_finite() && (1.0..=2.0).contains(&v) {
        v
    } else {
        1.0
    }
}

/// Une ligne de `tools/categories.json` — la seule source des catégories d'usine,
/// partagée avec `tools/lint-scripts.ps1` pour que les deux listes ne puissent pas
/// diverger (c'est exactement la dérive qui a rendu `CREER_UN_SCRIPT.txt` trompeur).
#[derive(Debug, Deserialize)]
struct CategorieUsine {
    id: String,
    id_fr: String,
    name_fr: String,
    name_en: String,
    icon: String,
}

/// Parse `tools/categories.json` (contenu brut) en catégories d'usine prêtes à
/// persister. Fonction pure : testable sans `AppHandle`.
pub fn factory_categories_from_json(raw: &str) -> Result<Vec<Category>, String> {
    let usine: Vec<CategorieUsine> =
        serde_json::from_str(raw).map_err(|e| format!("categories.json invalide : {e}"))?;
    Ok(usine
        .into_iter()
        .map(|c| Category {
            factory_aliases: vec![c.id.clone(), c.id_fr],
            name: BTreeMap::from([("fr".to_string(), c.name_fr), ("en".to_string(), c.name_en)]),
            id: c.id,
            description: String::new(),
            icon: c.icon,
            pinned: false,
            scripts: Vec::new(),
            aggregate: false,
        })
        .collect())
}

/// Réglages de premier lancement : les catégories d'usine, plus « Entretien complet »
/// épinglée — renommable et supprimable comme n'importe quelle autre catégorie
/// (§4.1). Sa seule particularité est `aggregate: true` : `group_scripts` lui
/// donne dynamiquement l'union de tout ce qui est déjà classé, elle ne peut pas
/// être visée par le `category:` d'un script (`factory_aliases` vide).
pub fn default_settings(factory: Vec<Category>) -> Settings {
    let mut categories = factory;
    categories.push(Category {
        id: "maintenance".to_string(),
        name: BTreeMap::from([
            ("fr".to_string(), "Entretien complet".to_string()),
            ("en".to_string(), "Full maintenance".to_string()),
        ]),
        description: String::new(),
        icon: "sparkles".to_string(),
        pinned: true,
        scripts: Vec::new(),
        factory_aliases: Vec::new(),
        aggregate: true,
    });

    Settings {
        theme: "system".to_string(),
        lang: "fr".to_string(),
        update_policy: "propose".to_string(),
        failure_policy: "continue".to_string(),
        log_cap_mb: 50,
        exec_policy: "bypass".to_string(),
        categories,
        overrides: BTreeMap::new(),
        onboarded: false,
        show_setting_numbers: false,
        ui_scale: 1.0,
        catalogue_source: String::new(),
        catalogue_check: "startup".to_string(),
        catalogue_reminder_hidden: false,
        sources_inactives: Vec::new(),
        sources_exclus: BTreeMap::new(),
    }
}

/// Charge `settings.json` depuis `path`, ou l'initialise si absent/illisible. Un JSON
/// corrompu ne bloque jamais l'application (même esprit que le lint : constater,
/// jamais planter) — on repart de réglages par défaut plutôt que de refuser de lancer.
pub fn load_from(path: &Path, factory: Vec<Category>) -> Result<Settings, String> {
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(s) = serde_json::from_str::<Settings>(&raw) {
            return Ok(s);
        }
    }
    let defaults = default_settings(factory);
    save_to(path, &defaults)?;
    Ok(defaults)
}

/// Écriture atomique (fichier temporaire puis renommage) pour ne jamais laisser un
/// `settings.json` tronqué si l'application est tuée pendant l'écriture.
pub fn save_to(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("creation de {} : {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &json).map_err(|e| format!("ecriture de {} : {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("renommage vers {} : {e}", path.display()))?;
    Ok(())
}

/// Toutes les categories auxquelles un script appartient (§4.1).
///
/// Ordre de decision, du plus explicite au plus suppose :
///   1. `overrides[id].categories` — ce que l'utilisateur a decide, liste vide
///      comprise ;
///   2. `category_locked` — l'ancien rangement a une seule categorie, relu tel
///      quel pour qu'un `settings.json` ecrit avant cette version garde son
///      classement ;
///   3. `category:` de l'entete — une **suggestion**, jamais un ordre.
///
/// Une liste vide signifie « Non classe ». Les identifiants qui ne designent
/// plus aucune categorie sont ecartes : supprimer une categorie ne doit pas
/// laisser des appartenances fantomes.
pub fn resolve_categories(settings: &Settings, script_id: &str, declared: &str) -> Vec<String> {
    let connue = |id: &String| {
        settings
            .categories
            .iter()
            .any(|c| &c.id == id && !c.aggregate)
    };

    if let Some(over) = settings.overrides.get(script_id) {
        if let Some(liste) = &over.categories {
            return liste.iter().filter(|id| connue(id)).cloned().collect();
        }
        if let Some(locked) = &over.category_locked {
            return if connue(locked) {
                vec![locked.clone()]
            } else {
                Vec::new()
            };
        }
    }

    settings
        .categories
        .iter()
        .filter(|cat| !cat.aggregate)
        .find(|cat| {
            cat.factory_aliases
                .iter()
                .any(|a| a.eq_ignore_ascii_case(declared))
        })
        .map(|cat| vec![cat.id.clone()])
        .unwrap_or_default()
}

/// Ajoute ou retire un script d'une categorie, sans toucher aux autres.
///
/// Premiere modification : la liste est amorcee avec le rangement effectif du
/// moment, pour qu'ajouter une categorie n'efface pas celle d'origine.
pub fn set_script_category_membership(
    settings: &mut Settings,
    script_id: &str,
    declared: &str,
    category_id: &str,
    member: bool,
) {
    let actuelles = resolve_categories(settings, script_id, declared);
    let over = settings.overrides.entry(script_id.to_string()).or_default();
    let mut liste = over.categories.clone().unwrap_or(actuelles);

    liste.retain(|id| id != category_id);
    if member {
        liste.push(category_id.to_string());
    }
    over.categories = Some(liste);
    // L'ancien champ ne doit plus peser : il n'a de sens que tant qu'aucune
    // liste explicite n'existe.
    over.category_locked = None;
}

/// Les trois booléens « réglage WinTool » de la §4.2, désignés par un jeton
/// stable côté interface plutôt que par un booléen positionnel —
/// `set_flag(id, "restore", true)` se relit, `set_flag(id, true, false)` non.
pub const FLAG_RESTORE: &str = "restore";
pub const FLAG_REBOOT: &str = "reboot";
pub const FLAG_ENABLED: &str = "enabled";

/// Fige une valeur de `$CONFIG` pour un script (§4.2 : « le script propose,
/// l'utilisateur dispose »).
///
/// `value = None` **efface** l'override au lieu d'écrire `null` : c'est le seul
/// chemin de retour vers le défaut déclaré, et il compte. Tant que la clé est
/// absente, la valeur suit le script et se met à jour à la Ré-analyse (§5.5) ;
/// dès qu'elle est présente, plus rien venant du fichier ne la réécrit.
pub fn set_config_value(
    settings: &mut Settings,
    script_id: &str,
    key: &str,
    value: Option<serde_json::Value>,
) {
    let entree = settings.overrides.entry(script_id.to_string()).or_default();
    match value {
        Some(v) => {
            entree.config.insert(key.to_string(), v);
        }
        None => {
            entree.config.remove(key);
        }
    }
    oublier_si_vide(settings, script_id);
}

/// Pose (ou relâche) l'un des trois booléens WinTool de la §4.2. `flag` vaut
/// [`FLAG_RESTORE`], [`FLAG_REBOOT`] ou [`FLAG_ENABLED`] ; `value = None` rend
/// le réglage à sa valeur initiale (la métadonnée du script pour les deux
/// premiers, « activé » pour le troisième).
pub fn set_flag(
    settings: &mut Settings,
    script_id: &str,
    flag: &str,
    value: Option<bool>,
) -> Result<(), String> {
    let entree = settings.overrides.entry(script_id.to_string()).or_default();
    match flag {
        FLAG_RESTORE => entree.reversible_ack = value,
        FLAG_REBOOT => entree.reboot_ack = value,
        FLAG_ENABLED => entree.enabled = value,
        autre => return Err(format!("reglage par script inconnu : {autre}")),
    }
    oublier_si_vide(settings, script_id);
    Ok(())
}

/// Rend au script **toutes** ses valeurs de `$CONFIG` et ses deux cases d'un
/// coup. Ne touche pas au classement en catégorie : ranger un script ailleurs
/// et régler ses options sont deux décisions distinctes, annuler l'une ne doit
/// pas annuler l'autre en silence.
pub fn reset_script_config(settings: &mut Settings, script_id: &str) {
    if let Some(entree) = settings.overrides.get_mut(script_id) {
        entree.config.clear();
        entree.reversible_ack = None;
        entree.reboot_ack = None;
        entree.enabled = None;
    }
    oublier_si_vide(settings, script_id);
}

/// Un override qui ne fige plus rien est retiré de `settings.json` : sans ça le
/// fichier accumulerait des objets vides à chaque aller-retour sur un
/// interrupteur, et « aucune entrée » cesserait de vouloir dire « rien figé ».
fn oublier_si_vide(settings: &mut Settings, script_id: &str) {
    let vide = settings.overrides.get(script_id).is_some_and(|o| {
        o.category_locked.is_none()
            && o.config.is_empty()
            && o.reversible_ack.is_none()
            && o.reboot_ack.is_none()
            && o.enabled.is_none()
    });
    if vide {
        settings.overrides.remove(script_id);
    }
}

/// Un lot (mode Expert, §2) : la catégorie et les scripts qui y sont rangés,
/// dans l'ordre manuel (§6.1). `missing` liste les ids que la catégorie
/// référence (classement manuel ou Ré-analyse passée) mais que la découverte
/// actuelle ne retrouve plus — affichés comme « manquant » (§4.3), jamais une
/// erreur bloquante.
#[derive(Debug, Clone, Serialize)]
pub struct CategoryGroup {
    pub category: Category,
    pub scripts: Vec<ScriptEntry>,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupedScripts {
    pub categories: Vec<CategoryGroup>,
    pub unclassified: Vec<ScriptEntry>,
}

/// Regroupe des scripts découverts par catégorie résolue (fonction pure,
/// testable sans `AppHandle` ni disque).
pub fn group_scripts(settings: &Settings, scripts: Vec<ScriptEntry>) -> GroupedScripts {
    let mut par_categorie: BTreeMap<String, Vec<ScriptEntry>> = BTreeMap::new();
    let mut non_classes = Vec::new();

    for entry in scripts {
        // Un script peut atterrir dans plusieurs seaux (§4.1). Le garde-fou
        // « execute une seule fois quand deux categories le partagent » vit a
        // l'execution, pas ici : le regroupement doit montrer la verite.
        let ids = resolve_categories(settings, &entry.id, &entry.meta.category);
        if ids.is_empty() {
            non_classes.push(entry);
        } else {
            for id_cat in ids {
                par_categorie.entry(id_cat).or_default().push(entry.clone());
            }
        }
    }

    // Union déterministe pour « Entretien complet » (catégorie agrégat, §4.1) :
    // calculée une fois, à partir des scripts déjà classés ailleurs. `.get()`
    // plutôt que `.remove()` plus bas : cette union doit voir TOUTES les
    // catégories, pas seulement celles pas encore traitées par le `.map()`
    // suivant — l'ordre de `settings.categories` ne doit pas influencer le
    // résultat.
    let mut union_classes: Vec<ScriptEntry> = par_categorie.values().flatten().cloned().collect();
    union_classes.sort_by(|a, b| a.id.cmp(&b.id));
    // Depuis que l'appartenance est multiple, un script range dans deux
    // categories apparaissait deux fois dans « Entretien complet » — et
    // l'entretien l'aurait lance deux fois (§4.1, garde-fou).
    union_classes.dedup_by(|a, b| a.id == b.id);

    let categories = settings
        .categories
        .iter()
        .map(|cat| {
            if cat.aggregate {
                return CategoryGroup {
                    category: cat.clone(),
                    scripts: union_classes.clone(),
                    missing: Vec::new(),
                };
            }
            let mut trouves = par_categorie.get(&cat.id).cloned().unwrap_or_default();
            // Ordre manuel (§6.1) d'abord ; un script nouvellement classé ici
            // (pas encore dans `cat.scripts`) arrive a la fin, dans l'ordre de
            // decouverte — un tri stable preserve cet ordre entre egalites.
            trouves.sort_by_key(|s| {
                cat.scripts
                    .iter()
                    .position(|id| id == &s.id)
                    .unwrap_or(usize::MAX)
            });
            let manquants = cat
                .scripts
                .iter()
                .filter(|id| !trouves.iter().any(|s| &s.id == *id))
                .cloned()
                .collect();
            CategoryGroup {
                category: cat.clone(),
                scripts: trouves,
                missing: manquants,
            }
        })
        .collect();

    GroupedScripts {
        categories,
        unclassified: non_classes,
    }
}

// -----------------------------------------------------------------------------
// Points d'entrée côté application (résolution de chemins via AppHandle)
// -----------------------------------------------------------------------------

pub fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(discovery::base_dir(app)?.join("settings.json"))
}

fn read_factory_categories<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Category>, String> {
    let path = app
        .path()
        .resolve("categories.json", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("ressources introuvables : {e}"))?;
    let raw =
        fs::read_to_string(&path).map_err(|e| format!("lecture de {} : {e}", path.display()))?;
    factory_categories_from_json(&raw)
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Settings, String> {
    load_from(&settings_path(app)?, read_factory_categories(app)?)
}

pub fn save<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> Result<(), String> {
    save_to(&settings_path(app)?, settings)
}

/// Reinitialisation aux reglages d'usine (§8) : reperd les categories et
/// overrides de l'utilisateur, exactement comme un premier lancement.
pub fn reset<R: Runtime>(app: &AppHandle<R>) -> Result<Settings, String> {
    let defaults = default_settings(read_factory_categories(app)?);
    save(app, &defaults)?;
    Ok(defaults)
}

/// Export (§8) : toute la configuration tient dans un fichier, a cote des
/// scripts et journaux de l'utilisateur — pas besoin d'un selecteur de
/// fichier natif pour un unique fichier a un emplacement previsible.
pub fn export<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let s = load(app)?;
    let chemin = discovery::base_dir(app)?.join("settings-export.json");
    let json = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    fs::write(&chemin, json).map_err(|e| format!("ecriture de {} : {e}", chemin.display()))?;
    Ok(chemin.to_string_lossy().to_string())
}

/// Import (§8) : valide le contenu avant d'ecrire quoi que ce soit — un
/// fichier corrompu ou d'une version incompatible est rejete proprement,
/// jamais partiellement applique.
pub fn import_from_str<R: Runtime>(app: &AppHandle<R>, raw: &str) -> Result<Settings, String> {
    let parsed: Settings = serde_json::from_str(raw)
        .map_err(|e| format!("fichier de configuration invalide : {e}"))?;
    save(app, &parsed)?;
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::Script;
    use serde_json::json;

    /// Entree minimale pour les tests de regroupement : seuls `id` et
    /// `category` comptent, le reste n'est jamais lu par `group_scripts`.
    fn script_entry(id: &str, category: &str) -> ScriptEntry {
        ScriptEntry {
            id: id.to_string(),
            path: format!("{id}.ps1"),
            abs_path: format!("{id}.ps1"),
            origin: "user",
            source: None,
            verified: false,
            hash: "0".repeat(64),
            declared_id: true,
            attention: Vec::new(),
            meta: Script {
                id: id.to_string(),
                lang: "fr".to_string(),
                title: id.to_string(),
                desc: String::new(),
                category: category.to_string(),
                icon: "wrench".to_string(),
                tags: Vec::new(),
                version: "1.0".to_string(),
                admin: false,
                risk: "low".to_string(),
                duration: "fast".to_string(),
                reversible: true,
                interruptible: true,
                reboot: false,
                engine: "auto".to_string(),
                options: Vec::new(),
                translations: BTreeMap::new(),
                findings: Vec::new(),
            },
        }
    }

    const JSON_USINE: &str = r#"[
        { "id": "cleaning", "id_fr": "nettoyage", "name_fr": "Faire le ménage", "name_en": "Cleaning", "icon": "broom" },
        { "id": "tools", "id_fr": "outillage", "name_fr": "Outillage", "name_en": "Tools", "icon": "wrench" }
    ]"#;

    fn reglages_nus() -> Settings {
        default_settings(factory_categories_from_json(JSON_USINE).unwrap())
    }

    /// Ou se retrouve un script, categorie par categorie.
    fn rangement(g: &GroupedScripts, id: &str) -> Vec<String> {
        g.categories
            .iter()
            .filter(|c| c.scripts.iter().any(|s| s.id == id))
            .map(|c| c.category.id.clone())
            .collect()
    }

    // ----- Appartenance multiple (§4.1) ------------------------------------

    #[test]
    fn un_script_peut_figurer_dans_plusieurs_categories() {
        let mut r = reglages_nus();
        let s = script_entry("nettoie", "cleaning");

        // Suggestion d'entete : une seule categorie au depart.
        assert_eq!(
            rangement(&group_scripts(&r, vec![s.clone()]), "nettoie"),
            vec!["cleaning", "maintenance"]
        );

        // On le coche AUSSI dans Outillage : l'ancienne appartenance reste.
        set_script_category_membership(&mut r, "nettoie", "cleaning", "tools", true);
        let mut ou = rangement(&group_scripts(&r, vec![s.clone()]), "nettoie");
        ou.retain(|c| c != "maintenance");
        ou.sort();
        assert_eq!(
            ou,
            vec!["cleaning", "tools"],
            "l'ajout a efface l'appartenance d'origine"
        );
    }

    #[test]
    fn l_agregat_ne_compte_un_script_qu_une_fois() {
        let mut r = reglages_nus();
        let s = script_entry("nettoie", "cleaning");
        set_script_category_membership(&mut r, "nettoie", "cleaning", "tools", true);

        let g = group_scripts(&r, vec![s]);
        let agregat = g
            .categories
            .iter()
            .find(|c| c.category.aggregate)
            .expect("agregat");
        // Sans deduplication, « Entretien complet » l'executerait deux fois.
        assert_eq!(
            agregat.scripts.iter().filter(|s| s.id == "nettoie").count(),
            1
        );
    }

    #[test]
    fn retirer_de_partout_ne_le_fait_pas_reclasser_par_la_suggestion() {
        let mut r = reglages_nus();
        let s = script_entry("nettoie", "cleaning");
        set_script_category_membership(&mut r, "nettoie", "cleaning", "cleaning", false);

        let g = group_scripts(&r, vec![s]);
        assert!(
            rangement(&g, "nettoie").is_empty(),
            "il est revenu dans une categorie"
        );
        assert_eq!(g.unclassified.len(), 1, "il aurait du passer en Non classe");
        // C'est la distinction entre None et Some(vide) : sans elle, la
        // suggestion `category: cleaning` l'y remettrait aussitot.
        assert_eq!(r.overrides["nettoie"].categories, Some(Vec::new()));
    }

    #[test]
    fn un_rangement_ecrit_par_une_version_anterieure_est_conserve() {
        let mut r = reglages_nus();
        // settings.json d'avant l'appartenance multiple : un seul champ.
        r.overrides.insert(
            "nettoie".to_string(),
            ScriptOverride {
                category_locked: Some("tools".to_string()),
                ..Default::default()
            },
        );
        let g = group_scripts(&r, vec![script_entry("nettoie", "cleaning")]);
        // L'ordre suit `settings.categories`, pas l'ordre d'ecriture : on
        // compare l'ensemble, pas la sequence.
        let mut ou = rangement(&g, "nettoie");
        ou.sort();
        assert_eq!(ou, vec!["maintenance", "tools"]);
    }

    #[test]
    fn une_appartenance_vers_une_categorie_supprimee_est_ignoree() {
        let mut r = reglages_nus();
        set_script_category_membership(&mut r, "nettoie", "cleaning", "tools", true);
        // L'utilisateur supprime Outillage ensuite.
        r.categories.retain(|c| c.id != "tools");

        let g = group_scripts(&r, vec![script_entry("nettoie", "cleaning")]);
        let ou = rangement(&g, "nettoie");
        assert!(
            !ou.iter().any(|c| c == "tools"),
            "appartenance fantome conservee"
        );
        assert!(
            ou.iter().any(|c| c == "cleaning"),
            "l'autre appartenance a ete perdue"
        );
    }

    #[test]
    fn une_valeur_figee_se_relit_et_seul_none_la_rend_au_script() {
        let mut s = reglages_nus();
        set_config_value(&mut s, "abc", "SleepOnAC_Min", Some(json!(0)));
        assert_eq!(s.overrides["abc"].config["SleepOnAC_Min"], json!(0));

        // Le cas qui compte : effacer, ce n'est pas ecrire `null`. Une cle
        // absente veut dire « suit le script » (§4.2) ; si l'effacement
        // laissait `null`, la valeur resterait figee sur rien.
        set_config_value(&mut s, "abc", "SleepOnAC_Min", None);
        assert!(!s.overrides.contains_key("abc"));
    }

    #[test]
    fn les_booleens_wintool_se_posent_et_se_relachent_separement() {
        let mut s = reglages_nus();
        set_flag(&mut s, "abc", FLAG_RESTORE, Some(true)).unwrap();
        set_flag(&mut s, "abc", FLAG_REBOOT, Some(false)).unwrap();
        assert_eq!(s.overrides["abc"].reversible_ack, Some(true));
        assert_eq!(s.overrides["abc"].reboot_ack, Some(false));

        set_flag(&mut s, "abc", FLAG_RESTORE, None).unwrap();
        assert_eq!(s.overrides["abc"].reversible_ack, None);
        assert_eq!(s.overrides["abc"].reboot_ack, Some(false));

        set_flag(&mut s, "abc", FLAG_ENABLED, Some(false)).unwrap();
        assert_eq!(s.overrides["abc"].enabled, Some(false));

        assert!(set_flag(&mut s, "abc", "autre_chose", Some(true)).is_err());
    }

    #[test]
    fn reinitialiser_les_options_ne_defait_pas_le_classement() {
        let mut s = reglages_nus();
        s.overrides.entry("abc".into()).or_default().category_locked = Some("tools".into());
        set_config_value(&mut s, "abc", "Cle", Some(json!("valeur")));
        set_flag(&mut s, "abc", FLAG_REBOOT, Some(true)).unwrap();

        reset_script_config(&mut s, "abc");

        let over = &s.overrides["abc"];
        assert!(over.config.is_empty());
        assert_eq!(over.reboot_ack, None);
        assert_eq!(over.category_locked.as_deref(), Some("tools"));
    }

    #[test]
    fn un_aller_retour_sur_un_interrupteur_ne_laisse_pas_de_trace() {
        let mut s = reglages_nus();
        set_flag(&mut s, "abc", FLAG_REBOOT, Some(true)).unwrap();
        set_flag(&mut s, "abc", FLAG_REBOOT, None).unwrap();
        assert!(
            s.overrides.is_empty(),
            "un override vide doit disparaitre de settings.json"
        );
    }

    #[test]
    fn parse_les_categories_usine_avec_leurs_deux_alias() {
        let cats = factory_categories_from_json(JSON_USINE).unwrap();
        assert_eq!(cats.len(), 2);
        assert_eq!(cats[0].factory_aliases, vec!["cleaning", "nettoyage"]);
        assert_eq!(cats[0].name["fr"], "Faire le ménage");
        assert_eq!(cats[0].name["en"], "Cleaning");
    }

    #[test]
    fn premier_lancement_ajoute_entretien_complet_epingle() {
        let cats = factory_categories_from_json(JSON_USINE).unwrap();
        let settings = default_settings(cats);
        let maintenance = settings
            .categories
            .iter()
            .find(|c| c.id == "maintenance")
            .expect("categorie maintenance absente");
        assert!(maintenance.pinned);
        assert_eq!(settings.categories.len(), 3);
    }

    #[test]
    fn resout_un_alias_francais_ou_anglais() {
        let cats = factory_categories_from_json(JSON_USINE).unwrap();
        let settings = default_settings(cats);
        assert_eq!(
            resolve_categories(&settings, "s1", "nettoyage"),
            vec!["cleaning"]
        );
        assert_eq!(
            resolve_categories(&settings, "s1", "CLEANING"),
            vec!["cleaning"]
        );
        // Une suggestion inconnue ne range nulle part : depuis l'appartenance
        // multiple, « Non classe » se lit a une liste VIDE, pas a un id special.
        assert!(resolve_categories(&settings, "s1", "bidon").is_empty());
    }

    #[test]
    fn un_classement_manuel_prime_toujours_sur_la_suggestion() {
        let cats = factory_categories_from_json(JSON_USINE).unwrap();
        let mut settings = default_settings(cats);
        settings.overrides.insert(
            "s1".to_string(),
            ScriptOverride {
                category_locked: Some("tools".to_string()),
                ..Default::default()
            },
        );
        // Le script suggere "cleaning" mais l'utilisateur l'a range dans "tools" :
        // ce rangement manuel l'emporte, quoi que dise `category:` par la suite.
        assert_eq!(
            resolve_categories(&settings, "s1", "cleaning"),
            vec!["tools"]
        );
    }

    #[test]
    fn charge_puis_recharge_a_l_identique() {
        let dir =
            std::env::temp_dir().join(format!("wintool-test-settings-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let _ = fs::remove_file(&path);

        let cats = factory_categories_from_json(JSON_USINE).unwrap();
        let charge = load_from(&path, cats.clone()).unwrap();
        assert!(
            path.exists(),
            "load_from doit ecrire les reglages par defaut"
        );

        let mut modifie = charge;
        modifie.lang = "en".to_string();
        // Les reglages par script (§4.2) font partie du voyage : une valeur
        // figee qui ne survit pas a un redemarrage n'est pas figee du tout.
        set_config_value(&mut modifie, "abc", "SleepOnAC_Min", Some(json!(0)));
        set_flag(&mut modifie, "abc", FLAG_RESTORE, Some(true)).unwrap();
        set_flag(&mut modifie, "abc", FLAG_ENABLED, Some(false)).unwrap();
        save_to(&path, &modifie).unwrap();

        let recharge = load_from(&path, cats).unwrap();
        assert_eq!(recharge.lang, "en");
        let over = &recharge.overrides["abc"];
        assert_eq!(over.config["SleepOnAC_Min"], json!(0));
        assert_eq!(over.reversible_ack, Some(true));
        assert_eq!(over.enabled, Some(false));
        assert_eq!(
            over.reboot_ack, None,
            "un reglage jamais touche reste au script"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_settings_json_corrompu_ne_bloque_pas_le_lancement() {
        let dir =
            std::env::temp_dir().join(format!("wintool-test-corrompu-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        fs::write(&path, "{ pas du json valide").unwrap();

        let cats = factory_categories_from_json(JSON_USINE).unwrap();
        let settings = load_from(&path, cats).expect("doit repartir de zero, pas planter");
        assert_eq!(settings.lang, "fr");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn regroupe_par_categorie_et_isole_le_non_classe() {
        let cats = factory_categories_from_json(JSON_USINE).unwrap();
        let settings = default_settings(cats);
        let scripts = vec![
            script_entry("s1", "cleaning"),
            script_entry("s2", "nettoyage"),
            script_entry("s3", "bidon"),
        ];
        let groupes = group_scripts(&settings, scripts);

        let nettoyage = groupes
            .categories
            .iter()
            .find(|g| g.category.id == "cleaning")
            .unwrap();
        assert_eq!(
            nettoyage
                .scripts
                .iter()
                .map(|s| s.id.as_str())
                .collect::<Vec<_>>(),
            vec!["s1", "s2"]
        );
        assert_eq!(groupes.unclassified.len(), 1);
        assert_eq!(groupes.unclassified[0].id, "s3");
    }

    #[test]
    fn entretien_complet_rassemble_dynamiquement_tout_ce_qui_est_classe() {
        let cats = factory_categories_from_json(JSON_USINE).unwrap();
        let settings = default_settings(cats);
        let scripts = vec![
            script_entry("s1", "cleaning"),
            script_entry("s2", "outillage"),
            script_entry("s3", "bidon"), // non classe : ne doit pas apparaitre
        ];
        let groupes = group_scripts(&settings, scripts);

        let entretien = groupes
            .categories
            .iter()
            .find(|g| g.category.id == "maintenance")
            .expect("categorie maintenance absente");
        assert!(entretien.category.pinned);
        assert_eq!(
            entretien
                .scripts
                .iter()
                .map(|s| s.id.as_str())
                .collect::<Vec<_>>(),
            vec!["s1", "s2"]
        );
        assert!(entretien.missing.is_empty());
    }

    #[test]
    fn respecte_l_ordre_manuel_et_signale_les_manquants() {
        let cats = factory_categories_from_json(JSON_USINE).unwrap();
        let mut settings = default_settings(cats);
        settings
            .categories
            .iter_mut()
            .find(|c| c.id == "cleaning")
            .unwrap()
            .scripts = vec!["s2".to_string(), "s1".to_string(), "s-disparu".to_string()];

        let scripts = vec![
            script_entry("s1", "cleaning"),
            script_entry("s2", "cleaning"),
        ];
        let groupes = group_scripts(&settings, scripts);

        let nettoyage = groupes
            .categories
            .iter()
            .find(|g| g.category.id == "cleaning")
            .unwrap();
        // L'ordre manuel (s2 puis s1) l'emporte sur l'ordre de decouverte.
        assert_eq!(
            nettoyage
                .scripts
                .iter()
                .map(|s| s.id.as_str())
                .collect::<Vec<_>>(),
            vec!["s2", "s1"]
        );
        assert_eq!(nettoyage.missing, vec!["s-disparu".to_string()]);
    }
}
