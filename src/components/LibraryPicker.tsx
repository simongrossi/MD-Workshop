import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';

type Props = {
  open: boolean;
  currentFolder: string | null;
  recentFolders: string[];
  favoriteFolders: string[];
  onSelect: (folder: string) => void;
  onToggleFavorite: (folder: string) => void;
  onRemoveRecent: (folder: string) => void;
  onChooseNewFolder: () => void;
  onClose: () => void;
};

function folderLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function folderParent(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return path;
  return parts.slice(0, -1).join('/');
}

export function LibraryPicker({
  open,
  currentFolder,
  recentFolders,
  favoriteFolders,
  onSelect,
  onToggleFavorite,
  onRemoveRecent,
  onChooseNewFolder,
  onClose
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const favSet = useMemo(() => new Set(favoriteFolders), [favoriteFolders]);

  const filteredFavs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return favoriteFolders.filter((f) => !q || f.toLowerCase().includes(q));
  }, [favoriteFolders, query]);

  const filteredRecents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recentFolders
      .filter((f) => !favSet.has(f)) // favoris déjà affichés
      .filter((f) => !q || f.toLowerCase().includes(q));
  }, [recentFolders, favSet, query]);

  if (!open) return null;

  function renderItem(folder: string) {
    const isFav = favSet.has(folder);
    const isCurrent = folder === currentFolder;
    return (
      <div
        key={folder}
        className={clsx('library-item', isCurrent && 'is-current')}
        onClick={() => onSelect(folder)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(folder);
          }
        }}
      >
        <span className="library-item-icon" aria-hidden="true">📁</span>
        <div className="library-item-main">
          <div className="library-item-name">
            {folderLabel(folder)}
            {isCurrent && <span className="library-item-badge">actuelle</span>}
          </div>
          <div className="library-item-path">{folderParent(folder)}</div>
        </div>
        <div className="library-item-actions">
          <button
            type="button"
            className={clsx('icon-btn', isFav && 'is-fav')}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(folder);
            }}
            title={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            aria-label={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            {isFav ? '★' : '☆'}
          </button>
          {!isFav && (
            <button
              type="button"
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveRecent(folder);
              }}
              title="Retirer de l'historique"
              aria-label="Retirer de l'historique"
            >
              ×
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="library-backdrop" onClick={onClose}>
      <section className="library-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="library-header">
          <div>
            <p className="sidebar-kicker">Bibliothèques</p>
            <h2>Changer de bibliothèque</h2>
          </div>
          <button className="quick-open-close" onClick={onClose}>Esc</button>
        </header>

        <div className="library-search">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer les bibliothèques…"
            className="text-input"
          />
          <button className="toolbar-button accent" onClick={onChooseNewFolder}>
            + Ouvrir un dossier…
          </button>
        </div>

        <div className="library-body">
          {filteredFavs.length > 0 && (
            <>
              <h3 className="library-section-title">Favoris</h3>
              <div className="library-list">
                {filteredFavs.map(renderItem)}
              </div>
            </>
          )}

          {filteredRecents.length > 0 && (
            <>
              <h3 className="library-section-title">Récentes</h3>
              <div className="library-list">
                {filteredRecents.map(renderItem)}
              </div>
            </>
          )}

          {filteredFavs.length === 0 && filteredRecents.length === 0 && (
            <p className="sidebar-empty library-empty">
              {query
                ? 'Aucune bibliothèque ne correspond.'
                : 'Aucune bibliothèque dans l\u2019historique. Ouvre un dossier pour commencer.'}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
