import { splitFrontMatter } from './markdown';

/**
 * Print-friendly stylesheet bundled with the printable HTML. Matches the
 * preview look but neutralizes UI chrome and adds @page rules + sensible
 * page-break behavior. The browser's "Save as PDF" target consumes this.
 */
const PRINT_CSS = `
@page {
  size: A4;
  margin: 18mm 16mm;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #1b2630;
  font-family: "Segoe UI", -apple-system, "Helvetica Neue", Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.55;
}

main {
  padding: 0;
  max-width: 100%;
}

h1, h2, h3, h4, h5, h6 {
  color: #0f1620;
  page-break-after: avoid;
  break-after: avoid-page;
}

h1 {
  font-size: 22pt;
  margin: 0 0 0.4em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid #ddd6c9;
}

h1:not(:first-child) {
  page-break-before: always;
  break-before: page;
}

h2 {
  font-size: 16pt;
  margin-top: 1.4em;
  border-bottom: 1px solid #ddd6c9;
  padding-bottom: 0.15em;
}

h3 { font-size: 13pt; margin-top: 1.2em; }

p { margin: 0.6em 0; orphans: 3; widows: 3; }

ul, ol { margin: 0.4em 0 0.8em 1.4em; }

li { margin: 0.15em 0; page-break-inside: avoid; break-inside: avoid; }

a {
  color: #0d6f63;
  text-decoration: none;
}

code {
  background: #f1ede4;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.9em;
}

pre {
  background: #faf7f1;
  border: 1px solid #ddd6c9;
  border-radius: 6px;
  padding: 10px 12px;
  overflow: visible;
  white-space: pre-wrap;
  word-wrap: break-word;
  page-break-inside: avoid;
  break-inside: avoid;
  font-size: 9.5pt;
}

pre code { background: transparent; padding: 0; }

blockquote {
  margin: 0.8em 0;
  padding: 0.4em 0.9em;
  border-left: 3px solid #0d9a87;
  background: #faf7f1;
  color: #4a525c;
  page-break-inside: avoid;
  break-inside: avoid;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
  page-break-inside: avoid;
  break-inside: avoid;
}

th, td {
  border: 1px solid #ddd6c9;
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}

th { background: #f1ede4; }

img {
  max-width: 100%;
  height: auto;
  page-break-inside: avoid;
  break-inside: avoid;
}

.wiki-link {
  color: #0d6f63;
  border-bottom: 1px dotted #0d6f63;
}

hr {
  border: 0;
  border-top: 1px solid #ddd6c9;
  margin: 1.5em 0;
}

input[type="checkbox"] { margin-right: 6px; }

.page-meta {
  color: #6f7680;
  font-size: 0.9em;
  margin: 0 0 1em;
}
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a self-contained printable HTML document. Wiki-links are flattened
 * to plain `<a>` (no JS-driven navigation possible in print) but they keep
 * their visual styling.
 */
function buildPrintableHtml(title: string, contentHtml: string): string {
  // The wiki-link extension emits `<a class="wiki-link" data-wiki="X">label</a>`.
  // For PDF output we keep the visual styling but drop the data attribute and
  // make the href a no-op (anchor). Cross-page navigation is handled by the
  // static-site export, not the PDF.
  const flattened = contentHtml.replace(
    /<a\s+class="wiki-link"\s+data-wiki="[^"]*">/g,
    '<a class="wiki-link">'
  );

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${flattened}
</main>
</body>
</html>`;
}

/**
 * Trigger the browser's native print dialog with a printable rendering of
 * `content`. The user picks "Save as PDF" (or any printer) from the OS dialog.
 *
 * Implementation: build a self-contained HTML document, drop it into a hidden
 * iframe in the host document, call `print()` on the iframe's contentWindow,
 * then clean up after a short delay. Cross-platform, no Rust changes needed.
 */
export async function exportToPdf(name: string, content: string): Promise<void> {
  const { html } = splitFrontMatter(content);
  const baseName = name.replace(/\.(md|markdown|mdx)$/i, '');
  const printableHtml = buildPrintableHtml(baseName, html);

  // Create the hidden iframe — `position: fixed` so it doesn't reflow the app,
  // dimensions large enough that any deferred image layout can settle.
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoad = () => {
        iframe.removeEventListener('load', onLoad);
        try {
          const win = iframe.contentWindow;
          if (!win) {
            reject(new Error('iframe sans contentWindow'));
            return;
          }
          // Give the renderer one tick so images/web fonts settle, then print.
          setTimeout(() => {
            try {
              win.focus();
              win.print();
              resolve();
            } catch (err) {
              reject(err);
            }
          }, 50);
        } catch (err) {
          reject(err);
        }
      };

      iframe.addEventListener('load', onLoad);
      // `srcdoc` is the most reliable way to load a self-contained document
      // into an iframe across Chromium/WebView2 (Tauri's runtime).
      iframe.srcdoc = printableHtml;
    });
  } finally {
    // Clean up after the print dialog has had time to read the iframe content.
    // We do not await the dialog itself — the OS handles it asynchronously.
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1000);
  }
}
