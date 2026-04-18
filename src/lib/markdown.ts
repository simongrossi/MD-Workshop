import DOMPurify from 'dompurify';
import { load } from 'js-yaml';
import { marked } from 'marked';
import { wikiLinkExtension } from './wikilinks';

marked.setOptions({
  breaks: true,
  gfm: true
});

marked.use(wikiLinkExtension);

type SplitFrontMatterResult = {
  html: string;
  frontMatter: Record<string, unknown>;
  excerpt: string;
  frontMatterError: string | null;
  rawFrontMatter: string;
};

function parseFrontMatter(content: string) {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);

  if (!match) {
    return {
      body: normalized,
      frontMatter: {},
      frontMatterError: null,
      rawFrontMatter: ''
    };
  }

  const rawFrontMatter = match[1];
  const body = normalized.slice(match[0].length);

  try {
    const parsed = load(rawFrontMatter);

    if (!parsed) {
      return {
        body,
        frontMatter: {},
        frontMatterError: null,
        rawFrontMatter
      };
    }

    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        body,
        frontMatter: parsed as Record<string, unknown>,
        frontMatterError: null,
        rawFrontMatter
      };
    }

    return {
      body,
      frontMatter: { value: parsed },
      frontMatterError: null,
      rawFrontMatter
    };
  } catch (error) {
    return {
      body,
      frontMatter: {},
      frontMatterError: error instanceof Error ? error.message : 'Front matter invalide.',
      rawFrontMatter
    };
  }
}

/**
 * Post-process the rendered HTML to tag each task-list checkbox with its
 * global index (matching the N-th `- [ ]` or `- [x]` line in the source).
 * This allows the preview to toggle checkboxes back in the source on click.
 */
function annotateCheckboxes(html: string): string {
  let index = 0;
  return html.replace(
    /<input\b([^>]*?)type="checkbox"([^>]*?)>/gi,
    (_match, before: string, after: string) => {
      const i = index++;
      // Keep original attrs but strip "disabled" and add data-checkbox-index + class
      const combined = `${before}${after}`
        .replace(/\sdisabled(=("[^"]*"|'[^']*'|[^>\s]*))?/gi, '')
        .trim();
      return `<input type="checkbox" data-checkbox-index="${i}" class="md-checkbox"${combined ? ' ' + combined : ''}>`;
    }
  );
}

// Tiny LRU around the full Markdown parse + sanitize pipeline. Multiple
// components (PreviewPane, OutlinePanel, App status bar) call this with the
// same content on the same render pass; caching short-circuits the expensive
// marked + DOMPurify work for identical input.
const SPLIT_CACHE_SIZE = 4;
const splitCache = new Map<string, SplitFrontMatterResult>();

function runSplitFrontMatter(content: string): SplitFrontMatterResult {
  const parsed = parseFrontMatter(content);

  let html = '';

  try {
    const rawHtml = marked.parse(parsed.body) as string;
    const withCheckboxes = annotateCheckboxes(rawHtml);
    html = DOMPurify.sanitize(withCheckboxes, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['data-wiki', 'data-checkbox-index']
    });
    html = html.replace(/<img(?![^>]*\bloading=)/gi, '<img loading="lazy"');
  } catch {
    html = '<p>Impossible de générer l’aperçu de ce document.</p>';
  }

  return {
    html,
    frontMatter: parsed.frontMatter,
    excerpt: parsed.body.slice(0, 240).trim(),
    frontMatterError: parsed.frontMatterError,
    rawFrontMatter: parsed.rawFrontMatter
  };
}

export function splitFrontMatter(content: string): SplitFrontMatterResult {
  const cached = splitCache.get(content);
  if (cached) {
    // bump to most-recent
    splitCache.delete(content);
    splitCache.set(content, cached);
    return cached;
  }
  const result = runSplitFrontMatter(content);
  splitCache.set(content, result);
  if (splitCache.size > SPLIT_CACHE_SIZE) {
    const oldest = splitCache.keys().next().value;
    if (oldest !== undefined) splitCache.delete(oldest);
  }
  return result;
}

/**
 * Toggle the N-th checkbox in the given markdown source.
 * Counts occurrences of `- [ ]` / `- [x]` (and `* [ ]`, `+ [ ]`) in the body
 * (skipping front matter), flips the N-th one.
 */
export function toggleCheckboxInSource(source: string, index: number): string | null {
  // Handle CRLF safely
  const normalized = source.replace(/\r\n/g, '\n');

  // Split front matter from body to get the correct offset
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const bodyOffset = fmMatch ? fmMatch[0].length : 0;
  const body = normalized.slice(bodyOffset);

  const checkboxRegex = /(^|\n)([ \t]*(?:[-*+]|\d+\.)[ \t]+)\[([ xX])\]/g;

  let count = 0;
  let found = false;

  const newBody = body.replace(checkboxRegex, (full, lead: string, prefix: string, state: string) => {
    const current = count;
    count += 1;
    if (current === index && !found) {
      found = true;
      const next = state === ' ' ? 'x' : ' ';
      return `${lead}${prefix}[${next}]`;
    }
    return full;
  });

  if (!found) return null;
  return normalized.slice(0, bodyOffset) + newBody;
}
