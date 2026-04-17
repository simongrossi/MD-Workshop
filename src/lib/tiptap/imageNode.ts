import Image from '@tiptap/extension-image';
import { convertFileSrc } from '@tauri-apps/api/core';
import { defaultMarkdownSerializer } from 'prosemirror-markdown';
import type { MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node as ProseNode } from 'prosemirror-model';

// Image node whose rendered <img src="..."> resolves relative paths via Tauri's
// convertFileSrc at render time, while the underlying node attribute keeps the
// original relative path (so serialization emits clean markdown).

export type ImageResolverContext = {
  activeFilePath: string;
  rootFolder: string | null;
};

let resolverContext: ImageResolverContext | null = null;

export function setImageResolverContext(ctx: ImageResolverContext | null) {
  resolverContext = ctx;
}

function normalizeAbsolutePath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const prefixMatch = normalized.match(/^[a-zA-Z]:/);
  const prefix = prefixMatch?.[0] ?? (normalized.startsWith('/') ? '/' : '');
  if (!prefix) return null;

  const remainder = prefix === '/' ? normalized.slice(1) : normalized.slice(prefix.length);
  const segments: string[] = [];

  for (const segment of remainder.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (prefix === '/') return `/${segments.join('/')}`;
  return segments.length > 0 ? `${prefix}/${segments.join('/')}` : `${prefix}/`;
}

function resolvePreviewImagePath(src: string, activeFilePath: string, rootFolder: string): string | null {
  const [, rawPath = src, suffix = ''] = /^([^?#]*)(.*)$/.exec(src) ?? [];
  if (!rawPath) return null;
  if (/^[a-zA-Z]:[\\/]/.test(rawPath)) return null;

  const root = normalizeAbsolutePath(rootFolder);
  const activePath = normalizeAbsolutePath(activeFilePath);
  if (!root || !activePath) return null;

  const activeDir = activePath.replace(/\/[^/]*$/, '');
  const basePath = /^[\\/]/.test(rawPath) ? root : activeDir;
  const resolved = normalizeAbsolutePath(`${basePath}/${rawPath.replace(/^[\\/]+/, '')}`);
  if (!resolved) return null;

  const rootLower = root.toLowerCase();
  const resolvedLower = resolved.toLowerCase();
  const isWithinRoot = resolvedLower === rootLower || resolvedLower.startsWith(`${rootLower}/`);
  return isWithinRoot ? `${resolved}${suffix}` : null;
}

export function resolveDisplaySrc(src: string): string {
  if (!src) return src;
  if (/^(https?:|data:|file:|asset:|blob:|\/\/)/i.test(src)) return src;
  const ctx = resolverContext;
  if (!ctx || !ctx.rootFolder) return src;
  const absolute = resolvePreviewImagePath(src, ctx.activeFilePath, ctx.rootFolder);
  if (!absolute) return src;
  try {
    return convertFileSrc(absolute);
  } catch {
    return src;
  }
}

export const TauriImage = Image.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      // Stored-but-hidden canonical src (original relative path).
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-raw-src') ?? el.getAttribute('src'),
        renderHTML: (attrs) => {
          const raw = attrs.src as string | null;
          if (!raw) return {};
          return {
            src: resolveDisplaySrc(raw),
            'data-raw-src': raw,
          };
        },
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseNode) {
          // Use default image serializer, but make sure it writes the *raw* src.
          const original = defaultMarkdownSerializer.nodes.image;
          original(state, node, node, 0);
        },
        parse: {
          // Handled by markdown-it default image parser.
        },
      },
    };
  },
});
