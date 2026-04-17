import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { GraphMode, MarkdownFileEntry, TagCount } from '../types';

type Props = {
  rootFolder: string | null;
  files: MarkdownFileEntry[];
  mode: GraphMode;
  depth: number;
  filterFolder: string;
  filterTags: string[];
  showOrphans: boolean;
  onModeChange: (mode: GraphMode) => void;
  onDepthChange: (depth: number) => void;
  onFilterFolderChange: (folder: string) => void;
  onFilterTagsChange: (tags: string[]) => void;
  onShowOrphansChange: (show: boolean) => void;
};

export function GraphControls({
  rootFolder,
  files,
  mode,
  depth,
  filterFolder,
  filterTags,
  showOrphans,
  onModeChange,
  onDepthChange,
  onFilterFolderChange,
  onFilterTagsChange,
  onShowOrphansChange
}: Props) {
  const [availableTags, setAvailableTags] = useState<TagCount[]>([]);

  useEffect(() => {
    if (!rootFolder) {
      setAvailableTags([]);
      return;
    }
    invoke<TagCount[]>('get_all_tags', { rootPath: rootFolder })
      .then(setAvailableTags)
      .catch(() => setAvailableTags([]));
  }, [rootFolder]);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) {
      const rel = f.relative_path.replace(/\\/g, '/');
      const parts = rel.split('/');
      parts.pop(); // remove filename
      let acc = '';
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        set.add(acc);
      }
    }
    return Array.from(set).sort();
  }, [files]);

  function toggleTag(tag: string) {
    if (filterTags.includes(tag)) {
      onFilterTagsChange(filterTags.filter((t) => t !== tag));
    } else {
      onFilterTagsChange([...filterTags, tag]);
    }
  }

  return (
    <div className="graph-controls">
      <div className="graph-controls-row">
        <div className="segmented-control graph-mode-toggle">
          <button
            className={mode === 'local' ? 'active' : ''}
            onClick={() => onModeChange('local')}
            title="Graphe local (fichier actif)"
          >
            Local
          </button>
          <button
            className={mode === 'global' ? 'active' : ''}
            onClick={() => onModeChange('global')}
            title="Graphe global (workspace entier)"
          >
            Global
          </button>
        </div>

        {mode === 'local' && (
          <label className="graph-depth">
            <span>Profondeur</span>
            <input
              type="range"
              min={1}
              max={3}
              step={1}
              value={depth}
              onChange={(e) => onDepthChange(Number(e.target.value))}
            />
            <span className="graph-depth-value">{depth}</span>
          </label>
        )}

        {mode === 'global' && (
          <>
            <label className="graph-folder">
              <span>Dossier</span>
              <input
                type="text"
                list="graph-folder-list"
                placeholder="Tous"
                value={filterFolder}
                onChange={(e) => onFilterFolderChange(e.target.value)}
              />
              <datalist id="graph-folder-list">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>

            <label className="graph-orphans">
              <input
                type="checkbox"
                checked={showOrphans}
                onChange={(e) => onShowOrphansChange(e.target.checked)}
              />
              <span>Orphelins</span>
            </label>
          </>
        )}
      </div>

      {mode === 'global' && availableTags.length > 0 && (
        <div className="graph-controls-row graph-tags-row">
          <span className="graph-tags-label">Tags :</span>
          <div className="graph-tag-chips">
            {availableTags.slice(0, 20).map((t) => {
              const selected = filterTags.includes(t.tag);
              return (
                <button
                  key={t.tag}
                  className={`graph-tag-chip${selected ? ' selected' : ''}`}
                  onClick={() => toggleTag(t.tag)}
                  title={`${t.count} fichier${t.count > 1 ? 's' : ''}`}
                >
                  #{t.tag}
                </button>
              );
            })}
          </div>
          {filterTags.length > 0 && (
            <button className="graph-tags-clear" onClick={() => onFilterTagsChange([])}>
              Effacer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
