import { useEffect, useMemo, useState } from 'react';
import { renderSlideHtml, splitSlides } from '../lib/slides';

type Props = {
  open: boolean;
  content: string;
  title: string;
  onClose: () => void;
};

export function SlidePresenter({ open, content, title, onClose }: Props) {
  const slides = useMemo(() => (open ? splitSlides(content) : []), [open, content]);
  const [index, setIndex] = useState(0);
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          setIndex((i) => Math.min(i + 1, slides.length - 1));
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          setIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          setIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setIndex(Math.max(0, slides.length - 1));
          break;
        case 'Escape':
          e.preventDefault();
          if (focusMode) {
            setFocusMode(false);
          } else {
            onClose();
          }
          break;
        case 'f':
        case 'F':
          if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            setFocusMode((v) => !v);
          }
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, slides.length, onClose, focusMode]);

  if (!open) return null;

  const total = slides.length;
  const safeIndex = Math.min(index, total - 1);
  const slideHtml = renderSlideHtml(slides[safeIndex] ?? '');
  const atFirst = safeIndex === 0;
  const atLast = safeIndex === total - 1;

  return (
    <div
      className={`slide-presenter${focusMode ? ' slide-focus' : ''}`}
      role="dialog"
      aria-label="Mode présentation"
      onClick={(e) => {
        // Click anywhere outside controls = next slide
        if (e.target === e.currentTarget && !atLast) {
          setIndex((i) => i + 1);
        }
      }}
    >
      <header className="slide-topbar">
        <span className="slide-title">{title}</span>
        <span className="slide-counter">
          {total > 0 ? `${safeIndex + 1} / ${total}` : '—'}
        </span>
        <button
          className="slide-close"
          onClick={onClose}
          title="Quitter (Esc)"
          aria-label="Quitter"
        >
          ✕
        </button>
      </header>

      <article className="slide-stage">
        <div
          className="slide-content markdown-preview"
          // eslint-disable-next-line react/no-danger -- DOMPurify-sanitized in renderSlideHtml
          dangerouslySetInnerHTML={{ __html: slideHtml }}
        />
      </article>

      <footer className="slide-footer">
        <button
          className="slide-nav"
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          disabled={atFirst}
          title="Slide précédente (←)"
          aria-label="Précédente"
        >
          ◀
        </button>
        <span className="slide-hint">
          ← / → · Espace · F (focus) · Esc (quitter)
        </span>
        <button
          className="slide-nav"
          onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
          disabled={atLast}
          title="Slide suivante (→)"
          aria-label="Suivante"
        >
          ▶
        </button>
      </footer>
    </div>
  );
}
