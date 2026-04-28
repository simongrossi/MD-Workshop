import DOMPurify from 'dompurify';
import { marked } from 'marked';
// `wikiLinkExtension` is already registered globally via lib/markdown.ts; we
// just rely on the same shared `marked` instance here so wiki-links render
// consistently in slides.

/**
 * Strip the YAML front matter, then split the body on lines that are exactly
 * `---` (with optional whitespace). Returns the raw markdown chunks per slide.
 *
 * A document with no `---` separators yields a single slide containing the
 * whole body. Empty leading/trailing slides are dropped.
 */
export function splitSlides(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n');

  let body = normalized;
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (fmMatch) {
    body = normalized.slice(fmMatch[0].length);
  }

  // Split on a line that contains only `---` (or `***` / `___`, the alternate
  // CommonMark thematic breaks). Surrounding whitespace tolerated.
  const slides = body
    .split(/\n[ \t]*(?:---+|\*\*\*+|___+)[ \t]*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (slides.length === 0) {
    return [''];
  }
  return slides;
}

export function renderSlideHtml(markdown: string): string {
  try {
    const raw = marked.parse(markdown) as string;
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['data-wiki']
    });
  } catch {
    return '<p>Slide invalide.</p>';
  }
}
