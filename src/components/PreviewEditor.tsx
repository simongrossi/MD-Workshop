import { useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { splitFrontMatter } from '../lib/markdown';
import { resolveRelativeLink, resolveWikiLink } from '../lib/wikilinks';
import { splitDocument, joinDocument } from '../lib/tiptap/frontMatter';
import { buildPreviewExtensions } from '../lib/tiptap/extensions';
import { setImageResolverContext } from '../lib/tiptap/imageNode';
import type { MarkdownFileEntry } from '../types';

type Props = {
  content: string;
  files: MarkdownFileEntry[];
  activeFilePath: string;
  rootFolder: string | null;
  onNavigate: (absolutePath: string) => void;
  onCreateFile?: (name: string) => void;
  onChange: (nextContent: string) => void;
};

// Debounce helper scoped to the component lifecycle.
function useDebouncedCallback<Args extends unknown[]>(fn: (...args: Args) => void, delay: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return (...args: Args) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      fnRef.current(...args);
    }, delay);
  };
}

export function PreviewEditor({
  content,
  files,
  activeFilePath,
  rootFolder,
  onNavigate,
  onCreateFile,
  onChange,
}: Props) {
  // Front matter shown in a side block, not fed into TipTap.
  const { frontMatter, frontMatterError, rawFrontMatter } = splitFrontMatter(content);
  const frontMatterEntries = Object.entries(frontMatter ?? {});

  const bodyRef = useRef<string>(splitDocument(content).body);
  const lastEmittedRef = useRef<string>(content);
  const suppressEmitRef = useRef<boolean>(false);

  // Keep the image resolver's context current so the TauriImage node
  // can resolve relative paths at render time.
  useEffect(() => {
    setImageResolverContext({ activeFilePath, rootFolder });
    return () => {
      setImageResolverContext(null);
    };
  }, [activeFilePath, rootFolder]);

  const extensions = useMemo(() => buildPreviewExtensions(), []);

  const debouncedEmit = useDebouncedCallback((nextMarkdown: string) => {
    lastEmittedRef.current = nextMarkdown;
    onChange(nextMarkdown);
  }, 300);

  const editor = useEditor({
    extensions,
    content: bodyRef.current,
    autofocus: false,
    editorProps: {
      attributes: {
        class: 'markdown-preview ProseMirror-preview',
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (suppressEmitRef.current) return;
      const storage = (ed.storage as { markdown?: { getMarkdown?: () => string } }).markdown;
      if (!storage?.getMarkdown) return;
      const body = storage.getMarkdown();
      bodyRef.current = body;
      const split = splitDocument(content);
      const full = split.hadFrontMatter ? joinDocument(split.raw, body) : body;
      debouncedEmit(full);
    },
  });

  // When `content` changes from outside (CodeMirror typed, file switch, …), re-sync
  // the editor document — but only if the incoming content diverges from what we
  // last emitted (otherwise we'd loop).
  useEffect(() => {
    if (!editor) return;
    if (content === lastEmittedRef.current) return;

    const split = splitDocument(content);
    if (split.body === bodyRef.current) {
      // Only front matter changed — no need to reset body.
      return;
    }
    bodyRef.current = split.body;
    suppressEmitRef.current = true;
    try {
      editor.commands.setContent(split.body, { emitUpdate: false });
    } finally {
      suppressEmitRef.current = false;
    }
  }, [content, editor]);

  // Mark unresolved wiki-links with a CSS class by scanning the rendered DOM.
  useEffect(() => {
    if (!editor) return;
    const update = () => annotateUnresolvedWikiLinks(editor, files);
    update();
    editor.on('update', update);
    editor.on('selectionUpdate', update);
    return () => {
      editor.off('update', update);
      editor.off('selectionUpdate', update);
    };
  }, [editor, files]);

  function handleClick(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor) return;

    const wikiTarget = anchor.getAttribute('data-wiki');
    if (wikiTarget) {
      event.preventDefault();
      const resolved = resolveWikiLink(wikiTarget, files);
      if (resolved) {
        onNavigate(resolved.path);
      } else if (onCreateFile) {
        if (window.confirm(`"${wikiTarget}" n'existe pas. Créer le fichier ?`)) {
          onCreateFile(wikiTarget);
        }
      }
      return;
    }

    const href = anchor.getAttribute('href');
    if (href) {
      const resolved = resolveRelativeLink(href, activeFilePath, files);
      if (resolved) {
        event.preventDefault();
        onNavigate(resolved.path);
      }
    }
  }

  return (
    <section className="preview-pane preview-pane-editable" onClick={handleClick}>
      {frontMatterError && (
        <div className="front-matter-error">
          <h3>Front matter invalide</h3>
          <p>{frontMatterError}</p>
          {rawFrontMatter && <pre>{rawFrontMatter}</pre>}
        </div>
      )}
      {frontMatterEntries.length > 0 && (
        <div className="front-matter-block">
          <h3>Front matter</h3>
          <dl>
            {frontMatterEntries.map(([key, value]) => (
              <div key={key} className="front-matter-row">
                <dt>{key}</dt>
                <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <EditorContent editor={editor} />
    </section>
  );
}

function annotateUnresolvedWikiLinks(editor: Editor, files: MarkdownFileEntry[]) {
  const dom = editor.view.dom as HTMLElement;
  const anchors = dom.querySelectorAll<HTMLAnchorElement>('a.wiki-link');
  anchors.forEach((anchor) => {
    const target = anchor.getAttribute('data-wiki') ?? '';
    const resolved = resolveWikiLink(target, files);
    if (resolved) {
      anchor.classList.remove('unresolved');
    } else {
      anchor.classList.add('unresolved');
    }
  });
}
