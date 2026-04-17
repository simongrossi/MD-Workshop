import type { MouseEvent as ReactMouseEvent } from 'react';
import type { OpenedDocument } from '../types';

type Props = {
  tabs: OpenedDocument[];
  activeTabPath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
};

export function TabBar({ tabs, activeTabPath, onSelect, onClose }: Props) {
  if (tabs.length <= 1) return null;

  function handleAuxClick(event: ReactMouseEvent<HTMLButtonElement>, path: string) {
    // Middle-click closes the tab
    if (event.button === 1) {
      event.preventDefault();
      onClose(path);
    }
  }

  return (
    <nav className="tab-bar" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.path === activeTabPath;
        const isDirty = tab.content !== tab.savedContent;

        return (
          <button
            key={tab.path}
            role="tab"
            aria-selected={isActive}
            className={`tab-item${isActive ? ' active' : ''}`}
            onClick={() => onSelect(tab.path)}
            onAuxClick={(event) => handleAuxClick(event, tab.path)}
            title={tab.relativePath}
          >
            <span className="tab-label">
              {tab.name}
              {isDirty && <span className="tab-dirty" aria-label="Modifié" />}
            </span>
            <span
              className="tab-close"
              role="button"
              aria-label={`Fermer ${tab.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.path);
              }}
            >
              ×
            </span>
          </button>
        );
      })}
    </nav>
  );
}
