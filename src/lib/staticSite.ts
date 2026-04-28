import { invoke } from '@tauri-apps/api/core';
import { splitFrontMatter } from './markdown';
import { resolveWikiLink } from './wikilinks';
import type { BacklinkEntry, MarkdownFileEntry } from '../types';
import { siteStylesheet } from './staticSiteStyles';

export type SiteTheme = 'auto' | 'light' | 'dark';

export type SiteExportOptions = {
  outputDir: string;
  baseUrl: string;
  theme: SiteTheme;
  includeBacklinks: boolean;
  copyAssets: boolean;
};

export type SiteFile = {
  relative_path: string;
  content: string;
};

export type SiteStats = {
  pages_written: number;
  assets_copied: number;
  duration_ms: number;
  output_dir: string;
};

export type ExportProgress = {
  current: number;
  total: number;
  label: string;
};

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}

function stripExt(name: string): string {
  return name.replace(/\.(md|markdown|mdx)$/i, '');
}

function toForwardSlash(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Convert a workspace `.md` relative path to its output `.html` relative path,
 * preserving the directory structure. Example:
 *   "notes/foo.md" → "notes/foo.html"
 */
function htmlPathFor(relativePath: string): string {
  const fwd = toForwardSlash(relativePath);
  return fwd.replace(/\.(md|markdown|mdx)$/i, '.html');
}

function depthOf(relPath: string): number {
  const fwd = toForwardSlash(relPath);
  return Math.max(0, fwd.split('/').length - 1);
}

/**
 * Compute the relative href from `fromHtmlPath` to `toHtmlPath`,
 * both expressed as workspace-relative `.html` paths using forward slashes.
 */
function relativeHref(fromHtmlPath: string, toHtmlPath: string): string {
  const up = '../'.repeat(depthOf(fromHtmlPath));
  return up + toHtmlPath;
}

function slugifyTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Replace each `<a class="wiki-link" data-wiki="X">` in `html` with a real
 * link pointing to the resolved `.html` page (or a broken-link span if
 * unresolved).
 */
function rewriteWikiLinks(
  html: string,
  files: MarkdownFileEntry[],
  currentHtmlPath: string
): string {
  // Order-agnostic match: any <a> with class="wiki-link" + data-wiki="…"
  return html.replace(
    /<a\b([^>]*?)>([\s\S]*?)<\/a>/g,
    (match, attrs: string, label: string) => {
      if (!/\bclass=("|')[^"']*\bwiki-link\b[^"']*\1/.test(attrs)) return match;
      const m = attrs.match(/\bdata-wiki=("|')([\s\S]*?)\1/);
      if (!m) return match;
      const decoded = m[2]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      const file = resolveWikiLink(decoded, files);
      if (!file) {
        return `<span class="wiki-link wiki-link-unresolved" title="Lien non résolu">${label}</span>`;
      }
      const href = relativeHref(currentHtmlPath, htmlPathFor(file.relative_path));
      return `<a class="wiki-link" href="${escapeAttr(href)}">${label}</a>`;
    }
  );
}

/**
 * Rewrite plain markdown links like `<a href="./other.md">…</a>` to point at
 * the corresponding `.html`. We only touch hrefs that look local and end
 * in a markdown extension; external/anchor/asset links pass through.
 */
function rewriteRelativeMdLinks(
  html: string,
  files: MarkdownFileEntry[],
  currentRelativePath: string
): string {
  const fileSet = new Set(
    files.map((f) => toForwardSlash(f.relative_path).toLowerCase())
  );
  const currentDir = toForwardSlash(currentRelativePath).replace(/\/[^/]*$/, '');

  return html.replace(/<a\s+href="([^"]+)"/g, (match, href: string) => {
    if (
      !href ||
      /^[a-z]+:\/\//i.test(href) ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('/')
    ) {
      return match;
    }
    if (!/\.(md|markdown|mdx)(#.*)?$/i.test(href)) {
      return match;
    }

    const [pathPart, anchor = ''] = href.split('#');
    const joined = currentDir ? `${currentDir}/${pathPart}` : pathPart;
    const resolved = normalizeFwd(joined).toLowerCase();

    if (!fileSet.has(resolved)) {
      return match;
    }

    const currentHtmlPath = htmlPathFor(currentRelativePath);
    const targetHtmlPath = htmlPathFor(resolved);
    const newHref =
      relativeHref(currentHtmlPath, targetHtmlPath) +
      (anchor ? `#${anchor}` : '');
    return `<a href="${escapeAttr(newHref)}"`;
  });
}

function normalizeFwd(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function getTitle(frontMatter: Record<string, unknown>, fallbackName: string): string {
  const fmTitle = frontMatter['title'];
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim();
  return stripExt(fallbackName);
}

function getTags(frontMatter: Record<string, unknown>, content: string): string[] {
  const seen = new Set<string>();

  const fmTags = frontMatter['tags'];
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) {
      if (typeof t === 'string' && t.trim()) seen.add(t.trim());
    }
  } else if (typeof fmTags === 'string') {
    for (const t of fmTags.split(/[,\s]+/)) {
      if (t.trim()) seen.add(t.trim());
    }
  }

  // Inline #tags in body — ignore those inside code blocks (best effort).
  const stripped = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '');
  const inlineRe = /(?:^|\s)#([a-zA-Z0-9_\-/]+)/g;
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(stripped)) !== null) {
    seen.add(m[1]);
  }

  return [...seen].sort();
}

