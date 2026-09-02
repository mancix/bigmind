/**
 * Renderer abstraction.
 *
 * `parseMarkdown` produces a platform-independent AST; this module defines
 * the contracts renderers implement so future outputs — React Web, React
 * Native, HTML export, PDF export — can be added without touching the parser.
 *
 * A renderer is intentionally tiny: inline tokens (leaf formatting) and
 * block rendering compose into a document renderer. Every renderer works from
 * the SAME AST, so web, native, and export surfaces cannot diverge.
 */

import type { MarkdownBlock } from './parse.js';
import type { InlineToken } from './inline.js';
import { parseMarkdown } from './parse.js';

/** Escapes text for safe HTML output (attribute and text use). */
export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Renders inline formatting tokens (bold/italic/code/link/wiki). */
export interface InlineRenderer {
  renderInline(tokens: readonly InlineToken[]): string;
}

/** Renders block-level Markdown (headings, paragraphs, lists, code, …). */
export interface MarkdownRenderer extends InlineRenderer {
  /** Renders an already-parsed document. */
  renderBlocks(blocks: readonly MarkdownBlock[]): string;
  /** Parses and renders a Markdown string in one step. */
  render(markdown: string): string;
}

/**
 * HTML rendering options.
 */
export interface HtmlRenderOptions {
  /**
   * When `true`, wiki links render as anchors with `data-note-title`
   * (`<a href="#" class="wiki-link" data-note-title="…">`). When `false`,
   * wiki links render as plain `[[…]]` text (e.g. inside a PDF export that
   * should not create anchors). Defaults to `true`.
   */
  renderWikiLinksAsAnchors?: boolean;
}

const WIKI_ANCHOR_CLASS = 'wiki-link';
const EXTERNAL_LINK_CLASS = 'external-link';

/**
 * Creates an HTML renderer over the shared AST.
 *
 * This is the forward-looking renderer used by web rendering and (future)
 * HTML/PDF export. The legacy `renderMarkdown` in `render-markdown.ts` is a
 * byte-for-byte port of the original web renderer and is kept only for
 * backward-compatibility parity (see `canonical.spec.ts`); new rendering
 * work should use this renderer.
 */
export function createHtmlRenderer(
  options: HtmlRenderOptions = {},
): MarkdownRenderer {
  const anchors = options.renderWikiLinksAsAnchors ?? true;

  function renderInline(tokens: readonly InlineToken[]): string {
    return tokens.map(renderToken).join('');
  }

  function renderToken(token: InlineToken): string {
    switch (token.type) {
      case 'text':
        return escapeHtmlText(token.value);
      case 'bold':
        return `<strong>${renderInline(token.content)}</strong>`;
      case 'italic':
        return `<em>${renderInline(token.content)}</em>`;
      case 'code':
        return `<code>${escapeHtmlText(token.value)}</code>`;
      case 'link':
        return `<a href="${escapeHtmlText(token.url)}" class="${EXTERNAL_LINK_CLASS}">${renderInline(token.content)}</a>`;
      case 'wiki': {
        const title = escapeHtmlText(token.title);
        const label = token.label ? escapeHtmlText(token.label) : title;
        if (!anchors) {
          return label === title ? `[[${label}]]` : `[[${label}|${title}]]`;
        }
        return `<a href="#" class="${WIKI_ANCHOR_CLASS}" data-note-title="${title}">${label}</a>`;
      }
      default:
        throw new Error(`Unknown inline token type: ${JSON.stringify(token)}`);
    }
  }

  function renderBlocks(blocks: readonly MarkdownBlock[]): string {
    return blocks.map(renderBlock).join('\n');
  }

  function renderBlock(block: MarkdownBlock): string {
    switch (block.type) {
      case 'heading':
        return `<h${block.level}>${renderInline(block.content)}</h${block.level}>`;
      case 'paragraph':
        return `<p>${renderInline(block.content)}</p>`;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const items = block.items
          .map((item) => {
            const checkbox =
              item.checked === null
                ? ''
                : `<span class="task-list-checkbox" aria-hidden="true">${
                    item.checked ? '☑' : '☐'
                  }</span>`;
            const state =
              item.checked === null ? '' : ` data-checked="${item.checked}"`;
            return `<li class="${item.checked === null ? '' : 'task-list-item'}"${state}>${checkbox}${renderInline(item.content)}</li>`;
          })
          .join('\n');
        return `<${tag} class="${itemHasCheckbox(block.items) ? 'task-list' : ''}">\n${items}\n</${tag}>`;
      }
      case 'code': {
        const language = block.language
          ? ` class="language-${escapeHtmlText(block.language)}"`
          : '';
        return `<pre><code${language}>${escapeHtmlText(block.content)}</code></pre>`;
      }
      case 'blockquote':
        return `<blockquote><p>${renderInline(block.content)}</p></blockquote>`;
      case 'table': {
        const head = `<thead><tr>${block.header
          .map((cell) => `<th>${escapeHtmlText(cell)}</th>`)
          .join('')}</tr></thead>`;
        const body =
          block.rows.length > 0
            ? `<tbody>${block.rows
                .map(
                  (row) =>
                    `<tr>${row
                      .map((cell) => `<td>${escapeHtmlText(cell)}</td>`)
                      .join('')}</tr>`,
                )
                .join('')}</tbody>`
            : '';
        return `<table>\n${head}\n${body}\n</table>`;
      }
      case 'hr':
        return '<hr />';
    }
  }

  return {
    renderInline,
    renderBlocks,
    render: (markdown: string) => renderBlocks(parseMarkdown(markdown)),
  };
}

function itemHasCheckbox(
  items: readonly { checked: boolean | null }[],
): boolean {
  return items.some((item) => item.checked !== null);
}

/** Convenience: parse + render a Markdown string to HTML. */
export function renderMarkdownHtml(
  markdown: string,
  options?: HtmlRenderOptions,
): string {
  return createHtmlRenderer(options).render(markdown);
}
