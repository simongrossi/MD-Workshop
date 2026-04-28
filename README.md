# MD Workshop

Éditeur Markdown desktop léger, pensé comme un *Obsidian minimaliste* — rapide, sans bloat, orienté productivité. Inspiré par l'esprit de SmoothCSV, mais pour les fichiers `.md`.

![MD Workshop — vue graphe](https://i.imgur.com/w3Txbkq.jpeg)

## Stack

- **Tauri 2.8** — fenêtre native + backend Rust
- **Rust** — indexation SQLite, opérations fichier, recherche multi-fichiers
- **React 19 + TypeScript + Vite 7** — frontend
- **CodeMirror 6** — éditeur (facets, compartments pour la config dynamique)
- **marked v16** — rendu HTML du preview
- **DOMPurify** — sanitization
- **js-yaml** — parsing du front matter
- **rusqlite + FTS5** — index interne pour backlinks, tags, audit des liens et base de recherche

## Fonctionnalités

### 📁 Bibliothèques
- Ouverture d'un dossier local (récursif sur `.md`, `.markdown`, `.mdx`)
- Changement rapide de bibliothèque (dropdown sidebar + modal `Ctrl+Shift+O`)
- **Bibliothèques favorites** et **récentes** persistées

### 📄 Fichiers
- Nouveau fichier (`Ctrl+N`) avec front matter pré-rempli
- Renommer, Supprimer, Enregistrer sous (`Ctrl+Shift+S`)
- **Renommage intelligent** : met à jour tous les `[[liens]]` et liens relatifs du workspace
- Backup automatique `.bak` avant sauvegarde
- Note du jour (`Ctrl+D`) — création/ouverture de `YYYY-MM-DD.md`
- **Menu contextuel** (clic droit sur un fichier) : Ouvrir, Afficher dans le Finder / Explorateur, Renommer, Copier le chemin, Favoris, Supprimer

### ✏️ Édition
- CodeMirror 6 avec highlight Markdown + wiki-links
- **Autocomplétion `[[page]]`** sur les fichiers du workspace
- **Snippets** configurables (`todo`, `done`, `date`, `now`, `table`, `code`, `note`, `fm`, …)
- **Drag & drop d'images** — sauvegarde auto dans `assets/`, insertion du lien markdown
- **Checkbox interactives** — cliquer `- [ ]` dans le preview modifie le source
- Fold/unfold des sections par heading
- Menu contextuel + raccourcis de formatage (gras, italique, titres, listes, citation, code...)

### 🔗 Liens & navigation
- **Wiki-links** `[[page]]` avec navigation au clic
- **Liens non résolus** en rouge — proposition de créer le fichier
- **Backlinks** — « Qui pointe vers ce fichier ? »
- **Audit des liens cassés** sur tout le workspace
- **Outline / TOC** — table des matières du document actif, scroll au clic

### 🔍 Recherche
- Recherche plein-texte multi-fichiers (scan direct des fichiers, insensible à la casse)
- **Recherche & remplace multi-fichiers** avec preview diff par fichier (`Ctrl+Shift+H`)
- **Quick Open** (`Ctrl+P`) — fuzzy search sur les noms de fichiers
- **Panneau tags** — tous les `#tag` inline ou front matter du workspace

### 🗂️ Multi-documents
- **Onglets** avec dirty indicator + middle-click-close
- Tri de l'arbre (Nom / Date / Taille) avec direction inversible
- **Favoris fichiers** (épinglés en haut) et **historique** des récents
- Métadonnées contextuelles (date relative, taille) selon le tri

### 🕸️ Vue graphe (`Alt+4`)
- **Graphe local** — connexions du fichier actif (profondeur 1–3 sauts)
- **Graphe global** — carte complète du workspace
- **Filtres** — dossier, tags (multi-sélection), orphelins on/off
- **Navigation** — clic = ouvre + recentre, double-clic = ouvre en mode split
- **Plein écran** (bouton dédié, `Esc` pour sortir)
- Rendu Canvas + `d3-force` (léger, thème auto via CSS vars)

### 📤 Export
- **Exporter en HTML** (fichier autonome avec styles)
- **Exporter en PDF** — boîte de dialogue d'impression native, CSS print dédié (A4, sauts de page, blocs insécables)
- **Exporter en site statique** — tout le workspace en HTML : sidebar de navigation, backlinks par page, pages de tags, `sitemap.xml` + canonical links optionnels (`baseurl`), thème clair/sombre/auto, copie de `assets/`
- **Copier en HTML riche** (presse-papiers → coller dans un email)
- **Copier pour WhatsApp** (`Ctrl+Shift+W`) — conversion du Markdown vers la syntaxe *WhatsApp*

### 📥 Import PDF
- **Conversion PDF → Markdown** via [pdf-inspector](https://github.com/firecrawl/pdf-inspector) (100 % local, pas d'OCR, pas d'API)
- Trois points d'entrée : commande palette, bouton sur l'écran d'accueil, glisser-déposer depuis le Finder n'importe où dans la fenêtre
- Détection des PDF scannés (signalés comme non convertibles sans OCR)

### 🎓 Découverte
- **Dossier démo** — bouton sur l'écran d'accueil + entrée permanente dans la modale des bibliothèques (copie 10 notes liées dans `Documents/MD-Workshop-Demo/`)

### 🎨 Interface
- **Thème clair / sombre**
- Paramètres (`Ctrl+,`) : police, taille, wrap, numéros, tab size, thème, mode par défaut
- Vues **Édition / Split / Aperçu / Graphe** redimensionnables
- **Mode présentation** (`Alt+5`) — `---` sépare les slides, plein écran, navigation clavier, mode focus (`F`)
- Sidebar + split redimensionnables, tailles persistées
- **Palette de commandes** (`Ctrl+Shift+P`)
- **Barre de statut** (type Notepad++) : position curseur, caractères, mots, lignes, encodage UTF-8, EOL

## Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Ctrl+N` | Nouveau fichier |
| `Ctrl+O` | Ouvrir un dossier |
| `Ctrl+Shift+O` | Changer de bibliothèque |
| `Ctrl+P` | Aller au fichier |
| `Ctrl+Shift+P` | Palette de commandes |
| `Ctrl+S` | Enregistrer |
| `Ctrl+Shift+S` | Enregistrer sous |
| `Ctrl+W` | Fermer l'onglet |
| `Ctrl+D` | Note du jour |
| `Ctrl+Shift+H` | Recherche & remplace |
| `Ctrl+Shift+W` | Copier pour WhatsApp |
| `Ctrl+,` | Paramètres |
| `Alt+1/2/3/4` | Mode édition / split / aperçu / graphe |
| `Alt+5` | Mode présentation (slides) |

## Architecture

- `src/` — frontend React
  - `components/` — UI (FileTree, TabBar, CommandPalette, SettingsDialog, SnippetsDialog, BrokenLinksDialog, LibrarySwitcher, LibraryPicker, PreviewPane, MarkdownEditor, **GraphView**, **GraphControls**…)
  - `lib/` — codemirror, markdown, wikilinks, settings, snippets, editorActions
  - `types.ts` — interfaces partagées avec Rust
- `src-tauri/` — backend Rust
  - `lib.rs` — commandes Tauri (fs, index, rename, export, images, **graph**, **load_demo**…)
  - `db.rs` — schéma SQLite + FTS5, reindex incrémental, backlinks, tags, broken-links, **graph queries**
- `demo/` — dossier de démonstration bundlé (10 notes interconnectées)

## Prérequis

### Windows
- Node.js 18+
- Rust + Cargo
- WebView2 (préinstallé sur Windows 10/11)
- Visual Studio Build Tools pour la compilation Rust/Tauri

### Linux / macOS
- Toolchain Tauri 2 (voir [tauri.app](https://tauri.app/start/prerequisites/))

## Installation

```bash
npm install
npm run tauri dev
```

## Build de production

```bash
npm run tauri build
```

## Index SQLite

L'index est stocké dans `<workspace>/.md-workshop/index.db`. Il est re-généré à l'ouverture du dossier et mis à jour de façon incrémentale à chaque sauvegarde.

Le FTS5 est actuellement utilisé par l'index interne du workspace. La recherche visible dans l'UI reste, pour l'instant, un scan direct des fichiers Markdown.

Tables principales :
- `indexed_files` — métadonnées (path, mtime, size)
- `fts_content` — plein-texte FTS5
- `wiki_links` / `md_links` — arêtes du graphe
- `tags` — index des `#tag` inline et front matter

## Roadmap

Voir [ROADMAP.md](./ROADMAP.md). 34/41 features faites (≈ 83 %) — la **v0.6.0** ajoute l'export site statique, l'export PDF et le mode présentation. Restent principalement les templates / table editor / minimap (Phase 5), l'export livre multi-doc et le front matter typé (Phase 7).

## Changelog

Voir [CHANGELOG.md](./CHANGELOG.md) pour l'historique détaillé des versions.

## Licence

MIT — voir [LICENSE](./LICENSE).
