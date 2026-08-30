/**
 * Pure string transforms for the mobile formatting toolbar.
 *
 * Selection-based edits keep the authored Markdown as the source of truth and
 * are fully unit-testable (no editor framework dependency).
 */

export type InlineSyntax = 'bold' | 'italic' | 'code';

const INLINE_WRAPPERS: Record<InlineSyntax, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  code: ['`', '`'],
};

/**
 * Toggles inline formatting (bold/italic/code) around `[start, end)` of the
 * content. With no selection (`start === end`) it inserts a template with the
 * caret placed inside. Returns the new text and the adjusted selection.
 */
export function toggleInline(
  text: string,
  start: number,
  end: number,
  syntax: InlineSyntax,
): { text: string; start: number; end: number } {
  const [open, close] = INLINE_WRAPPERS[syntax];
  const inside = text.slice(start, end);

  if (
    inside.length >= open.length + close.length &&
    inside.startsWith(open) &&
    inside.endsWith(close)
  ) {
    const unwrapped = inside.slice(open.length, inside.length - close.length);
    const next = text.slice(0, start) + unwrapped + text.slice(end);
    return { text: next, start, end: start + unwrapped.length };
  }

  const next = text.slice(0, start) + open + inside + close + text.slice(end);
  return {
    text: next,
    start: start + open.length,
    end: start + open.length + inside.length,
  };
}

/**
 * Toggles a `## ` heading prefix on the line containing the caret.
 */
export function toggleHeading(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineBreak = text.indexOf('\n', end);
  const lineEnd = lineBreak === -1 ? text.length : lineBreak;
  const line = text.slice(lineStart, lineEnd);

  const hasHeading = line.startsWith('## ');
  const nextLine = hasHeading ? line.slice(3) : '## ' + line;
  const delta = hasHeading ? -3 : 3;
  const next = text.slice(0, lineStart) + nextLine + text.slice(lineEnd);

  return {
    text: next,
    start: Math.max(0, start + delta),
    end: Math.max(0, end + delta),
  };
}

/**
 * Inserts a link snippet `[label](https://)` with the caret in the URL.
 */
export function insertLink(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  const label = text.slice(start, end).trim() || 'link';
  const snippet = `[${label}](https://)`;
  const next = text.slice(0, start) + snippet + text.slice(end);
  const caret = start + snippet.length - 1;
  return { text: next, start: caret, end: caret };
}
