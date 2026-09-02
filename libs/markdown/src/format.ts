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

/**
 * Inserts a wiki-link `[[label]]` around `[start, end)` (or a bare `[[]]`
 * template with the caret inside the brackets). The label — when one was
 * selected — stays selected inside the brackets so typing replaces it.
 */
export function insertWikiLinkSnippet(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  const label = text.slice(start, end).trim();
  const snippet = label ? `[[${label}]]` : '[[]]';
  const next = text.slice(0, start) + snippet + text.slice(end);
  const insideStart = start + 2;
  return {
    text: next,
    start: insideStart,
    end: insideStart + label.length,
  };
}

/** Line-range helpers shared by the block transforms. */
function lineRange(
  text: string,
  start: number,
  end: number,
): {
  lineStart: number;
  regionEnd: number;
} {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineBreak = text.indexOf('\n', end);
  return { lineStart, regionEnd: lineBreak === -1 ? text.length : lineBreak };
}

/** The 0-based line index containing `offset`, within `[lineStart, regionEnd]`. */
function lineIndexOf(text: string, lineStart: number, offset: number): number {
  let count = 0;
  for (let i = lineStart; i < offset; i += 1) {
    if (text[i] === '\n') count += 1;
  }
  return count;
}

/**
 * Applies a per-line prefix toggle over every line intersecting the
 * selection. Each line that `strip` recognizes loses its marker; every other
 * line gains `prefix`.
 *
 * Cursor/selection anchoring: offsets are shifted by the length changes of
 * every preceding line; inside a line, an offset at or past the old marker
 * sticks to the content after the marker, while an offset within the marker
 * itself clamps to the (new) content start.
 */
function toggleLinePrefix(
  text: string,
  start: number,
  end: number,
  prefix: string,
  strip: (line: string) => string | null,
): { text: string; start: number; end: number } {
  const { lineStart, regionEnd } = lineRange(text, start, end);
  const lines = text.slice(lineStart, regionEnd).split('\n');

  const out: string[] = [];
  const oldMarkerLen: number[] = [];
  const newMarkerLen: number[] = [];
  const lineDeltas: number[] = [];
  for (const line of lines) {
    const stripped = strip(line);
    if (stripped !== null) {
      const removed = line.length - stripped.length;
      out.push(stripped);
      oldMarkerLen.push(removed);
      newMarkerLen.push(0);
      lineDeltas.push(-removed);
    } else {
      out.push(prefix + line);
      oldMarkerLen.push(0);
      newMarkerLen.push(prefix.length);
      lineDeltas.push(prefix.length);
    }
  }

  const next =
    text.slice(0, lineStart) + out.join('\n') + text.slice(regionEnd);

  // deltaBefore[k] = Σ lineDeltas[0..k-1] — shift of line k's start.
  const deltaBefore: number[] = [0];
  let acc = 0;
  for (const delta of lineDeltas.slice(0, -1)) {
    acc += delta;
    deltaBefore.push(acc);
  }

  const anchor = (offset: number): number => {
    const lineBreak = text.lastIndexOf('\n', Math.max(0, offset - 1));
    const lineStartK = lineBreak + 1;
    const k = lineIndexOf(text, lineStart, offset);
    const rel = offset - lineStartK;
    const newLineStart = lineStartK + deltaBefore[k];
    if (rel < oldMarkerLen[k]) {
      return newLineStart + Math.min(rel, newMarkerLen[k]);
    }
    return newLineStart + (rel - oldMarkerLen[k]) + newMarkerLen[k];
  };

  return { text: next, start: anchor(start), end: anchor(end) };
}

/** Toggles `- ` / `* ` bullet markers on every selected line. */
export function toggleBulletList(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  return toggleLinePrefix(text, start, end, '- ', (line) => {
    if (line.startsWith('- ')) return line.slice(2);
    if (line.startsWith('* ')) return line.slice(2);
    return null;
  });
}

