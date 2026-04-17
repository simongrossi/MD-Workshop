import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarkdownFileEntry } from '../types';

type Props = {
  open: boolean;
  files: MarkdownFileEntry[];
  onOpenFile: (path: string) => Promise<boolean> | boolean;
  onClose: () => void;
};

function scoreFile(file: MarkdownFileEntry, query: string) {
  const normalizedQuery = query.toLowerCase();
  const relative = file.relative_path.toLowerCase();
  const name = file.name.toLowerCase();

  if (!normalizedQuery) return 0;
  if (name === normalizedQuery) return 1;
  if (relative === normalizedQuery) return 2;
  if (name.startsWith(normalizedQuery)) return 3;
  if (relative.startsWith(normalizedQuery)) return 4;
  if (name.includes(normalizedQuery)) return 5;
  if (relative.includes(normalizedQuery)) return 6;
  return 99;
}

export function QuickOpen({ open, files, onOpenFile, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return files
      .map((file) => ({ file, score: scoreFile(file, normalizedQuery) }))
      .filter(({ score }) => score < 99)
      .sort((a, b) => a.score - b.score || a.file.relative_path.localeCompare(b.file.relative_path))
      .slice(0, 14)
      .map(({ file }) => file);
  }, [files, query]);

  useEffect(() => {
    if (!open) return;

    setQuery('');
    setActiveIndex(0);
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  return (
    <div className="quick-open-backdrop" onClick={onClose}>
      <section className="quick-open-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="quick-open-header">
          <p className="sidebar-kicker">Aller au fichier</p>
          <button className="quick-open-close" onClick={onClose}>
            Esc
          </button>
        </div>

        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose();
              return;
            }

            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
              return;
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
              return;
            }

            if (event.key === 'Enter' && matches[activeIndex]) {
              event.preventDefault();
              void Promise.resolve(onOpenFile(matches[activeIndex].path)).then((opened) => {
                if (opened) {
                  onClose();
                }
              });
            }
          }}
          className="quick-open-input"
          placeholder="Nom de fichier ou chemin…"
        />

        <div className="quick-open-results">
          {matches.length === 0 ? (
            <p className="sidebar-empty">Aucun fichier ne correspond à cette recherche.</p>
          ) : (
            matches.map((file, index) => (
              <button
                key={file.path}
                className={`quick-open-item${index === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  void Promise.resolve(onOpenFile(file.path)).then((opened) => {
                    if (opened) {
                      onClose();
                    }
                  });
                }}
              >
                <span>{file.name}</span>
                <small>{file.relative_path}</small>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
