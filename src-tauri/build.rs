fn main() {
    // Le manifeste embarque requireAdministrator : une seule invite UAC au lancement,
    // et tous les scripts executes ensuite heritent des droits administrateur.
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));

    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("echec du script de build Tauri");
}
