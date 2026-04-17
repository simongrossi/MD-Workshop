---
title: Markdown 101
tags: [demo, tutoriel]
---

# Markdown 101

Petit rappel de la syntaxe Markdown la plus utile.

## Titres

```
# Titre 1
## Titre 2
### Titre 3
```

## Emphases

- **gras** avec `**texte**`
- *italique* avec `*texte*`
- ~~barré~~ avec `~~texte~~`
- `code inline` avec des backticks

## Listes

- Élément A
- Élément B
  - Sous-élément
- Élément C

1. Premier
2. Deuxième
3. Troisième

## Cases à cocher

- [x] Faire le café
- [ ] Écrire une note
- [ ] Tester la [[projets/Phase 4 - Graphe|vue graphe]]
- [ ] Relire [[Wikilinks]]

> Astuce : dans l'aperçu, clique directement sur une case — le fichier source est mis à jour automatiquement.

## Bloc de code

```python
def hello(name: str) -> str:
    return f"Bonjour {name}"
```

## Citation

> *"Le Markdown, c'est comme la prose, mais structurée."*
> — un dev, quelque part

## Liens

- Lien externe : [Spécification CommonMark](https://commonmark.org)
- Lien relatif : [À propos](../À%20propos.md)
- Wiki-link : [[Wikilinks]] ou [[Tags]]

Retour à l'[[../Accueil]].