type RenderedPage = {
  relativePath: string;
  htmlRelative: string;
  title: string;
  tags: string[];
  contentHtml: string;
  modifiedUnix: number | null;
  excerpt: string;
};

function renderSidebar(pages: RenderedPage[], currentHtmlPath: string): string {
  // Group by top-level folder for a clean nested list.
  type Node = { name: string; href: string | null; children: Map<string, Node> };
  const root: Node = { name: '', href: null, children: new Map() };

  for (const p of pages) {
    const segments = toForwardSlash(p.relativePath).split('/');
    let cursor = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLeaf = i === segments.length - 1;
      const key = isLeaf ? `__file:${seg}` : seg;
      if (!cursor.children.has(key)) {
        cursor.children.set(key, {
          name: isLeaf ? p.title : seg,
          href: isLeaf ? relativeHref(currentHtmlPath, p.htmlRelative) : null,
          children: new Map()
        });
      }
      cursor = cursor.children.get(key)!;
    }
  }

  function renderNode(node: Node): string {
    const entries = [...node.children.values()].sort((a, b) => {
      const aLeaf = a.href !== null;
      const bLeaf = b.href !== null;
      if (aLeaf !== bLeaf) return aLeaf ? 1 : -1; // folders first
      return a.name.localeCompare(b.name);
    });

    return (
      '<ul>' +
      entries
        .map((child) => {
          if (child.href) {
            return `<li><a href="${escapeAttr(child.href)}">${escapeHtml(child.name)}</a></li>`;
          }
          return `<li class="nav-folder"><span class="nav-folder-name">${escapeHtml(child.name)}</span>${renderNode(child)}</li>`;
        })
        .join('') +
      '</ul>'
    );
  }

  return renderNode(root);
}

function renderBacklinks(
  backlinks: BacklinkEntry[],
  currentHtmlPath: string
): string {
  if (backlinks.length === 0) return '';
  return (
    '<aside class="backlinks"><h2>Mentions liées</h2><ul>' +
    backlinks
      .map((bl) => {
        const href = relativeHref(currentHtmlPath, htmlPathFor(bl.relative_path));
        return `<li><a href="${escapeAttr(href)}"><strong>${escapeHtml(bl.name)}</strong></a><div class="backlink-context">${escapeHtml(bl.context_line)}</div></li>`;
      })
      .join('') +
    '</ul></aside>'
  );
}

function renderTagsRow(tags: string[], currentHtmlPath: string): string {
  if (tags.length === 0) return '';
  return (
    '<div class="page-tags">' +
    tags
      .map((tag) => {
        const href = relativeHref(currentHtmlPath, `tags/${slugifyTag(tag)}.html`);
        return `<a class="page-tag" href="${escapeAttr(href)}">#${escapeHtml(tag)}</a>`;
      })
      .join(' ') +
    '</div>'
  );
}

function pageTemplate(args: {
  title: string;
  siteTitle: string;
  themeAttr: string;
  cssHref: string;
  canonicalUrl: string | null;
  body: string;
}): string {
  const canonical = args.canonicalUrl
    ? `<link rel="canonical" href="${escapeAttr(args.canonicalUrl)}">`
    : '';
  const themeAttr = args.themeAttr ? ` data-theme="${args.themeAttr}"` : '';
  return `<!DOCTYPE html>
<html lang="fr"${themeAttr}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(args.title)} — ${escapeHtml(args.siteTitle)}</title>
<link rel="stylesheet" href="${escapeAttr(args.cssHref)}">
${canonical}
</head>
<body>
${args.body}
</body>
</html>`;
}

