# Roadmap — MD Workshop

Vision : l'outil ultime léger du Markdown. Un Obsidian minimaliste, rapide, sans bloat.

---

## Phase 1 — Liens & Navigation

- [x] Wiki-links `[[page]]` (parsing, rendu, résolution)
- [x] Navigation au clic (cliquer un lien dans le preview ouvre le fichier)
- [x] Autocomplétion `[[` dans l'éditeur (dropdown des fichiers du workspace)
- [x] Liens non résolus (highlight des `[[liens]]` pointant vers des fichiers inexistants)
- [x] Création depuis lien (cliquer un lien non résolu propose de créer le fichier)

## Phase 2 — Backlinks & Contexte

- [x] Panneau backlinks ("Qui pointe vers ce fichier ?")
- [x] Outline / TOC (table des matières par headings du document actif)
- [x] Tags `#tag` inline (parsing dans le contenu, pas seulement le front matter)
- [x] Panneau de tags (vue latérale, clic pour filtrer)

## Phase 3 — Multi-documents & Productivité

- [x] Onglets multi-documents
- [x] Palette de commandes (`Ctrl+Shift+P`)
- [x] Daily notes (raccourci pour créer/ouvrir la note du jour)
- [x] Fichiers récents (historique)
- [x] Favoris / épingles en haut de l'arbre
- [x] Tri de l'arbre (nom, date, taille)

## Phase 4 — Vue Graphe

- [x] Graphe local (connexions du fichier actif, 1 niveau)
- [x] Graphe global (carte du workspace entier)
- [x] Filtrage du graphe (par tag, dossier, profondeur)
- [x] Navigation depuis le graphe (clic → ouvre le fichier)

## Phase 5 — Édition avancée

- [ ] **Templates avec variables** — modèles `meeting.md`, `book-note.md`… avec placeholders (`{{date}}`, `{{title}}`, prompt utilisateur). À combiner avec `Ctrl+D` pour des dailies pré-remplies
- [x] Snippets (raccourcis pour blocs récurrents)
- [x] Checkbox interactives (cocher dans le preview met à jour le source)
- [x] Fold/unfold des sections par heading
- [x] Drag & drop d'images (sauvegarde dans `assets/` + insertion du lien)
- [ ] **Cross-références cliquables** — auto-numérotation `Figure N` / `Tableau N` / `Équation N` + syntaxe `[@fig:nom]` → ancre cliquable (rendu preview + export site)
- [ ] Table editor (édition visuelle des tableaux markdown)
- [ ] Minimap

## Phase 6 — Recherche & Indexation

- [x] Index SQLite côté Rust (contenu, liens, tags)
- [x] Recherche par tags
- [x] Recherche & remplace multi-fichiers
- [x] Audit des liens cassés
- [x] Renommage intelligent (renommer un fichier met à jour tous les `[[liens]]`)

## Phase 7 — Export & Personnalisation

- [x] Thèmes light/dark (custom à venir)
- [x] **Export PDF** — boîte de dialogue d'impression native via iframe + `window.print()`. CSS print dédié (A4, marges 18/16 mm, sauts de page sur `<h1>`, blocs insécables)
- [ ] **Export livre / multi-doc PDF** — compiler un dossier ou une sélection de notes en un seul PDF avec TOC, numéros de page, chapitres = headings. Coche la case « Book/article export » du comparatif Quarkdown
- [x] **Import PDF** (conversion PDF → Markdown via pdf-inspector, sans OCR)
- [x] Export HTML statique (mini-site) — site complet du workspace avec sidebar, backlinks, pages tags, sitemap.xml optionnel
- [x] Copier en HTML riche (pour coller dans un email)
- [x] **Mode présentation / slides** — `---` = saut de slide, mode plein écran (`Alt+5`), navigation `←` / `→` / `Espace` / `Home` / `End` / `Esc`, mode focus `F`. Réutilise le rendu preview
- [ ] Front matter intelligent (autocomplétion des clés)
- [ ] Propriétés typées dans le front matter (dates, listes, booléens)

---

## Volontairement exclu

Ces fonctionnalités sortent de la philosophie « léger, sans bloat » et ne
sont pas prévues — pas un oubli, un choix.

- **Système de plugins** — multiplie surface de bugs et complexité. Si une
  fonctionnalité est utile à 80 % des utilisateurs, elle doit être native ;
  sinon elle ne doit pas exister
- **Sync cloud / serveur propriétaire** — les fichiers restent locaux.
  Utilisez Syncthing, iCloud Drive, Dropbox, Git
- **Langage de scripting dans les notes** — Markdown reste Markdown. Les
  templates avec variables (Phase 5) couvrent 95 % des cas, sans dialecte
  propriétaire à apprendre
- **Éditeur WYSIWYG** — l'édition reste source-first (CodeMirror). Le mode
  preview sert à *voir*, pas à éditer en mode Word
- **Collaboration temps réel** — pas l'usage cible (notes personnelles ou
  petites équipes asynchrones)
