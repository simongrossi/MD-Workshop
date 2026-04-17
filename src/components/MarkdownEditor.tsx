import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorView, lineNumbers as lineNumbersExt } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  buildEditorTheme,
  createMarkdownState,
  editorThemeCompartment,
  lineNumbersCompartment,
  lineWrapCompartment,
  snippetsCompartment,
  snippetsFacet,
  tabSizeCompartment,
  wikiLinkFilesCompartment,
  wikiLinkFilesFacet,
  type CursorInfo,
  type EditorSettings,
  type WikiLinkFile
} from '../lib/codemirror';
import type { Snippet } from '../lib/snippets';
import {
  EDITOR_CONTEXT_MENU_GROUPS,
  runEditorAction,
  type MarkdownEditorActionId
} from '../lib/editorActions';

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** List of workspace files for [[ autocompletion */
  wikiLinkFiles?: WikiLinkFile[];
  /** Live editor settings */
  settings?: EditorSettings;
  /** User snippets */
  snippets?: Snippet[];
  /**
   * Callback invoked when an image file is dropped into the editor.
   * The implementation is expected to persist the file and insert
   * a markdown image link. Return whether drop was handled.
   */
  onImageDrop?: (files: File[]) => Promise<string[]>;
  /** Fires whenever the cursor moves or the document changes. */
  onCursorChange?: (info: CursorInfo) => void;
};

type ContextMenuState = {
  x: number;
  y: number;
};

const IMAGE_MIME_PREFIX = 'image/';

export type MarkdownEditorHandle = {
  focus: () => void;
  runAction: (actionId: MarkdownEditorActionId) => Promise<void>;
  scrollToHeading: (text: string, index: number) => void;
  insertAtCursor: (text: string) => void;
};

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor({ value, onChange, wikiLinkFiles = [], settings, snippets = [], onImageDrop, onCursorChange }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latestOnChange = useRef(onChange);
  const latestOnCursorChange = useRef(onCursorChange);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    latestOnChange.current = onChange;
  }, [onChange]);

  useEffect(() => {
    latestOnCursorChange.current = onCursorChange;
  }, [onCursorChange]);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        viewRef.current?.focus();
      },
      async runAction(actionId) {
        if (!viewRef.current) return;
        await runEditorAction(viewRef.current, actionId);
      },
      scrollToHeading(text, index) {
        const view = viewRef.current;
        if (!view) return;

        const doc = view.state.doc.toString();
        const headingRegex = /^(#{1,6})\s+(.+)$/gm;
        let match: RegExpExecArray | null;
        let count = 0;

        while ((match = headingRegex.exec(doc)) !== null) {
          const headingText = match[2].replace(/\s*#+\s*$/, '').trim();
          if (headingText === text && count === index) {
            view.dispatch({
              effects: EditorView.scrollIntoView(match.index, { y: 'start' }),
              selection: { anchor: match.index }
            });
            view.focus();
            return;
          }
          count++;
        }
      },
      insertAtCursor(text: string) {
        const view = viewRef.current;
        if (!view) return;
        const sel = view.state.selection.main;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length }
        });
        view.focus();
      }
    }),
    []
  );

  useEffect(() => {
    if (!hostRef.current) return;

    const state = createMarkdownState(
      value,
      (next) => latestOnChange.current(next),
      wikiLinkFiles,
      settings,
      snippets,
      (info) => latestOnCursorChange.current?.(info)
    );
    const view = new EditorView({
      state,
      parent: hostRef.current
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Keep the wiki-link file list in sync without recreating the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: wikiLinkFilesCompartment.reconfigure(
        wikiLinkFilesFacet.of(wikiLinkFiles)
      )
    });
  }, [wikiLinkFiles]);

  // Keep snippets in sync
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: snippetsCompartment.reconfigure(snippetsFacet.of(snippets))
    });
  }, [snippets]);

  // React to settings changes (font, wrap, numbers, tab size)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !settings) return;

    view.dispatch({
      effects: [
        editorThemeCompartment.reconfigure(buildEditorTheme(settings.fontSize, settings.fontFamily)),
        lineWrapCompartment.reconfigure(settings.lineWrap ? EditorView.lineWrapping : []),
        lineNumbersCompartment.reconfigure(settings.lineNumbers ? lineNumbersExt() : []),
        tabSizeCompartment.reconfigure(EditorState.tabSize.of(settings.tabSize))
      ]
    });
  }, [settings]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (current === value) return;

    view.dispatch({
      changes: {
        from: 0,
        to: current.length,
        insert: value
      }
    });
  }, [value]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  async function handleAction(actionId: MarkdownEditorActionId) {
    if (!viewRef.current) return;
    await runEditorAction(viewRef.current, actionId);
    setContextMenu(null);
  }

  function hasImageFiles(dt: DataTransfer | null): boolean {
    if (!dt) return false;
    // Some browsers only expose files on drop, not on dragover
    if (dt.files && dt.files.length > 0) {
      for (let i = 0; i < dt.files.length; i++) {
        if (dt.files[i].type.startsWith(IMAGE_MIME_PREFIX)) return true;
      }
    }
    if (dt.items && dt.items.length > 0) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind === 'file' && item.type.startsWith(IMAGE_MIME_PREFIX)) return true;
      }
    }
    return false;
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    setDropActive(false);
    if (!onImageDrop) return;
    const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
      f.type.startsWith(IMAGE_MIME_PREFIX)
    );
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();

    const relativePaths = await onImageDrop(files);
    const view = viewRef.current;
    if (!view || relativePaths.length === 0) return;

    const insertion = relativePaths.map((rel) => `![](${rel})`).join('\n');
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: insertion },
      selection: { anchor: sel.from + insertion.length }
    });
    view.focus();
  }

  return (
    <div
      className={`editor-host-shell${dropActive ? ' drop-active' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault();
        viewRef.current?.focus();
        setContextMenu({
          x: event.clientX,
          y: event.clientY
        });
      }}
      onDragEnter={(event) => {
        if (onImageDrop && hasImageFiles(event.dataTransfer)) {
          event.preventDefault();
          setDropActive(true);
        }
      }}
      onDragOver={(event) => {
        if (onImageDrop && hasImageFiles(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(event) => {
        // Only turn off the overlay when leaving the host completely
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropActive(false);
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      <div ref={hostRef} className="editor-host" />
      {dropActive && (
        <div className="editor-drop-overlay" aria-hidden="true">
          <div className="editor-drop-hint">Déposer pour insérer l'image…</div>
        </div>
      )}

      {contextMenu && (
        <div
          className="editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.preventDefault()}
        >
          {EDITOR_CONTEXT_MENU_GROUPS.map((group, index) => (
            <div key={index} className="editor-context-group">
              {group.map((item) => (
                <button key={item.id} className="editor-context-item" onClick={() => void handleAction(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
