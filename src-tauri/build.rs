fn main() {
    // Cle publique du catalogue officiel de scripts (specification §16.2) :
    // compilee dans le binaire, jamais lue sur le disque a l'execution — tout
    // ce qui est inscriptible sans elevation est remplacable. Le fichier est
    // ecrit par tools/generer-cle-signature.ps1 -Cible catalogue.
    //
    // Absent, la constante est vide et le catalogue refuse tout plutot que de
    // faire confiance a quoi que ce soit : c'est le cas d'un fork qui n'a pas
    // encore genere sa propre cle. Une release, elle, refuse de se construire
    // sans (release.yml).
    println!("cargo:rerun-if-changed=catalogue.pub");
    let cle = std::fs::read_to_string("catalogue.pub")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=WINTOOL_CATALOGUE_PUB={cle}");

    // Le manifeste embarque requireAdministrator : une seule invite UAC au lancement,
    // et tous les scripts executes ensuite heritent des droits administrateur.
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));

    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("echec du script de build Tauri");
}
