import { useEffect, useMemo, useRef, useState } from 'react';

export type PaletteCommand = {
  id: string;
  label: string;
  shortcut?: string;
  /** Optional category shown as a subtle prefix */
  category?: string;
  action: () => void;
};

type Props = {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
};

function scoreCommand(cmd: PaletteCommand, query: string): number {
  const q = query.toLowerCase();
  const label = cmd.label.toLowerCase();
  const cat = cmd.category?.toLowerCase() ?? '';
  const full = `${cat} ${label}`;

  if (!q) return 0;
  if (label === q) return 1;
  if (label.startsWith(q)) return 2;
  if (full.startsWith(q)) return 3;
  if (label.includes(q)) return 4;
  if (full.includes(q)) return 5;
  return 99;
}

export function CommandPalette({ open, commands, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim();
    return commands
      .map((cmd) => ({ cmd, score: scoreCommand(cmd, q) }))
      .filter(({ score }) => score < 99)
      .sort((a, b) => a.score - b.score || a.cmd.label.localeCompare(b.cmd.label))
      .slice(0, 20)
      .map(({ cmd }) => cmd);
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function runCommand(cmd: PaletteCommand) {
    onClose();
    // Defer so the palette closes visually before the action runs
    window.setTimeout(() => cmd.action(), 0);
  }

  if (!open) return null;

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <section className="command-palette-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-header">
          <p className="sidebar-kicker">Palette de commandes</p>
          <button className="quick-open-close" onClick={onClose}>
            Esc
          </button>
        </div>

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onClose();
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
              return;
            }
            if (e.key === 'Enter' && matches[activeIndex]) {
              e.preventDefault();
              runCommand(matches[activeIndex]);
            }
          }}
          className="quick-open-input"
          placeholder="Taper une commande…"
        />

        <div ref={listRef} className="command-palette-results">
          {matches.length === 0 ? (
            <p className="sidebar-empty">Aucune commande ne correspond.</p>
          ) : (
            matches.map((cmd, index) => (
              <button
                key={cmd.id}
                className={`command-palette-item${index === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(cmd)}
              >
                <span className="command-palette-label">
                  {cmd.category && <span className="command-palette-category">{cmd.category}</span>}
                  {cmd.label}
                </span>
                {cmd.shortcut && <kbd className="command-palette-shortcut">{cmd.shortcut}</kbd>}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
