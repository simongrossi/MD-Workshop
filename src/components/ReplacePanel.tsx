import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ReplaceFilePreview, ReplaceResult } from '../types';

type Props = {
  open: boolean;
  rootFolder: string | null;
  onClose: () => void;
  onDone: (result: ReplaceResult) => void;
  onOpenFile: (path: string) => void;
};

export function ReplacePanel({ open, rootFolder, onClose, onDone, onOpenFile }: Props) {
  const [search, setSearch] = useState('');
  const [replace, setReplace] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [previews, setPreviews] = useState<ReplaceFilePreview[]>([]);
  const [excludedFiles, setExcludedFiles] = useState<Set<string>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  if (!open) return null;

  const includedPreviews = previews.filter((p) => !excludedFiles.has(p.path));
  const totalMatches = previews.reduce((sum, p) => sum + p.lines.length, 0);
  const includedMatches = includedPreviews.reduce((sum, p) => sum + p.lines.length, 0);

  async function handlePreview() {
    if (!rootFolder || !search.trim()) return;

    setLoading(true);
    setHasSearched(true);
    setExcludedFiles(new Set());
    setCollapsedFiles(new Set());

    try {
      const results = await invoke<ReplaceFilePreview[]>('preview_replace', {
        rootPath: rootFolder,
        search,
        replace,
        isRegex,
        caseSensitive
      });
      setPreviews(results);
    } catch (error) {
      setPreviews([]);
      // Could show an error status
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!rootFolder || includedPreviews.length === 0) return;

    setApplying(true);
    try {
      const result = await invoke<ReplaceResult>('apply_replace', {
        rootPath: rootFolder,
        search,
        replace,
        isRegex,
        caseSensitive,
        filePaths: includedPreviews.map((p) => p.path)
      });

      onDone(result);
      setPreviews([]);
      setSearch('');
      setReplace('');
      setHasSearched(false);
    } catch {
      // error
    } finally {
      setApplying(false);
    }
  }

  function toggleFileExcluded(path: string) {
    setExcludedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleFileCollapsed(path: string) {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="replace-backdrop" onClick={onClose}>
      <div className="replace-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="replace-header">
          <h2>Rechercher et remplacer</h2>
          <button className="replace-close" onClick={onClose}>
            Esc
          </button>
        </div>

        <div className="replace-inputs">
          <div className="replace-field">
            <label>Rechercher</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handlePreview();
              }}
              placeholder="Texte ou expression"
              className="text-input"
              autoFocus
            />
          </div>
          <div className="replace-field">
            <label>Remplacer par</label>
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handlePreview();
              }}
              placeholder="Texte de remplacement"
              className="text-input"
            />
          </div>
          <div className="replace-options">
            <label className="replace-toggle">
              <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
              <span>Respecter la casse</span>
            </label>
            <label className="replace-toggle">
              <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} />
              <span>Expression régulière</span>
            </label>
          </div>
          <div className="replace-actions-bar">
            <button className="toolbar-button accent" onClick={() => void handlePreview()} disabled={!search.trim() || loading}>
              {loading ? 'Recherche…' : 'Prévisualiser'}
            </button>
            {includedPreviews.length > 0 && (
              <button className="toolbar-button replace-apply" onClick={() => void handleApply()} disabled={applying}>
                {applying
                  ? 'Remplacement…'
                  : `Remplacer tout (${includedMatches} dans ${includedPreviews.length} fichier${includedPreviews.length > 1 ? 's' : ''})`}
              </button>
            )}
          </div>
        </div>

        <div className="replace-preview-area">
          {!hasSearched ? (
            <p className="replace-empty">Saisis un terme et clique sur Prévisualiser pour voir les changements.</p>
          ) : previews.length === 0 && !loading ? (
            <p className="replace-empty">Aucune correspondance trouvée.</p>
          ) : loading ? (
            <p className="replace-empty">Recherche en cours…</p>
          ) : (
            <>
              <div className="replace-summary">
                {totalMatches} correspondance{totalMatches > 1 ? 's' : ''} dans {previews.length} fichier
                {previews.length > 1 ? 's' : ''}
              </div>
              <div className="replace-file-list">
                {previews.map((file) => {
                  const excluded = excludedFiles.has(file.path);
                  const collapsed = collapsedFiles.has(file.path);

                  return (
                    <div key={file.path} className={`replace-file${excluded ? ' excluded' : ''}`}>
                      <div className="replace-file-header">
                        <label className="replace-file-check">
                          <input type="checkbox" checked={!excluded} onChange={() => toggleFileExcluded(file.path)} />
                        </label>
                        <button className="replace-file-toggle" onClick={() => toggleFileCollapsed(file.path)}>
                          <span className={`replace-chevron${collapsed ? '' : ' open'}`}>&#9654;</span>
                        </button>
                        <button className="replace-file-name" onClick={() => onOpenFile(file.path)}>
                          {file.relative_path}
                        </button>
                        <span className="replace-file-count">{file.lines.length}</span>
                      </div>

                      {!collapsed && (
                        <div className="replace-diff-lines">
                          {file.lines.map((line) => (
                            <div key={`${file.path}-${line.line_number}`} className="replace-diff-pair">
                              <span className="replace-line-number">L{line.line_number}</span>
                              <div className="replace-diff-content">
                                <div className="replace-diff-before">{line.before}</div>
                                <div className="replace-diff-after">{line.after}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
