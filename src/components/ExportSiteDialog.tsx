import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  defaultOutputDir,
  exportStaticSite,
  type SiteStats,
  type SiteTheme
} from '../lib/staticSite';
import type { MarkdownFileEntry } from '../types';

type Props = {
  open: boolean;
  rootFolder: string | null;
  onClose: () => void;
  onStatus: (msg: string) => void;
};

type Phase = 'idle' | 'running' | 'done' | 'error';

export function ExportSiteDialog({ open, rootFolder, onClose, onStatus }: Props) {
  const [outputDir, setOutputDir] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [theme, setTheme] = useState<SiteTheme>('auto');
  const [includeBacklinks, setIncludeBacklinks] = useState(true);
  const [copyAssets, setCopyAssets] = useState(true);

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && rootFolder) {
      setOutputDir(defaultOutputDir(rootFolder));
      setPhase('idle');
      setProgress(null);
      setStats(null);
      setError(null);
    }
  }, [open, rootFolder]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'running') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, phase]);

  if (!open) return null;

  async function pickOutputDir() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Choisir le dossier de sortie',
      defaultPath: outputDir || undefined
    });
    if (typeof selected === 'string') {
      setOutputDir(selected);
    }
  }

  async function runExport() {
    if (!rootFolder) return;
    setPhase('running');
    setError(null);
    setStats(null);

    try {
      const files = await invoke<MarkdownFileEntry[]>('list_markdown_files', {
        rootPath: rootFolder
      });
      if (files.length === 0) {
        throw new Error('Aucun fichier Markdown à exporter.');
      }
      const result = await exportStaticSite(
        rootFolder,
        files,
        {
          outputDir,
          baseUrl,
          theme,
          includeBacklinks,
          copyAssets
        },
        (p) => setProgress(p)
      );
      setStats(result);
      setPhase('done');
      onStatus(`Site exporté : ${result.pages_written} pages dans ${result.output_dir}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
      onStatus(`Échec de l'export du site : ${String(e)}`);
    }
  }

  async function revealOutput() {
    if (!stats) return;
    try {
      await invoke('reveal_in_file_manager', { path: stats.output_dir });
    } catch (e) {
      onStatus(`Impossible d'ouvrir le dossier : ${String(e)}`);
    }
  }

  const running = phase === 'running';

  return (
    <div className="settings-backdrop" onClick={() => !running && onClose()}>
      <section
        className="settings-dialog"
        style={{ maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <p className="sidebar-kicker">Export</p>
            <h2>Exporter en site statique</h2>
          </div>
          <button
            className="quick-open-close"
            onClick={onClose}
            disabled={running}
            aria-label="Fermer"
          >
            Esc
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <p style={{ color: 'var(--muted)', margin: '0 0 12px' }}>
              Génère un site HTML autonome (une page par note, sidebar de navigation,
              backlinks, pages de tags) à partir de toute la bibliothèque.
            </p>

            <div className="settings-row">
              <div className="settings-label">
                <label>Dossier de sortie</label>
                <p>Tout son contenu sera créé/écrasé.</p>
              </div>
              <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
                <input
                  className="settings-input"
                  value={outputDir}
                  onChange={(e) => setOutputDir(e.target.value)}
                  disabled={running}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  className="toolbar-button subtle"
                  onClick={() => void pickOutputDir()}
                  disabled={running}
                >
                  Parcourir…
                </button>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-label">
                <label>URL de base (optionnel)</label>
                <p>
                  Active <code>sitemap.xml</code> et liens canoniques.
                  Ex. <code>https://notes.exemple.com</code>.
                </p>
              </div>
              <input
                className="settings-input"
                placeholder="https://…"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={running}
              />
            </div>

            <div className="settings-row">
              <div className="settings-label">
                <label>Thème</label>
                <p>« Auto » suit les préférences du visiteur.</p>
              </div>
              <div className="segmented-control settings-segmented">
                {(['auto', 'light', 'dark'] as SiteTheme[]).map((t) => (
                  <button
                    key={t}
                    className={theme === t ? 'active' : ''}
                    onClick={() => setTheme(t)}
                    disabled={running}
                  >
                    {t === 'auto' ? 'Auto' : t === 'light' ? 'Clair' : 'Sombre'}
                  </button>
                ))}
              </div>
            </div>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={includeBacklinks}
                onChange={(e) => setIncludeBacklinks(e.target.checked)}
                disabled={running}
              />
              <span>
                <strong>Inclure les backlinks</strong>
                <small>Ajoute « Mentions liées » au pied de chaque page.</small>
              </span>
            </label>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={copyAssets}
                onChange={(e) => setCopyAssets(e.target.checked)}
                disabled={running}
              />
              <span>
                <strong>Copier le dossier <code>assets/</code></strong>
                <small>Nécessaire si vos notes embarquent des images locales.</small>
              </span>
            </label>
          </section>

          {progress && phase === 'running' && (
            <section className="settings-section">
              <p style={{ margin: '4px 0', fontSize: '0.9rem' }}>
                Rendu : {progress.current} / {progress.total} —{' '}
                <span style={{ color: 'var(--muted)' }}>{progress.label}</span>
              </p>
              <div
                style={{
                  height: 6,
                  background: 'var(--line)',
                  borderRadius: 3,
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                    background: 'var(--accent)',
                    transition: 'width 120ms ease'
                  }}
                />
              </div>
            </section>
          )}

          {phase === 'done' && stats && (
            <section className="settings-section">
              <p style={{ margin: 0 }}>
                ✅ <strong>{stats.pages_written}</strong> pages écrites
                {stats.assets_copied > 0 && <> · <strong>{stats.assets_copied}</strong> assets copiés</>}
                <> · {stats.duration_ms} ms</>
              </p>
              <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
                {stats.output_dir}
              </p>
            </section>
          )}

          {phase === 'error' && error && (
            <section className="settings-section">
              <p className="front-matter-error" style={{ margin: 0 }}>
                Erreur : {error}
              </p>
            </section>
          )}
        </div>

        <footer className="settings-footer">
          {phase === 'done' && stats && (
            <button className="toolbar-button subtle" onClick={() => void revealOutput()}>
              Ouvrir le dossier
            </button>
          )}
          <button
            className="toolbar-button subtle"
            onClick={onClose}
            disabled={running}
          >
            {phase === 'done' ? 'Fermer' : 'Annuler'}
          </button>
          <button
            className="toolbar-button accent"
            onClick={() => void runExport()}
            disabled={running || !rootFolder || !outputDir.trim()}
          >
            {running ? 'Export en cours…' : phase === 'done' ? 'Réexporter' : 'Exporter'}
          </button>
        </footer>
      </section>
    </div>
  );
}
