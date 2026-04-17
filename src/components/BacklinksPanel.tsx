import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { BacklinkEntry, TagCount } from '../types';

type Props = {
  rootFolder: string | null;
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
};

export function BacklinksPanel({ rootFolder, activeFilePath, onOpenFile }: Props) {
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [activeSection, setActiveSection] = useState<'backlinks' | 'tags'>('backlinks');

  useEffect(() => {
    if (!rootFolder || !activeFilePath) {
      setBacklinks([]);
      return;
    }

    invoke<BacklinkEntry[]>('get_backlinks', { rootPath: rootFolder, filePath: activeFilePath })
      .then(setBacklinks)
      .catch(() => setBacklinks([]));
  }, [rootFolder, activeFilePath]);

  useEffect(() => {
    if (!rootFolder) {
      setTags([]);
      return;
    }

    invoke<TagCount[]>('get_all_tags', { rootPath: rootFolder })
      .then(setTags)
      .catch(() => setTags([]));
  }, [rootFolder]);

  return (
    <section className="backlinks-panel">
      <div className="backlinks-tabs">
        <button
          className={activeSection === 'backlinks' ? 'active' : ''}
          onClick={() => setActiveSection('backlinks')}
        >
          Backlinks{backlinks.length > 0 && ` (${backlinks.length})`}
        </button>
        <button
          className={activeSection === 'tags' ? 'active' : ''}
          onClick={() => setActiveSection('tags')}
        >
          Tags{tags.length > 0 && ` (${tags.length})`}
        </button>
      </div>

      {activeSection === 'backlinks' && (
        <div className="backlinks-list">
          {!activeFilePath ? (
            <p className="sidebar-empty">Ouvre un fichier pour voir ses backlinks.</p>
          ) : backlinks.length === 0 ? (
            <p className="sidebar-empty">Aucun fichier ne pointe vers ce document.</p>
          ) : (
            backlinks.map((bl) => (
              <button
                key={bl.path}
                className="backlink-item"
                onClick={() => onOpenFile(bl.path)}
                title={bl.relative_path}
              >
                <span className="backlink-name">{bl.name}</span>
                {bl.context_line && (
                  <small className="backlink-context">{bl.context_line}</small>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {activeSection === 'tags' && (
        <div className="tags-list">
          {tags.length === 0 ? (
            <p className="sidebar-empty">Aucun tag trouvé dans le workspace.</p>
          ) : (
            tags.map((t) => (
              <button key={t.tag} className="tag-item" onClick={() => void handleTagClick(t.tag)}>
                <span className="tag-name">#{t.tag}</span>
                <span className="tag-count">{t.count}</span>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );

  async function handleTagClick(tag: string) {
    if (!rootFolder) return;

    try {
      const results = await invoke<{ path: string }[]>('get_files_by_tag', {
        rootPath: rootFolder,
        tag
      });
      if (results.length === 1) {
        onOpenFile(results[0].path);
      }
      // TODO: with multiple results, could open a picker — for now just open the first
      if (results.length > 1) {
        onOpenFile(results[0].path);
      }
    } catch {
      // silently ignore
    }
  }
}
