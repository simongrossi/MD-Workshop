---
title: Tags
tags: [demo, tutoriel, inspiration]
---

# Tags

Deux façons de tagger une note.

## 1. Tags inline

Dans le corps d'une note, écris `#motclef`. Exemples dans ce fichier :

Cette idée vient du monde de #tutoriel et de l'#inspiration générale. Elle pourrait servir pour un projet #demo.

Contraintes :
- doit commencer par une lettre (pas `#42`)
- peut contenir `/`, `_`, `-`
- insensible à la casse lors de la recherche

## 2. Tags frontmatter

En haut du fichier, entre deux `---` :

```yaml
---
tags: [projet, idée, urgent]
---
```

Les deux systèmes sont indexés ensemble et apparaissent dans le panneau **Tags** de la barre latérale.

## Utiliser les tags

- Clic sur un tag dans le panneau latéral → ouvre le(s) fichier(s) correspondants
- Dans la [[projets/Phase 4 - Graphe|vue graphe globale]] : filtre les nœuds par tag
- Recherche : taper le tag dans la barre de recherche

## Voir aussi

- [[Wikilinks]]
- [[Markdown 101]]
- [[../Accueil]]
