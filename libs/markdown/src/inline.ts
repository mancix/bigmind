/**
 * Inline Markdown tokenizer.
 *
 * Mirrors the subset of Markdown the BigMind clients use (and the web
 * `render-markdown.ts` semantics): bold, italic, inline code, links, and
 * `[[wiki-links]]`. Unmatched markers stay plain text, like the web renderer.
 */

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; content: InlineToken[] }
  | { type: 'italic'; content: InlineToken[] }
  | { type: 'code'; value: string }
  | { type: 'link'; url: string; content: InlineToken[] }
  | { type: 'wiki'; title: string; label?: string };

const WIKI_PATTERN = /^\[\[([^[\]\n]+?)(?:\|([^[\]\n]+?))?\]\]/;
const LINK_PATTERN = /^\[([^\]]+)\]\(([^)\s]+)\)/;

function nextMarkerOrEnd(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const remaining = text.slice(index);
    if (
      remaining.startsWith('`') ||
      remaining.startsWith('**') ||
      remaining.startsWith('*') ||
      WIKI_PATTERN.test(remaining) ||
      LINK_PATTERN.test(remaining)
    ) {
      break;
    }
    index += 1;
  }
  return index;
}

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let index = 0;

  while (index < text.length) {
    const remaining = text.slice(index);

    // Inline code first so `**` inside code stays literal.
    if (remaining.startsWith('`')) {
      const end = remaining.indexOf('`', 1);
      tokens.push({
        type: 'code',
        value: remaining.slice(1, end === -1 ? remaining.length : end),
      });
      index += end === -1 ? remaining.length : end + 1;
      continue;
    }

    const wiki = WIKI_PATTERN.exec(remaining);
    if (wiki) {
      tokens.push({ type: 'wiki', title: wiki[1], label: wiki[2] });
      index += wiki[0].length;
      continue;
    }

    const link = LINK_PATTERN.exec(remaining);
    if (link) {
      tokens.push({
        type: 'link',
        url: link[2],
        content: parseInline(link[1]),
      });
      index += link[0].length;
      continue;
    }

    if (remaining.startsWith('**')) {
      const end = remaining.indexOf('**', 2);
      if (end > 2) {
        tokens.push({
          type: 'bold',
          content: parseInline(remaining.slice(2, end)),
        });
        index += end + 2;
        continue;
      }
    }

    if (remaining.startsWith('*')) {
      const end = remaining.indexOf('*', 1);
      if (end > 1) {
        tokens.push({
          type: 'italic',
          content: parseInline(remaining.slice(1, end)),
        });
        index += end + 1;
        continue;
      }
    }

    // Accumulate a run of plain text up to the next marker.
    const end = nextMarkerOrEnd(text, index);
    tokens.push({ type: 'text', value: text.slice(index, end) });
    index = end;
  }

  return tokens;
}
