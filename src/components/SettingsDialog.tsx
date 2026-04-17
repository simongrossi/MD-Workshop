import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  FONT_FAMILY_OPTIONS,
  type AppSettings,
  type DefaultViewMode,
  type Theme
} from '../lib/settings';

type Props = {
  open: boolean;
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onClose: () => void;
};

export function SettingsDialog({ open, settings, onChange, onClose }: Props) {
  const [local, setLocal] = useState<AppSettings>(settings);

  useEffect(() => {
    if (open) setLocal(settings);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    const next = { ...local, [key]: value };
    setLocal(next);
    onChange(next); // live apply
  }

  function resetDefaults() {
    setLocal(DEFAULT_SETTINGS);
    onChange(DEFAULT_SETTINGS);
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <div>
            <p className="sidebar-kicker">Paramètres</p>
            <h2>Configuration</h2>
          </div>
          <button className="quick-open-close" onClick={onClose} aria-label="Fermer">
            Esc
          </button>
        </header>

        <div className="settings-body">
          {/* ── Éditeur ── */}
          <section className="settings-section">
            <h3>Éditeur</h3>

            <div className="settings-row">
              <div className="settings-label">
                <label>Famille de police</label>
                <p>Police utilisée dans la zone d'édition.</p>
              </div>
              <select
                className="settings-input"
                value={local.editorFontFamily}
                onChange={(e) => update('editorFontFamily', e.target.value)}
              >
                {FONT_FAMILY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-label">
                <label>Taille de police</label>
                <p>Entre 10 et 24 pixels.</p>
              </div>
              <input
                type="number"
                min={10}
                max={24}
                className="settings-input settings-input-sm"
                value={local.editorFontSize}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 10 && n <= 24) update('editorFontSize', n);
                }}
              />
            </div>

            <div className="settings-row">
              <div className="settings-label">
                <label>Taille de tabulation</label>
                <p>Nombre d'espaces représentant une tabulation.</p>
              </div>
              <input
                type="number"
                min={1}
                max={8}
                className="settings-input settings-input-sm"
                value={local.editorTabSize}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 1 && n <= 8) update('editorTabSize', n);
                }}
              />
            </div>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={local.editorLineWrap}
                onChange={(e) => update('editorLineWrap', e.target.checked)}
              />
              <span>
                <strong>Retour à la ligne automatique</strong>
                <small>Enveloppe les lignes longues au lieu de scroller horizontalement.</small>
              </span>
            </label>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={local.editorLineNumbers}
                onChange={(e) => update('editorLineNumbers', e.target.checked)}
              />
              <span>
                <strong>Numéros de ligne</strong>
                <small>Affiche la numérotation à gauche de l'éditeur.</small>
              </span>
            </label>
          </section>

          {/* ── Apparence ── */}
          <section className="settings-section">
            <h3>Apparence</h3>

            <div className="settings-row">
              <div className="settings-label">
                <label>Thème</label>
                <p>Mode clair ou sombre.</p>
              </div>
              <div className="segmented-control settings-segmented">
                <button
                  className={local.theme === 'light' ? 'active' : ''}
                  onClick={() => update('theme', 'light' as Theme)}
                >
                  Clair
                </button>
                <button
                  className={local.theme === 'dark' ? 'active' : ''}
                  onClick={() => update('theme', 'dark' as Theme)}
                >
                  Sombre
                </button>
              </div>
            </div>
          </section>

          {/* ── Affichage ── */}
          <section className="settings-section">
            <h3>Affichage</h3>

            <div className="settings-row">
              <div className="settings-label">
                <label>Mode par défaut</label>
                <p>Mode appliqué à l'ouverture d'un fichier.</p>
              </div>
              <div className="segmented-control settings-segmented">
                {(['edit', 'split', 'preview'] as DefaultViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    className={local.defaultViewMode === mode ? 'active' : ''}
                    onClick={() => update('defaultViewMode', mode)}
                  >
                    {mode === 'edit' ? 'Édition' : mode === 'split' ? 'Split' : 'Aperçu'}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <footer className="settings-footer">
          <button className="toolbar-button subtle" onClick={resetDefaults}>
            Réinitialiser
          </button>
          <button className="toolbar-button accent" onClick={onClose}>
            Fermer
          </button>
        </footer>
      </section>
    </div>
  );
}
