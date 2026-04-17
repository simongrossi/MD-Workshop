import type { MarkedExtension, Tokens } from 'marked';
import type { MarkdownFileEntry } from '../types';

// ── Regex ──────────────────────────────────────────────────────────────
// Matches [[target]] and [[target|display text]]
export const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

// ── Helpers ────────────────────────────────────────────────────────────

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripMdExtension(name: string) {
  return name.replace(/\.(md|markdown|mdx)$/i, '');
}

// ── marked extension ───────────────────────────────────────────────────

export const wikiLinkExtension: MarkedExtension = {
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start(src: string) {
        return src.indexOf('[[');
      },
      tokenizer(src: string) {
        const match = /^\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/.exec(src);
        if (match) {
          return {
            type: 'wikilink',
            raw: match[0],
            target: match[1].trim(),
            display: (match[2] ?? match[1]).trim()
          } as Tokens.Generic;
        }
      },
      renderer(token: Tokens.Generic) {
        const target = escapeHtml(token['target'] as string);
        const display = escapeHtml(token['display'] as string);
        return `<a class="wiki-link" data-wiki="${target}">${display}</a>`;
      }
    }
  ]
};

// ── Resolution ─────────────────────────────────────────────────────────

export function resolveWikiLink(
  name: string,
  files: MarkdownFileEntry[]
): MarkdownFileEntry | null {
  const normalizedTarget = stripMdExtension(name.trim()).toLowerCase();

  // 1. Match by filename (without extension)
  for (const file of files) {
    const fileName = stripMdExtension(file.name).toLowerCase();
    if (fileName === normalizedTarget) return file;
  }

  // 2. Match by relative path (without extension)
  for (const file of files) {
    const relPath = stripMdExtension(file.relative_path.replace(/\\/g, '/')).toLowerCase();
    if (relPath === normalizedTarget.replace(/\\/g, '/')) return file;
  }

  return null;
}

export function resolveRelativeLink(
  href: string,
  activeFilePath: string,
  files: MarkdownFileEntry[]
): MarkdownFileEntry | null {
  // Only handle relative paths to markdown files
  if (!href || /^[a-z]+:\/\//i.test(href) || href.startsWith('#')) return null;
  if (!/\.(md|markdown|mdx)$/i.test(href)) return null;

  // Resolve relative to the active file's directory
  const activeDir = activeFilePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  const resolved = normalizePath(`${activeDir}/${href}`);

  for (const file of files) {
    if (file.path.replace(/\\/g, '/').toLowerCase() === resolved.toLowerCase()) {
      return file;
    }
  }

  return null;
}

function normalizePath(path: string) {
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return parts.join('/');
}
