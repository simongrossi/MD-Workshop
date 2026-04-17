import { useEffect, useState } from 'react';
import { DEFAULT_SNIPPETS, type Snippet } from '../lib/snippets';

type Props = {
  open: boolean;
  snippets: Snippet[];
  onChange: (next: Snippet[]) => void;
  onClose: () => void;
};

function makeId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function SnippetsDialog({ open, snippets, onChange, onClose }: Props) {
  const [local, setLocal] = useState<Snippet[]>(snippets);
  const [selectedId, setSelectedId] = useState<string | null>(snippets[0]?.id ?? null);

  useEffect(() => {
    if (open) {
      setLocal(snippets);
      if (!selectedId && snippets[0]) setSelectedId(snippets[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, snippets]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selected = local.find((s) => s.id === selectedId) ?? null;

  function commit(next: Snippet[]) {
    setLocal(next);
    onChange(next);
  }

  function updateSelected(patch: Partial<Snippet>) {
    if (!selected) return;
    commit(local.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)));
  }

  function addSnippet() {
    const fresh: Snippet = {
      id: makeId(),
      prefix: 'nouveau',
      label: 'Nouveau snippet',
      body: '{{cursor}}',
      description: ''
    };
    commit([...local, fresh]);
    setSelectedId(fresh.id);
  }

  function removeSelected() {
    if (!selected) return;
    if (!window.confirm(`Supprimer le snippet "${selected.label}" ?`)) return;
    const next = local.filter((s) => s.id !== selected.id);
    commit(next);
    setSelectedId(next[0]?.id ?? null);
  }

  function resetDefaults() {
    if (!window.confirm('Réinitialiser tous les snippets aux valeurs par défaut ?')) return;
    commit(DEFAULT_SNIPPETS);
    setSelectedId(DEFAULT_SNIPPETS[0]?.id ?? null);
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section className="settings-dialog snippets-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <div>
            <p className="sidebar-kicker">Snippets</p>
            <h2>Gérer les raccourcis</h2>
          </div>
          <button className="quick-open-close" onClick={onClose}>Esc</button>
        </header>

        <div className="snippets-body">
          {/* List on the left */}
          <aside className="snippets-list">
            <div className="snippets-list-header">
              <span>{local.length} snippet(s)</span>
              <button className="icon-btn" onClick={addSnippet} title="Nouveau snippet">+</button>
            </div>
            <div className="snippets-items">
              {local.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`snippets-item${s.id === selectedId ? ' active' : ''}`}
                  onClick={() => setSelectedId(s.id)}
                >
                  <span className="snippets-item-label">{s.label}</span>
                  <span className="snippets-item-prefix">{s.prefix}</span>
                </button>
              ))}
            </div>
          </aside>

          {/* Editor on the right */}
          <section className="snippets-editor">
            {selected ? (
              <>
                <div className="settings-row">
                  <div className="settings-label">
                    <label>Nom affiché</label>
                    <p>Visible dans la liste d'autocomplétion.</p>
                  </div>
                  <input
                    className="settings-input"
                    value={selected.label}
                    onChange={(e) => updateSelected({ label: e.target.value })}
                  />
                </div>

                <div className="settings-row">
                  <div className="settings-label">
                    <label>Préfixe de déclenchement</label>
                    <p>Tape ce mot puis Ctrl+Espace pour insérer.</p>
                  </div>
                  <input
                    className="settings-input settings-input-sm"
                    value={selected.prefix}
                    onChange={(e) => updateSelected({ prefix: e.target.value })}
                  />
                </div>

                <div className="settings-row">
                  <div className="settings-label">
                    <label>Description</label>
                    <p>Optionnelle — affichée dans le menu.</p>
                  </div>
                  <input
                    className="settings-input"
                    value={selected.description ?? ''}
                    onChange={(e) => updateSelected({ description: e.target.value })}
                  />
                </div>

                <div className="snippets-body-field">
                  <label>Contenu</label>
                  <p className="snippets-hint">
                    Utilise <code>{'{{cursor}}'}</code> pour la position du curseur,{' '}
                    <code>{'{{date}}'}</code> pour la date du jour,{' '}
                    <code>{'{{datetime}}'}</code> pour date+heure.
                  </p>
                  <textarea
                    className="snippets-textarea"
                    value={selected.body}
                    onChange={(e) => updateSelected({ body: e.target.value })}
                    rows={8}
                  />
                </div>

                <div className="snippets-footer">
                  <button className="toolbar-button" onClick={removeSelected}>
                    Supprimer ce snippet
                  </button>
                </div>
              </>
            ) : (
              <p className="sidebar-empty">Sélectionne un snippet ou crée-en un.</p>
            )}
          </section>
        </div>

        <footer className="settings-footer">
          <button className="toolbar-button subtle" onClick={resetDefaults}>
            Réinitialiser les défauts
          </button>
          <button className="toolbar-button accent" onClick={onClose}>
            Fermer
          </button>
        </footer>
      </section>
    </div>
  );
}
