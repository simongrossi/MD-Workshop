import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { Menu, Submenu } from '@tauri-apps/api/menu';
import { BacklinksPanel } from './components/BacklinksPanel';
import { BrokenLinksDialog } from './components/BrokenLinksDialog';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { FileTree } from './components/FileTree';
import { GraphControls } from './components/GraphControls';
// d3-force is a sizable dependency only needed when the graph view is open;
// defer loading it until the user actually switches to that mode.
const GraphView = lazy(() =>
  import('./components/GraphView').then((m) => ({ default: m.GraphView }))
);
import { LibraryPicker } from './components/LibraryPicker';
import { LibrarySwitcher } from './components/LibrarySwitcher';
import { OutlinePanel } from './components/OutlinePanel';
import { MarkdownEditor, type MarkdownEditorHandle } from './components/MarkdownEditor';
import { PreviewPane } from './components/PreviewPane';
import { QuickOpen } from './components/QuickOpen';
import { ReplacePanel } from './components/ReplacePanel';
import { SearchPanel } from './components/SearchPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { SnippetsDialog } from './components/SnippetsDialog';
import { TabBar } from './components/TabBar';
import { EDITOR_FORMAT_MENU_ITEMS, type MarkdownEditorActionId } from './lib/editorActions';
import type { EditorSettings, WikiLinkFile } from './lib/codemirror';
import { splitFrontMatter, toggleCheckboxInSource } from './lib/markdown';
import { markdownToWhatsApp } from './lib/whatsapp';
import { loadSettings, saveSettings, type AppSettings } from './lib/settings';
import { loadSnippets, saveSnippets, type Snippet } from './lib/snippets';
import type { IndexStats, MarkdownFileEntry, OpenedDocument, RenameResult, ReplaceResult, SearchResult } from './types';

const LAST_FOLDER_KEY = 'md-workshop:last-folder';
const SIDEBAR_WIDTH_KEY = 'md-workshop:sidebar-width';
const SPLIT_RATIO_KEY = 'md-workshop:split-ratio';
const RECENTS_KEY = 'md-workshop:recents';
const FAVORITES_KEY = 'md-workshop:favorites';
const RECENT_FOLDERS_KEY = 'md-workshop:recent-folders';
const FAVORITE_FOLDERS_KEY = 'md-workshop:favorite-folders';
const PREVIEW_EDITABLE_KEY = 'md-workshop:preview-editable';

type ViewMode = 'split' | 'edit' | 'preview' | 'graph';
type GraphModeState = 'local' | 'global';
type RefreshFilesOptions = {
  reindex?: boolean;
  preserveStatus?: boolean;
};

function pathLabel(path: string | null) {
  if (!path) return 'Aucun dossier';
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}


