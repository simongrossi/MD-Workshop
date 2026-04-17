import { Node, mergeAttributes } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';
import type { MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node as ProseNode } from 'prosemirror-model';

// Inline wiki-link node: renders `[[Target]]` or `[[Target|Display]]`.
// Round-trip: markdown-it plugin parses `[[...]]` → <a class="wiki-link" data-wiki="...">display</a>;
// ProseMirror picks it up via parseHTML; serialize emits `[[target]]` or `[[target|display]]`.

const WIKI_RE = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/;
const WIKI_RE_G = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g;

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function wikiLinkMarkdownItPlugin(md: MarkdownIt) {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;
    if (state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;

    const rest = state.src.slice(state.pos);
    const match = WIKI_RE.exec(rest);
    if (!match || match.index !== 0) return false;

    if (!silent) {
      const target = match[1].trim();
      const display = (match[2] ?? match[1]).trim();
      const token = state.push('wikilink', '', 0);
      token.meta = { target, display };
      token.content = display;
      token.markup = match[0];
    }
    state.pos += match[0].length;
    return true;
  });

  md.renderer.rules.wikilink = (tokens, idx) => {
    const meta = (tokens[idx].meta ?? {}) as { target?: string; display?: string };
    const target = escapeHtml(meta.target ?? '');
    const display = escapeHtml(meta.display ?? meta.target ?? '');
    return `<a class="wiki-link" data-wiki="${target}">${display}</a>`;
  };
}

export const WikiLink = Node.create({
  name: 'wikiLink',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-wiki') ?? '',
        renderHTML: (attrs) => ({ 'data-wiki': attrs.target }),
      },
      display: {
        default: '',
        parseHTML: (el) => el.textContent ?? '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a.wiki-link',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          if (!el.classList.contains('wiki-link')) return false;
          return {
            target: el.getAttribute('data-wiki') ?? '',
            display: el.textContent ?? '',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const display = (node.attrs.display as string) || (node.attrs.target as string) || '';
    return [
      'a',
      mergeAttributes(HTMLAttributes, { class: 'wiki-link' }),
      display,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseNode) {
          const target = (node.attrs.target as string) ?? '';
          const display = (node.attrs.display as string) ?? '';
          if (display && display !== target) {
            state.write(`[[${target}|${display}]]`);
          } else {
            state.write(`[[${target}]]`);
          }
        },
        parse: {
          setup(md: MarkdownIt) {
            wikiLinkMarkdownItPlugin(md);
          },
        },
      },
    };
  },
});

// Pre-escape utility: given already-rendered HTML text that the user pasted or typed,
// you might want to linkify raw `[[...]]` occurrences. Exposed for callers that need it.
export function findWikiLinkRanges(source: string): Array<{ start: number; end: number; target: string; display: string }> {
  const out: Array<{ start: number; end: number; target: string; display: string }> = [];
  const re = new RegExp(WIKI_RE_G.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      target: m[1].trim(),
      display: (m[2] ?? m[1]).trim(),
    });
  }
  return out;
}
