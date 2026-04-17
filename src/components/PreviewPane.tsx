import { useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { splitFrontMatter } from '../lib/markdown';
import { resolveRelativeLink, resolveWikiLink, WIKILINK_REGEX } from '../lib/wikilinks';
import type { MarkdownFileEntry } from '../types';

type Props = {
  content: string;
  files: MarkdownFileEntry[];
  activeFilePath: string;
  rootFolder: string | null;
  onNavigate: (absolutePath: string) => void;
  onCreateFile?: (name: string) => void;
  onToggleCheckbox?: (index: number) => void;
};

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

  if (prefix === '/') {
    return `/${segments.join('/')}`;
  }

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

export function PreviewPane({ content, files, activeFilePath, rootFolder, onNavigate, onCreateFile, onToggleCheckbox }: Props) {
  const { html: rawHtml, frontMatter, frontMatterError, rawFrontMatter } = splitFrontMatter(content);
  const frontMatterEntries = Object.entries(frontMatter ?? {});

  // Post-process HTML to mark unresolved wiki-links and resolve relative image src
  const html = useMemo(() => {
    let out = rawHtml;

    // Wiki-link resolution
    const unresolvedNames = new Set<string>();
    const wlRegex = new RegExp(WIKILINK_REGEX.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = wlRegex.exec(content)) !== null) {
      const target = m[1].trim();
      if (!resolveWikiLink(target, files)) {
        unresolvedNames.add(target.toLowerCase());
      }
    }

    if (unresolvedNames.size > 0) {
      out = out.replace(
        /<a class="wiki-link" data-wiki="([^"]*)">/g,
        (match, target: string) => {
          const isUnresolved = unresolvedNames.has(target.toLowerCase());
          return isUnresolved
            ? `<a class="wiki-link unresolved" data-wiki="${target}">`
            : match;
        }
      );
    }

    // Resolve relative <img src="..."> from the active file's directory.
    if (rootFolder) {
      out = out.replace(/<img([^>]*?)src="([^"]+)"([^>]*)>/g, (match, before, src: string, after) => {
        // Skip absolute URLs (http, data, file, asset, etc.)
        if (/^(https?:|data:|file:|asset:|blob:|\/\/)/i.test(src)) return match;
        const absolute = resolvePreviewImagePath(src, activeFilePath, rootFolder);
        if (!absolute) return match;
        try {
          const url = convertFileSrc(absolute);
          return `<img${before}src="${url}"${after}>`;
        } catch {
          return match;
        }
      });
    }

    return out;
  }, [rawHtml, content, files, activeFilePath, rootFolder]);

  function handleClick(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;

    // Interactive checkbox
    const checkbox = target.closest('input[data-checkbox-index]') as HTMLInputElement | null;
    if (checkbox && onToggleCheckbox) {
      event.preventDefault();
      const idx = Number(checkbox.dataset.checkboxIndex);
      if (Number.isFinite(idx)) onToggleCheckbox(idx);
      return;
    }

    const anchor = target.closest('a');
    if (!anchor) return;

    // Wiki-link
    const wikiTarget = anchor.getAttribute('data-wiki');
    if (wikiTarget) {
      event.preventDefault();
      const resolved = resolveWikiLink(wikiTarget, files);
      if (resolved) {
        onNavigate(resolved.path);
      } else if (onCreateFile) {
        // Unresolved link — propose to create the file
        if (window.confirm(`"${wikiTarget}" n'existe pas. Créer le fichier ?`)) {
          onCreateFile(wikiTarget);
        }
      }
      return;
    }

    // Standard markdown link to a local .md file
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
    <section className="preview-pane" onClick={handleClick}>
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
      <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
