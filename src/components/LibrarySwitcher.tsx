import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

type Props = {
  currentFolder: string | null;
  currentLabel: string;
  recentFolders: string[];
  favoriteFolders: string[];
  onSwitch: (folder: string) => void;
  onToggleFavorite: (folder: string) => void;
  onOpenPicker: () => void;
  onChooseNewFolder: () => void;
};

function folderLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function LibrarySwitcher({
  currentFolder,
  currentLabel,
  recentFolders,
  favoriteFolders,
  onSwitch,
  onToggleFavorite,
  onOpenPicker,
  onChooseNewFolder
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isFav = currentFolder ? favoriteFolders.includes(currentFolder) : false;
  const favSet = new Set(favoriteFolders);

  // Favoris en premier, puis récentes (hors courante et hors favoris déjà listés)
  const favoriteEntries = favoriteFolders.filter((f) => f !== currentFolder);
  const recentEntries = recentFolders.filter(
    (f) => f !== currentFolder && !favSet.has(f)
  ).slice(0, 6);

  function handleSelect(folder: string) {
    setOpen(false);
    onSwitch(folder);
  }

  return (
    <div className="library-switcher" ref={ref}>
      <button
        type="button"
        className="library-switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="library-switcher-label">{currentLabel}</span>
        <span className="library-switcher-caret" aria-hidden="true">▾</span>
      </button>

      {currentFolder && (
        <button
          type="button"
          className={clsx('icon-btn library-switcher-fav', isFav && 'is-fav')}
          onClick={() => onToggleFavorite(currentFolder)}
          title={isFav ? 'Retirer des favoris' : 'Mettre en favori'}
          aria-label={isFav ? 'Retirer des favoris' : 'Mettre en favori'}
        >
          {isFav ? '★' : '☆'}
        </button>
      )}

      {open && (
        <div className="library-switcher-menu" role="menu">
          {favoriteEntries.length > 0 && (
            <>
              <div className="library-switcher-section">Favoris</div>
              {favoriteEntries.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="library-switcher-item"
                  onClick={() => handleSelect(f)}
                  title={f}
                >
                  <span className="library-switcher-item-icon">★</span>
                  <span className="library-switcher-item-name">{folderLabel(f)}</span>
                </button>
              ))}
            </>
          )}

          {recentEntries.length > 0 && (
            <>
              <div className="library-switcher-section">Récentes</div>
              {recentEntries.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="library-switcher-item"
                  onClick={() => handleSelect(f)}
                  title={f}
                >
                  <span className="library-switcher-item-icon">📁</span>
                  <span className="library-switcher-item-name">{folderLabel(f)}</span>
                </button>
              ))}
            </>
          )}

          {favoriteEntries.length === 0 && recentEntries.length === 0 && (
            <div className="library-switcher-empty">Aucune autre bibliothèque.</div>
          )}

          <div className="library-switcher-divider" />
          <button
            type="button"
            className="library-switcher-item"
            onClick={() => {
              setOpen(false);
              onOpenPicker();
            }}
          >
            <span className="library-switcher-item-icon">⋯</span>
            <span className="library-switcher-item-name">Toutes les bibliothèques…</span>
          </button>
          <button
            type="button"
            className="library-switcher-item"
            onClick={() => {
              setOpen(false);
              onChooseNewFolder();
            }}
          >
            <span className="library-switcher-item-icon">+</span>
            <span className="library-switcher-item-name">Ouvrir un dossier…</span>
          </button>
        </div>
      )}
    </div>
  );
}
