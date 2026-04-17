import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { MarkdownFileEntry } from '../types';

export type SortKey = 'name' | 'date' | 'size';

type Props = {
  files: MarkdownFileEntry[];
  activePath: string | null;
  filter: string;
  onFilterChange: (value: string) => void;
  onSelect: (file: MarkdownFileEntry) => void;
  favorites: Set<string>;
  onToggleFavorite: (path: string) => void;
  onCreateNew: () => void;
  onRevealInFinder?: (path: string) => void;
  onRenameFile?: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onCopyPath?: (path: string) => void;
};

type ContextMenuState = {
  x: number;
  y: number;
  file: MarkdownFileEntry;
};

const SORT_KEY = 'md-workshop:sort-by';
const SORT_DIR_KEY = 'md-workshop:sort-dir';

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Nom',
  date: 'Date',
  size: 'Taille'
};

function compareFn(a: MarkdownFileEntry, b: MarkdownFileEntry, key: SortKey, asc: boolean): number {
  let cmp = 0;
  switch (key) {
    case 'name':
      cmp = a.relative_path.localeCompare(b.relative_path);
      break;
    case 'date':
      cmp = (a.modified_unix ?? 0) - (b.modified_unix ?? 0);
      break;
    case 'size':
      cmp = a.size - b.size;
      break;
  }
  return asc ? cmp : -cmp;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(unix: number | null): string {
  if (!unix) return '—';
  const date = new Date(unix * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Today
  if (diffDays === 0) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  // Yesterday
  if (diffDays === 1) return 'hier';
  // This week
  if (diffDays < 7) return `il y a ${diffDays} j`;
  // This year
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }
  // Older
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function FileTree({ files, activePath, filter, onFilterChange, onSelect, favorites, onToggleFavorite, onCreateNew, onRevealInFinder, onRenameFile, onDeleteFile, onCopyPath }: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onEsc);
    };
  }, [contextMenu]);

  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const stored = localStorage.getItem(SORT_KEY);
    return (stored === 'name' || stored === 'date' || stored === 'size') ? stored : 'name';
  });

  const [sortAsc, setSortAsc] = useState(() => {
    const stored = localStorage.getItem(SORT_DIR_KEY);
    return stored === 'desc' ? false : true;
  });

  function changeSortKey(key: SortKey) {
    if (key === sortKey) {
      // Toggle direction
      const next = !sortAsc;
      setSortAsc(next);
      localStorage.setItem(SORT_DIR_KEY, next ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      // Default: name asc, date desc (newest first), size desc (largest first)
      const defaultAsc = key === 'name';
      setSortAsc(defaultAsc);
      localStorage.setItem(SORT_KEY, key);
      localStorage.setItem(SORT_DIR_KEY, defaultAsc ? 'asc' : 'desc');
    }
  }

  const isFiltering = filter.trim().length > 0;

  const { pinnedFiles, otherFiles } = useMemo(() => {
    const sorted = [...files].sort((a, b) => compareFn(a, b, sortKey, sortAsc));

    if (isFiltering || favorites.size === 0) {
      return { pinnedFiles: [] as MarkdownFileEntry[], otherFiles: sorted };
    }

    const pinned: MarkdownFileEntry[] = [];
    const rest: MarkdownFileEntry[] = [];
    for (const f of sorted) {
      if (favorites.has(f.path)) {
        pinned.push(f);
      } else {
        rest.push(f);
      }
    }
    return { pinnedFiles: pinned, otherFiles: rest };
  }, [files, sortKey, sortAsc, favorites, isFiltering]);

  function renderFile(file: MarkdownFileEntry) {
    const isFav = favorites.has(file.path);
    const meta =
      sortKey === 'date'
        ? formatDate(file.modified_unix)
        : sortKey === 'size'
          ? formatSize(file.size)
          : null;

    return (
      <div
        key={file.path}
        className={clsx('file-row', activePath === file.path && 'active')}
        onClick={() => onSelect(file)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY, file });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(file);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <span className="file-row-main">
          <span className="file-name">{file.name}</span>
          <span className="file-row-side">
            {meta && <span className="file-meta">{meta}</span>}
            <button
              type="button"
              className={clsx('file-fav-btn', isFav && 'is-fav')}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(file.path);
              }}
              title={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              aria-label={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            >
              {isFav ? '★' : '☆'}
            </button>
          </span>
        </span>
        <span className="file-path">{file.relative_path}</span>
      </div>
    );
  }

  return (
    <section className="sidebar-section">
      <div className="sidebar-section-header">
        <h3>Fichiers</h3>
        <div className="sidebar-section-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onCreateNew}
            title="Nouveau fichier (Ctrl+N)"
            aria-label="Nouveau fichier"
          >
            +
          </button>
          <span className="sidebar-count">{files.length}</span>
        </div>
      </div>
      <div className="sidebar-controls">
        <input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filtrer les fichiers"
          className="text-input"
        />
        <div className="sort-bar">
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <button
              key={key}
              className={clsx('sort-btn', sortKey === key && 'active')}
              onClick={() => changeSortKey(key)}
            >
              {SORT_LABELS[key]}
              {sortKey === key && (
                <span className="sort-arrow">{sortAsc ? '↑' : '↓'}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="file-list">
        {files.length === 0 ? (
          <p className="sidebar-empty">Aucun fichier Markdown dans ce dossier.</p>
        ) : (
          <>
            {pinnedFiles.length > 0 && (
              <>
                <div className="file-list-divider">
                  <span>Épinglés</span>
                </div>
                {pinnedFiles.map(renderFile)}
                <div className="file-list-divider">
                  <span>Tous les fichiers</span>
                </div>
              </>
            )}
            {otherFiles.map(renderFile)}
          </>
        )}
      </div>

      {contextMenu && (
        <div
          className="editor-context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1000 }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="editor-context-item"
            onClick={() => {
              onSelect(contextMenu.file);
              setContextMenu(null);
            }}
          >
            Ouvrir
          </button>
          {onRevealInFinder && (
            <button
              type="button"
              className="editor-context-item"
              onClick={() => {
                onRevealInFinder(contextMenu.file.path);
                setContextMenu(null);
              }}
            >
              Afficher dans le Finder
            </button>
          )}
          {onRenameFile && (
            <button
              type="button"
              className="editor-context-item"
              onClick={() => {
                onRenameFile(contextMenu.file.path);
                setContextMenu(null);
              }}
            >
              Renommer…
            </button>
          )}
          {onCopyPath && (
            <button
              type="button"
              className="editor-context-item"
              onClick={() => {
                onCopyPath(contextMenu.file.path);
                setContextMenu(null);
              }}
            >
              Copier le chemin
            </button>
          )}
          <button
            type="button"
            className="editor-context-item"
            onClick={() => {
              onToggleFavorite(contextMenu.file.path);
              setContextMenu(null);
            }}
          >
            {favorites.has(contextMenu.file.path) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          </button>
          {onDeleteFile && (
            <button
              type="button"
              className="editor-context-item danger"
              onClick={() => {
                onDeleteFile(contextMenu.file.path);
                setContextMenu(null);
              }}
            >
              Supprimer…
            </button>
          )}
        </div>
      )}
    </section>
  );
}
