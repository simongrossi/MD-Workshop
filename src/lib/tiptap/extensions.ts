import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from './wikiLink';
import { TauriImage } from './imageNode';

export function buildPreviewExtensions() {
  return [
    StarterKit.configure({
      // We keep all default nodes editable. Code blocks use the built-in TipTap
      // codeBlock (no syntax highlighting, acceptable for phase 1).
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
        },
      },
    }),
    TauriImage.configure({
      inline: false,
      allowBase64: false,
    }),
    WikiLink,
    Markdown.configure({
      html: true,
      tightLists: true,
      linkify: false,
      breaks: true,
      transformPastedText: true,
      transformCopiedText: true,
      bulletListMarker: '-',
    }),
  ];
}
