export type Theme = 'light' | 'dark';
export type DefaultViewMode = 'edit' | 'split' | 'preview';
export type GraphMode = 'local' | 'global';

export type AppSettings = {
  // Editor
  editorFontSize: number;      // px
  editorFontFamily: string;    // CSS font family
  editorLineWrap: boolean;
  editorLineNumbers: boolean;
  editorTabSize: number;

  // Appearance
  theme: Theme;

  // View
  defaultViewMode: DefaultViewMode;

  // Graph
  graphMode: GraphMode;
  graphDepth: number;           // 1..3
  graphFilterFolder: string;
  graphFilterTags: string[];
  graphShowOrphans: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  editorFontSize: 14,
  editorFontFamily: '"Cascadia Code", Consolas, monospace',
  editorLineWrap: true,
  editorLineNumbers: true,
  editorTabSize: 2,
  theme: 'light',
  defaultViewMode: 'split',
  graphMode: 'local',
  graphDepth: 1,
  graphFilterFolder: '',
  graphFilterTags: [],
  graphShowOrphans: true
};

const STORAGE_KEY = 'md-workshop:settings';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const FONT_FAMILY_OPTIONS: { label: string; value: string }[] = [
  { label: 'Cascadia Code (défaut)', value: '"Cascadia Code", Consolas, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Menlo / Monaco', value: 'Menlo, Monaco, "Courier New", monospace' },
  { label: 'Fira Code', value: '"Fira Code", "Cascadia Code", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", "Cascadia Code", monospace' },
  { label: 'Ubuntu Mono', value: '"Ubuntu Mono", monospace' },
  { label: 'System monospace', value: 'ui-monospace, monospace' }
];