function pageBody(args: {
  siteTitle: string;
  homeHref: string;
  searchHref: string;
  sidebar: string;
  title: string;
  tagsHtml: string;
  contentHtml: string;
  backlinksHtml: string;
  modifiedLabel: string | null;
}): string {
  const meta = args.modifiedLabel
    ? `<div class="page-meta">Mis à jour le ${escapeHtml(args.modifiedLabel)}</div>`
    : '';
  return `<div class="layout">
<aside class="sidebar">
<a class="site-title" href="${escapeAttr(args.homeHref)}">${escapeHtml(args.siteTitle)}</a>
<nav class="sidebar-nav">${args.sidebar}</nav>
</aside>
<main class="content">
<article class="markdown-preview">
<h1 class="page-title">${escapeHtml(args.title)}</h1>
${meta}
${args.tagsHtml}
${args.contentHtml}
</article>
${args.backlinksHtml}
</main>
</div>`;
}

function joinBaseUrl(baseUrl: string, htmlRelative: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  const base = trimmed.replace(/\/+$/, '');
  return `${base}/${htmlRelative}`;
}

function formatDate(unix: number | null): string | null {
  if (!unix) return null;
  try {
    const d = new Date(unix * 1000);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return null;
  }
}

function buildSitemap(pages: RenderedPage[], baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  const base = trimmed.replace(/\/+$/, '');
  const urls = pages
    .map((p) => {
      const loc = `${base}/${p.htmlRelative}`;
      const lastmod = p.modifiedUnix
        ? `<lastmod>${new Date(p.modifiedUnix * 1000).toISOString()}</lastmod>`
        : '';
      return `  <url><loc>${escapeHtml(loc)}</loc>${lastmod}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function buildIndexBody(
  siteTitle: string,
  pages: RenderedPage[],
  sidebar: string
): string {
  const recent = [...pages]
    .filter((p) => p.modifiedUnix !== null)
    .sort((a, b) => (b.modifiedUnix ?? 0) - (a.modifiedUnix ?? 0))
    .slice(0, 12);

  const recentList = recent.length
    ? `<h2>Récemment modifiés</h2><ul class="recent-list">${recent
        .map((p) => {
          const date = formatDate(p.modifiedUnix);
          return `<li><a href="${escapeAttr(p.htmlRelative)}">${escapeHtml(p.title)}</a>${date ? `<span class="recent-date">${escapeHtml(date)}</span>` : ''}</li>`;
        })
        .join('')}</ul>`
    : '';

  const allList = `<h2>Toutes les notes (${pages.length})</h2><ul class="all-list">${pages
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p) => `<li><a href="${escapeAttr(p.htmlRelative)}">${escapeHtml(p.title)}</a></li>`)
    .join('')}</ul>`;

  return `<div class="layout">
<aside class="sidebar">
<a class="site-title" href="index.html">${escapeHtml(siteTitle)}</a>
<nav class="sidebar-nav">${sidebar}</nav>
</aside>
<main class="content">
<article class="markdown-preview">
<h1 class="page-title">${escapeHtml(siteTitle)}</h1>
<p class="page-meta">${pages.length} note(s) publiée(s)</p>
${recentList}
${allList}
</article>
</main>
</div>`;
}

function buildTagPageBody(
  tag: string,
  taggedPages: RenderedPage[],
  sidebar: string,
  siteTitle: string
): string {
  const list = taggedPages
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(
      (p) =>
        `<li><a href="${escapeAttr(`../${p.htmlRelative}`)}">${escapeHtml(p.title)}</a>${p.excerpt ? `<div class="tag-excerpt">${escapeHtml(p.excerpt)}</div>` : ''}</li>`
    )
    .join('');

  return `<div class="layout">
<aside class="sidebar">
<a class="site-title" href="../index.html">${escapeHtml(siteTitle)}</a>
<nav class="sidebar-nav">${sidebar}</nav>
</aside>
<main class="content">
<article class="markdown-preview">
<h1 class="page-title">#${escapeHtml(tag)}</h1>
<p class="page-meta">${taggedPages.length} note(s)</p>
<ul class="tag-list">${list}</ul>
</article>
</main>
</div>`;
}

export async function exportStaticSite(
  rootPath: string,
  files: MarkdownFileEntry[],
  options: SiteExportOptions,
  onProgress?: (p: ExportProgress) => void
): Promise<SiteStats> {
  const siteTitle = (() => {
    const parts = toForwardSlash(rootPath).split('/').filter(Boolean);
    return parts[parts.length - 1] || 'MD Workshop';
  })();

  const themeAttr =
    options.theme === 'light' ? '' : options.theme === 'dark' ? 'dark' : '';

  // Pre-render all pages so we can build sidebar + tag pages in a second pass.
  const rendered: RenderedPage[] = [];
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.({ current: i + 1, total, label: file.relative_path });

    const content = await invoke<string>('read_markdown_file', {
      rootPath,
      path: file.path
    });
    const { html, frontMatter, excerpt } = splitFrontMatter(content);

    const htmlRel = htmlPathFor(file.relative_path);
    let body = rewriteWikiLinks(html, files, htmlRel);
    body = rewriteRelativeMdLinks(body, files, file.relative_path);

    rendered.push({
      relativePath: file.relative_path,
      htmlRelative: htmlRel,
      title: getTitle(frontMatter, file.name),
      tags: getTags(frontMatter, content),
      contentHtml: body,
      modifiedUnix: file.modified_unix,
      excerpt: excerpt.replace(/\s+/g, ' ').slice(0, 200)
    });
  }

  // Second pass: stitch each page with sidebar + backlinks.
  const siteFiles: SiteFile[] = [];

  for (const page of rendered) {
    const sidebar = renderSidebar(rendered, page.htmlRelative);
    const cssHref = relativeHref(page.htmlRelative, '_site/style.css');
    const homeHref = relativeHref(page.htmlRelative, 'index.html');

    let backlinksHtml = '';
    if (options.includeBacklinks) {
      try {
        const filePath = files.find((f) => f.relative_path === page.relativePath)?.path;
        if (filePath) {
          const backlinks = await invoke<BacklinkEntry[]>('get_backlinks', {
            rootPath,
            filePath
          });
          backlinksHtml = renderBacklinks(backlinks, page.htmlRelative);
        }
      } catch {
        backlinksHtml = '';
      }
    }

    const body = pageBody({
      siteTitle,
      homeHref,
      searchHref: homeHref,
      sidebar,
      title: page.title,
      tagsHtml: renderTagsRow(page.tags, page.htmlRelative),
      contentHtml: page.contentHtml,
      backlinksHtml,
      modifiedLabel: formatDate(page.modifiedUnix)
    });

    const html = pageTemplate({
      title: page.title,
      siteTitle,
      themeAttr,
      cssHref,
      canonicalUrl: joinBaseUrl(options.baseUrl, page.htmlRelative),
      body
    });

    siteFiles.push({ relative_path: page.htmlRelative, content: html });
  }

  // Index page
  {
    const indexHtmlPath = 'index.html';
    const sidebar = renderSidebar(rendered, indexHtmlPath);
    const cssHref = relativeHref(indexHtmlPath, '_site/style.css');
    const body = buildIndexBody(siteTitle, rendered, sidebar);
    const html = pageTemplate({
      title: siteTitle,
      siteTitle,
      themeAttr,
      cssHref,
      canonicalUrl: joinBaseUrl(options.baseUrl, indexHtmlPath),
      body
    });
    siteFiles.push({ relative_path: indexHtmlPath, content: html });
  }

  // Tag pages
  const tagMap = new Map<string, RenderedPage[]>();
  for (const page of rendered) {
    for (const tag of page.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(page);
    }
  }
  for (const [tag, pagesForTag] of tagMap) {
    const slug = slugifyTag(tag);
    if (!slug) continue;
    const tagHtmlPath = `tags/${slug}.html`;
    // Sidebar links use ../foo.html paths, computed against this depth-1 page.
    const sidebar = renderSidebar(rendered, tagHtmlPath);
    const cssHref = relativeHref(tagHtmlPath, '_site/style.css');
    const body = buildTagPageBody(tag, pagesForTag, sidebar, siteTitle);
    const html = pageTemplate({
      title: `#${tag}`,
      siteTitle,
      themeAttr,
      cssHref,
      canonicalUrl: joinBaseUrl(options.baseUrl, tagHtmlPath),
      body
    });
    siteFiles.push({ relative_path: tagHtmlPath, content: html });
  }

  // Stylesheet
  siteFiles.push({
    relative_path: '_site/style.css',
    content: siteStylesheet()
  });

  // Sitemap
  const sitemap = buildSitemap(rendered, options.baseUrl);
  if (sitemap) {
    siteFiles.push({ relative_path: 'sitemap.xml', content: sitemap });
  }

  onProgress?.({ current: total, total, label: 'Écriture sur le disque…' });

  const stats = await invoke<SiteStats>('write_static_site', {
    rootPath,
    outputDir: options.outputDir,
    files: siteFiles,
    copyAssets: options.copyAssets
  });

  return stats;
}

export function defaultOutputDir(rootPath: string): string {
  const sep = rootPath.includes('\\') ? '\\' : '/';
  return rootPath.replace(/[\\/]+$/, '') + sep + '_site';
}
