# Mentions relatives aux composants tiers — WinTool 1.0.0

Document établi le 26 septembre 2026 pour WinTool 1.0.0, à partir de l'état réel du dépôt
à cette date (`src-tauri/Cargo.lock`, `package-lock.json`, `src/icons/`, `src/fonts/`).

**Version 2.** Elle remplace la version précédente sur trois points : le texte intégral de
la licence ISC y figure (avec la totalité du fichier `LICENSE` de Lucide, dont un volet
MIT qui manquait) ; le texte intégral de l'OFL-1.1 y figure, accompagné d'une analyse du
cas des noms réservés et des sous-ensembles ; et le choix de la branche MIT, jusque-là
sous-entendu, est désormais formulé comme une déclaration explicite et vérifiable, option
par option. Le texte intégral de l'Apache-2.0 a également été ajouté, parce qu'il est
obligatoire.

---

## Sommaire

1. [Pourquoi ce fichier existe](#1-pourquoi-ce-fichier-existe)
2. [Comment cette liste a été établie](#2-comment-cette-liste-a-été-établie)
3. [Déclaration de choix de licence (branche MIT)](#3-déclaration-de-choix-de-licence-branche-mit)
4. [Tauri et ses plugins](#4-tauri-et-ses-plugins)
5. [Bibliothèques Rust nommément traitées](#5-bibliothèques-rust-nommément-traitées)
6. [Arbre Rust complet, groupé par licence déclarée](#6-arbre-rust-complet-groupé-par-licence-déclarée)
7. [Icônes — Lucide](#7-icônes--lucide)
8. [Polices — Inter et IBM Plex Mono](#8-polices--inter-et-ibm-plex-mono)
9. [Composants sous MPL-2.0](#9-composants-sous-mpl-20)
10. [Microsoft Edge WebView2](#10-microsoft-edge-webview2)
11. [Textes intégraux des licences](#11-textes-intégraux-des-licences)
12. [À vérifier avant publication](#12-à-vérifier-avant-publication)
13. [Maintenance de ce fichier](#13-maintenance-de-ce-fichier)

---

## 1. Pourquoi ce fichier existe

WinTool est distribué sous une licence personnalisée, écrite pour ce projet. Mais WinTool
n'est pas fait que de code écrit pour WinTool : l'application s'appuie sur des
bibliothèques, des icônes et des polices écrites par d'autres, chacune avec sa propre
licence.

Ces licences — MIT, Apache-2.0, ISC, OFL, BSD, Zlib, Unicode, MPL — sont permissives :
elles autorisent expressément à redistribuer le composant à l'intérieur d'un logiciel
diffusé sous d'autres conditions, y compris une licence maison comme celle de WinTool.
C'est ce qui rend la licence de WinTool possible.

**En échange, toutes exigent une seule et même chose : que leurs mentions soient
conservées.** Le texte de la licence et l'avis de droit d'auteur doivent voyager avec le
logiciel, jusqu'à l'utilisateur final. Retirer ces mentions ferait perdre le droit de
redistribuer le composant — et donc de distribuer WinTool.

Ce fichier est cette conservation. Il n'accorde aucun droit sur WinTool lui-même : la
licence de WinTool reste le fichier `LICENSE`. Il ne fait que rendre à chaque composant
tiers la mention qui lui est due.

Trois précisions pour le lecteur :

- **Les licences ci-dessous s'appliquent aux composants tiers, pas à WinTool.** Le fait
  que WinTool intègre du code sous MIT ne rend pas WinTool disponible sous MIT.
- **Les scripts PowerShell ne sont pas concernés.** Ils ne font pas partie de WinTool et
  relèvent chacun de la licence choisie par leur auteur (voir `LICENSE` et
  `docs/FORMAT_SCRIPT.md`).
- **Aucune licence n'a été devinée.** Chaque mention provient du champ `license` déclaré
  par le composant lui-même, ou du fichier de licence livré avec lui. Ce dont je ne suis
  pas certain est rassemblé en section 12, « À vérifier », plutôt qu'affirmé.

---

## 2. Comment cette liste a été établie

| Périmètre | Méthode |
|---|---|
| Bibliothèques Rust | `cargo tree --offline --edges normal --target x86_64-pc-windows-msvc --prefix none --no-dedupe` (223 entrées, dont WinTool lui-même), croisé avec le champ `license` de `cargo metadata --offline --format-version 1` |
| Avis de droit d'auteur Rust | Fichiers `LICENSE*` présents dans les sources décompressées du registre, sous `~/.cargo/registry/src/` |
| Paquets npm | `package.json`, `package-lock.json`, et les fichiers `LICENSE` présents dans `node_modules` |
| Icônes | Fichiers réellement versionnés dans `src/icons/` (2 113 SVG) et sprite `src/icons.svg` |
| Polices | Table `name` des trois `.woff2` de `src/fonts/`, lue avec `fontTools` ; en-têtes `LICENSE.txt` des dépôts amont récupérés à la source |
| Runtime WebView2 | `src-tauri/tauri.conf.json` |

Le filtre `--target x86_64-pc-windows-msvc` importe : sans lui, `cargo metadata` retourne
aussi les dépendances Linux (`rustix`, `linux-raw-sys`, WASI) et macOS (famille `objc2`),
qui ne sont **pas** compilées dans le binaire Windows livré. Vérifié : aucune d'elles
n'apparaît dans l'arbre Windows. Elles sont volontairement absentes de ce document. Si
WinTool est un jour porté sur une autre plateforme, ce fichier devra être régénéré — et
l'arbre des autres plateformes introduit des expressions de licence absentes ici
(`Apache-2.0 WITH LLVM-exception`, `MIT OR Apache-2.0 OR LGPL-2.1-or-later`,
`Zlib OR Apache-2.0 OR MIT`), qu'il faudra traiter.

### Commandes de re-vérification

Les trois vérifications non triviales de ce document se rejouent ainsi :

```powershell
# 1. Arbre Windows et licences déclarées
cd src-tauri
cargo tree --offline --edges normal --target x86_64-pc-windows-msvc --prefix none --no-dedupe
cargo metadata --offline --format-version 1    # champ "license" de chaque paquet

# 2. Noms réellement inscrits dans les fichiers de police livrés
python -m pip install fonttools brotli
python -c "from fontTools.ttLib import TTFont; t=TTFont('src/fonts/ibm-plex-mono-latin-400-normal.woff2'); [print(r.nameID, r.toUnicode()) for r in t['name'].names]"

# 3. En-têtes de licence amont des deux polices
curl -L https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt
curl -L https://raw.githubusercontent.com/IBM/plex/master/LICENSE.txt
```

---

## 3. Déclaration de choix de licence (branche MIT)

La majorité des composants tiers de WinTool ne sont pas sous une licence unique : ils sont
proposés **au choix** sous plusieurs licences, avec l'opérateur SPDX `OR` (ou, dans les
notations antérieures à SPDX, une simple barre oblique `/`). Ce `OR` est une option offerte
au redistributeur, pas un cumul : il faut en choisir une, et c'est celle-là seule qui
s'applique ensuite.

Une option qui n'est pas exprimée n'est pas exercée. La déclaration qui suit remplace donc
toute lecture implicite.

### Déclaration

> **Pour chaque composant tiers dont la licence déclarée offre un choix entre plusieurs
> licences, WinTool exerce l'option **MIT** et redistribue ce composant sous les seules
> conditions de la licence MIT.**
>
> Lorsque MIT ne figure pas parmi les options offertes, l'option retenue est nommée
> expressément dans le tableau ci-dessous.
>
> Lorsque la licence déclarée n'offre aucun choix — licence unique, ou plusieurs licences
> cumulatives reliées par `AND` — aucune option n'est exercée : toutes les conditions
> déclarées s'appliquent.
>
> Ce choix vaut pour la version 1.0.0 de WinTool et pour toutes les versions ultérieures
> tant que ce document n'énonce pas le contraire. Il est irrévocable pour les copies déjà
> distribuées : un destinataire qui a reçu un composant sous MIT le conserve sous MIT.

### Toutes les expressions de licence présentes dans l'arbre Windows, et l'option exercée

Les 222 bibliothèques tierces de l'arbre Windows se répartissent exactement ainsi. Le
tableau est exhaustif : la somme de la colonne « Nb » fait 222.

| Expression déclarée | Nb | Choix offert ? | **Option exercée par WinTool** |
|---|---:|---|---|
| `MIT OR Apache-2.0` | 112 | oui | **MIT** |
| `MIT` | 35 | non | MIT (seule licence) |
| `Apache-2.0 OR MIT` | 23 | oui | **MIT** |
| `Unicode-3.0` | 18 | non | Unicode-3.0 (seule licence) |
| `MIT/Apache-2.0` (notation ancienne) | 9 | oui | **MIT** |
| `MPL-2.0` | 5 | non | MPL-2.0 (seule licence) |
| `Unlicense OR MIT` | 4 | oui | **MIT** |
| `BSD-3-Clause` | 2 | non | BSD-3-Clause (seule licence) |
| `MIT OR Zlib OR Apache-2.0` | 2 | oui | **MIT** |
| `Unlicense/MIT` (notation ancienne) | 2 | oui | **MIT** |
| `0BSD OR MIT OR Apache-2.0` | 1 | oui | **MIT** |
| `Apache-2.0 / MIT` (notation ancienne) | 1 | oui | **MIT** |
| `MIT OR Apache-2.0 OR Zlib` | 1 | oui | **MIT** |
| `BSD-3-Clause/MIT` (notation ancienne) | 1 | oui | **MIT** |
| `CC0-1.0 OR MIT-0 OR Apache-2.0` | 1 | oui, mais **pas de MIT** | **MIT-0** |
| `(MIT OR Apache-2.0) AND Unicode-3.0` | 1 | partiel | **MIT** pour la parenthèse, **+ Unicode-3.0** cumulée |
| `Apache-2.0 AND MIT` | 1 | non, cumulatives | Apache-2.0 **et** MIT, les deux |
| `BSD-3-Clause AND MIT` | 1 | non, cumulatives | BSD-3-Clause **et** MIT, les deux |
| `Apache-2.0` | 1 | non | Apache-2.0 (seule licence) |
| `Zlib` | 1 | non | Zlib (seule licence) |
| **Total** | **222** | | |

Les composants concernés par les six dernières lignes sont nommés : `dunce` 1.0.5
(`CC0-1.0 OR MIT-0 OR Apache-2.0`), `unicode-ident` 1.0.26, `dpi` 0.1.2
(`Apache-2.0 AND MIT`), `brotli` 8.0.4 (`BSD-3-Clause AND MIT`), `tao` 0.35.3
(`Apache-2.0` seule), `foldhash` 0.2.0 (`Zlib` seule).

### Ce que ce choix change concrètement

Retenir MIT n'est pas cosmétique : cela réduit la surface d'obligations. MIT tient en un
paragraphe et n'impose rien d'autre que la conservation de l'avis de droit d'auteur et du
texte. L'Apache-2.0, elle, impose en plus deux choses que MIT ignore :

- **§4(b)** : signaler de façon apparente tout fichier modifié ;
- **§4(d)** : reprendre le contenu du fichier `NOTICE` du composant, s'il en existe un.

En exerçant MIT sur les 149 composants qui offrent ce choix face à l'Apache-2.0, ces deux
obligations ne s'attachent pas à eux.

### Conséquence : quels textes de licence doivent malgré tout accompagner WinTool

Une fois l'option MIT exercée partout où elle est offerte, voici exactement ce qui reste
dû. C'est la liste des textes reproduits en section 11.

| Licence | Rendue obligatoire par | Reproduite ici ? |
|---|---|---|
| MIT | 35 composants sous MIT seule, plus les 149 où MIT est l'option exercée, plus `dpi` et `brotli` (cumulatives) | oui, §11.1 |
| MIT-0 | `dunce` 1.0.5 | oui, §11.2 |
| ISC | `lucide-static` (icônes) | oui, §11.3 |
| OFL-1.1 | Inter, IBM Plex Mono | oui, §11.4 |
| Apache-2.0 | `tao` 0.35.3 (seule) et `dpi` 0.1.2 (cumulée avec MIT) | oui, §11.5 |
| BSD-3-Clause | `alloc-no-stdlib`, `alloc-stdlib`, `brotli` | oui, §11.6 |
| Zlib | `foldhash` 0.2.0 | oui, §11.7 |
| Unicode-3.0 | les 18 composants ICU4X, plus `unicode-ident` | oui, §11.8 |
| MPL-2.0 | `option-ext`, `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short` | **non** — voir §11.9, seule exception, motivée |

**Et, symétriquement, les textes qui ne sont *pas* dus, précisément parce que l'option MIT
a été exercée :** `Unlicense` (6 composants), `0BSD` (`adler2`), `CC0-1.0` (`dunce`).
`Zlib` n'est dû que pour `foldhash`, qui n'offre aucun choix — l'option Zlib de
`miniz_oxide` et de `raw-window-handle` n'est pas exercée. `Apache-2.0` n'est dû que pour
`tao` et `dpi`, jamais pour les 149 autres.

---

## 4. Tauri et ses plugins

Tauri fournit le cadre applicatif : fenêtre, pont entre le Rust et la page web,
empaquetage. Tout le groupe est publié par Tauri Programme within The Commons
Conservancy sous double licence `Apache-2.0 OR MIT`.

**Option exercée : MIT** (section 3).

| Composant | Version | Licence déclarée | Option exercée |
|---|---|---|---|
| `tauri` | 2.11.6 | Apache-2.0 OR MIT | **MIT** |
| `tauri-plugin-opener` | 2.5.5 | Apache-2.0 OR MIT | **MIT** |
| `tauri-runtime` | 2.11.3 | Apache-2.0 OR MIT | **MIT** |
| `tauri-runtime-wry` | 2.11.4 | Apache-2.0 OR MIT | **MIT** |
| `tauri-utils` | 2.9.3 | Apache-2.0 OR MIT | **MIT** |
| `tauri-macros` | 2.6.3 | Apache-2.0 OR MIT | **MIT** |
| `tauri-codegen` | 2.6.3 | Apache-2.0 OR MIT | **MIT** |
| `wry` | 0.55.1 | Apache-2.0 OR MIT | **MIT** |
| `@tauri-apps/api` (npm) | 2.11.1 | Apache-2.0 OR MIT | **MIT** |
| `@tauri-apps/cli` (npm) | 2.11.5 | Apache-2.0 OR MIT | **MIT** |

Source : <https://github.com/tauri-apps/tauri>

Deux composants de cette famille font exception et **n'offrent aucun choix** :

| Composant | Version | Licence déclarée | Conséquence |
|---|---|---|---|
| `tao` | 0.35.3 | **Apache-2.0 seule** | Le texte complet de l'Apache-2.0 doit accompagner WinTool |
| `dpi` | 0.1.2 | **Apache-2.0 AND MIT** (cumulatives) | Les deux textes sont dus, on ne peut pas choisir |

C'est la raison — la seule — pour laquelle le texte de l'Apache-2.0 reste nécessaire alors
que MIT est retenue partout où le choix existe. Il est reproduit en §11.5.

Le cas de `dpi` mérite une ligne d'explication, car un `AND` est inhabituel : le paquet est
sous Apache-2.0, mais il incorpore du code repris de `rust-lang/libm`, sous MIT. Ses
sources livrent donc deux fichiers, `LICENSE` (Apache-2.0) et `LICENSE-LIBM-MIT` (MIT,
avec les avis de musl libc, Sun Microsystems, David Schultz, Steven G. Kargl,
Bruce D. Evans, Stephen L. Moshier, Arm Limited et Rich Felker qu'il reprend).

**Vérifié : ni `tao` 0.35.3 ni `dpi` 0.1.2 ne livrent de fichier `NOTICE`.** L'obligation
§4(d) de l'Apache-2.0 est donc sans objet pour WinTool. De même, WinTool ne modifie aucun
fichier de ces deux paquets : §4(b) est sans objet également. Ne restent que §4(a)
— joindre une copie de la licence, ce que fait §11.5 — et §4(c), la conservation des avis.

Notes sur les deux paquets npm :

- `@tauri-apps/cli` est un outil de compilation. Il ne se retrouve pas dans l'application
  livrée. Il est mentionné par transparence, pas par obligation.
- `@tauri-apps/api` est déclaré en dépendance, mais l'interface ne l'importe pas :
  `src/main.js` passe par l'objet global `window.__TAURI__` injecté par le Rust
  (`withGlobalTauri: true` dans `tauri.conf.json`, vérifié). Le code JavaScript de ce
  paquet n'est donc vraisemblablement pas redistribué. Il est mentionné quand même — une
  mention en trop ne coûte rien.

---

## 5. Bibliothèques Rust nommément traitées

| Composant | Version | Licence déclarée | Option exercée | Rôle dans WinTool |
|---|---|---|---|---|
| `serde` | 1.0.229 | MIT OR Apache-2.0 | **MIT** | Sérialisation des structures échangées avec l'interface |
| `serde_derive` | 1.0.229 | MIT OR Apache-2.0 | **MIT** | Macros dérivées de `serde` |
| `serde_core` | 1.0.229 | MIT OR Apache-2.0 | **MIT** | Noyau de `serde` |
| `serde_json` | 1.0.151 | MIT OR Apache-2.0 | **MIT** | Lecture et écriture des fichiers de configuration et d'historique |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 | **MIT** | Empreinte SHA-256 du contenu des scripts (approbation avant exécution) |
| `chrono` | 0.4.45 | MIT OR Apache-2.0 | **MIT** | Horodatage local des journaux d'exécution |

- `serde`, `serde_json` : <https://github.com/serde-rs/serde> et <https://github.com/serde-rs/json>
- `sha2` : projet RustCrypto, <https://github.com/RustCrypto/hashes>
- `chrono` : <https://github.com/chronotope/chrono>

---

## 6. Arbre Rust complet, groupé par licence déclarée

222 bibliothèques tierces, hors WinTool lui-même. Une même bibliothèque peut apparaître
en deux versions : c'est normal, Cargo les compile alors séparément et les deux sont
présentes dans le binaire.

Les expressions telles que `MIT/Apache-2.0` ou `Apache-2.0 / MIT` sont d'anciennes
notations, antérieures à la normalisation SPDX. Elles signifient « OR » (au choix), pas
« AND ». L'option exercée sur chacune est celle du tableau de la section 3.

### MIT OR Apache-2.0 — 112 composants — **option exercée : MIT**

`anyhow` 1.0.104 · `base64` 0.22.1 · `base64` 0.23.1 · `bitflags` 2.13.2 ·
`block-buffer` 0.10.4 · `camino` 1.2.6 · `cargo-platform` 0.1.9 · `cfg-if` 1.0.5 ·
`chrono` 0.4.45 · `cookie` 0.18.2 · `cpufeatures` 0.2.17 · `crc32fast` 1.5.2 ·
`crossbeam-channel` 0.5.17 · `crossbeam-utils` 0.8.23 · `crypto-common` 0.1.7 ·
`deranged` 0.5.8 · `digest` 0.10.7 · `dirs` 6.0.0 · `dirs-sys` 0.5.0 ·
`displaydoc` 0.2.7 · `dtoa` 1.0.11 · `dyn-clone` 1.0.20 · `erased-serde` 0.4.10 ·
`fdeflate` 0.3.7 · `flate2` 1.1.10 · `form_urlencoded` 1.2.2 · `getrandom` 0.3.4 ·
`getrandom` 0.4.3 · `glob` 0.3.4 · `hashbrown` 0.12.3 · `hashbrown` 0.17.1 ·
`heck` 0.5.0 · `html5ever` 0.38.0 · `http` 1.5.0 · `idna` 1.1.0 · `itoa` 1.0.18 ·
`jsonptr` 0.6.3 · `keyboard-types` 0.7.0 · `libc` 0.2.189 · `lock_api` 0.4.14 ·
`log` 0.4.34 · `markup5ever` 0.38.0 · `mime` 0.3.17 · `num-conv` 0.2.2 ·
`num-traits` 0.2.19 · `once_cell` 1.21.4 · `parking_lot` 0.12.5 ·
`parking_lot_core` 0.9.12 · `percent-encoding` 2.3.2 · `png` 0.17.16 ·
`powerfmt` 0.2.0 · `proc-macro2` 1.0.107 · `quote` 1.0.47 · `regex` 1.13.1 ·
`regex-automata` 0.4.18 · `regex-syntax` 0.8.11 · `scopeguard` 1.2.0 · `semver` 1.0.28 ·
`serde` 1.0.229 · `serde-untagged` 0.1.9 · `serde_core` 1.0.229 ·
`serde_derive` 1.0.229 · `serde_derive_internals` 0.29.1 · `serde_json` 1.0.151 ·
`serde_repr` 0.1.21 · `serde_spanned` 1.1.1 · `serde_with` 3.23.0 ·
`serde_with_macros` 3.23.0 · `serialize-to-javascript` 0.1.2 ·
`serialize-to-javascript-impl` 0.1.2 · `servo_arc` 0.4.3 · `sha2` 0.10.9 ·
`smallvec` 1.16.1 · `softbuffer` 0.4.8 · `stable_deref_trait` 1.2.1 ·
`string_cache` 0.9.0 · `syn` 2.0.119 · `syn` 3.0.6 · `tendril` 0.5.1 ·
`thiserror` 1.0.69 · `thiserror` 2.0.20 · `thiserror-impl` 1.0.69 ·
`thiserror-impl` 2.0.20 · `time` 0.3.55 · `time-core` 0.1.9 · `time-macros` 0.2.32 ·
`toml` 1.1.6 · `toml_datetime` 1.1.1 · `toml_parser` 1.1.3 · `toml_writer` 1.1.2 ·
`typeid` 1.0.3 · `typenum` 1.20.1 · `unicode-segmentation` 1.13.3 · `url` 2.5.8 ·
`web_atoms` 0.2.6 · `windows` 0.61.3 · `windows-collections` 0.2.0 ·
`windows-core` 0.61.2 · `windows-future` 0.2.1 · `windows-implement` 0.60.2 ·
`windows-interface` 0.59.3 · `windows-link` 0.1.3 · `windows-link` 0.2.1 ·
`windows-numerics` 0.2.0 · `windows-result` 0.3.4 · `windows-strings` 0.4.2 ·
`windows-sys` 0.59.0 · `windows-sys` 0.61.2 · `windows-targets` 0.52.6 ·
`windows-threading` 0.1.0 · `windows-version` 0.1.7 · `windows_x86_64_msvc` 0.52.6

### Apache-2.0 OR MIT — 23 composants — **option exercée : MIT**

`bit-set` 0.8.0 · `bit-vec` 0.8.0 · `ctor` 0.8.0 · `ctor-proc-macro` 0.0.7 ·
`equivalent` 1.0.2 · `fastrand` 2.5.0 · `idna_adapter` 1.2.2 · `indexmap` 1.9.3 ·
`indexmap` 2.14.2 · `muda` 0.19.3 · `pin-project-lite` 0.2.17 · `rustc-hash` 2.1.3 ·
`tauri` 2.11.6 · `tauri-codegen` 2.6.3 · `tauri-macros` 2.6.3 ·
`tauri-plugin-opener` 2.5.5 · `tauri-runtime` 2.11.3 · `tauri-runtime-wry` 2.11.4 ·
`tauri-utils` 2.9.3 · `utf8_iter` 1.0.4 · `uuid` 1.26.1 · `window-vibrancy` 0.6.0 ·
`wry` 0.55.1

### MIT/Apache-2.0 et Apache-2.0 / MIT (notations anciennes, équivalentes à « OR ») — 10 composants — **option exercée : MIT**

`bitflags` 1.3.2 · `fnv` 1.0.7 · `ident_case` 1.0.1 · `json-patch` 3.0.1 ·
`siphasher` 1.0.3 · `unic-char-property` 0.9.0 · `unic-char-range` 0.9.0 ·
`unic-common` 0.9.0 · `unic-ucd-ident` 0.9.0 · `unic-ucd-version` 0.9.0

### MIT seule — 35 composants — aucun choix

`bytes` 1.12.1 · `cargo_metadata` 0.19.2 · `cfb` 0.7.3 · `darling` 0.24.1 ·
`darling_core` 0.24.1 · `darling_macro` 0.24.1 · `derive_more` 2.1.1 ·
`derive_more-impl` 2.1.1 · `dom_query` 0.27.0 · `generic-array` 0.14.7 · `ico` 0.5.0 ·
`infer` 0.19.0 · `new_debug_unreachable` 1.0.6 · `open` 5.4.4 · `phf` 0.13.1 ·
`phf_generator` 0.13.1 · `phf_macros` 0.13.1 · `phf_shared` 0.13.1 · `plist` 1.10.1 ·
`precomputed-hash` 0.1.1 · `quick-xml` 0.42.0 · `schemars` 0.8.22 ·
`schemars_derive` 0.8.22 · `simd-adler32` 0.3.10 · `strsim` 0.11.1 ·
`synstructure` 0.14.0 · `tokio` 1.53.1 · `tracing` 0.1.44 · `tracing-core` 0.1.36 ·
`urlpattern` 0.3.0 · `webview2-com` 0.38.2 · `webview2-com-macros` 0.8.1 ·
`webview2-com-sys` 0.38.2 · `winnow` 1.0.4 · `zmij` 1.0.23

### Unicode-3.0 — 18 composants — aucun choix

Composants du projet ICU4X, publiés sous la licence Unicode v3. Le texte de cette licence
doit être conservé ; il est reproduit en §11.8.

`icu_collections` 2.3.0 · `icu_locale_core` 2.3.0 · `icu_normalizer` 2.3.0 ·
`icu_normalizer_data` 2.3.0 · `icu_properties` 2.3.0 · `icu_properties_data` 2.3.0 ·
`icu_provider` 2.3.1 · `litemap` 0.8.3 · `potential_utf` 0.1.6 · `tinystr` 0.8.4 ·
`writeable` 0.6.4 · `yoke` 0.8.3 · `yoke-derive` 0.8.3 · `zerofrom` 0.1.8 ·
`zerofrom-derive` 0.1.8 · `zerotrie` 0.2.5 · `zerovec` 0.11.8 · `zerovec-derive` 0.11.6

S'y ajoute `unicode-ident` 1.0.26, déclaré `(MIT OR Apache-2.0) AND Unicode-3.0` :
l'option **MIT** est exercée pour la parenthèse, et la licence Unicode-3.0 s'applique
**en plus**, de façon cumulative. Le `AND` ne se choisit pas.

### MPL-2.0 — 5 composants — aucun choix

**Voir la section 9, qui traite ce cas à part.**

`cssparser` 0.36.0 · `cssparser-macros` 0.6.1 · `dtoa-short` 0.3.5 ·
`option-ext` 0.2.0 · `selectors` 0.36.1

### Unlicense OR MIT et Unlicense/MIT — 6 composants — **option exercée : MIT**

Le texte de l'Unlicense n'est donc **pas** dû.

`aho-corasick` 1.1.5 · `byteorder` 1.5.0 · `memchr` 2.8.3 · `same-file` 1.0.6 ·
`walkdir` 2.5.0 · `winapi-util` 0.1.11

### BSD-3-Clause et variantes — 4 composants

| Composant | Version | Licence déclarée | Option exercée |
|---|---|---|---|
| `alloc-no-stdlib` | 2.0.4 | BSD-3-Clause seule | aucun choix — BSD-3-Clause |
| `alloc-stdlib` | 0.2.4 | BSD-3-Clause seule | aucun choix — BSD-3-Clause |
| `brotli` | 8.0.4 | **BSD-3-Clause AND MIT** | aucun choix — les deux s'appliquent |
| `brotli-decompressor` | 5.0.3 | BSD-3-Clause/MIT | **MIT** |

Le texte BSD-3-Clause reste dû à cause des trois premiers. Il est reproduit en §11.6.

### Zlib et variantes — 5 composants

| Composant | Version | Licence déclarée | Option exercée |
|---|---|---|---|
| `foldhash` | 0.2.0 | **Zlib seule** | aucun choix — Zlib |
| `miniz_oxide` | 0.8.9 et 0.9.1 | MIT OR Zlib OR Apache-2.0 | **MIT** |
| `raw-window-handle` | 0.6.2 | MIT OR Apache-2.0 OR Zlib | **MIT** |
| `adler2` | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | **MIT** |

Le texte Zlib est dû **uniquement** à cause de `foldhash`, qui n'offre aucune alternative.
Il est reproduit en §11.7. Le texte 0BSD n'est pas dû, l'option MIT ayant été exercée sur
`adler2`.

### Autres

`dunce` 1.0.5 — `CC0-1.0 OR MIT-0 OR Apache-2.0`. Aucune de ces options n'est la licence
MIT proprement dite. **WinTool exerce l'option MIT-0**, la plus proche et la moins
exigeante ; son texte est reproduit en §11.2. Les textes CC0-1.0 et Apache-2.0 ne sont pas
dus **de ce fait** (l'Apache-2.0 reste due par ailleurs, pour `tao` et `dpi`).

`tao` 0.35.3 (`Apache-2.0` seule) et `dpi` 0.1.2 (`Apache-2.0 AND MIT`) : déjà traités en
section 4.

---

## 7. Icônes — Lucide

WinTool embarque **2 113 fichiers SVG** dans `src/icons/`, copiés depuis le paquet npm
`lucide-static` par `tools/sync-icons.mjs`, plus un sprite `src/icons.svg` assemblé à
partir des mêmes fichiers. Ces icônes sont redistribuées telles quelles dans
l'application.

| | |
|---|---|
| Composant | `lucide-static` 1.47.0 |
| Licence | **ISC**, plus un volet **MIT** pour une partie des icônes (voir ci-dessous) |
| Avis de droit d'auteur | `Copyright (c) 2026 Lucide Icons and Contributors` |
| Source | <https://github.com/lucide-icons/lucide> |

### Le fichier `LICENSE` de Lucide comporte deux volets, pas un

C'est un point qui avait été manqué dans la version précédente de ce document. Le fichier
`LICENSE` de `lucide-static` contient :

1. la licence **ISC** et son avis de droit d'auteur, qui couvre le jeu d'icônes Lucide ;
2. puis, séparément, la liste nominative de **115 icônes dérivées du projet Feather**, et
   la licence **MIT** de Cole Bemis qui leur est propre.

**Vérifié : les 115 icônes de cette liste sont toutes présentes dans `src/icons/`.** Le
volet MIT n'est donc pas théorique : il s'applique à des fichiers réellement redistribués
par WinTool, et son avis de droit d'auteur doit être conservé au même titre que celui de
Lucide.

Correction par rapport à la version précédente de ce document, qui indiquait
« Copyright (c) 2013-2023 Cole Bemis » : l'avis exact, tel qu'il figure dans le fichier
livré, est **`Copyright (c) 2013-present Cole Bemis`**.

Le fichier `LICENSE` de Lucide est reproduit **intégralement et sans coupure** en §11.3 :
c'est la seule façon de conserver à la fois le texte ISC, la liste des 115 icônes
concernées et le texte MIT qui s'y attache.

---

## 8. Polices — Inter et IBM Plex Mono

WinTool embarque trois fichiers de polices dans `src/fonts/`, chargés par `src/styles.css`
via `@font-face` et servis localement. Vérifié dans `tauri.conf.json` : la politique CSP
de l'application n'autorise que `font-src 'self'` — aucune requête réseau n'est faite pour
les polices, elles sont bien redistribuées dans le paquet d'installation.

| Fichier | Police | Licence |
|---|---|---|
| `inter-latin-wght-normal.woff2` | Inter (variable, sous-ensemble latin) | **OFL-1.1** |
| `ibm-plex-mono-latin-400-normal.woff2` | IBM Plex Mono Regular (sous-ensemble latin) | **OFL-1.1** |
| `ibm-plex-mono-latin-500-normal.woff2` | IBM Plex Mono Medium (sous-ensemble latin) | **OFL-1.1** |

- Inter — Rasmus Andersson, <https://github.com/rsms/inter>
- IBM Plex — IBM Corp., <https://github.com/IBM/plex>

Le texte intégral de l'OFL-1.1 est reproduit en §11.4.

### 8.1 Ce que contiennent réellement les fichiers livrés

Table `name` des trois `.woff2`, lue avec `fontTools` (et non supposée) :

| Fichier | `name` 1 — famille | `name` 0 — copyright | `name` 6 — PostScript | Version | Glyphes | Points de code |
|---|---|---|---|---|---:|---:|
| `inter-latin-wght-normal.woff2` | `Inter` | `Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)` | `Inter-Regular` | 4.001 | 518 | 230 |
| `ibm-plex-mono-latin-400-normal.woff2` | `IBM Plex Mono` | `Copyright 2017 IBM Corp. All rights reserved.` | `IBMPlexMono-Regular` | 2.3 | 280 | 229 |
| `ibm-plex-mono-latin-500-normal.woff2` | `IBM Plex Mono Medium` | `Copyright 2017 IBM Corp. All rights reserved.` | `IBMPlexMono-Medium` | 2.3 | 280 | 229 |

Deux observations tirées de cette lecture :

- **Aucun des trois fichiers ne contient l'enregistrement `name` 13** (« license
  description »), celui qui sert à loger le texte de la licence dans les métadonnées. Seul
  `name` 14 est présent, et il ne contient qu'une URL
  (`https://openfontlicense.org` pour Inter, `http://scripts.sil.org/OFL` pour Plex).
  La condition 2 de l'OFL exige que chaque copie contienne « the above copyright notice
  **and this license** ». L'avis de droit d'auteur est bien là, dans `name` 0 ; le texte
  de la licence, non — et une URL n'est pas le texte. **Il faut donc joindre des fichiers
  texte autonomes**, ce que la condition 2 autorise expressément
  (« as stand-alone text files »).
- Côté CSS, `src/styles.css` déclare `font-family: 'Inter'` et, deux fois,
  `font-family: 'IBM Plex Mono'`. Ce sont les noms effectivement présentés au logiciel, et
  à travers lui à l'utilisateur.

### 8.2 Les noms réservés : réponse, police par police

L'OFL définit ainsi la notion : « "Reserved Font Name" refers to any names specified as
such after the copyright statement(s). » Il faut donc regarder l'en-tête du fichier de
licence de chaque police amont. Je les ai récupérés à la source.

**Inter — aucun nom réservé.** L'en-tête de `LICENSE.txt` du dépôt `rsms/inter` se réduit
à :

```
Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
```

Aucune mention « with Reserved Font Name ». La condition 3 de l'OFL est donc **sans objet**
pour Inter : le sous-ensemble livré peut conserver le nom « Inter », et aucun renommage
n'est requis. Restent dues les conditions 1, 2, 4 et 5, traitées en 8.4.

**IBM Plex — nom réservé « Plex ».** L'en-tête de `LICENSE.txt` du dépôt `IBM/plex` est,
mot pour mot :

```
Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"
```

Le nom « Plex » est donc un Reserved Font Name au sens de l'OFL, et c'est ce cas qui
demande une analyse.

### 8.3 Le sous-ensemble d'IBM Plex Mono doit-il être renommé ?

**Réponse : oui, en lecture stricte de l'OFL-1.1 — sauf si une permission écrite d'IBM
existe, ce que je n'ai pas pu vérifier. Le détail du raisonnement suit, pour que la
conclusion puisse être contestée sur pièces plutôt que crue.**

Le raisonnement tient en trois pas, tous tirés du texte de la licence lui-même (reproduit
en §11.4), pas d'une interprétation.

**Pas 1 — les fichiers livrés sont-ils une « Modified Version » ?** La définition de l'OFL
est large :

> « "Modified Version" refers to any derivative made by adding to, deleting, or
> substituting -- in part or in whole -- any of the components of the Original Version,
> **by changing formats** or by porting the Font Software to a new environment. »

Deux motifs s'appliquent ici, et un seul suffirait :

- *suppression de composants* : les fichiers livrés couvrent 229 points de code, un
  sous-ensemble latin. Le nom de fichier l'annonce d'ailleurs lui-même (`...-latin-...`).
- *changement de format* : IBM publie ses sources en OTF/TTF. Un `.woff2` produit à partir
  de celles-ci est, littéralement, « changing formats ».

Le second motif est le plus solide, car il ne dépend d'aucune appréciation : **la seule
façon d'y échapper serait que le fichier livré soit un `.woff2` publié tel quel par IBM,
octet pour octet.** Ce n'est pas le cas ici, puisque le fichier est sous-ensemblé.

**Pas 2 — que dit alors la condition 3 ?**

> « 3) No Modified Version of the Font Software may use the Reserved Font Name(s) unless
> explicit written permission is granted by the corresponding Copyright Holder. This
> restriction only applies to the primary font name as presented to the users. »

La restriction ne porte que sur « the primary font name as presented to the users ».

**Pas 3 — quel est ici ce nom, et contient-il « Plex » ?** Oui, à deux endroits, tous deux
vérifiés plus haut :

- dans la table `name` des fichiers : `IBM Plex Mono`, `IBM Plex Mono Medium`,
  `IBMPlexMono-Regular`, `IBMPlexMono-Medium` ;
- dans `src/styles.css` : `font-family: 'IBM Plex Mono'`.

Le nom réservé « Plex » y figure. La condition 3 n'est donc pas respectée, et la clause de
terminaison de l'OFL est brutale : « This license becomes null and void if any of the above
conditions are not met. »

**Confirmation par l'auteur de la licence.** SIL, qui écrit et maintient l'OFL, traite ce
cas précis dans sa page « Webfonts and Reserved Font Names » : le sous-ensemblage préalable
ne peut pas préserver l'équivalence fonctionnelle, et « needs to be considered a Modified
Version for which RFN restrictions apply ». SIL énumère quatre stratégies conformes pour
un service de polices web : servir la version d'origine sans aucune modification ; obtenir
de l'auteur une re-licence sans nom réservé ; signer un accord séparé autorisant l'usage du
nom réservé ; ou n'optimiser qu'en préservant entièrement l'équivalence fonctionnelle
(conversion vers TTF, OTF, WOFF, WOFF2 — sans sous-ensemblage). Voir
<https://openfontlicense.org/webfonts-and-reserved-font-names/> et
<https://openfontlicense.org/ofl-faq/>. Cette position est celle de l'auteur de la licence,
pas une décision de justice : elle éclaire l'intention, elle ne la tranche pas.

**Ce dont je ne suis pas certain, et qui pourrait renverser la conclusion :**

- **Une permission écrite d'IBM existe peut-être.** La condition 3 réserve explicitement
  ce cas. Plusieurs services de diffusion de polices web opèrent sous des accords de ce
  type. Je n'en ai pas trouvé pour IBM Plex, mais je n'ai pas mené de recherche
  exhaustive, et un tel accord ne bénéficierait pas nécessairement à un redistributeur en
  aval comme WinTool. **À vérifier auprès d'IBM ou dans le dépôt `IBM/plex`** (voir
  section 12).
- **La provenance exacte des fichiers n'est pas documentée**, ce qui empêche de savoir
  sous quel régime l'intermédiaire a produit le sous-ensemble. Les noms de fichiers suivent
  la convention du projet Fontsource, mais aucune dépendance Fontsource ne figure dans
  `package.json` : les fichiers ont été déposés à la main. La version inscrite dans le
  fichier, « Version 2.3 », est par ailleurs une version ancienne d'IBM Plex Mono.
- **Le fait que WinTool n'ait pas produit lui-même le sous-ensemble ne le protège pas.**
  La condition 3 interdit à une Modified Version d'*utiliser* le nom réservé ; distribuer
  la Modified Version non conforme d'un tiers reste la distribuer. Et le nom présenté à
  l'utilisateur via `styles.css` est, lui, entièrement sous le contrôle de l'auteur de
  WinTool.

**Quatre façons de se mettre en règle, de la moins coûteuse à la plus coûteuse :**

| # | Solution | Coût | Effet |
|---|---|---|---|
| A | **Renommer.** Réécrire les enregistrements `name` 1, 3, 4, 6 (et 16 s'il existe) des deux `.woff2` avec un nom ne contenant pas « Plex » — par exemple `WinTool Mono` — puis aligner `font-family` dans `src/styles.css`. | ~30 min, `fontTools` suffit | Conformité pleine. La condition 3 ne vise que le nom. |
| B | **Livrer la version d'origine**, telle qu'IBM la publie, sans sous-ensemble ni reconversion. | Poids du paquet | Plus de Modified Version, donc plus de condition 3. *À vérifier d'abord : IBM publie-t-il lui-même du `.woff2` ? Si vous convertissez vous-même, vous recréez une Modified Version.* |
| C | **Obtenir d'IBM une permission écrite explicite** couvrant l'usage du nom sur un sous-ensemble. | Délai, incertain | Conformité pleine, par la porte que la condition 3 laisse ouverte. |
| D | **Remplacer IBM Plex Mono** par une police à chasse fixe dont l'en-tête OFL ne déclare aucun nom réservé, comme Inter n'en déclare aucun. | Travail de design | Supprime le problème. *Vérifier l'en-tête de chaque candidate — ne pas le supposer.* |

La solution A est recommandée : elle est entièrement sous le contrôle de l'auteur,
vérifiable en une commande, et n'exige l'accord de personne.

**Attention, si A est retenue :** renommer ne dispense de rien d'autre. L'avis
`Copyright 2017 IBM Corp. All rights reserved.` doit être conservé dans `name` 0 ; le
fichier renommé reste sous OFL-1.1 (condition 5) ; et la condition 4 interdit d'utiliser le
nom d'IBM pour promouvoir WinTool, y compris pour dire que WinTool « utilise IBM Plex ».
Mentionner la provenance dans ce document-ci est une reconnaissance de contribution, que la
condition 4 autorise expressément — en faire un argument de présentation, non.

### 8.4 Les autres obligations de l'OFL, qui valent pour les deux polices

1. **Le texte de l'OFL et l'avis de droit d'auteur doivent accompagner les polices**
   (condition 2). Comme montré en 8.1, les fichiers ne portent pas le texte de la licence.
   Il faut des fichiers autonomes. *Ce n'est pas le cas actuellement — voir section 12.*
2. **Les polices ne peuvent pas être vendues seules** (condition 1). L'OFL autorise leur
   vente à l'intérieur d'un ensemble logiciel plus large, mais interdit de vendre les
   fichiers de police pris isolément. Aucun conflit ici : la licence de WinTool interdit
   déjà de vendre WinTool.
3. **Les fichiers de police restent sous OFL** (condition 5), y compris renommés. Cela ne
   contamine pas WinTool : « The requirement for fonts to remain under this license does
   not apply to any document created using the Font Software », et l'OFL n'impose rien au
   logiciel qui embarque la police. Elle ne régit que les fichiers de police et leurs
   dérivés.
4. **Le nom des auteurs ne peut pas servir à promouvoir WinTool** (condition 4), sauf pour
   reconnaître leur contribution — ce que fait ce document.

---

## 9. Composants sous MPL-2.0

**Cette section corrige une hypothèse de départ.** Il avait été indiqué qu'aucune
dépendance n'était copyleft. C'est inexact : cinq composants sont sous **Mozilla Public
License 2.0**, qui est un copyleft — faible, limité au fichier, mais réel.

| Composant | Version | Chemin d'entrée | Dans le binaire livré ? |
|---|---|---|---|
| `option-ext` | 0.2.0 | `dirs-sys` ← `dirs` ← `tauri` | **Oui**, à l'exécution |
| `cssparser` | 0.36.0 | `dom_query` ← `tauri-utils` ← `tauri-codegen` ← `tauri-macros` | Non — compilation seule |
| `cssparser-macros` | 0.6.1 | idem | Non — compilation seule |
| `selectors` | 0.36.1 | idem | Non — compilation seule |
| `dtoa-short` | 0.3.5 | `cssparser`, idem | Non — compilation seule |

La distinction tient à un détail de résolution des dépendances : `tauri-utils` apparaît
deux fois dans le graphe, avec des jeux de fonctionnalités différents. L'instance
atteinte par `tauri-codegen` (une macro procédurale, donc exécutée pendant la
compilation) active `dom_query` ; celle atteinte directement par `tauri` ne l'active pas.
Les quatre composants liés à `dom_query` ne sont donc vraisemblablement pas liés dans
`wintool.exe`. `option-ext`, lui, l'est bel et bien.

### Ce que la MPL-2.0 exige, et pourquoi ce n'est pas un problème

La MPL-2.0 est conçue pour ce cas précis. Son article 3.3 autorise explicitement à
distribuer un « Larger Work » — ici WinTool — **sous les conditions de son choix**, y
compris une licence propriétaire ou personnalisée. Le copyleft ne remonte pas : il ne
s'applique qu'aux fichiers d'origine MPL.

En contrepartie, deux obligations, toutes deux faciles à satisfaire :

1. **Indiquer que ces composants sont sous MPL-2.0.** C'est fait par le présent document.
2. **Rendre leur code source disponible sous MPL-2.0, et dire où le trouver.** Les
   composants sont utilisés sans modification : il suffit de renvoyer vers la source
   publique d'origine.

Source de `option-ext` : <https://github.com/soc/option-ext>
Sources de `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short` : projet Servo,
<https://github.com/servo/rust-cssparser> et <https://github.com/servo/servo>

### Articulation avec la licence de WinTool

La licence de WinTool comporte désormais une obligation de code source, mais elle ne se
déclenche **que sur distribution** : quiconque distribue une version modifiée de WinTool
doit en fournir le code source complet à chaque personne qui reçoit le binaire, sans
obligation de publication ouverte. Un usage purement interne à une organisation, sans
aucune remise à un tiers, ne déclenche rien.

La MPL-2.0 fonctionne sur exactement le même déclencheur. Son article 3.2 ne vise que la
distribution sous forme exécutable ; un usage interne sans distribution ne la déclenche pas
davantage. **Les deux régimes coïncident donc sur le fait générateur**, ce qui simplifie la
lecture : tant que rien ne sort de l'organisation, ni l'une ni l'autre n'exige quoi que ce
soit.

Ils diffèrent en revanche sur trois points, qu'il faut avoir en tête :

| | Licence WinTool | MPL-2.0 |
|---|---|---|
| **Portée** | tout le code de la version modifiée de WinTool | uniquement les cinq fichiers/composants MPL listés ci-dessus |
| **Destinataire** | remise du code à chaque personne qui reçoit le binaire | il suffit d'informer le destinataire du moyen d'obtenir le code (art. 3.2(a)), à un coût n'excédant pas celui de la distribution |
| **Source de l'obligation** | contrat consenti par l'auteur de WinTool | licence des composants, indépendante — elle s'appliquerait même si la licence WinTool n'exigeait rien |

Le dernier point est le plus important : la MPL s'applique de son propre chef. Un
assouplissement futur de la licence WinTool (que l'arbitrage (f) réserve d'ailleurs pour
les versions à venir) ne libérerait pas pour autant des obligations MPL sur ces cinq
composants.

**Il reste utile que le fichier `LICENSE` signale ce point**, pour éviter qu'un forkeur de
bonne foi croie que les conditions de WinTool épuisent la question. Une phrase suffit, par
exemple dans l'article consacré aux composants tiers : *« Certains composants tiers
imposent leurs propres obligations, notamment de mise à disposition de leur code source.
La présente licence ne s'y substitue pas et n'en dispense pas. »*

Le texte de la MPL-2.0 doit accompagner WinTool. Il est le seul texte non reproduit dans ce
document ; voir §11.9, qui explique pourquoi et où le prendre.

---

## 10. Microsoft Edge WebView2

WinTool affiche son interface dans WebView2, le moteur de rendu de Microsoft Edge. C'est
la brique la plus délicate de ce document, parce que c'est la seule qui ne soit pas sous
licence libre : elle relève des **conditions de distribution de Microsoft**, un contrat
propriétaire qui ne figure dans aucun fichier du dépôt.

Deux éléments distincts, à ne pas confondre :

**Le Runtime WebView2.** C'est le moteur lui-même. Microsoft l'installe et le met à jour
sur Windows 10 et 11 ; il est en pratique déjà présent sur les machines visées par
WinTool. Vérifié dans `src-tauri/tauri.conf.json` : aucun `webviewInstallMode` n'est
défini, donc Tauri applique son mode par défaut pour une cible NSIS. Il faut vérifier ce
mode exact (section 12) : selon le réglage, l'installeur télécharge le programme d'amorçage
depuis les serveurs de Microsoft au moment de l'installation, ou bien l'embarque. **Le
premier cas n'est pas une redistribution ; le second en est une**, et appelle alors le
respect des conditions de redistribution du Runtime publiées par Microsoft.

**Le SDK WebView2**, via les bibliothèques Rust `webview2-com` 0.38.2,
`webview2-com-macros` 0.8.1 et `webview2-com-sys` 0.38.2. Ces trois-là sont déclarées
**MIT** ; ce sont des liaisons écrites par le projet Tauri, pas du code Microsoft. Elles
décrivent l'interface COM du moteur sans le contenir.

WinTool n'est ni publié ni approuvé par Microsoft. « Microsoft », « Windows », « Microsoft
Edge » et « WebView2 » sont des marques de Microsoft Corporation, citées ici à titre
purement descriptif.

**Les conditions Microsoft sont susceptibles d'évoluer sans lien avec le calendrier de
WinTool.** C'est le seul composant de ce document qui ne soit pas figé par une licence
irrévocable. Il faut donc les relire avant chaque version marquante :
<https://developer.microsoft.com/microsoft-edge/webview2/>

---

## 11. Textes intégraux des licences

Les textes ci-dessous sont reproduits **verbatim**, depuis les fichiers effectivement
livrés par les composants ou depuis la source officielle de l'éditeur de la licence. Ils
n'ont été ni résumés, ni reformatés, ni traduits — une licence traduite n'est plus la
licence.

Rappel de la section 3 : cette liste est exactement celle qui reste due **après** exercice
de l'option MIT partout où elle est offerte.

### 11.1 Licence MIT

Due par 35 composants sous MIT seule, par les 149 composants où l'option MIT a été
exercée, et par `dpi` 0.1.2 et `brotli` 8.0.4 où elle est cumulative.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Chaque composant sous MIT porte son propre avis de droit d'auteur, que le texte ci-dessus
impose de conserver. Ils ne sont pas reproduits un à un ici : voir section 12, point 3, qui
propose d'en générer la liste exhaustive automatiquement. Quelques avis relevés
manuellement, parce qu'ils se rattachent à des composants traités nommément :

- `brotli` 8.0.4, volet MIT : voir son fichier `LICENSE.MIT`.
- `dpi` 0.1.2, volet MIT : « rust-lang/libm as a whole is available for use under the MIT
  license », avec les avis repris de musl libc — `Copyright © 2005-2020 Rich Felker, et
  al.` — et des portions mathématiques : Sun Microsystems (1993, 2004), David Schultz
  (2003-2011), Steven G. Kargl (2003-2009), Bruce D. Evans (2003-2009), Stephen L. Moshier
  (2008), Arm Limited (2017-2018).

### 11.2 Licence MIT-0 (option exercée sur `dunce` 1.0.5)

Identique au texte MIT de §11.1, **sans** le paragraphe « The above copyright notice and
this permission notice shall be included… ». MIT-0 n'exige aucune conservation de mention ;
`dunce` est mentionné ici par cohérence de la déclaration de choix, pas par obligation.

### 11.3 Licence ISC — `lucide-static` (icônes)

Reproduction **intégrale** du fichier `node_modules/lucide-static/LICENSE`, version 1.47.0,
volet ISC **et** volet MIT compris. Aucune coupure : la liste nominative des icônes
dérivées de Feather fait partie de la mention à conserver, et les 115 icônes qu'elle nomme
sont toutes présentes dans `src/icons/`.

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 11.4 SIL Open Font License 1.1 — Inter et IBM Plex Mono

Texte intégral, reproduit depuis le fichier `LICENSE.txt` du dépôt `IBM/plex`. Le dépôt
`rsms/inter` livre le même texte de licence ; seul l'en-tête de droit d'auteur diffère.

**Les deux avis de droit d'auteur à conserver, chacun tel qu'il figure en tête du fichier
de licence de sa police :**

```
Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
```

```
Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"

This Font Software is licensed under the SIL Open Font License, Version 1.1.
```

La seconde ligne est capitale et fait l'objet de la section 8.3 : **« Plex » est un
Reserved Font Name ; « Inter » n'en est pas un.**

**Texte de la licence :**

```
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### 11.5 Licence Apache 2.0 — `tao` 0.35.3 et `dpi` 0.1.2

**Pourquoi ce texte figure ici alors que l'option MIT a été exercée partout où elle était
offerte :** parce que deux composants ne l'offrent pas. `tao` 0.35.3 est sous Apache-2.0
**seule** ; `dpi` 0.1.2 est sous `Apache-2.0 AND MIT`, où le `AND` est cumulatif et ne se
choisit pas. Pour ces deux-là — et pour eux seulement — l'Apache-2.0 s'applique, et son
§4(a) impose de remettre une copie de la licence à tout destinataire. La voici.

Rappel de la section 4, vérifié dans les sources du registre : ni `tao` ni `dpi` ne
livrent de fichier `NOTICE`, et WinTool ne modifie aucun de leurs fichiers ; les §4(b) et
§4(d) sont donc sans objet.

Texte repris de <https://www.apache.org/licenses/LICENSE-2.0.txt>, identique au fichier
`LICENSE` livré dans les sources de `tao` et de `dpi`.

```

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### 11.6 Licence BSD 3-Clause — `alloc-no-stdlib`, `alloc-stdlib`, `brotli`

Avis de droit d'auteur, relevé dans les fichiers `LICENSE` livrés par `alloc-no-stdlib`
2.0.4 et par `brotli` 8.0.4 (`LICENSE.BSD-3-Clause`) :

```
Copyright (c) 2016 Dropbox, Inc.
All rights reserved.
```

*`alloc-stdlib` 0.2.4 ne livre aucun fichier de licence dans son archive du registre : son
avis exact est à confirmer en amont — voir section 12, point 8.*

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

La clause 3 mérite d'être relevée : elle interdit d'utiliser le nom des auteurs de
`brotli`, `alloc-no-stdlib` et `alloc-stdlib` pour promouvoir WinTool. WinTool ne le fait
pas, et ne doit pas commencer.

### 11.7 Licence Zlib — `foldhash` 0.2.0

Due uniquement par `foldhash`, seule bibliothèque de l'arbre à n'offrir aucune alternative
à Zlib. Avis relevé dans son fichier `LICENSE` :

```
Copyright (c) 2024 Orson Peters
```

```
This software is provided 'as-is', without any express or implied warranty. In
no event will the authors be held liable for any damages arising from the use
of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it freely,
subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
   that you wrote the original software. If you use this software in a product,
   an acknowledgment in the product documentation would be appreciated but is
   not required.

2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.

3. This notice may not be removed or altered from any source distribution.
```

### 11.8 Licence Unicode v3 — les 18 composants ICU4X et `unicode-ident`

Texte reproduit depuis le fichier `LICENSE` livré par `icu_properties` 2.3.0, identique
dans les autres composants ICU4X. Noter que l'avis de droit d'auteur qui y figure
(`1991-2026` sur le site d'Unicode, `2020-2024` dans les composants livrés) doit être
conservé **tel que livré par le composant** : c'est celui-ci qui fait foi.

```
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2020-2024 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0

—

Portions of ICU4X may have been adapted from ICU4C and/or ICU4J.
ICU 1.8.1 to ICU 57.1 © 1995-2016 International Business Machines Corporation and others.
```

### 11.9 Licence MPL-2.0 — le seul texte non reproduit ici, et pourquoi

Les cinq composants de la section 9 imposent que le texte de la MPL-2.0 accompagne
WinTool. Il n'est **pas** reproduit dans ce document, et c'est un choix délibéré, pas un
oubli : le texte fait près de dix pages, il doit de toute façon être livré comme fichier
autonome dans l'installeur (comme tous les autres, voir section 12 point 1), et l'insérer
ici doublerait la longueur du document sans rien ajouter à l'obligation.

**Il doit donc impérativement être versionné sous `licenses/MPL-2.0.txt`.** Deux sources
verbatim, au choix :

- le fichier `LICENSE.txt` livré dans les sources de `option-ext` 0.2.0, présent dans le
  registre Cargo local ;
- <https://www.mozilla.org/MPL/2.0/>

Tant que ce fichier n'existe pas dans le dépôt, l'obligation n'est pas remplie. C'est le
point 1 de la section 12.

---

## 12. À vérifier avant publication

Les points ci-dessous n'ont pas pu être établis avec certitude à partir du dépôt seul. Ils
sont listés ici plutôt que tranchés au jugé : une mention fausse est pire qu'une mention
absente.

### Bloquants — obligations non satisfaites en l'état

1. **Aucun texte de licence n'est versionné dans le dépôt.** Vérifié : `git ls-files` ne
   retourne aucun fichier de licence, et le dossier `licenses/` n'existe pas. La seule
   copie présente sur la machine est `node_modules/lucide-static/LICENSE`, qui n'est pas
   suivi par Git et disparaîtra de toute copie du dépôt. En l'état, WinTool redistribue des
   composants MIT, ISC, OFL, BSD, Zlib, MPL, Apache et Unicode sans leurs textes :
   l'obligation commune à toutes ces licences n'est pas remplie.

   Ce document règle la moitié du problème — il contient désormais les textes — mais un
   document Markdown dans le dépôt n'est pas encore un fichier livré à l'utilisateur.
   Il faut :

   | Fichier à créer | Source verbatim |
   |---|---|
   | `licenses/MIT.txt` | §11.1 |
   | `licenses/ISC-lucide.txt` | copie de `node_modules/lucide-static/LICENSE` |
   | `licenses/OFL-1.1-Inter.txt` | `LICENSE.txt` du dépôt `rsms/inter` |
   | `licenses/OFL-1.1-IBMPlex.txt` | `LICENSE.txt` du dépôt `IBM/plex` |
   | `licenses/Apache-2.0.txt` | <https://www.apache.org/licenses/LICENSE-2.0.txt> |
   | `licenses/BSD-3-Clause.txt` | §11.6 |
   | `licenses/Zlib.txt` | §11.7 |
   | `licenses/Unicode-3.0.txt` | `LICENSE` d'un composant ICU4X |
   | `licenses/MPL-2.0.txt` | `LICENSE.txt` d'`option-ext`, ou <https://www.mozilla.org/MPL/2.0/> |

   Pour les deux polices, il faut le fichier **du dépôt d'origine**, pas un texte OFL
   générique : l'en-tête porte l'avis de droit d'auteur et la mention de nom réservé, qui
   sont précisément ce que l'OFL impose de conserver, et qui diffèrent entre les deux.

   Puis inclure le dossier dans l'installeur NSIS via `bundle.resources` de
   `tauri.conf.json`, comme c'est déjà fait pour `scripts/Default` et `categories.json`.

2. **Les polices sont embarquées sans leur licence.** Vérifié : `src/fonts/` ne contient
   que trois `.woff2`, et aucun des trois ne porte d'enregistrement `name` 13 (voir 8.1).
   L'OFL exige que son texte accompagne les fichiers de police. À corriger avec le point 1.

3. **Avis de droit d'auteur individuels.** MIT, ISC et BSD imposent de conserver l'avis
   *de chaque* composant, pas seulement le texte type de la licence. Les reproduire à la
   main pour 222 bibliothèques serait à la fois pénible et fragile. La bonne méthode est
   de les générer :

   ```powershell
   cargo install cargo-about
   cargo about init          # depuis src-tauri
   cargo about generate about.hbs > ../THIRD-PARTY-RUST.txt
   ```

   Ce fichier généré devient l'annexe exhaustive ; le présent document reste la couche
   lisible qui l'explique. À régénérer à chaque mise à jour de `Cargo.lock`.

4. **Nom réservé « Plex » : trancher entre les solutions A, B, C et D de la section 8.3.**
   C'est le seul point de ce document où une obligation est vraisemblablement enfreinte
   aujourd'hui, et non simplement mal documentée. Avant de renommer, une seule vérification
   peut tout annuler : **rechercher si IBM a accordé une permission écrite explicite**
   couvrant l'usage du nom « Plex » sur des sous-ensembles — dans le dépôt `IBM/plex`
   (fichiers `README`, `FAQ`, politique de marque), ou en écrivant à IBM. Si une telle
   permission existe et bénéficie aux redistributeurs en aval, rien n'est à changer, et il
   faut alors en archiver la preuve à côté de ce document.

### À trancher

5. **Mode d'installation de WebView2.** Vérifié : `tauri.conf.json` ne définit pas
   `webviewInstallMode`. Vérifier dans la documentation Tauri 2 la valeur par défaut
   appliquée à une cible NSIS, puis **la fixer explicitement** dans le fichier de
   configuration. Ne pas dépendre d'un défaut implicite sur un point qui détermine si
   WinTool redistribue ou non un binaire Microsoft : un changement de défaut dans une
   version future de Tauri modifierait silencieusement les obligations.

6. **Provenance exacte des `.woff2`.** Les noms de fichiers suivent la convention du projet
   Fontsource, mais aucune dépendance Fontsource ne figure dans `package.json` : les
   fichiers ont été déposés à la main. La version inscrite dans les fichiers IBM Plex Mono
   est « Version 2.3 », une version ancienne. Noter quelque part la version, l'origine et
   la date de récupération exactes de chaque fichier, sans quoi la chaîne d'attribution ne
   sera pas reconstituable dans six mois — et le point 4 restera impossible à instruire.

7. **Icônes de l'application** (`src-tauri/icons/`, `icon.ico`, `32x32.png`,
   `128x128.png`, `128x128@2x.png`, `icon.icns`) : leur origine n'est pas documentée. Si
   elles sont l'œuvre originale de l'auteur, rien à faire. Si elles dérivent d'un jeu
   tiers, elles doivent figurer dans ce document.

8. **Avis de droit d'auteur d'`alloc-stdlib` 0.2.4.** L'archive du registre ne contient
   aucun fichier de licence, alors que le paquet est déclaré BSD-3-Clause — licence qui
   impose précisément la conservation d'un avis. Le relever dans le dépôt amont du projet
   `brotli` (même auteur, même avis Dropbox selon toute vraisemblance) plutôt que de le
   supposer.

9. **Fonctionnalités Cargo et arbre réel.** Cette liste provient de la résolution par
   défaut, vérifiée le 26 septembre 2026 : 223 entrées dont WinTool, soit 222
   bibliothèques tierces, et la somme des groupes de la section 6 retombe exactement sur
   222. Si des fonctionnalités sont activées plus tard sur `tauri` ou un autre composant,
   l'arbre changera. Le fichier généré au point 3 doit alors être régénéré, et ce document
   relu.

10. **Adresse du dépôt public.** Ce document désigne le dépôt de WinTool sans le nommer,
    parce qu'une migration de GitHub vers GitLab est décidée mais pas faite : `git remote`
    pointe encore vers `github.com/burnout293/WinTool`. Une fois la migration effectuée,
    inscrire l'URL GitLab définitive ici et dans `README.md`, et vérifier que les liens de
    mise à jour automatique de l'application pointent bien au bon endroit. Les URL des
    projets tiers citées dans ce document, elles, ne changent pas : elles désignent les
    dépôts de leurs auteurs, où qu'ils soient hébergés.

### Hors périmètre

11. **Les scripts PowerShell de `scripts/Default` ne sont pas des composants tiers.** Ils
    sont l'œuvre de l'auteur de WinTool et relèvent de ses propres conditions. Les scripts
    provenant de sources tierces relèvent de la licence choisie par leur auteur et
    n'entrent jamais dans ce document — conformément à la séparation posée par la licence
    WinTool et par `docs/FORMAT_SCRIPT.md`. Un script conforme au contrat v2 conserve sa
    fonction hors de WinTool ; il n'est pas une extension de WinTool et n'est pas soumis à
    sa licence.

12. **Contributions assistées par IA.** Le cahier des charges soulève la question du
    statut du code généré par IA. Elle relève du fichier `LICENSE`, pas de celui-ci : ce
    document ne traite que du code écrit par des tiers identifiés.

---

## 13. Maintenance de ce fichier

| Événement | Action |
|---|---|
| `cargo update` ou modification de `Cargo.toml` | Régénérer l'annexe `cargo about`, refaire le comptage de la section 3 (la somme doit retomber sur le total), relire la section 6 |
| Apparition d'une expression de licence absente du tableau de la section 3 | **Ne pas la ranger par analogie.** Ajouter une ligne, nommer l'option exercée, et vérifier si un nouveau texte de licence devient dû |
| Mise à jour de `lucide-static` | Recopier son `LICENSE` entier dans §11.3 : l'année change, et la liste des icônes Feather aussi |
| Remplacement ou mise à jour d'une police | Reprendre la section 8 en entier, y compris la lecture de la table `name` et l'en-tête OFL amont — c'est là que se cachent les noms réservés |
| Renommage effectif d'IBM Plex Mono (solution A) | Mettre à jour le tableau 8.1, la conclusion de 8.3 et le point 4 de la section 12 |
| Nouvelle version majeure de Tauri | Relire les sections 4, 9 et 10 : l'arbre change en profondeur |
| Portage vers une autre plateforme | Régénérer intégralement : cette liste est spécifique à Windows x86-64, et les autres cibles introduisent des licences absentes ici |
| Avant chaque version publiée | Relire les conditions WebView2 de Microsoft (section 10) |

Ce document ne modifie ni ne remplace le fichier `LICENSE` de WinTool. En cas de
divergence entre les deux sur les droits accordés **sur WinTool**, `LICENSE` prévaut.
Sur les droits accordés **sur un composant tiers**, c'est la licence propre de ce
composant qui prévaut, et rien dans `LICENSE` ne peut y déroger.