/** Toggles `1. ` ordered-list markers on every selected line. */
export function toggleOrderedList(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  return toggleLinePrefix(text, start, end, '1. ', (line) => {
    const match = /^\d+\.\s+(.*)$/.exec(line);
    return match ? match[1] : null;
  });
}

/** Toggles `- [ ] ` checklist markers on every selected line. */
export function toggleChecklist(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  return toggleLinePrefix(text, start, end, '- [ ] ', (line) => {
    const match = /^- \[[ xX]\]\s+(.*)$/.exec(line);
    return match ? match[1] : null;
  });
}

/** Toggles `> ` blockquote markers on every selected line. */
export function toggleQuote(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  return toggleLinePrefix(text, start, end, '> ', (line) => {
    if (line.startsWith('> ')) return line.slice(2);
    return line === '>' ? '' : null;
  });
}

/** First line of a fenced block that starts with a ``` marker. */
function isFenceLine(line: string): boolean {
  return /^```/.test(line);
}

/**
 * When the caret is inside an existing fenced code block (and nothing is
 * selected), returns that block's full-line range so toggling removes it.
 */
function enclosingFenceRange(
  text: string,
  lineStart: number,
): { lineStart: number; regionEnd: number } | null {
  let cursor = lineStart;
  let open = -1;
  while (cursor > 0) {
    const begin = text.lastIndexOf('\n', cursor - 1) + 1;
    const lineEnd = text.indexOf('\n', begin);
    const line = text.slice(begin, lineEnd === -1 ? text.length : lineEnd);
    if (isFenceLine(line)) {
      open = begin;
      break;
    }
    if (begin === 0) break;
    cursor = begin - 1;
  }
  if (open < 0) return null;

  const searchFrom = lineStart === text.length ? text.length : lineStart + 1;
  const closeAt = text.indexOf('\n```', searchFrom);
  if (closeAt < 0) return null;
  const fenceEnd = text.indexOf('\n', closeAt + 3);
  return {
    lineStart: open,
    regionEnd: fenceEnd === -1 ? text.length : fenceEnd,
  };
}

/**
 * Toggles a fenced code block around the selected lines (or the caret's
 * line). Selecting an existing block — or placing the caret inside one —
 * removes its fences; otherwise the region is wrapped in ``` ``` ```.
 */
export function toggleCodeBlock(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  let { lineStart, regionEnd } = lineRange(text, start, end);
  const region = text.slice(lineStart, regionEnd);
  const lines = region.split('\n');
  const isFenced =
    lines.length >= 2 &&
    isFenceLine(lines[0]) &&
    /^```\s*$/.test(lines[lines.length - 1]);

  // Caret inside, but not covering, an existing block → toggle that block.
  const enclosing =
    !isFenced && start === end ? enclosingFenceRange(text, lineStart) : null;
  if (enclosing) {
    lineStart = enclosing.lineStart;
    regionEnd = enclosing.regionEnd;
    const removed = text.slice(lineStart, regionEnd).split('\n');
    const content = removed.slice(1, -1).join('\n');
    const openFenceLength = removed[0].length + 1;
    const next = text.slice(0, lineStart) + content + text.slice(regionEnd);
    return {
      text: next,
      start: Math.max(lineStart, start - openFenceLength),
      end: Math.max(lineStart, end - openFenceLength),
    };
  }

  if (isFenced) {
    const content = lines.slice(1, -1).join('\n');
    const openFenceLength = lines[0].length + 1;
    const next = text.slice(0, lineStart) + content + text.slice(regionEnd);
    return {
      text: next,
      start: Math.max(lineStart, start - openFenceLength),
      end: Math.max(lineStart, end - openFenceLength),
    };
  }

  // Wrap: everything before the caret shifts by the opening fence "```\n".
  const next =
    text.slice(0, lineStart) +
    '```\n' +
    region +
    '\n```' +
    text.slice(regionEnd);
  return { text: next, start: start + 4, end: end + 4 };
}
