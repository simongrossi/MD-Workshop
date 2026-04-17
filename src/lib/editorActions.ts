import { redo, undo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type MarkdownEditorActionId =
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'numberedList'
  | 'quote'
  | 'codeBlock'
  | 'link'
  | 'checklist';

export type EditorActionItem = {
  id: MarkdownEditorActionId;
  label: string;
};

export const EDITOR_CONTEXT_MENU_GROUPS: EditorActionItem[][] = [
  [
    { id: 'undo', label: 'Annuler' },
    { id: 'redo', label: 'Rétablir' }
  ],
  [
    { id: 'copy', label: 'Copier' },
    { id: 'cut', label: 'Couper' },
    { id: 'paste', label: 'Coller' }
  ],
  [
    { id: 'bold', label: 'Gras' },
    { id: 'italic', label: 'Italique' },
    { id: 'strikethrough', label: 'Barré' },
    { id: 'inlineCode', label: 'Code inline' },
    { id: 'link', label: 'Lien' }
  ],
  [
    { id: 'heading1', label: 'Titre 1' },
    { id: 'heading2', label: 'Titre 2' },
    { id: 'heading3', label: 'Titre 3' },
    { id: 'quote', label: 'Citation' },
    { id: 'codeBlock', label: 'Bloc de code' }
  ],
  [
    { id: 'bulletList', label: 'Liste à puces' },
    { id: 'numberedList', label: 'Liste numérotée' },
    { id: 'checklist', label: 'Checklist' }
  ]
];

export const EDITOR_FORMAT_MENU_ITEMS: EditorActionItem[] = [
  { id: 'bold', label: 'Gras' },
  { id: 'italic', label: 'Italique' },
  { id: 'strikethrough', label: 'Barré' },
  { id: 'inlineCode', label: 'Code inline' },
  { id: 'link', label: 'Lien' },
  { id: 'heading1', label: 'Titre 1' },
  { id: 'heading2', label: 'Titre 2' },
  { id: 'heading3', label: 'Titre 3' },
  { id: 'bulletList', label: 'Liste à puces' },
  { id: 'numberedList', label: 'Liste numérotée' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'quote', label: 'Citation' },
  { id: 'codeBlock', label: 'Bloc de code' }
];

function dispatchSelection(view: EditorView, from: number, to: number, insert: string, selectFrom: number, selectTo: number) {
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.range(selectFrom, selectTo)
  });
  view.focus();
}

function wrapSelection(view: EditorView, prefix: string, suffix: string, placeholder: string) {
  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to);
  const content = selectedText || placeholder;
  const insert = `${prefix}${content}${suffix}`;
  const start = selection.from + prefix.length;
  const end = start + content.length;

  dispatchSelection(view, selection.from, selection.to, insert, start, end);
}

function insertLink(view: EditorView) {
  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to) || 'texte';
  const url = 'https://';
  const insert = `[${selectedText}](${url})`;
  const urlStart = selection.from + selectedText.length + 3;
  const urlEnd = urlStart + url.length;

  dispatchSelection(view, selection.from, selection.to, insert, urlStart, urlEnd);
}

function transformSelectedLines(view: EditorView, transform: (lines: string[]) => string[]) {
  const selection = view.state.selection.main;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const from = startLine.from;
  const to = endLine.to;
  const lines = view.state.sliceDoc(from, to).split('\n');
  const nextLines = transform(lines);
  const insert = nextLines.join('\n');

  dispatchSelection(view, from, to, insert, from, from + insert.length);
}

function togglePrefix(lines: string[], prefix: string) {
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const shouldRemove = nonEmptyLines.length > 0 && nonEmptyLines.every((line) => line.startsWith(prefix));

  if (shouldRemove) {
    return lines.map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line));
  }

  return lines.map((line) => (line.trim().length === 0 ? line : `${prefix}${line}`));
}