export default function App() {
  const [rootFolder, setRootFolder] = useState<string | null>(null);
  const [files, setFiles] = useState<MarkdownFileEntry[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenedDocument[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const s = loadSettings();
    return s.defaultViewMode as ViewMode;
  });
  const [graphMode, setGraphMode] = useState<GraphModeState>(() => loadSettings().graphMode);
  const [graphDepth, setGraphDepth] = useState<number>(() => loadSettings().graphDepth);
  const [graphFilterFolder, setGraphFilterFolder] = useState<string>(() => loadSettings().graphFilterFolder);
  const [graphFilterTags, setGraphFilterTags] = useState<string[]>(() => loadSettings().graphFilterTags);
  const [graphShowOrphans, setGraphShowOrphans] = useState<boolean>(() => loadSettings().graphShowOrphans);
  const [graphFullscreen, setGraphFullscreen] = useState(false);
  const [status, setStatus] = useState('Prêt.');
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [replacePanelOpen, setReplacePanelOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets());
  const [brokenLinksOpen, setBrokenLinksOpen] = useState(false);
  const [welcomeDropActive, setWelcomeDropActive] = useState(false);
  const [cursorInfo, setCursorInfo] = useState<{ line: number; col: number; selectionLength: number } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : 308;
  });
  const [splitRatio, setSplitRatio] = useState(() => {
    const stored = Number(localStorage.getItem(SPLIT_RATIO_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : 0.48;
  });
  const [previewEditable, setPreviewEditable] = useState<boolean>(() => {
    return localStorage.getItem(PREVIEW_EDITABLE_KEY) === '1';
  });

  useEffect(() => {
    localStorage.setItem(PREVIEW_EDITABLE_KEY, previewEditable ? '1' : '0');
  }, [previewEditable]);

  const [recentPaths, setRecentPaths] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]'); } catch { return []; }
  });
  const [favoritePaths, setFavoritePaths] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]'); } catch { return []; }
  });
  const [recentFolders, setRecentFolders] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY) ?? '[]'); } catch { return []; }
  });
  const [favoriteFolders, setFavoriteFolders] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(FAVORITE_FOLDERS_KEY) ?? '[]'); } catch { return []; }
  });
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);

  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const menuActionsRef = useRef<{
    chooseFolder: () => void;
    saveFile: () => void;
    saveFileAs: () => void;
    openQuickOpen: () => void;
    setViewMode: (mode: ViewMode) => void;
    runEditorAction: (actionId: MarkdownEditorActionId) => void;
    closeActiveTab: () => void;
    closeAllTabs: () => void;
    promptCreateFile: () => void;
    importPdf: () => void;
    openDailyNote: () => void;
    openSettings: () => void;
    openFile: (path: string) => void;
    openReplace: () => void;
    renameActiveFile: () => void;
    deleteActiveFile: () => void;
    exportToHtml: () => void;
    copyAsHtml: () => void;
    copyAsWhatsApp: () => void;
    openLibraryPicker: () => void;
    switchToFolder: (folder: string) => void;
    openBrokenLinks: () => void;
  }>({
    chooseFolder: () => undefined,
    saveFile: () => undefined,
    saveFileAs: () => undefined,
    openQuickOpen: () => undefined,
    setViewMode: () => undefined,
    runEditorAction: () => undefined,
    closeActiveTab: () => undefined,
    closeAllTabs: () => undefined,
    promptCreateFile: () => undefined,
    importPdf: () => undefined,
    openDailyNote: () => undefined,
    openSettings: () => undefined,
    openFile: () => undefined,
    openReplace: () => undefined,
    renameActiveFile: () => undefined,
    deleteActiveFile: () => undefined,
    exportToHtml: () => undefined,
    copyAsHtml: () => undefined,
    copyAsWhatsApp: () => undefined,
    openLibraryPicker: () => undefined,
    switchToFolder: () => undefined,
    openBrokenLinks: () => undefined
  });

  // ── Derived state ──────────────────────────────────────────────────

  const activeDoc = useMemo(
    () => openTabs.find((tab) => tab.path === activeTabPath) ?? null,
    [openTabs, activeTabPath]
  );

  const rootFolderLabel = useMemo(() => pathLabel(rootFolder), [rootFolder]);

  const activeDocDirty = useMemo(
    () => (activeDoc ? activeDoc.content !== activeDoc.savedContent : false),
    [activeDoc]
  );

  const anyTabDirty = useMemo(
    () => openTabs.some((tab) => tab.content !== tab.savedContent),
    [openTabs]
  );

  const favorites = useMemo(() => new Set(favoritePaths), [favoritePaths]);

  const docStats = useMemo(() => {
    const content = activeDoc?.content ?? '';
    if (!activeDoc) return null;
    const chars = content.length;
    const lines = content === '' ? 0 : content.split('\n').length;
    const words = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
    return { chars, lines, words };
  }, [activeDoc]);

  const recentFiles = useMemo(
    () =>
      recentPaths
        .map((path) => files.find((f) => f.path === path))
        .filter((f): f is MarkdownFileEntry => f != null)
        .slice(0, 12),
    [recentPaths, files]
  );

  const filteredFiles = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((file) => file.relative_path.toLowerCase().includes(q));
  }, [files, fileFilter]);

  const wikiLinkFiles = useMemo<WikiLinkFile[]>(
    () =>
      files.map((f) => ({
        label: f.name.replace(/\.(md|markdown|mdx)$/i, ''),
        detail: f.relative_path
      })),
    [files]
  );

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [
      { id: 'file.new', label: 'Nouveau fichier…', shortcut: 'Ctrl+N', category: 'Fichier', action: () => promptCreateFile() },
      { id: 'file.import-pdf', label: 'Importer un PDF…', category: 'Fichier', action: () => void importPdfFromDialog() },
      { id: 'file.open-folder', label: 'Ouvrir un dossier…', shortcut: 'Ctrl+O', category: 'Fichier', action: () => void chooseFolder() },
      { id: 'file.load-demo', label: 'Charger le dossier démo', category: 'Fichier', action: () => void loadDemoWorkspace(false) },
      { id: 'file.reset-demo', label: 'Réinitialiser le dossier démo', category: 'Fichier', action: () => void loadDemoWorkspace(true) },
      { id: 'file.switch-library', label: 'Changer de bibliothèque…', shortcut: 'Ctrl+Shift+O', category: 'Fichier', action: () => setLibraryPickerOpen(true) },
      { id: 'file.save', label: 'Enregistrer', shortcut: 'Ctrl+S', category: 'Fichier', action: () => void saveFile() },
      { id: 'file.save-as', label: 'Enregistrer sous…', shortcut: 'Ctrl+Shift+S', category: 'Fichier', action: () => void saveFileAs() },
      { id: 'file.rename', label: 'Renommer le fichier…', category: 'Fichier', action: () => void renameActiveFile() },
      { id: 'file.delete', label: 'Supprimer le fichier…', category: 'Fichier', action: () => void deleteActiveFile() },
      { id: 'file.export-html', label: 'Exporter en HTML…', category: 'Fichier', action: () => void exportToHtml() },
      { id: 'file.copy-html', label: 'Copier en HTML', category: 'Fichier', action: () => void copyAsHtml() },
      { id: 'file.copy-whatsapp', label: 'Copier pour WhatsApp', shortcut: 'Ctrl+Shift+W', category: 'Fichier', action: () => void copyAsWhatsApp() },
      { id: 'file.close-all', label: 'Fermer tous les onglets', category: 'Fichier', action: () => closeAllTabs() },
      { id: 'file.quick-open', label: 'Aller au fichier…', shortcut: 'Ctrl+P', category: 'Fichier', action: () => openQuickOpen() },
      { id: 'file.close-tab', label: 'Fermer l\u2019onglet', shortcut: 'Ctrl+W', category: 'Fichier', action: () => { if (activeTabPath) closeTab(activeTabPath); } },
      { id: 'file.daily-note', label: 'Note du jour', shortcut: 'Ctrl+D', category: 'Fichier', action: () => void openDailyNote() },
      { id: 'view.edit', label: 'Mode édition', shortcut: 'Alt+1', category: 'Affichage', action: () => setViewMode('edit') },
      { id: 'view.split', label: 'Mode split', shortcut: 'Alt+2', category: 'Affichage', action: () => setViewMode('split') },
      { id: 'view.preview', label: 'Mode aperçu', shortcut: 'Alt+3', category: 'Affichage', action: () => setViewMode('preview') },
      { id: 'view.graph', label: 'Mode graphe', shortcut: 'Alt+4', category: 'Affichage', action: () => setViewMode('graph') },
      { id: 'tools.replace', label: 'Recherche et remplacement', shortcut: 'Ctrl+Shift+H', category: 'Outils', action: () => setReplacePanelOpen(true) },
      { id: 'tools.settings', label: 'Paramètres…', shortcut: 'Ctrl+,', category: 'Outils', action: () => setSettingsOpen(true) },
      { id: 'tools.snippets', label: 'Gérer les snippets…', category: 'Outils', action: () => setSnippetsOpen(true) },
      { id: 'tools.broken-links', label: 'Audit des liens cassés…', category: 'Outils', action: () => setBrokenLinksOpen(true) },
      // Editor format actions
      ...EDITOR_FORMAT_MENU_ITEMS.map((item) => ({
        id: `format.${item.id}`,
        label: item.label,
        category: 'Format',
        action: () => runEditorMenuAction(item.id)
      }))
    ];
    return cmds;
  }, [activeTabPath, files.length, rootFolder, openTabs]);

  // ── Tab helpers ────────────────────────────────────────────────────

  const updateTab = useCallback((path: string, updater: (tab: OpenedDocument) => OpenedDocument) => {
    setOpenTabs((tabs) => tabs.map((tab) => (tab.path === path ? updater(tab) : tab)));
  }, []);

  const updateActiveTab = useCallback(
    (updater: (tab: OpenedDocument) => OpenedDocument) => {
      if (!activeTabPath) return;
      updateTab(activeTabPath, updater);
    },
    [activeTabPath, updateTab]
  );

  // ── Side effects ───────────────────────────────────────────────────

  // First-run detection: on a fresh install the Tauri app config dir has no
  // marker yet, so we drop any stale last-folder from localStorage (which
  // WebView2 preserves across uninstalls). Otherwise we restore the last
  // folder and let the scan effect below do its job.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let isFirstRun = false;
      try {
        isFirstRun = await invoke<boolean>('check_first_run');
      } catch {
        // If the command fails, fall back to preserving previous behaviour.
      }
      if (cancelled) return;
      if (isFirstRun) {
        localStorage.removeItem(LAST_FOLDER_KEY);
        return;
      }
      const last = localStorage.getItem(LAST_FOLDER_KEY);
      if (last) setRootFolder(last);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!rootFolder) return;

    let cancelled = false;

    void (async () => {
      try {
        addToRecentFolders(rootFolder);
        setFiles([]);
        setStatus(`Scan du dossier en cours… (${pathLabel(rootFolder)})`);
        await invoke('set_workspace_asset_scope', { rootPath: rootFolder });
        if (cancelled) return;
        await refreshFiles(rootFolder);
      } catch (error) {
        if (!cancelled) {
          setStatus(`Erreur au chargement du dossier : ${String(error)}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFolder]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatio));
  }, [splitRatio]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!anyTabDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyTabDirty]);

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  function updateSettings(next: AppSettings) {
    setSettings(next);
    saveSettings(next);
  }

  // Exit fullscreen automatically when leaving graph mode
  useEffect(() => {
    if (viewMode !== 'graph' && graphFullscreen) setGraphFullscreen(false);
  }, [viewMode, graphFullscreen]);

  // Native Tauri window-level drag-drop — catches files dropped anywhere
  // (editor, preview, welcome screen). On macOS/Tauri 2 the OS drag events
  // are intercepted natively and never reach the webview's HTML drop handler.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const w = getCurrentWebview();
      const off = await w.onDragDropEvent(async (event) => {
        const payload = event.payload as { type: string; paths?: string[] };
        if (payload.type !== 'drop') {
          if (payload.type === 'enter' || payload.type === 'over') {
            const paths = payload.paths ?? [];
            if (paths.some((p) => p.toLowerCase().endsWith('.pdf'))) {
              setWelcomeDropActive(true);
            }
          } else if (payload.type === 'leave') {
            setWelcomeDropActive(false);
          }
          return;
        }
        setWelcomeDropActive(false);
        const paths = payload.paths ?? [];
        const pdfs = paths.filter((p) => p.toLowerCase().endsWith('.pdf'));
        if (pdfs.length === 0) return;
        for (const pdfPath of pdfs) {
          await importPdfFromPath(pdfPath);
        }
      });
      if (cancelled) off();
      else unlisten = off;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [rootFolder]);


  // Persist graph preferences whenever they change
  useEffect(() => {
    setSettings((prev) => {
      const next: AppSettings = {
        ...prev,
        graphMode,
        graphDepth,
        graphFilterFolder,
        graphFilterTags,
        graphShowOrphans
      };
      saveSettings(next);
      return next;
    });
  }, [graphMode, graphDepth, graphFilterFolder, graphFilterTags, graphShowOrphans]);

  function updateSnippets(next: Snippet[]) {
    setSnippets(next);
    saveSnippets(next);
  }

  const editorSettings = useMemo<EditorSettings>(
    () => ({
      fontSize: settings.editorFontSize,
      fontFamily: settings.editorFontFamily,
      lineWrap: settings.editorLineWrap,
      lineNumbers: settings.editorLineNumbers,
      tabSize: settings.editorTabSize
    }),
    [settings]
  );

  // ── Core functions ─────────────────────────────────────────────────

  async function refreshFiles(folder: string, options: RefreshFilesOptions = {}) {
    const { reindex = true, preserveStatus = false } = options;
    if (!preserveStatus) {
      setStatus(`Scan du dossier en cours… (${pathLabel(folder)})`);
    }
    const nextFiles = await invoke<MarkdownFileEntry[]>('list_markdown_files', { rootPath: folder });
    setFiles(nextFiles);

    // Update open tabs: refresh metadata, remove tabs whose files are gone
    setOpenTabs((tabs) => {
      const updated: OpenedDocument[] = [];
      for (const tab of tabs) {
        const stillExists = nextFiles.find((file) => file.path === tab.path);
        if (stillExists) {
          updated.push({
            ...tab,
            relativePath: stillExists.relative_path,
            name: stillExists.name
          });
        }
      }
      return updated;
    });

    setActiveTabPath((current) => {
      if (!current) return current;
      const stillExists = nextFiles.find((file) => file.path === current);
      return stillExists ? current : null;
    });

    if (!preserveStatus) {
      setStatus(`${nextFiles.length} fichier(s) Markdown détecté(s).`);
    }

    if (reindex) {
      // Reindex workspace in the background
      invoke<IndexStats>('reindex_workspace', { rootPath: folder })
        .then((stats) => {
          if (stats.files_indexed > 0) {
            setStatus(
              `Index mis à jour : ${stats.files_indexed} fichier(s) indexé(s), ` +
              `${stats.links_found} lien(s), ${stats.tags_found} tag(s) (${stats.duration_ms}ms)`
            );
          }
        })
        .catch(() => {
          // Indexation échouée silencieusement — la recherche classique reste fonctionnelle
        });
    }
  }

  async function chooseFolder(): Promise<string | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Choisir un dossier Markdown'
    });

    if (typeof selected !== 'string') return null;

    if (anyTabDirty) {
      const ok = window.confirm(
        'Des onglets contiennent des modifications non enregistrées. Continuer et les fermer ?'
      );
      if (!ok) return null;
    }

    localStorage.setItem(LAST_FOLDER_KEY, selected);
    addToRecentFolders(selected);
    setOpenTabs([]);
    setActiveTabPath(null);
    setFiles([]);
    setRootFolder(selected);
    setSearchQuery('');
    setSearchResults([]);
    setQuickOpenOpen(false);
    return selected;
  }

  async function openFile(path: string) {
    if (!rootFolder) return false;

    // Already open in a tab? Just switch to it
    const existingTab = openTabs.find((tab) => tab.path === path);
    if (existingTab) {
      setActiveTabPath(path);
      addToRecents(path);
      setStatus(`Ouvert : ${existingTab.relativePath}`);
      return true;
    }

    // Open a new tab
    try {
      const content = await invoke<string>('read_markdown_file', { rootPath: rootFolder, path });
      const meta = files.find((file) => file.path === path);

      const newTab: OpenedDocument = {
        path,
        relativePath: meta?.relative_path ?? path,
        name: meta?.name ?? path.split(/[\\/]/).pop() ?? 'Sans nom',
        content,
        savedContent: content
      };

      setOpenTabs((tabs) => [...tabs, newTab]);
      setActiveTabPath(path);
      addToRecents(path);
      setStatus(`Ouvert : ${newTab.relativePath}`);
      return true;
    } catch (error) {
      setStatus(`Impossible d'ouvrir le fichier : ${String(error)}`);
      return false;
    }
  }

  function closeTab(path: string) {
    const tab = openTabs.find((t) => t.path === path);
    if (!tab) return;

    if (tab.content !== tab.savedContent) {
      const ok = window.confirm(
        `"${tab.name}" contient des modifications non enregistrées. Fermer quand même ?`
      );
      if (!ok) return;
    }

    setOpenTabs((tabs) => {
      const idx = tabs.findIndex((t) => t.path === path);
      const next = tabs.filter((t) => t.path !== path);

      // If we're closing the active tab, switch to an adjacent one
      if (activeTabPath === path) {
        const neighbor = next[Math.min(idx, next.length - 1)] ?? null;
        setActiveTabPath(neighbor?.path ?? null);
      }

      return next;
    });
  }

  async function saveFile() {
    if (!activeDoc || !rootFolder) return;

    try {
      await invoke('save_markdown_file', {
        rootPath: rootFolder,
        path: activeDoc.path,
        content: activeDoc.content
      });

      updateActiveTab((tab) => ({ ...tab, savedContent: tab.content }));
      setStatus(`Enregistré : ${activeDoc.relativePath}`);

      // Re-index this single file in the background
      invoke('index_file', { rootPath: rootFolder, path: activeDoc.path }).catch(() => {});

      await refreshFiles(rootFolder, { reindex: false, preserveStatus: true });
    } catch (error) {
      setStatus(`Impossible d'enregistrer le fichier : ${String(error)}`);
    }
  }

  async function renameActiveFile() {
    if (!activeDoc || !rootFolder) return;

    const currentName = activeDoc.name.replace(/\.(md|markdown|mdx)$/i, '');
    const newName = window.prompt('Nouveau nom (sans extension) :', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    if (activeDoc.content !== activeDoc.savedContent) {
      const ok = window.confirm(
        'Le fichier contient des modifications non enregistrées. Enregistrer et renommer ?'
      );
      if (!ok) return;
      await saveFile();
    }

    // Ask whether to also update [[wiki-links]] and relative md-links pointing to this file
    const updateLinks = window.confirm(
      `Mettre à jour aussi tous les [[${currentName}]] et liens relatifs dans le workspace ?\n\n` +
        `OK = renommer partout\nAnnuler = juste renommer le fichier`
    );

    try {
      const result = await invoke<RenameResult>('rename_markdown_file', {
        rootPath: rootFolder,
        path: activeDoc.path,
        newName: newName.trim(),
        updateLinks
      });

      // Close old tab and open new
      const oldPath = activeDoc.path;
      setOpenTabs((tabs) => tabs.filter((t) => t.path !== oldPath));
      await refreshFiles(rootFolder);
      await openFile(result.new_path);

      if (updateLinks && result.links_updated > 0) {
        setStatus(
          `Renommé. ${result.links_updated} lien(s) mis à jour dans ${result.files_updated} fichier(s).`
        );
      } else {
        setStatus(`Renommé : ${newName.trim()}`);
      }
    } catch (error) {
      setStatus(`Impossible de renommer : ${String(error)}`);
    }
  }

  async function deleteActiveFile() {
    if (!activeDoc || !rootFolder) return;

    const ok = window.confirm(
      `Supprimer définitivement "${activeDoc.name}" ?\n\nCette action est irréversible.`
    );
    if (!ok) return;

    try {
      const pathToRemove = activeDoc.path;
      await invoke('delete_markdown_file', { rootPath: rootFolder, path: pathToRemove });

      // Close the tab
      setOpenTabs((tabs) => {
        const idx = tabs.findIndex((t) => t.path === pathToRemove);
        const next = tabs.filter((t) => t.path !== pathToRemove);
        if (activeTabPath === pathToRemove) {
          const neighbor = next[Math.min(idx, next.length - 1)] ?? null;
          setActiveTabPath(neighbor?.path ?? null);
        }
        return next;
      });

      // Clean from recents + favorites
      setRecentPaths((prev) => prev.filter((p) => p !== pathToRemove));
      setFavoritePaths((prev) => prev.filter((p) => p !== pathToRemove));

      await refreshFiles(rootFolder);
      setStatus(`Fichier supprimé.`);
    } catch (error) {
      setStatus(`Impossible de supprimer : ${String(error)}`);
    }
  }

  async function revealFileInFinder(targetPath: string) {
    try {
      await invoke('reveal_in_file_manager', { path: targetPath });
    } catch (error) {
      setStatus(`Impossible d'ouvrir l'emplacement : ${String(error)}`);
    }
  }

  async function copyFilePath(targetPath: string) {
    try {
      await navigator.clipboard.writeText(targetPath);
      setStatus('Chemin copié dans le presse-papier.');
    } catch (error) {
      setStatus(`Impossible de copier le chemin : ${String(error)}`);
    }
  }

  async function renameFileAt(targetPath: string) {
    if (!rootFolder) return;
    const meta = files.find((f) => f.path === targetPath);
    const displayName = meta?.name ?? targetPath.split(/[\\/]/).pop() ?? 'document.md';
    const currentName = displayName.replace(/\.(md|markdown|mdx)$/i, '');

    const newName = window.prompt('Nouveau nom (sans extension) :', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    const openTab = openTabs.find((t) => t.path === targetPath);
    if (openTab && openTab.content !== openTab.savedContent) {
      const ok = window.confirm(
        'Le fichier contient des modifications non enregistrées. Enregistrer et renommer ?'
      );
      if (!ok) return;
      try {
        await invoke('save_markdown_file', {
          rootPath: rootFolder,
          path: targetPath,
          content: openTab.content
        });
        updateTab(targetPath, (tab) => ({ ...tab, savedContent: tab.content }));
      } catch (error) {
        setStatus(`Impossible d'enregistrer : ${String(error)}`);
        return;
      }
    }

    const updateLinks = window.confirm(
      `Mettre à jour aussi tous les [[${currentName}]] et liens relatifs dans le workspace ?\n\n` +
        `OK = renommer partout\nAnnuler = juste renommer le fichier`
    );

    try {
      const result = await invoke<RenameResult>('rename_markdown_file', {
        rootPath: rootFolder,
        path: targetPath,
        newName: newName.trim(),
        updateLinks
      });

      if (openTab) {
        setOpenTabs((tabs) => tabs.filter((t) => t.path !== targetPath));
        await refreshFiles(rootFolder);
        await openFile(result.new_path);
      } else {
        await refreshFiles(rootFolder);
      }

      if (updateLinks && result.links_updated > 0) {
        setStatus(
          `Renommé. ${result.links_updated} lien(s) mis à jour dans ${result.files_updated} fichier(s).`
        );
      } else {
        setStatus(`Renommé : ${newName.trim()}`);
      }
    } catch (error) {
      setStatus(`Impossible de renommer : ${String(error)}`);
    }
  }

  async function deleteFileAt(targetPath: string) {
    if (!rootFolder) return;
    const meta = files.find((f) => f.path === targetPath);
    const displayName = meta?.name ?? targetPath.split(/[\\/]/).pop() ?? 'ce fichier';

    const openTab = openTabs.find((t) => t.path === targetPath);
    if (openTab && openTab.content !== openTab.savedContent) {
      const ok = window.confirm(
        `"${displayName}" contient des modifications non enregistrées. Supprimer quand même ?`
      );
      if (!ok) return;
    }

    const ok = window.confirm(
      `Supprimer définitivement "${displayName}" ?\n\nCette action est irréversible.`
    );
    if (!ok) return;

    try {
      await invoke('delete_markdown_file', { rootPath: rootFolder, path: targetPath });

      if (openTab) {
        setOpenTabs((tabs) => {
          const idx = tabs.findIndex((t) => t.path === targetPath);
          const next = tabs.filter((t) => t.path !== targetPath);
          if (activeTabPath === targetPath) {
            const neighbor = next[Math.min(idx, next.length - 1)] ?? null;
            setActiveTabPath(neighbor?.path ?? null);
          }
          return next;
        });
      }
      setRecentPaths((prev) => prev.filter((p) => p !== targetPath));
      setFavoritePaths((prev) => prev.filter((p) => p !== targetPath));
      await refreshFiles(rootFolder);
      setStatus(`Fichier supprimé : ${displayName}`);
    } catch (error) {
      setStatus(`Impossible de supprimer : ${String(error)}`);
    }
  }

  async function exportToHtml() {
    if (!activeDoc) return;
    try {
      const { html } = splitFrontMatter(activeDoc.content);
      const styledHtml = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${activeDoc.name.replace(/\.(md|markdown|mdx)$/i, '')}</title>
<style>
body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; line-height: 1.7; color: #1b2630; }
h1,h2,h3 { line-height: 1.2; }
code { padding: 0.1em 0.35em; border-radius: 4px; background: #f1ede4; font-family: "Cascadia Code", Consolas, monospace; font-size: 0.92em; }
pre { padding: 14px 16px; border: 1px solid #ddd6c9; border-radius: 8px; background: #faf7f1; overflow: auto; }
blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #0d9a87; color: #6f7680; }
a { color: #0d9a87; }
table { border-collapse: collapse; } th, td { border: 1px solid #ddd6c9; padding: 6px 10px; }
</style>
</head>
<body>
${html}
</body>
</html>`;

      const blob = new Blob([styledHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = activeDoc.name.replace(/\.(md|markdown|mdx)$/i, '') + '.html';
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`Export HTML : ${a.download}`);
    } catch (error) {
      setStatus(`Échec de l'export : ${String(error)}`);
    }
  }

  async function copyAsHtml() {
    if (!activeDoc) return;
    try {
      const { html } = splitFrontMatter(activeDoc.content);
      if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard.write !== 'function') {
        throw new Error('Le presse-papiers HTML riche n’est pas disponible.');
      }

      const plainText =
        new DOMParser()
          .parseFromString(html, 'text/html')
          .body.textContent
          ?.replace(/\s+\n/g, '\n')
          .trim() ?? '';

      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' })
        })
      ]);
      setStatus('HTML riche copié dans le presse-papiers.');
    } catch (error) {
      setStatus(`Impossible de copier : ${String(error)}`);
    }
  }

  async function copyAsWhatsApp() {
    if (!activeDoc) return;
    try {
      const text = markdownToWhatsApp(activeDoc.content);
      await navigator.clipboard.writeText(text);
      setStatus('Texte WhatsApp copié dans le presse-papiers.');
    } catch (error) {
      setStatus(`Impossible de copier : ${String(error)}`);
    }
  }

  async function saveFileAs() {
    if (!activeDoc || !rootFolder) return;

    const defaultName = activeDoc.name.replace(/\.(md|markdown|mdx)$/i, '') + '-copie';
    const name = window.prompt('Enregistrer sous (nom du nouveau fichier) :', defaultName);
    if (!name || !name.trim()) return;

    try {
      const newPath = await invoke<string>('save_as_markdown_file', {
        rootPath: rootFolder,
        name: name.trim(),
        content: activeDoc.content
      });
      await refreshFiles(rootFolder);
      await openFile(newPath);
      setStatus(`Enregistré sous : ${name.trim()}`);
    } catch (error) {
      setStatus(`Impossible d'enregistrer sous : ${String(error)}`);
    }
  }

  function closeAllTabs() {
    const dirty = openTabs.filter((t) => t.content !== t.savedContent);
    if (dirty.length > 0) {
      const ok = window.confirm(
        `${dirty.length} onglet(s) contiennent des modifications non enregistrées. Tout fermer ?`
      );
      if (!ok) return;
    }
    setOpenTabs([]);
    setActiveTabPath(null);
    setStatus('Tous les onglets fermés.');
  }

  async function runSearch() {
    if (!rootFolder) return;
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setStatus('Recherche effacée.');
      return;
    }

    setSearchLoading(true);
    try {
      const results = await invoke<SearchResult[]>('search_markdown', {
        rootPath: rootFolder,
        query: searchQuery
      });
      setSearchResults(results);
      setStatus(`${results.length} fichier(s) trouvé(s) pour "${searchQuery}".`);
    } finally {
      setSearchLoading(false);
    }
  }

  async function createFile(name: string) {
    if (!rootFolder) return;
    try {
      const newPath = await invoke<string>('create_markdown_file', { rootPath: rootFolder, name });
      await refreshFiles(rootFolder);
      await openFile(newPath);
      setStatus(`Fichier créé : ${name}`);
    } catch (error) {
      setStatus(`Impossible de créer le fichier : ${String(error)}`);
    }
  }

  function promptCreateFile() {
    if (!rootFolder) {
      void chooseFolder();
      return;
    }
    const name = window.prompt('Nom du nouveau fichier (sans extension) :');
    if (!name || !name.trim()) return;
    void createFile(name.trim());
  }

  type PdfConversionResult = {
    pdf_type: 'text_based' | 'scanned' | 'image_based' | 'mixed';
    markdown: string | null;
    page_count: number;
    pages_needing_ocr: number[];
    title: string | null;
  };

  async function finalizePdfImport(
    conversion: PdfConversionResult,
    sourceName: string,
    targetRoot: string
  ): Promise<void> {
    if (conversion.pdf_type === 'scanned' || !conversion.markdown) {
      setStatus(
        `PDF "${sourceName}" non convertible (type : ${conversion.pdf_type}). ` +
          `Ce PDF semble scanné — OCR non supporté.`
      );
      return;
    }

    const baseName = sourceName.replace(/\.pdf$/i, '').trim() || 'document-pdf';
    try {
      const newPath = await invoke<string>('create_markdown_file', {
        rootPath: targetRoot,
        name: baseName
      });
      await invoke('save_markdown_file', {
        rootPath: targetRoot,
        path: newPath,
        content: conversion.markdown
      });
      await refreshFiles(targetRoot);

      // Open the new tab directly without going through openFile(),
      // because after a just-selected workspace the rootFolder state
      // isn't yet reflected in openFile's closure.
      const fileName = newPath.split(/[\\/]/).pop() ?? `${baseName}.md`;
      const relativePath = newPath.startsWith(targetRoot)
        ? newPath.slice(targetRoot.length).replace(/^[\\/]+/, '')
        : fileName;
      const newTab: OpenedDocument = {
        path: newPath,
        relativePath,
        name: fileName,
        content: conversion.markdown,
        savedContent: conversion.markdown
      };
      setOpenTabs((tabs) =>
        tabs.some((t) => t.path === newPath) ? tabs : [...tabs, newTab]
      );
      setActiveTabPath(newPath);
      addToRecents(newPath);

      const suffix =
        conversion.pdf_type === 'mixed'
          ? ` (mixte, ${conversion.pages_needing_ocr.length} page(s) nécessitant OCR ignorée(s))`
          : '';
      setStatus(`PDF importé : ${baseName}.md (${conversion.page_count} page(s))${suffix}`);
    } catch (error) {
      setStatus(`Impossible de créer le fichier depuis le PDF : ${String(error)}`);
    }
  }

  async function resolveTargetRoot(): Promise<string | null> {
    if (rootFolder) return rootFolder;
    setStatus('Choisissez un dossier de destination pour le PDF…');
    return await chooseFolder();
  }

  async function importPdfFromFile(file: File): Promise<void> {
    const targetRoot = await resolveTargetRoot();
    if (!targetRoot) return;
    try {
      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      setStatus(`Conversion du PDF "${file.name}"…`);
      const conversion = await invoke<PdfConversionResult>('convert_pdf_to_markdown', {
        pdfBytes: bytes
      });
      await finalizePdfImport(conversion, file.name, targetRoot);
    } catch (error) {
      setStatus(`Échec de la conversion du PDF : ${String(error)}`);
    }
  }

  async function importPdfFromPath(pdfPath: string): Promise<void> {
    const targetRoot = await resolveTargetRoot();
    if (!targetRoot) return;
    const fileName = pdfPath.split(/[\\/]/).pop() ?? 'document.pdf';
    try {
      setStatus(`Conversion du PDF "${fileName}"…`);
      const conversion = await invoke<PdfConversionResult>('convert_pdf_path_to_markdown', {
        path: pdfPath
      });
      await finalizePdfImport(conversion, fileName, targetRoot);
    } catch (error) {
      setStatus(`Échec de la conversion du PDF : ${String(error)}`);
    }
  }

  async function importPdfFromDialog(): Promise<void> {
    const targetRoot = await resolveTargetRoot();
    if (!targetRoot) return;
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      title: 'Importer un PDF'
    });
    if (typeof selected !== 'string') return;
    await importPdfFromPath(selected);
  }

  async function openDailyNote() {
    if (!rootFolder) {
      void chooseFolder();
      return;
    }
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dailyName = `${yyyy}-${mm}-${dd}`;

    // Check if already exists in open files
    const existing = files.find((f) => {
      const stem = f.name.replace(/\.(md|markdown|mdx)$/i, '');
      return stem === dailyName;
    });

    if (existing) {
      await openFile(existing.path);
      return;
    }

    // Create it
    await createFile(dailyName);
  }

  function addToRecents(path: string) {
    setRecentPaths((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)].slice(0, 20);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function toggleFavorite(path: string) {
    setFavoritePaths((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function addToRecentFolders(folder: string) {
    setRecentFolders((prev) => {
      const next = [folder, ...prev.filter((p) => p !== folder)].slice(0, 15);
      localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function toggleFavoriteFolder(folder: string) {
    setFavoriteFolders((prev) => {
      const next = prev.includes(folder) ? prev.filter((p) => p !== folder) : [...prev, folder];
      localStorage.setItem(FAVORITE_FOLDERS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function removeRecentFolder(folder: string) {
    setRecentFolders((prev) => {
      const next = prev.filter((p) => p !== folder);
      localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function loadDemoWorkspace(reset: boolean = false) {
    try {
      setStatus('Préparation de la démo…');
      const path = await invoke<string>('load_demo_workspace', { reset });
      await switchToFolder(path);
      setStatus(reset ? 'Démo réinitialisée.' : 'Démo chargée.');
    } catch (error) {
      setStatus(`Impossible de charger la démo : ${String(error)}`);
    }
  }

  async function switchToFolder(folder: string) {
    if (folder === rootFolder) return;
    if (anyTabDirty) {
      const ok = window.confirm(
        'Des onglets contiennent des modifications non enregistrées. Continuer et les fermer ?'
      );
      if (!ok) return;
    }
    localStorage.setItem(LAST_FOLDER_KEY, folder);
    addToRecentFolders(folder);
    setOpenTabs([]);
    setActiveTabPath(null);
    setFiles([]);
    setRootFolder(folder);
    setSearchQuery('');
    setSearchResults([]);
    setQuickOpenOpen(false);
    setLibraryPickerOpen(false);
  }

  function openQuickOpen() {
    if (!rootFolder || files.length === 0) {
      void chooseFolder();
      return;
    }

    setQuickOpenOpen(true);
  }

  function runEditorMenuAction(actionId: MarkdownEditorActionId) {
    void editorRef.current?.runAction(actionId);
  }

  // ── Menu actions ref ───────────────────────────────────────────────

  menuActionsRef.current = {
    chooseFolder: () => void chooseFolder(),
    saveFile: () => void saveFile(),
    saveFileAs: () => void saveFileAs(),
    openQuickOpen: () => openQuickOpen(),
    setViewMode: (mode) => setViewMode(mode),
    runEditorAction: (actionId) => runEditorMenuAction(actionId),
    closeActiveTab: () => {
      if (activeTabPath) closeTab(activeTabPath);
    },
    closeAllTabs: () => closeAllTabs(),
    promptCreateFile: () => promptCreateFile(),
    importPdf: () => void importPdfFromDialog(),
    openDailyNote: () => void openDailyNote(),
    openSettings: () => setSettingsOpen(true),
    openFile: (path: string) => void openFile(path),
    openReplace: () => setReplacePanelOpen(true),
    renameActiveFile: () => void renameActiveFile(),
    deleteActiveFile: () => void deleteActiveFile(),
    exportToHtml: () => void exportToHtml(),
    copyAsHtml: () => void copyAsHtml(),
    copyAsWhatsApp: () => void copyAsWhatsApp(),
    openLibraryPicker: () => setLibraryPickerOpen(true),
    switchToFolder: (folder: string) => void switchToFolder(folder),
    openBrokenLinks: () => setBrokenLinksOpen(true)
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Alt+1..4 view mode shortcuts (web fallback; Tauri also has native menu)
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (event.key === '1') { event.preventDefault(); setViewMode('edit'); return; }
        if (event.key === '2') { event.preventDefault(); setViewMode('split'); return; }
        if (event.key === '3') { event.preventDefault(); setViewMode('preview'); return; }
        if (event.key === '4') { event.preventDefault(); setViewMode('graph'); return; }
      }

      // Esc exits graph fullscreen
      if (event.key === 'Escape' && graphFullscreen) {
        event.preventDefault();
        setGraphFullscreen(false);
        return;
      }

      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;

      const key = event.key.toLowerCase();

      // Shift combos first — Ctrl+Shift+P must not fall into Ctrl+P
      if (key === 'p' && event.shiftKey) {
        event.preventDefault();
        setCommandPaletteOpen(true);
      } else if (key === 's' && event.shiftKey) {
        event.preventDefault();
        void saveFileAs();
      } else if (key === 'o' && event.shiftKey) {
        event.preventDefault();
        setLibraryPickerOpen(true);
      } else if (key === 'h' && event.shiftKey) {
        event.preventDefault();
        setReplacePanelOpen(true);
      } else if (key === 'w' && event.shiftKey) {
        event.preventDefault();
        void copyAsWhatsApp();
      } else if (key === 'o') {
        event.preventDefault();
        void chooseFolder();
      } else if (key === 's') {
        event.preventDefault();
        void saveFile();
      } else if (key === 'p') {
        event.preventDefault();
        openQuickOpen();
      } else if (key === 'w') {
        event.preventDefault();
        menuActionsRef.current.closeActiveTab();
      } else if (key === 'd') {
        event.preventDefault();
        void openDailyNote();
      } else if (key === 'n') {
        event.preventDefault();
        promptCreateFile();
      } else if (key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [files.length, rootFolder, openTabs, activeTabPath, graphFullscreen]);

  // ── Native app menu ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function setupAppMenu() {
      try {
        // Sous-menu des fichiers récents (dynamique)
        const recentsItems =
          recentFiles.length === 0
            ? [{ id: 'file.recents-empty', text: '(aucun fichier récent)', enabled: false }]
            : recentFiles.slice(0, 10).map((f, idx) => ({
                id: `file.recent.${idx}`,
                text: f.name,
                action: () => menuActionsRef.current.openFile(f.path)
              }));

        const recentsSubmenu = await Submenu.new({
          text: 'Ouvrir un fichier récent',
          items: recentsItems
        });

        const exportSubmenu = await Submenu.new({
          text: 'Exporter',
          items: [
            {
              id: 'file.export.html',
              text: 'Exporter en HTML…',
              action: () => menuActionsRef.current.exportToHtml()
            },
            {
              id: 'file.export.copy-html',
              text: 'Copier en HTML',
              action: () => menuActionsRef.current.copyAsHtml()
            },
            {
              id: 'file.export.copy-whatsapp',
              text: 'Copier pour WhatsApp',
              accelerator: 'Ctrl+Shift+W',
              action: () => menuActionsRef.current.copyAsWhatsApp()
            }
          ]
        });

        // Sous-menu des bibliothèques : favoris en premier, puis récentes
        const favSet = new Set(favoriteFolders);
        const libraryEntries = [
          ...favoriteFolders.map((f) => ({ folder: f, fav: true })),
          ...recentFolders.filter((f) => !favSet.has(f)).map((f) => ({ folder: f, fav: false }))
        ].slice(0, 15);

        const libraryItems =
          libraryEntries.length === 0
            ? [{ id: 'libs.empty', text: '(aucune bibliothèque récente)', enabled: false }]
            : libraryEntries.map((entry, idx) => {
                const name = entry.folder.split(/[\\/]/).filter(Boolean).pop() ?? entry.folder;
                return {
                  id: `lib.${idx}`,
                  text: entry.fav ? `★ ${name}` : name,
                  action: () => menuActionsRef.current.switchToFolder(entry.folder)
                };
              });

        const librariesSubmenu = await Submenu.new({
          text: 'Bibliothèques récentes',
          items: libraryItems
        });

        const fileMenu = await Submenu.new({
          text: 'Fichier',
          items: [
            {
              id: 'file.new',
              text: 'Nouveau fichier…',
              accelerator: 'CmdOrCtrl+N',
              action: () => menuActionsRef.current.promptCreateFile()
            },
            {
              id: 'file.daily-note',
              text: 'Note du jour',
              accelerator: 'CmdOrCtrl+D',
              action: () => menuActionsRef.current.openDailyNote()
            },
            {
              id: 'file.import-pdf',
              text: 'Importer un PDF…',
              action: () => menuActionsRef.current.importPdf()
            },
            { item: 'Separator' },
            {
              id: 'file.open-folder',
              text: 'Ouvrir un dossier…',
              accelerator: 'CmdOrCtrl+O',
              action: () => menuActionsRef.current.chooseFolder()
            },
            {
              id: 'file.switch-library',
              text: 'Changer de bibliothèque…',
              accelerator: 'CmdOrCtrl+Shift+O',
              action: () => menuActionsRef.current.openLibraryPicker()
            },
            librariesSubmenu,
            {
              id: 'file.quick-open',
              text: 'Aller au fichier…',
              accelerator: 'CmdOrCtrl+P',
              action: () => menuActionsRef.current.openQuickOpen()
            },
            recentsSubmenu,
            { item: 'Separator' },
            {
              id: 'file.save',
              text: 'Enregistrer',
              accelerator: 'CmdOrCtrl+S',
              action: () => menuActionsRef.current.saveFile()
            },
            {
              id: 'file.save-as',
              text: 'Enregistrer sous…',
              accelerator: 'CmdOrCtrl+Shift+S',
              action: () => menuActionsRef.current.saveFileAs()
            },
            { item: 'Separator' },
            {
              id: 'file.rename',
              text: 'Renommer…',
              action: () => menuActionsRef.current.renameActiveFile()
            },
            {
              id: 'file.delete',
              text: 'Supprimer…',
              action: () => menuActionsRef.current.deleteActiveFile()
            },
            { item: 'Separator' },
            exportSubmenu,
            { item: 'Separator' },
            {
              id: 'file.close-tab',
              text: 'Fermer l\u2019onglet',
              accelerator: 'CmdOrCtrl+W',
              action: () => menuActionsRef.current.closeActiveTab()
            },
            {
              id: 'file.close-all',
              text: 'Fermer tous les onglets',
              action: () => menuActionsRef.current.closeAllTabs()
            },
            { item: 'Separator' },
            {
              id: 'file.settings',
              text: 'Paramètres…',
              accelerator: 'CmdOrCtrl+,',
              action: () => menuActionsRef.current.openSettings()
            },
            { item: 'Separator' },
            { item: 'Quit' }
          ]
        });

        const editMenu = await Submenu.new({
          text: 'Édition',
          items: [
            { item: 'Undo' },
            { item: 'Redo' },
            { item: 'Separator' },
            { item: 'Cut' },
            { item: 'Copy' },
            { item: 'Paste' },
            { item: 'SelectAll' },
            { item: 'Separator' },
            {
              id: 'edit.replace',
              text: 'Recherche et remplacement…',
              accelerator: 'CmdOrCtrl+Shift+H',
              action: () => menuActionsRef.current.openReplace()
            },
            {
              id: 'edit.broken-links',
              text: 'Audit des liens cassés…',
              action: () => menuActionsRef.current.openBrokenLinks()
            }
          ]
        });

        const formatMenu = await Submenu.new({
          text: 'Format',
          items: EDITOR_FORMAT_MENU_ITEMS.map((item) => ({
            id: `format.${item.id}`,
            text: item.label,
            action: () => menuActionsRef.current.runEditorAction(item.id)
          }))
        });

        const viewMenu = await Submenu.new({
          text: 'Affichage',
          items: [
            {
              id: 'view.edit',
              text: 'Mode édition',
              accelerator: 'Alt+1',
              action: () => menuActionsRef.current.setViewMode('edit')
            },
            {
              id: 'view.split',
              text: 'Mode split',
              accelerator: 'Alt+2',
              action: () => menuActionsRef.current.setViewMode('split')
            },
            {
              id: 'view.preview',
              text: 'Mode aperçu',
              accelerator: 'Alt+3',
              action: () => menuActionsRef.current.setViewMode('preview')
            },
            {
              id: 'view.graph',
              text: 'Mode graphe',
              accelerator: 'Alt+4',
              action: () => menuActionsRef.current.setViewMode('graph')
            }
          ]
        });

        const menu = await Menu.new({
          items: [fileMenu, editMenu, formatMenu, viewMenu]
        });

        if (cancelled) return;
        await menu.setAsAppMenu();
      } catch {
        // Ignored outside Tauri or if the native menu cannot be initialized.
      }
    }

    void setupAppMenu();

    return () => {
      cancelled = true;
    };
  }, [recentFiles, recentFolders, favoriteFolders]);

  // ── Resize handlers ────────────────────────────────────────────────

  function startSidebarResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const workspaceBounds = workspaceRef.current?.getBoundingClientRect();
    if (!workspaceBounds) return;

    const onMove = (moveEvent: MouseEvent) => {
      const nextWidth = clamp(moveEvent.clientX - workspaceBounds.left, 248, 440);
      setSidebarWidth(nextWidth);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startSplitResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const splitBounds = splitLayoutRef.current?.getBoundingClientRect();
    if (!splitBounds) return;

    const onMove = (moveEvent: MouseEvent) => {
      const nextRatio = clamp((moveEvent.clientX - splitBounds.left) / splitBounds.width, 0.28, 0.72);
      setSplitRatio(nextRatio);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Editor onChange for active tab ─────────────────────────────────

  function handleEditorChange(content: string) {
    updateActiveTab((tab) => ({ ...tab, content }));
  }

  function handleToggleCheckbox(index: number) {
    if (!activeDoc) return;
    const next = toggleCheckboxInSource(activeDoc.content, index);
    if (next === null) return;
    updateActiveTab((tab) => ({ ...tab, content: next }));
  }

  async function handleImageDrop(files: File[]): Promise<string[]> {
    if (!rootFolder || files.length === 0) return [];
    const results: string[] = [];
    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buffer));
        const saved = await invoke<{ path: string; relative: string }>('save_image', {
          rootPath: rootFolder,
          fileName: file.name || 'image.png',
          bytes
        });
        results.push(saved.relative);
      } catch (error) {
        setStatus(`Impossible de sauvegarder l'image : ${String(error)}`);
      }
    }
    if (results.length > 0) {
      setStatus(`${results.length} image(s) insérée(s) dans assets/.`);
      // Refresh file listing so new images appear if user browses later
      if (rootFolder) void refreshFiles(rootFolder);
    }
    return results;
  }

  // ── Render ─────────────────────────────────────────────────────────

  const showEditor = viewMode === 'split' || viewMode === 'edit';
  const showPreview = viewMode === 'split' || viewMode === 'preview';

  return (
    <div className={`app-shell${graphFullscreen && viewMode === 'graph' ? ' graph-fullscreen' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div className="brand-copy">
            <h1>MD Workshop</h1>
            <span>Markdown desktop, simple et direct.</span>
          </div>
        </div>

        <div className="toolbar">
          <button className="toolbar-button accent" onClick={() => void chooseFolder()}>
            Ouvrir un dossier
          </button>
          <button className="toolbar-button" onClick={() => void saveFile()} disabled={!activeDoc || !activeDocDirty}>
            Enregistrer
          </button>
          <button className="toolbar-button" onClick={openQuickOpen}>
            Aller au fichier
          </button>
          {activeDoc && viewMode !== 'graph' && (
            <div className="segmented-control">
              <button className={viewMode === 'edit' ? 'active' : ''} onClick={() => setViewMode('edit')}>
                Édition
              </button>
              <button className={viewMode === 'split' ? 'active' : ''} onClick={() => setViewMode('split')}>
                Split
              </button>
              <button className={viewMode === 'preview' ? 'active' : ''} onClick={() => setViewMode('preview')}>
                Aperçu
              </button>
            </div>
          )}
          {activeDoc && viewMode !== 'graph' && (viewMode === 'split' || viewMode === 'preview') && (
            <button
              className={`toolbar-button ${previewEditable ? 'accent' : ''}`}
              onClick={() => setPreviewEditable((v) => !v)}
              title={previewEditable
                ? 'Aperçu éditable activé (cliquer pour désactiver)'
                : 'Activer l’édition dans l’aperçu'}
            >
              {previewEditable ? '✎ Aperçu éditable' : 'Aperçu éditable'}
            </button>
          )}
          {rootFolder && (
            <button
              className={`toolbar-button ${viewMode === 'graph' ? 'accent' : ''}`}
              onClick={() => setViewMode(viewMode === 'graph' ? (activeDoc ? 'split' : 'edit') : 'graph')}
              title="Mode graphe (Alt+4)"
            >
              {viewMode === 'graph' ? '← Retour' : 'Graphe'}
            </button>
          )}
        </div>
      </header>

      <main ref={workspaceRef} className="workspace">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <section className="sidebar-summary">
            <p className="sidebar-kicker">Bibliothèque</p>
            <div className="sidebar-summary-row">
              <LibrarySwitcher
                currentFolder={rootFolder}
                currentLabel={rootFolderLabel}
                recentFolders={recentFolders}
                favoriteFolders={favoriteFolders}
                onSwitch={(folder) => void switchToFolder(folder)}
                onToggleFavorite={toggleFavoriteFolder}
                onOpenPicker={() => setLibraryPickerOpen(true)}
                onChooseNewFolder={() => void chooseFolder()}
              />
              {rootFolder && <span>{files.length}</span>}
            </div>
            <p>{rootFolder ? 'Dossier Markdown ouvert.' : 'Choisis un dossier pour commencer.'}</p>
            <p className="sidebar-status">{status}</p>
          </section>

          <FileTree
            files={filteredFiles}
            activePath={activeDoc?.path ?? null}
            filter={fileFilter}
            onFilterChange={setFileFilter}
            onSelect={(file) => void openFile(file.path)}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onCreateNew={promptCreateFile}
            onRevealInFinder={(p) => void revealFileInFinder(p)}
            onRenameFile={(p) => void renameFileAt(p)}
            onDeleteFile={(p) => void deleteFileAt(p)}
            onCopyPath={(p) => void copyFilePath(p)}
          />

          <SearchPanel
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onSearch={() => void runSearch()}
            results={searchResults}
            onOpenResult={(path) => void openFile(path)}
            loading={searchLoading}
          />

          <OutlinePanel
            content={activeDoc?.content ?? null}
            onScrollToHeading={(text, index) => editorRef.current?.scrollToHeading(text, index)}
          />

          <BacklinksPanel
            rootFolder={rootFolder}
            activeFilePath={activeDoc?.path ?? null}
            onOpenFile={(path) => void openFile(path)}
          />
        </aside>

        <div
          className="panel-resizer workspace-resizer"
          onMouseDown={startSidebarResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner la barre latérale"
        />

        <section className="main-pane">
          {viewMode === 'graph' && rootFolder ? (
            <div className="graph-panel">
              <GraphControls
                rootFolder={rootFolder}
                files={files}
                mode={graphMode}
                depth={graphDepth}
                filterFolder={graphFilterFolder}
                filterTags={graphFilterTags}
                showOrphans={graphShowOrphans}
                onModeChange={setGraphMode}
                onDepthChange={setGraphDepth}
                onFilterFolderChange={setGraphFilterFolder}
                onFilterTagsChange={setGraphFilterTags}
                onShowOrphansChange={setGraphShowOrphans}
              />
              <Suspense fallback={<div className="graph-loading" aria-busy="true" />}>
                <GraphView
                  rootFolder={rootFolder}
                  activeFilePath={activeDoc?.path ?? null}
                  mode={graphMode}
                  depth={graphDepth}
                  filterFolder={graphFilterFolder}
                  filterTags={graphFilterTags}
                  showOrphans={graphShowOrphans}
                  fullscreen={graphFullscreen}
                  onToggleFullscreen={() => setGraphFullscreen((v) => !v)}
                  onNavigate={(path) => void openFile(path)}
                  onOpenInEditor={(path) => {
                    void openFile(path);
                    setViewMode('split');
                  }}
                />
              </Suspense>
            </div>
          ) : activeDoc ? (
            <div className="document-panel">
              <TabBar
                tabs={openTabs}
                activeTabPath={activeTabPath}
                onSelect={setActiveTabPath}
                onClose={closeTab}
              />

              <div className="document-header">
                <div className="document-title-block">
                  <h2>{activeDoc.name}</h2>
                  <p>{activeDoc.relativePath}</p>
                </div>
                <div className="document-header-side">
                  <button className="toolbar-button subtle" onClick={openQuickOpen}>
                    Ctrl+P
                  </button>
                  <span className={activeDocDirty ? 'dirty-pill' : 'saved-pill'}>
                    {activeDocDirty ? 'Modifié' : 'Enregistré'}
                  </span>
                </div>
              </div>

              {viewMode === 'split' ? (
                <div ref={splitLayoutRef} className="split-layout">
                  <section className="editor-pane split-pane" style={{ flex: `${splitRatio} 1 0` }}>
                    <MarkdownEditor
                      ref={editorRef}
                      value={activeDoc.content}
                      onChange={handleEditorChange}
                      wikiLinkFiles={wikiLinkFiles}
                      settings={editorSettings}
                      snippets={snippets}
                      onImageDrop={handleImageDrop}
                      onCursorChange={setCursorInfo}
                    />
                  </section>

                  <div
                    className="panel-resizer split-resizer"
                    onMouseDown={startSplitResize}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Redimensionner l'éditeur et l'aperçu"
                  />

                  <div className="preview-shell split-pane" style={{ flex: `${1 - splitRatio} 1 0` }}>
                    <PreviewPane
                      content={activeDoc.content}
                      files={files}
                      activeFilePath={activeDoc.path}
                      rootFolder={rootFolder}
                      onNavigate={(path) => void openFile(path)}
                      onCreateFile={(name) => void createFile(name)}
                      onToggleCheckbox={handleToggleCheckbox}
                      editable={previewEditable}
                      onChange={handleEditorChange}
                    />
                  </div>
                </div>
              ) : (
                <div className={`editor-preview-grid mode-${viewMode}`}>
                  {showEditor && (
                    <section className="editor-pane">
                      <MarkdownEditor
                        ref={editorRef}
                        value={activeDoc.content}
                        onChange={handleEditorChange}
                        wikiLinkFiles={wikiLinkFiles}
                        settings={editorSettings}
                        snippets={snippets}
                        onImageDrop={handleImageDrop}
                        onCursorChange={setCursorInfo}
                      />
                    </section>
                  )}
                  {showPreview && (
                    <div className="preview-shell">
                      <PreviewPane
                        content={activeDoc.content}
                        files={files}
                        activeFilePath={activeDoc.path}
                        rootFolder={rootFolder}
                        onNavigate={(path) => void openFile(path)}
                        onCreateFile={(name) => void createFile(name)}
                        onToggleCheckbox={handleToggleCheckbox}
                        editable={previewEditable}
                        onChange={handleEditorChange}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <section
              className={`welcome-screen${welcomeDropActive ? ' drop-active' : ''}`}
            >
              <p className="sidebar-kicker">MD Workshop</p>
              <h2>Un atelier Markdown très simple.</h2>
              <p>Ouvre un dossier local pour parcourir, éditer et prévisualiser tes notes sans distraction.</p>
              <p style={{ opacity: 0.7, fontSize: '0.9em' }}>
                Astuce : glisse un PDF ici pour le convertir en Markdown.
              </p>
              <div className="welcome-actions">
                <button className="toolbar-button accent" onClick={() => void chooseFolder()}>
                  Ouvrir un dossier
                </button>
                <button
                  className="toolbar-button"
                  onClick={() => void importPdfFromDialog()}
                  title="Convertir un PDF en fichier Markdown"
                >
                  Importer un PDF…
                </button>
                {!rootFolder && (
                  <button
                    className="toolbar-button"
                    onClick={() => void loadDemoWorkspace(false)}
                    title="Copie le dossier démo dans Documents/MD-Workshop-Demo/ et l'ouvre"
                  >
                    Charger la démo
                  </button>
                )}
                {rootFolder && files.length > 0 && (
                  <button className="toolbar-button" onClick={openQuickOpen}>
                    Aller au fichier
                  </button>
                )}
              </div>
              {rootFolder && files.length > 0 && (
                <div className="welcome-list">
                  {recentFiles.length > 0 && (
                    <p className="welcome-list-label">Fichiers récents</p>
                  )}
                  {(recentFiles.length > 0 ? recentFiles : files.slice(0, 6)).map((file) => (
                    <button key={file.path} className="welcome-file" onClick={() => void openFile(file.path)}>
                      <span>{file.name}</span>
                      <small>{file.relative_path}</small>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </section>
      </main>

      <footer className="statusbar" role="contentinfo">
        <div className="statusbar-left">
          <span className="statusbar-msg">{status}</span>
        </div>
        <div className="statusbar-right">
          {activeDoc && (
            <>
              {cursorInfo && (
                <span className="statusbar-cell">
                  Ln {cursorInfo.line}, Col {cursorInfo.col}
                  {cursorInfo.selectionLength > 0 && ` (${cursorInfo.selectionLength} sél.)`}
                </span>
              )}
              {docStats && (
                <>
                  <span className="statusbar-cell">{docStats.chars.toLocaleString('fr-FR')} car.</span>
                  <span className="statusbar-cell">{docStats.words.toLocaleString('fr-FR')} mots</span>
                  <span className="statusbar-cell">{docStats.lines.toLocaleString('fr-FR')} lignes</span>
                </>
              )}
              <span className="statusbar-cell">Markdown</span>
              <span className="statusbar-cell">UTF-8</span>
              <span className="statusbar-cell">LF</span>
            </>
          )}
        </div>
      </footer>

      <QuickOpen open={quickOpenOpen} files={files} onOpenFile={openFile} onClose={() => setQuickOpenOpen(false)} />

      <CommandPalette
        open={commandPaletteOpen}
        commands={paletteCommands}
        onClose={() => setCommandPaletteOpen(false)}
      />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onChange={updateSettings}
        onClose={() => setSettingsOpen(false)}
      />

      <SnippetsDialog
        open={snippetsOpen}
        snippets={snippets}
        onChange={updateSnippets}
        onClose={() => setSnippetsOpen(false)}
      />

      <BrokenLinksDialog
        open={brokenLinksOpen}
        rootFolder={rootFolder}
        onClose={() => setBrokenLinksOpen(false)}
        onOpenFile={(path) => void openFile(path)}
      />

      <LibraryPicker
        open={libraryPickerOpen}
        currentFolder={rootFolder}
        recentFolders={recentFolders}
        favoriteFolders={favoriteFolders}
        onSelect={(folder) => void switchToFolder(folder)}
        onToggleFavorite={toggleFavoriteFolder}
        onRemoveRecent={removeRecentFolder}
        onChooseNewFolder={() => {
          setLibraryPickerOpen(false);
          void chooseFolder();
        }}
        onLoadDemo={() => {
          setLibraryPickerOpen(false);
          void loadDemoWorkspace(false);
        }}
        onClose={() => setLibraryPickerOpen(false)}
      />

      <ReplacePanel
        open={replacePanelOpen}
        rootFolder={rootFolder}
        onClose={() => setReplacePanelOpen(false)}
        onDone={(result) => {
          setReplacePanelOpen(false);
          setStatus(
            `Remplacement terminé : ${result.replacements} modification(s) dans ${result.files_changed} fichier(s).`
          );
          if (rootFolder) void refreshFiles(rootFolder);
        }}
        onOpenFile={(path) => void openFile(path)}
      />
    </div>
  );
}
