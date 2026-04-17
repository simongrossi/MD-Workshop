# Changelog

Toutes les évolutions notables du projet sont listées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet applique [SemVer](https://semver.org/lang/fr/).

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
