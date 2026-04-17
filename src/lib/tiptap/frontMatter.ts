// Split YAML front matter from a markdown document so the body can be fed into
// TipTap without the WYSIWYG touching the YAML block.

export type FrontMatterSplit = {
  raw: string;           // The raw "---\n...\n---\n" block (empty string if none)
  body: string;          // Everything after front matter
  hadFrontMatter: boolean;
  eol: '\n' | '\r\n';    // End-of-line style of the original source
};

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function splitDocument(source: string): FrontMatterSplit {
  const eol: '\n' | '\r\n' = /\r\n/.test(source) ? '\r\n' : '\n';
  const match = source.match(FRONT_MATTER_RE);
  if (!match) {
    return { raw: '', body: source, hadFrontMatter: false, eol };
  }
  const raw = match[0];
  const body = source.slice(raw.length);
  return { raw, body, hadFrontMatter: true, eol };
}

export function joinDocument(raw: string, body: string): string {
  if (!raw) return body;
  // Ensure exactly one blank line (or at least a newline) between front matter and body.
  if (raw.endsWith('\n') || raw.endsWith('\r\n')) {
    return raw + body;
  }
  return `${raw}\n${body}`;
}
