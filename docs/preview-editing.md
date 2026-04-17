# Édition dans la vue Aperçu (WYSIWYG)

Un éditeur WYSIWYG optionnel permet de modifier le document directement dans la vue
Aperçu, sans passer par CodeMirror. Utile pour un flux d'écriture plus naturel —
notamment sur les titres et les paragraphes.

## Activation

Dans la toolbar, en mode **Split** ou **Aperçu**, un bouton `Aperçu éditable`
apparaît. Cliquer dessus bascule entre :

- **Aperçu lecture seule** (par défaut) : rendu HTML statique, cases à cocher
  cliquables, wiki-links navigables.
- **Aperçu éditable** : l'aperçu devient un éditeur WYSIWYG basé sur
  [TipTap](https://tiptap.dev/) / ProseMirror.

L'état est mémorisé dans `localStorage` sous la clé
`md-workshop:preview-editable` et restauré au démarrage.

## Ce qui est éditable

- Titres (`#`, `##`, …, `######`)
- Paragraphes, gras, italique, code inline, liens
- Listes à puces et numérotées
- Citations, blocs de code, ligne horizontale
- Wiki-links : taper `[[Note]]` ou `[[Note|Label]]` — rendu comme lien cliquable,
  conservé tel quel à la sauvegarde.
- Images : les chemins relatifs (`./assets/img.png`) sont résolus à l'affichage via
  `convertFileSrc` de Tauri, mais le chemin original est toujours ce qui est
  sauvegardé dans le fichier `.md`.

Le **front matter YAML** reste hors de l'éditeur WYSIWYG : il est affiché dans le
panneau latéral comme avant et réinjecté byte-à-byte lors de la sauvegarde.

## Synchronisation avec l'éditeur CodeMirror (mode Split)

La source de vérité reste `OpenedDocument.content` (chaîne markdown).

- Taper dans CodeMirror → l'aperçu WYSIWYG se met à jour sans perdre le curseur.
- Taper dans l'aperçu → CodeMirror se met à jour, via une sérialisation markdown
  debouncée (150 ms). Aucun feedback loop : un garde sur la dernière valeur émise
  coupe le cycle quand la prop revient identique.

Ctrl+S déclenche la sauvegarde habituelle via l'IPC Tauri.

## Bibliothèque et extensions

| Paquet | Rôle |
|---|---|
| `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` | Cœur TipTap et nodes standard. |
| `@tiptap/extension-image` | Node image (étendu pour résoudre les chemins Tauri). |
| `tiptap-markdown` | Parser/sérialiseur markdown (basé sur `markdown-it`). |
| `markdown-it` | Parser markdown utilisé par `tiptap-markdown`, étendu d'un plugin maison pour les wiki-links. |

## Wiki-links (détails techniques)

Le node `wikiLink` (inline, atomique) est défini dans
[`src/lib/tiptap/wikiLink.ts`](../src/lib/tiptap/wikiLink.ts). Il :

1. Enregistre une règle markdown-it sur `[[...]]` qui produit un token rendu en
   `<a class="wiki-link" data-wiki="...">display</a>` — format identique à celui
   que `marked` produit dans l'aperçu readonly. ProseMirror absorbe ce HTML via le
   `parseHTML` du node.
2. Sérialise le node TipTap en `[[target]]` ou `[[target|display]]` selon les
   attributs.
3. Les wiki-links non résolus sont marqués avec la classe `unresolved` par un
   `useEffect` qui scanne le DOM après chaque mise à jour et consulte la liste
   des fichiers du workspace (réutilise `resolveWikiLink`).

## Images et chemins Tauri

`TauriImage` ([`src/lib/tiptap/imageNode.ts`](../src/lib/tiptap/imageNode.ts))
stocke le chemin relatif original dans l'attribut `src` du node et dans
`data-raw-src`. À l'affichage, un `convertFileSrc` produit l'URL `asset:`
utilisée pour le rendu uniquement — la sérialisation markdown émet toujours le
chemin brut.

Le contexte de résolution (chemin du fichier actif + `rootFolder`) est injecté
via `setImageResolverContext()` par `PreviewEditor.tsx`.

## Limites connues

- **Undo séparés** : CodeMirror et TipTap ont chacun leur pile d'undo ; en mode
  Split, `Ctrl+Z` agit sur le pane focus.
- **Normalisation** : les styles markdown non-canoniques (titres `===`,
  marqueurs `*` pour les listes) sont normalisés lors d'une édition dans
  l'aperçu (→ `#`, `-`). C'est cosmétique.
- **Blocs adjacents image + texte** : deux paragraphes successifs contenant
  uniquement une image peuvent être fusionnés par le parser. Pas bloquant,
  à surveiller.
- **Raccourcis markdown-style** (taper `## ` pour obtenir un H2) : non encore
  câblés.
- **Checkbox `- [ ]`** : toggle interactif désactivé en mode éditable (éditer
  directement le texte). La vue readonly garde le toggle cliquable.

## Code concerné

- [`src/components/PreviewPane.tsx`](../src/components/PreviewPane.tsx) — switch entre readonly et éditable.
- [`src/components/PreviewPaneReadonly.tsx`](../src/components/PreviewPaneReadonly.tsx) — rendu readonly (ancien comportement).
- [`src/components/PreviewEditor.tsx`](../src/components/PreviewEditor.tsx) — composant TipTap.
- [`src/lib/tiptap/`](../src/lib/tiptap/) — extensions, nodes, helpers front-matter.
