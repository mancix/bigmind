/**
 * Block-level Markdown parser.
 *
 * Produces a small, typed structure that every platform can render (React
 * Native preview, tests, future web parity). The source of truth is always
 * the raw markdown text; this parser is display/serialization-only.
 */
import { parseInline, type InlineToken } from './inline.js';

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: InlineToken[] }
  | { type: 'paragraph'; content: InlineToken[] }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }
  | { type: 'code'; language: string | null; content: string }
  | { type: 'blockquote'; content: InlineToken[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'hr' };

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const HR_PATTERN = /^(\s*[-*_]){3,}\s*$/;
const UNORDERED_ITEM = /^\s*[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const FENCE = /^```\s*([\w+-]*)\s*$/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split('\n');
  let index = 0;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const content = parseInline(paragraph.join('\n'));
    blocks.push({ type: 'paragraph', content });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index];

    if (FENCE.test(line)) {
      flushParagraph();
      const match = FENCE.exec(line);
      const language = match?.[1] || null;
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence (or end of input)
      blocks.push({ type: 'code', language, content: code.join('\n') });
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading && paragraph.length === 0) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        content: parseInline(heading[2]),
      });
      index += 1;
      continue;
    }

    if (HR_PATTERN.test(line) && paragraph.length === 0) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    // Table: current line and the next line both look like table rows.
    if (
      paragraph.length === 0 &&
      line.includes('|') &&
      index + 1 < lines.length
    ) {
      const separator = lines[index + 1];
      if (TABLE_SEPARATOR.test(separator) && separator.includes('|')) {
        flushParagraph();
        const header = splitTableRow(line);
        index += 2;
        const rows: string[][] = [];
        while (
          index < lines.length &&
          lines[index].trim() !== '' &&
          lines[index].includes('|')
        ) {
          rows.push(splitTableRow(lines[index]));
          index += 1;
        }
        blocks.push({ type: 'table', header, rows });
        continue;
      }
    }

    const unordered = UNORDERED_ITEM.exec(line);
    const ordered = ORDERED_ITEM.exec(line);
    if (
      (unordered || ordered) &&
      (paragraph.length === 0 || paragraph.length === 1)
    ) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      const items: InlineToken[][] = [];
      while (index < lines.length) {
        const itemMatch = orderedList
          ? ORDERED_ITEM.exec(lines[index])
          : UNORDERED_ITEM.exec(lines[index]);
        if (!itemMatch) break;
        items.push(parseInline(itemMatch[1]));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: orderedList, items });
      continue;
    }

    const quote = BLOCKQUOTE.exec(line);
    if (quote && paragraph.length === 0) {
      flushParagraph();
      const content: string[] = [];
      while (index < lines.length) {
        const quoteMatch = BLOCKQUOTE.exec(lines[index]);
        if (!quoteMatch) break;
        content.push(quoteMatch[1]);
        index += 1;
      }
      blocks.push({
        type: 'blockquote',
        content: parseInline(content.join('\n')),
      });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks;
}
