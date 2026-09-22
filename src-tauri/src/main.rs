// Empeche l'ouverture d'une console noire derriere la fenetre en release. NE PAS RETIRER.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    wintool_lib::run()
}
