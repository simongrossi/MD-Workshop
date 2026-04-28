/**
 * Stylesheet for the exported static site. Self-contained — uses CSS custom
 * properties so a single sheet supports light + dark via prefers-color-scheme,
 * and the exported HTML can override with `data-theme="dark"` to force a mode.
 */
export function siteStylesheet(): string {
  return `:root {
  --bg: #f4f1eb;
  --panel: #fbfaf7;
  --canvas: #fffdf9;
  --line: #ddd6c9;
  --line-strong: #cbc2b2;
  --text: #1b2630;
  --muted: #6f7680;
  --accent: #0d9a87;
  --accent-soft: rgba(13, 154, 135, 0.1);
  --warning: #b96b20;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1a1d21;
    --panel: #23272d;
    --canvas: #282c33;
    --line: #3a3f47;
    --line-strong: #4a5059;
    --text: #e6e8eb;
    --muted: #9ba2ab;
    --accent: #2dd4bf;
    --accent-soft: rgba(45, 212, 191, 0.14);
    --warning: #e8a259;
    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
  --bg: #1a1d21;
  --panel: #23272d;
  --canvas: #282c33;
  --line: #3a3f47;
  --line-strong: #4a5059;
  --text: #e6e8eb;
  --muted: #9ba2ab;
  --accent: #2dd4bf;
  --accent-soft: rgba(45, 212, 191, 0.14);
  --warning: #e8a259;
  color-scheme: dark;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Segoe UI Variable Text", "Segoe UI", -apple-system, "Aptos", sans-serif;
  font-size: 16px;
  line-height: 1.65;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  min-height: 100vh;
}

.sidebar {
  background: var(--panel);
  border-right: 1px solid var(--line);
  padding: 24px 18px;
  overflow-y: auto;
  position: sticky;
  top: 0;
  height: 100vh;
}

.site-title {
  display: block;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 18px;
  letter-spacing: -0.01em;
}
.site-title:hover { text-decoration: none; color: var(--accent); }

.sidebar-nav ul {
  list-style: none;
  padding: 0;
  margin: 0 0 0 0;
}
.sidebar-nav > ul { margin-left: 0; }
.sidebar-nav ul ul { margin-left: 12px; padding-left: 8px; border-left: 1px solid var(--line); }

.sidebar-nav li { padding: 2px 0; font-size: 0.9rem; }
.sidebar-nav a {
  color: var(--text);
  display: block;
  padding: 3px 6px;
  border-radius: 4px;
}
.sidebar-nav a:hover {
  background: var(--accent-soft);
  text-decoration: none;
}

.nav-folder-name {
  display: block;
  padding: 4px 6px;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  font-weight: 600;
}

.content {
  padding: 48px 56px;
  max-width: 880px;
  width: 100%;
}

.markdown-preview { color: var(--text); }

.page-title {
  margin: 0 0 6px;
  font-size: 2rem;
  letter-spacing: -0.01em;
}

.page-meta {
  color: var(--muted);
  font-size: 0.85rem;
  margin: 0 0 18px;
}

.page-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 24px;
}
.page-tag {
  background: var(--accent-soft);
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.8rem;
}
.page-tag:hover { text-decoration: none; opacity: 0.85; }

.markdown-preview h1,
.markdown-preview h2,
.markdown-preview h3,
.markdown-preview h4 {
  line-height: 1.25;
  margin-top: 1.6em;
  margin-bottom: 0.5em;
  letter-spacing: -0.01em;
}
.markdown-preview h2 { padding-bottom: 0.3em; border-bottom: 1px solid var(--line); }

.markdown-preview p, .markdown-preview ul, .markdown-preview ol { margin: 0.6em 0 1em; }

.markdown-preview code {
  background: var(--panel);
  padding: 0.1em 0.4em;
  border-radius: 4px;
  border: 1px solid var(--line);
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.9em;
}

.markdown-preview pre {
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
}
.markdown-preview pre code {
  background: transparent;
  border: 0;
  padding: 0;
}

.markdown-preview blockquote {
  margin: 1em 0;
  padding: 0.4em 1em;
  border-left: 3px solid var(--accent);
  color: var(--muted);
  background: var(--panel);
  border-radius: 0 6px 6px 0;
}

.markdown-preview img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

.markdown-preview table {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
}
.markdown-preview th, .markdown-preview td {
  border: 1px solid var(--line);
  padding: 8px 12px;
  text-align: left;
}
.markdown-preview th { background: var(--panel); }

.markdown-preview hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }

.wiki-link {
  color: var(--accent);
  border-bottom: 1px dotted var(--accent);
}
.wiki-link:hover { text-decoration: none; opacity: 0.85; }
.wiki-link-unresolved {
  color: var(--warning);
  border-bottom: 1px dotted var(--warning);
  cursor: not-allowed;
}

input[type="checkbox"].md-checkbox {
  margin-right: 6px;
  accent-color: var(--accent);
}

.backlinks {
  margin-top: 48px;
  padding: 20px 24px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.backlinks h2 {
  margin: 0 0 12px;
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  border: 0;
  padding: 0;
}
.backlinks ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.backlinks li { font-size: 0.92rem; }
.backlink-context {
  color: var(--muted);
  font-size: 0.85rem;
  margin-top: 2px;
  font-style: italic;
}

.recent-list, .all-list, .tag-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 6px;
}
.recent-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px;
  border-radius: 4px;
}
.recent-list li:hover { background: var(--accent-soft); }
.recent-date { color: var(--muted); font-size: 0.85rem; flex-shrink: 0; }
.tag-list li { padding: 8px 10px; border-bottom: 1px solid var(--line); }
.tag-excerpt {
  color: var(--muted);
  font-size: 0.85rem;
  margin-top: 2px;
}

@media (max-width: 800px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  .content { padding: 24px 18px; }
}
`;
}
