---
title: Phase 4 — Vue Graphe
tags: [demo, projet, graphe]
status: livré
---

# Projet : Vue Graphe

## Objectif

Offrir une carte visuelle du réseau de notes, comme dans [[../notes/Obsidian vs MD Workshop|Obsidian]].

## Sous-tâches

- [x] Graphe local (fichier actif + voisins)
- [x] Graphe global (workspace entier)
- [x] Filtres : dossier, tag, profondeur
- [x] Orphelins on/off
- [x] Navigation au clic

## Comment le tester

1. Ouvre n'importe quelle note (ex. [[../Accueil]])
2. `Alt+4` — passe en mode graphe
3. Toggle **Local / Global** en haut
4. Slider **Profondeur** en mode local (1 → 3)
5. Filtre par tag `#projet` ou `#tutoriel` en mode global
6. Clique un nœud → la note s'ouvre, le graphe recentre

## Notes connexes

- [[Idées]] — autres pistes pour la suite
- [[../notes/Wikilinks]] — la base que le graphe exploite
- [[../notes/Tags]] — utilisé pour filtrer

Retour : [[../Accueil]].
