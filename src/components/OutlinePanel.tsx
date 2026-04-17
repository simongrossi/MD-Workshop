import { useMemo } from 'react';

type HeadingEntry = {
  level: number;
  text: string;
  index: number;
};

type Props = {
  content: string | null;
  onScrollToHeading: (text: string, index: number) => void;
};

function parseHeadings(content: string): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  let inCodeBlock = false;
  let headingIndex = 0;

  // Strip front matter
  let body = content;
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (fmMatch) body = content.slice(fmMatch[0].length);

  for (const line of body.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].replace(/\s*#+\s*$/, '').trim(), // strip trailing #
        index: headingIndex
      });
      headingIndex++;
    }
  }

  return headings;
}

export function OutlinePanel({ content, onScrollToHeading }: Props) {
  const headings = useMemo(() => (content ? parseHeadings(content) : []), [content]);

  if (!content) {
    return (
      <section className="outline-panel">
        <div className="sidebar-section-header">
          <h3>Outline</h3>
        </div>
        <p className="sidebar-empty">Ouvre un fichier pour voir son plan.</p>
      </section>
    );
  }

  if (headings.length === 0) {
    return (
      <section className="outline-panel">
        <div className="sidebar-section-header">
          <h3>Outline</h3>
        </div>
        <p className="sidebar-empty">Aucun heading dans ce document.</p>
      </section>
    );
  }

  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <section className="outline-panel">
      <div className="sidebar-section-header">
        <h3>Outline</h3>
      </div>
      <nav className="outline-list">
        {headings.map((h, i) => (
          <button
            key={`${h.text}-${i}`}
            className={`outline-item outline-level-${h.level}`}
            style={{ paddingLeft: `${(h.level - minLevel) * 12 + 10}px` }}
            onClick={() => onScrollToHeading(h.text, h.index)}
          >
            {h.text}
          </button>
        ))}
      </nav>
    </section>
  );
}
