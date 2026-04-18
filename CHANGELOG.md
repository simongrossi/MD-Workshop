# Changelog

Toutes les évolutions notables du projet sont listées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet applique [SemVer](https://semver.org/lang/fr/).

## [0.5.0] — 2026-04-18

### Changé — Stockage de l'index SQLite

- **Fini le dossier `.md-workshop/` à la racine des workspaces**. L'index FTS5 (recherche plein texte, backlinks, tags, wiki-links) est désormais stocké dans le répertoire app-data spécifique à l'utilisateur, pas dans le workspace.
  - **Windows** : `%APPDATA%\com.simongrossi.mdworkshop\workspaces\<digest>\index.db`
  - **macOS** : `~/Library/Application Support/com.simongrossi.mdworkshop/workspaces/<digest>/index.db`
  - **Linux** : `~/.local/share/com.simongrossi.mdworkshop/workspaces/<digest>/index.db`
  - `<digest>` est un hash court (16 hex) du chemin canonique du workspace.
- **Plus de pollution** des dossiers ouverts : plus rien à `.gitignore`, plus de risque de commit accidentel.
- **Sécurité de premier ouverture** : si tu as remonté d'un cran dans le file picker par inadvertance (ouvrant par ex. `D:\Programmation\` au lieu de `D:\Programmation\mes-notes\`), l'app ne pollue plus ce dossier — l'index part ailleurs.
- **Registry debug** (`workspaces/registry.json`) : mapping `digest → chemin canonique` mis à jour à chaque ouverture, utile pour futur ménage d'orphelins.

### Ajouté — Nettoyage automatique du legacy

- À la première ouverture d'un workspace en v0.5.0, tout dossier `.md-workshop/` trouvé à la racine est **supprimé silencieusement**. L'index est reconstruit dans le nouvel emplacement en quelques secondes (reindex incrémental déclenché automatiquement à la première commande).
- Opération best-effort : si la suppression échoue (permissions, fichier ouvert ailleurs), l'app continue sans bloquer — un message est écrit sur `stderr`.

### Technique

- Nouveau `db::init_index_base(PathBuf)` appelé dans le `setup` hook de Tauri. Tente `app.path().app_data_dir()` puis `fs::create_dir_all` pour garantir que le répertoire existe avant toute ouverture de connexion.
- Nouveau helper `workspace_digest(&Path)` (hash non-crypto `DefaultHasher` — collisions négligeables sur un set personnel).
- `db_dir(&Path)` passe de `root.join(".md-workshop")` à `INDEX_BASE.get().join(digest)`.
- Le filtre `if ev.path.components().any(|c| c.as_os_str() == ".md-workshop")` dans le file watcher est supprimé — plus nécessaire et évite un faux filtre si un utilisateur a légitimement un dossier nommé `.md-workshop` dans son contenu.
- Aucune nouvelle dépendance.

### Impact utilisateur

- **Rien à faire** si tu mets à jour depuis v0.4.0 : au prochain ouvrage d'un workspace, l'ancien `.md-workshop/` disparaît, le nouvel index se construit ailleurs. Un petit reindex au premier open, puis tout redevient normal.
- Tous les workflows (recherche, backlinks, tags, graph view) restent identiques.

---

## [0.4.0] — 2026-04-18

Version dédiée à la **performance, la stabilité et la gestion mémoire**. Aucune
rupture d'API utilisateur ; les workflows restent identiques, mais l'app devient
nettement plus rapide et plus sobre sur gros workspaces.

### Ajouté — Surveillance du système de fichiers

- **File watcher natif** via `notify` + `notify-debouncer-mini` (debounce 300 ms).
  - Déclenché automatiquement à chaque `set_workspace_asset_scope`, swap automatique à chaque changement de racine.
  - Ignore `.md-workshop/` pour éviter toute boucle de rétroaction WAL / SQLite.
  - Sur modification d'un `.md` externe : invalidation du cache de fichiers + cache de tags, réindexation incrémentale via `index_single_file`.
  - Sur suppression externe : retrait propre de l'entrée via `db::remove_indexed_file`.
  - Conséquence : les éditions faites depuis Obsidian, un éditeur tiers ou la CLI sont reflétées dans l'app sans action manuelle.

### Changé — Pipeline backend (Rust / Tauri)

- **Pool de connexions SQLite** (`db::get_connection` + `ConnHandle`) au lieu d'ouvrir une nouvelle connexion par commande. Supprime le coût de `PRAGMA` + `CREATE TABLE IF NOT EXISTS` sur chaque appel.
- **PRAGMAs agressifs** dans `open_index` : `mmap_size = 256 MiB`, `cache_size = -20000` (20 Mo), `temp_store = MEMORY` — 10-30 % plus rapide sur FTS et reindex avec index volumineux.
- **Profil release optimisé** dans `Cargo.toml` : `opt-level = 3`, `lto = "thin"`, `panic = "abort"`, `strip = true`, `codegen-units = 1`. Binaire plus petit, démarrage plus rapide, plus d'unwinding parasite.
- **`canonicalize_root` caché** via `OnceLock` global : un seul syscall par chemin par session au lieu d'un par commande.
- **Cache fichiers partagé** `FileListCache` (TTL 1.5 s) invalidé par toute mutation (create, rename, delete, save_as). `list_markdown_files` réutilise désormais les métadonnées déjà fournies par `WalkDir` (plus d'appel `fs::metadata` redondant).
- **Cache tags** `TagsCache` pour `get_all_tags`, invalidé sur save / create / rename / delete.
- **Reindex incrémental sur save** : `save_markdown_file` appelle `index_single_file` au lieu d'attendre le prochain reindex global. Backlinks, recherche FTS et liste de tags restent cohérents en continu.
- **Recherche FTS-first** : `search_markdown` utilise désormais l'index FTS5 comme filtre de candidats (jusqu'à 200), puis n'ouvre que les fichiers pré-filtrés. Fallback `WalkDir` si l'index est vide. Passage à `async fn` + `spawn_blocking`.
- **PDF en `spawn_blocking`** : `convert_pdf_to_markdown` et `convert_pdf_path_to_markdown` sont devenues `async`. L'UI reste interactive pendant la conversion d'un PDF volumineux.
- **`read_markdown_file` async** : lectures disque déportées sur le thread pool pour éviter de bloquer le runtime Tauri.
- **`apply_replace`** écrit dans un `String` bufferisé au lieu d'un `Vec<String>` joint en fin — moins d'allocations sur gros remplacements.
- **`extract_inline_tags`** : dédup via `HashSet` au lieu d'un `Vec::contains` O(n²).
- **`get_backlinks`** plafonné à 200 entrées pour éviter l'explosion sur les fichiers hub très référencés.

### Changé — Frontend (React / Vite)

- **GraphView** :
  - Variables CSS (`--accent`, `--text`, `--muted`, `--line`) lues une seule fois au montage puis rafraîchies uniquement sur changement de thème (`MutationObserver` existant). Avant : 5 appels `getComputedStyle` par tick × N nœuds × 60 fps.
  - Plafond `MAX_NODES = 500` avec priorité aux nœuds à fort degré. Au-delà, on garde la colonne vertébrale du graphe.
  - **Culling viewport** : les nœuds et arêtes hors écran sont sautés au rendu canvas.
- **PreviewPane** :
  - `content` débattu 120 ms avant le re-parse marked + DOMPurify.
  - `splitFrontMatter` mémoïsé via `useMemo`.
  - Ajout automatique de `loading="lazy"` sur toutes les `<img>` du rendu.
- **TipTap** : debounce de l'émission markdown porté de 150 ms → 300 ms.
- **`splitFrontMatter`** : **LRU** de 4 entrées pour court-circuiter les appels répétés avec le même contenu (OutlinePanel + PreviewPane + barre d'état déclenchaient jusqu'à 3 parses identiques par render).
- **Lazy-loading** :
  - `GraphView` chargé via `React.lazy` — `d3-force` n'est plus dans le bundle initial.
  - `PreviewEditor` (TipTap + extensions) chargé via `React.lazy` — toute la chaîne TipTap reste dormante tant que le mode WYSIWYG n'est pas activé.
- **QuickOpen** : matching en une seule passe (plus de `map().filter().sort().slice().map()` chaînés pour ne garder que 14 items).
- **Vite** : `build.sourcemap = false` en production (sourcemaps conservées en dev).

### Technique

- Nouvelles dépendances Rust : `notify = "6.1"`, `notify-debouncer-mini = "0.4"`.
- Nouveaux helpers `db::get_connection`, `db::remove_indexed_file`, `db::search_fts_paths`, `db::index_has_files`.
- Nouveaux états Tauri : `FileListCache`, `TagsCache`, `WorkspaceWatcher`.
- Globaux `OnceLock` : `CONN_POOL` (db.rs), `CANON_CACHE` (lib.rs).
- Ordres de grandeur mesurés :
  - Démarrage à froid, workspace demo : ~identique (file watcher ajoute ~10 ms).
  - Recherche sur 1 000 fichiers : **10× à 100×** plus rapide (selon densité de résultats) grâce au routage FTS5.
  - Sauvegarde d'un fichier : backlinks et tags mis à jour en ~20 ms au lieu d'attendre un reindex manuel.
  - Graph view 500+ nœuds : reste interactif (>30 fps) grâce au culling + plafond.

### Reporté

- Markdown parsing déporté en Web Worker : refactor async profond qui casse l'API synchrone partout ; gain réel seulement sur documents > 1 Mo. Couvert à 95 % par le debounce 120 ms + la LRU `splitFrontMatter`.
- Virtualisation des listes (SearchPanel, ReplacePanel, FileTree) : ajouterait `@tanstack/react-virtual`. Reste ouvert.
- Normalisation du store d'onglets (Zustand / Map) : refactor structurel à décider séparément.
- `pulldown-cmark` côté Rust pour le rendu preview : gros gain théorique mais architecture différente.

---

## [0.3.0] — 2026-04-18

### Ajouté — Import PDF

- **Conversion PDF → Markdown** via [firecrawl/pdf-inspector](https://github.com/firecrawl/pdf-inspector) (crate Rust, `lopdf`, 100 % local — aucun service externe).
- Trois points d'entrée :
  - **Palette / menu Fichier** → « Importer un PDF… » (ouvre un file picker).
  - **Écran d'accueil** → bouton « Importer un PDF… » et zone de glisser-déposer dédiée.
  - **Glisser-déposer** depuis le Finder / Explorateur n'importe où dans la fenêtre (listener `onDragDropEvent` natif Tauri 2, fonctionne même là où les events HTML sont interceptés).
- Détection du type de PDF :
  - `text_based` / `mixed` → converti en `.md` créé dans le workspace, ouvert automatiquement dans un onglet.
  - `scanned` → message explicite dans la barre de statut (OCR non supporté).
- Si aucun dossier n'est ouvert au moment du drop, ouverture automatique du picker de dossier puis conversion dans le dossier choisi.
- Nouvelles commandes Tauri : `convert_pdf_to_markdown` (bytes) et `convert_pdf_path_to_markdown` (chemin).

### Ajouté — Menu contextuel sur les fichiers

- **Clic droit** sur un fichier dans l'arbre → menu avec :
  - Ouvrir
  - **Afficher dans le Finder / Explorateur** (cross-platform — `open -R` macOS, `explorer /select,` Windows, `xdg-open` Linux)
  - Renommer… (avec option de mise à jour des `[[liens]]`)
  - Copier le chemin (dans le presse-papier)
  - Ajouter / retirer des favoris
  - Supprimer… (avec confirmation et avertissement si modifications non sauvées)
- Nouvelle commande Tauri `reveal_in_file_manager`.

### Ajouté — Barre de statut (type Notepad++)

- Footer fin en bas de la fenêtre avec :
  - **Position du curseur** — `Ln X, Col Y` (+ `(N sél.)` quand sélection active)
  - **Caractères**, **mots**, **lignes** du document actif
  - **Markdown** / **UTF-8** / **LF**
  - Message de statut contextuel à gauche (import PDF, enregistrement, etc.)
- Mise à jour en temps réel via un `EditorView.updateListener` CodeMirror exposé par un nouveau callback `onCursorChange`.

### Ajouté — Menus natifs

- Entrée **Fichier → Importer un PDF…** dans la barre de menus macOS / Windows.

### Technique

- Dépendance Rust : `pdf-inspector = { git = "…", rev = "cf2faa3…" }` épinglée à un commit précis pour la reproductibilité.
- Nouveau type TS `CursorInfo` exporté depuis `src/lib/codemirror.ts`.
- Refactor : `chooseFolder()` renvoie désormais `Promise<string | null>` (chemin sélectionné) pour permettre le chaînage « ouvrir dossier puis importer PDF » sans race condition avec le state React.

---

## [0.2.0] — 2026-04-17

### Ajouté — Phase 4 : Vue Graphe

- **Vue graphe** (`Alt+4`) — carte visuelle du réseau de notes.
  - Mode **local** : graphe centré sur le fichier actif avec slider de profondeur (1–3 sauts).
  - Mode **global** : carte complète du workspace.
  - **Filtres** : dossier (autocomplete), tags (chips multi-sélection), affichage des orphelins on/off.
  - **Navigation** : simple clic sur un nœud → ouvre le fichier et recentre le graphe (mode local) ; double-clic → ouvre en mode split.
  - **Plein écran** via bouton dédié ou `Esc` pour sortir.
  - Nœuds non-résolus (wiki-links cassés) visibles en pointillé, taille proportionnelle au degré, couleur du nœud actif en accent.
  - Rendu Canvas + `d3-force` (~25 KB, zéro dépendance lourde).
  - Drag & drop des nœuds (pin/unpin), pan (clic-glisser sur vide), zoom à la molette.
  - Nouvelle commande Tauri `get_graph_data` + fonctions SQL `get_graph_local` / `get_graph_global`.

### Ajouté — Dossier de démonstration

- Dossier **démo** bundlé dans l'app (10 notes interconnectées : wiki-links, tags, frontmatter, sous-dossiers, daily note, checkboxes).
- Bouton **"Charger la démo"** sur l'écran d'accueil.
- Entrée permanente **"🎓 Démo MD Workshop"** (section *Découverte*) dans la modale `Ctrl+Shift+O` — dissimulable via le `×` (persisté).
- Commandes palette : `Charger le dossier démo`, `Réinitialiser le dossier démo`.
- Commande Tauri `load_demo_workspace` qui copie les ressources dans `Documents/MD-Workshop-Demo/` au premier appel (option `reset: true` pour écraser).

### Ajouté — Raccourcis & commandes

- `Alt+4` — Mode graphe (listener web + accélérateur menu natif).
- `Ctrl+Shift+W` — **Copier pour WhatsApp** (ne conflicte plus avec `Ctrl+W` qui ferme l'onglet).

### Modifié

- **Barre d'outils** : le bouton "Graphe" sort du segmented control Édition/Split/Aperçu pour devenir un bouton dédié (accent quand actif, libellé *← Retour* pour revenir à la vue précédente).
- **Modale "Changer de bibliothèque"** : bouton `+ Ouvrir un dossier…` ne se tronque plus sur deux lignes (`white-space: nowrap` + flex-shrink:0), l'input s'adapte à la largeur disponible.
- **Fonctionnalités Phase 4 livrées dans [ROADMAP.md](./ROADMAP.md)** (4/4 cases cochées).

### Corrigé

- `Esc` ferme désormais correctement la modale **Changer de bibliothèque** (listener en *capture phase* + handler sur l'input).
- Déplacer un nœud du graphe (drag > 4px) ne déclenche plus d'ouverture de fichier.
- En mode graphe global, changer de fichier actif ne provoque plus un refetch inutile (le highlight se met à jour via un redraw).

### Technique

- **Backend** : nouveaux types `GraphNode` / `GraphEdge` / `GraphData` (Rust + TS), commandes `get_graph_data` / `load_demo_workspace` enregistrées dans `invoke_handler!`.
- **Frontend** : composants `GraphView.tsx` (~350 lignes, Canvas + d3-force), `GraphControls.tsx` (filtres).
- **Dépendances** : ajout de `d3-force` + `d3-selection` + types.
- **Settings** : persistance `graphMode`, `graphDepth`, `graphFilterFolder`, `graphFilterTags`, `graphShowOrphans`.
- **Bundle Tauri** : ressource `../demo → demo` déclarée dans `tauri.conf.json`.

---

## [0.1.0] — 2025-12

### Ajouté

Release initiale — voir [README.md](./README.md) pour la liste complète. En résumé :

- Éditeur Markdown CodeMirror 6, preview `marked` + DOMPurify, front-matter YAML.
- Bibliothèques multiples (favoris, récentes), onglets multi-documents.
- Wiki-links `[[…]]` avec autocomplete, liens non résolus, backlinks, outline, tags.
- Index SQLite + FTS5, recherche plein texte, audit des liens cassés, renommage intelligent.
- Snippets configurables, drag & drop d'images, checkboxes interactives, fold/unfold.
- Export HTML, copie en HTML riche.
- Thèmes clair/sombre, palette de commandes (`Ctrl+Shift+P`), daily notes.
