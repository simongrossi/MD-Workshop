export type MarkdownFileEntry = {
  path: string;
  relative_path: string;
  name: string;
  modified_unix: number | null;
  size: number;
};

export type SearchMatch = {
  line_number: number;
  line: string;
};

export type SearchResult = {
  path: string;
  relative_path: string;
  matches: SearchMatch[];
};

export type OpenedDocument = {
  path: string;
  relativePath: string;
  name: string;
  content: string;
  savedContent: string;
};

// ── Index types ──────────────────────────────────────────────────────

export type IndexStats = {
  files_indexed: number;
  links_found: number;
  tags_found: number;
  duration_ms: number;
};

export type BacklinkEntry = {
  path: string;
  relative_path: string;
  name: string;
  context_line: string;
};

export type TagCount = {
  tag: string;
  count: number;
};

export type FtsResult = {
  path: string;
  relative_path: string;
  name: string;
  snippet: string;
};

// ── Replace types ────────────────────────────────────────────────────

export type ReplaceLine = {
  line_number: number;
  before: string;
  after: string;
};

export type ReplaceFilePreview = {
  path: string;
  relative_path: string;
  lines: ReplaceLine[];
};

export type ReplaceResult = {
  files_changed: number;
  replacements: number;
};

// ── Broken links ─────────────────────────────────────────────────────

export type BrokenLink = {
  source_path: string;
  source_relative: string;
  source_name: string;
  target: string;
  kind: 'wiki' | 'md';
  line_number: number;
  context: string;
};

// ── Rename result ────────────────────────────────────────────────────

export type RenameResult = {
  new_path: string;
  files_updated: number;
  links_updated: number;
};
