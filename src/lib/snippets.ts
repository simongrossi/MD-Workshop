export type Snippet = {
  id: string;
  prefix: string;    // trigger text, e.g. "todo", "date", "table"
  label: string;     // display name
  body: string;      // inserted text, supports {{cursor}} placeholder
  description?: string;
};

const STORAGE_KEY = 'md-workshop:snippets';

export const DEFAULT_SNIPPETS: Snippet[] = [
  {
    id: 'builtin-todo',
    prefix: 'todo',
    label: '☑ Tâche à faire',
    body: '- [ ] {{cursor}}',
    description: 'Ligne de checklist vide'
  },
  {
    id: 'builtin-done',
    prefix: 'done',
    label: '☑ Tâche terminée',
    body: '- [x] {{cursor}}',
    description: 'Ligne de checklist cochée'
  },
  {
    id: 'builtin-date',
    prefix: 'date',
    label: '📅 Date du jour',
    body: '{{date}}',
    description: 'Insère la date du jour (AAAA-MM-JJ)'
  },
  {
    id: 'builtin-datetime',
    prefix: 'now',
    label: '🕓 Date + heure',
    body: '{{datetime}}',
    description: 'Insère la date et l\u2019heure du jour'
  },
  {
    id: 'builtin-table',
    prefix: 'table',
    label: '🧾 Tableau 3x3',
    body: '| Col 1 | Col 2 | Col 3 |\n| --- | --- | --- |\n| {{cursor}} |   |   |\n|   |   |   |',
    description: 'Tableau vide à 3 colonnes'
  },
  {
    id: 'builtin-code',
    prefix: 'code',
    label: '💻 Bloc de code',
    body: '```\n{{cursor}}\n```',
    description: 'Bloc de code vide'
  },
  {
    id: 'builtin-callout',
    prefix: 'note',
    label: '💡 Note',
    body: '> **Note**\n> {{cursor}}',
    description: 'Bloc de citation en forme de note'
  },
  {
    id: 'builtin-frontmatter',
    prefix: 'fm',
    label: '📋 Front matter',
    body: '---\ntitle: {{cursor}}\ndate: {{date}}\ntags: []\n---\n',
    description: 'Bloc YAML de front matter'
  }
];

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SNIPPETS;
    const parsed = JSON.parse(raw) as Snippet[];
    if (!Array.isArray(parsed)) return DEFAULT_SNIPPETS;
    // Ensure the 8 defaults are still present (upgrades)
    const existingIds = new Set(parsed.map((s) => s.id));
    const merged = [
      ...parsed,
      ...DEFAULT_SNIPPETS.filter((s) => !existingIds.has(s.id))
    ];
    return merged;
  } catch {
    return DEFAULT_SNIPPETS;
  }
}

export function saveSnippets(snippets: Snippet[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
}

export function expandSnippet(body: string): { text: string; cursorOffset: number } {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());

  const date = `${yyyy}-${mm}-${dd}`;
  const datetime = `${date} ${hh}:${mi}`;

  let text = body
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{datetime\}\}/g, datetime)
    .replace(/\{\{time\}\}/g, `${hh}:${mi}`);

  const cursorMarker = '{{cursor}}';
  const cursorIdx = text.indexOf(cursorMarker);
  if (cursorIdx >= 0) {
    text = text.replace(cursorMarker, '');
    return { text, cursorOffset: cursorIdx };
  }
  return { text, cursorOffset: text.length };
}
