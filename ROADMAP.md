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

- [ ] Graphe local (connexions du fichier actif, 1 niveau)
- [ ] Graphe global (carte du workspace entier)
- [ ] Filtrage du graphe (par tag, dossier, profondeur)
- [ ] Navigation depuis le graphe (clic → ouvre le fichier)

## Phase 5 — Édition avancée

- [ ] Templates (créer un fichier depuis un modèle)
- [x] Snippets (raccourcis pour blocs récurrents)
- [x] Checkbox interactives (cocher dans le preview met à jour le source)
- [x] Fold/unfold des sections par heading
- [x] Drag & drop d'images (sauvegarde dans `assets/` + insertion du lien)
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
- [ ] Export PDF
- [ ] Export HTML statique (mini-site)
- [x] Copier en HTML riche (pour coller dans un email)
- [ ] Front matter intelligent (autocomplétion des clés)
- [ ] Propriétés typées dans le front matter (dates, listes, booléens)
