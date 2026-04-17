import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { expandSnippet, type Snippet } from './snippets';
import { markdown } from '@codemirror/lang-markdown';
import { foldGutter, foldKeymap } from '@codemirror/language';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  keymap,
  lineNumbers,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';
import { Compartment, EditorState, Facet } from '@codemirror/state';

// ── Wiki-link highlighting ─────────────────────────────────────────────

const wikiLinkMark = Decoration.mark({ class: 'cm-wikilink' });

const wikiLinkMatcher = new MatchDecorator({
  regexp: /\[\[[^\]]+?\]\]/g,
  decoration: wikiLinkMark
});

const wikiLinkHighlight = ViewPlugin.define(
  (view) => ({
    decorations: wikiLinkMatcher.createDeco(view) as DecorationSet,
    update(update: ViewUpdate) {
      this.decorations = wikiLinkMatcher.updateDeco(update, this.decorations);
    }
  }),
  { decorations: (v) => v.decorations }
);

// ── Wiki-link file list facet ──────────────────────────────────────────

export type WikiLinkFile = {
  /** Display label (file stem, e.g. "My Note") */
  label: string;
  /** Relative path for secondary info, e.g. "folder/My Note.md" */
  detail: string;
};

/**
 * Facet that holds the list of files available for [[ completion.
 * Multiple providers are combined by concatenation.
 */
export const wikiLinkFilesFacet = Facet.define<WikiLinkFile[], WikiLinkFile[]>({
  combine: (values) => values.flat()
});

/**
 * Compartment used to dynamically update the file list without
 * recreating the entire editor state.
 */
export const wikiLinkFilesCompartment = new Compartment();

// ── Snippets facet & completion ────────────────────────────────────────

export const snippetsFacet = Facet.define<Snippet[], Snippet[]>({
  combine: (values) => values.flat()
});

export const snippetsCompartment = new Compartment();

function snippetCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[a-zA-Z_][\w-]*/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;

  const snippets = context.state.facet(snippetsFacet);
  if (snippets.length === 0) return null;

  const prefix = word.text.toLowerCase();
  const matches = snippets.filter((s) => s.prefix.toLowerCase().startsWith(prefix));
  if (matches.length === 0) return null;

  const options: Completion[] = matches.map((snippet) => ({
    label: snippet.prefix,
    displayLabel: snippet.label,
    detail: 'snippet',
    info: snippet.description,
    type: 'snippet',
    apply: (view, _completion, from, to) => {
      const { text, cursorOffset } = expandSnippet(snippet.body);
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + cursorOffset }
      });
    }
  }));

  return {
    from: word.from,
    options,
    filter: false
  };
}

// ── Settings compartments ──────────────────────────────────────────────

/** Compartment for the theme (font size, font family) */
export const editorThemeCompartment = new Compartment();
/** Compartment for line wrapping */
export const lineWrapCompartment = new Compartment();
/** Compartment for line numbers */
export const lineNumbersCompartment = new Compartment();
/** Compartment for tab size */
export const tabSizeCompartment = new Compartment();

export type EditorSettings = {
  fontSize: number;
  fontFamily: string;
  lineWrap: boolean;
  lineNumbers: boolean;
  tabSize: number;
};

export function buildEditorTheme(fontSize: number, fontFamily: string) {
  return EditorView.theme({
    '&': {
      fontSize: `${fontSize}px`
    },
    '.cm-scroller': {
      fontFamily
    }
  });
}

// ── Wiki-link completion source ────────────────────────────────────────

function wikiLinkCompletion(context: CompletionContext): CompletionResult | null {
  // Match `[[` optionally followed by partial text (no `]` yet)
  const match = context.matchBefore(/\[\[[^\]]*$/);
  if (!match) return null;

  // The text after `[[`
  const query = match.text.slice(2).toLowerCase();

  const files = context.state.facet(wikiLinkFilesFacet);
  if (files.length === 0) return null;

  const options = files
    .filter((f) => !query || f.label.toLowerCase().includes(query) || f.detail.toLowerCase().includes(query))
    .map((f) => ({
      label: f.label,
      detail: f.detail,
      // Replace from after `[[` to cursor, and append `]]`
      apply: `${f.label}]]`
    }));

  if (options.length === 0) return null;

  return {
    from: match.from + 2, // after the `[[`
    options,
    filter: false // we already filtered above
  };
}

// ── Factory ────────────────────────────────────────────────────────────

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 14,
  fontFamily: '"Cascadia Code", Consolas, monospace',
  lineWrap: true,
  lineNumbers: true,
  tabSize: 2
};

export function createMarkdownState(
  doc: string,
  onChange: (value: string) => void,
  files: WikiLinkFile[] = [],
  editorSettings: EditorSettings = DEFAULT_EDITOR_SETTINGS,
  snippets: Snippet[] = []
) {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbersCompartment.of(editorSettings.lineNumbers ? lineNumbers() : []),
      history(),
      drawSelection(),
      dropCursor(),
      highlightSelectionMatches(),
      foldGutter(),
      markdown(),
      wikiLinkHighlight,
      wikiLinkFilesCompartment.of(wikiLinkFilesFacet.of(files)),
      snippetsCompartment.of(snippetsFacet.of(snippets)),
      autocompletion({
        override: [wikiLinkCompletion, snippetCompletion],
        activateOnTyping: true
      }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap]),
      lineWrapCompartment.of(editorSettings.lineWrap ? EditorView.lineWrapping : []),
      editorThemeCompartment.of(buildEditorTheme(editorSettings.fontSize, editorSettings.fontFamily)),
      tabSizeCompartment.of(EditorState.tabSize.of(editorSettings.tabSize)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      })
    ]
  });
}
