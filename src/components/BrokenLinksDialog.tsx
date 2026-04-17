import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { BrokenLink } from '../types';

type Props = {
  open: boolean;
  rootFolder: string | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
};

type GroupedBroken = Record<string, BrokenLink[]>;

export function BrokenLinksDialog({ open, rootFolder, onClose, onOpenFile }: Props) {
  const [loading, setLoading] = useState(false);
  const [links, setLinks] = useState<BrokenLink[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !rootFolder) return;
    setLoading(true);
    setError(null);
    invoke<BrokenLink[]>('find_broken_links', { rootPath: rootFolder })
      .then((result) => {
        setLinks(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [open, rootFolder]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const grouped = useMemo<GroupedBroken>(() => {
    const g: GroupedBroken = {};
    for (const link of links) {
      if (!g[link.source_path]) g[link.source_path] = [];
      g[link.source_path].push(link);
    }
    return g;
  }, [links]);

  const sourceFiles = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  async function refresh() {
    if (!rootFolder) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<BrokenLink[]>('find_broken_links', { rootPath: rootFolder });
      setLinks(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section className="settings-dialog broken-links-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <div>
            <p className="sidebar-kicker">Audit</p>
            <h2>
              Liens cassés{' '}
              {!loading && links.length > 0 && (
                <span className="broken-links-count">{links.length}</span>
              )}
            </h2>
          </div>
          <div className="broken-links-header-actions">
            <button className="toolbar-button subtle" onClick={() => void refresh()} disabled={loading}>
              Rafraîchir
            </button>
            <button className="quick-open-close" onClick={onClose}>Esc</button>
          </div>
        </header>

        <div className="broken-links-body">
          {loading && <p className="sidebar-empty">Analyse en cours…</p>}
          {error && <p className="front-matter-error">Erreur : {error}</p>}

          {!loading && !error && links.length === 0 && (
            <p className="broken-links-empty">
              🎉 Aucun lien cassé détecté dans cette bibliothèque.
            </p>
          )}

          {!loading && links.length > 0 && (
            <div className="broken-links-list">
              {sourceFiles.map((sourcePath) => {
                const group = grouped[sourcePath];
                const first = group[0];
                return (
                  <div key={sourcePath} className="broken-links-file">
                    <button
                      type="button"
                      className="broken-links-file-header"
                      onClick={() => {
                        onClose();
                        onOpenFile(sourcePath);
                      }}
                      title={sourcePath}
                    >
                      <span className="broken-links-file-name">{first.source_name}</span>
                      <span className="broken-links-file-path">{first.source_relative}</span>
                      <span className="broken-links-file-count">{group.length}</span>
                    </button>

                    <div className="broken-links-items">
                      {group.map((link, idx) => (
                        <div
                          key={`${link.line_number}-${idx}`}
                          className="broken-links-item"
                          onClick={() => {
                            onClose();
                            onOpenFile(sourcePath);
                          }}
                        >
                          <span className={`broken-links-kind broken-links-kind-${link.kind}`}>
                            {link.kind === 'wiki' ? '[[…]]' : '[](…)'}
                          </span>
                          <div className="broken-links-item-main">
                            <div className="broken-links-target">{link.target}</div>
                            <div className="broken-links-context">
                              <span className="broken-links-line">L{link.line_number}</span>
                              <span>{link.context}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="settings-footer">
          <span className="broken-links-summary">
            {!loading && `${sourceFiles.length} fichier(s) · ${links.length} lien(s) cassé(s)`}
          </span>
          <button className="toolbar-button accent" onClick={onClose}>Fermer</button>
        </footer>
      </section>
    </div>
  );
}