function toggleChecklist(lines: string[]) {
  const checklistPattern = /^- \[ \] /;
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const shouldRemove = nonEmptyLines.length > 0 && nonEmptyLines.every((line) => checklistPattern.test(line));

  if (shouldRemove) {
    return lines.map((line) => line.replace(checklistPattern, ''));
  }

  return lines.map((line) => (line.trim().length === 0 ? line : `- [ ] ${line}`));
}

function toggleNumberedList(lines: string[]) {
  const numberedPattern = /^\d+\.\s/;
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const shouldRemove = nonEmptyLines.length > 0 && nonEmptyLines.every((line) => numberedPattern.test(line));

  if (shouldRemove) {
    return lines.map((line) => line.replace(numberedPattern, ''));
  }

  let index = 1;
  return lines.map((line) => {
    if (line.trim().length === 0) return line;
    const value = `${index}. ${line}`;
    index += 1;
    return value;
  });
}

function applyHeading(view: EditorView, level: 1 | 2 | 3) {
  const prefix = `${'#'.repeat(level)} `;

  transformSelectedLines(view, (lines) =>
    lines.map((line) => {
      if (line.trim().length === 0) return line;
      const stripped = line.replace(/^#{1,6}\s+/, '');
      return `${prefix}${stripped}`;
    })
  );
}

function insertCodeBlock(view: EditorView) {
  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to) || 'code';
  const insert = ['```', selectedText, '```'].join('\n');
  const start = selection.from + 4;
  const end = start + selectedText.length;

  dispatchSelection(view, selection.from, selection.to, insert, start, end);
}

async function copySelection(view: EditorView) {
  const selection = view.state.selection.main;
  const text = view.state.sliceDoc(selection.from, selection.to);
  if (!text || !navigator.clipboard?.writeText) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Ignore clipboard errors when the environment does not allow writing.
  }
}

async function cutSelection(view: EditorView) {
  const selection = view.state.selection.main;
  const text = view.state.sliceDoc(selection.from, selection.to);
  if (!text) return;

  await copySelection(view);
  dispatchSelection(view, selection.from, selection.to, '', selection.from, selection.from);
}

async function pasteClipboard(view: EditorView) {
  if (!navigator.clipboard?.readText) return;
  let text = '';

  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }

  const selection = view.state.selection.main;
  const cursor = selection.from + text.length;

  dispatchSelection(view, selection.from, selection.to, text, cursor, cursor);
}

export async function runEditorAction(view: EditorView, actionId: MarkdownEditorActionId) {
  switch (actionId) {
    case 'undo':
      undo(view);
      break;
    case 'redo':
      redo(view);
      break;
    case 'copy':
      await copySelection(view);
      break;
    case 'cut':
      await cutSelection(view);
      break;
    case 'paste':
      await pasteClipboard(view);
      break;
    case 'bold':
      wrapSelection(view, '**', '**', 'texte');
      break;
    case 'italic':
      wrapSelection(view, '*', '*', 'texte');
      break;
    case 'strikethrough':
      wrapSelection(view, '~~', '~~', 'texte');
      break;
    case 'inlineCode':
      wrapSelection(view, '`', '`', 'code');
      break;
    case 'heading1':
      applyHeading(view, 1);
      break;
    case 'heading2':
      applyHeading(view, 2);
      break;
    case 'heading3':
      applyHeading(view, 3);
      break;
    case 'bulletList':
      transformSelectedLines(view, (lines) => togglePrefix(lines, '- '));
      break;
    case 'numberedList':
      transformSelectedLines(view, toggleNumberedList);
      break;
    case 'quote':
      transformSelectedLines(view, (lines) => togglePrefix(lines, '> '));
      break;
    case 'codeBlock':
      insertCodeBlock(view);
      break;
    case 'link':
      insertLink(view);
      break;
    case 'checklist':
      transformSelectedLines(view, toggleChecklist);
      break;
  }
}
