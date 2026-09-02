/**
 * Plain-text note preview — canonical implementation shared by web and
 * mobile. Ported from `@bigmind/domain/notes` so every client generates the
 * same preview, and built on the shared {@link extractPlainText} so previews
 * and search indexing never diverge.
 */

import { extractPlainText } from './text.js';

/** Fallback shown when a note has no readable content. */
export const EMPTY_NOTE_PREVIEW = 'Empty note';

/**
 * Builds a human-readable preview of a Markdown document.
 *
 * Strips Markdown/HTML formatting while preserving the text a reader would
 * see, then truncates to `maxLength` characters (always appending `…` when
 * truncated; the ellipsis is part of the returned string).
 *
 * @param markdown raw note content
 * @param maxLength maximum preview length; `undefined` returns the full
 * plain text; `0` returns `''`; `1` returns `'…'`
 */
export function createMarkdownPreview(
  markdown: string,
  maxLength?: number,
): string {
  const plainText = extractPlainText(markdown);
  const preview = plainText || EMPTY_NOTE_PREVIEW;

  if (maxLength === undefined || preview.length <= maxLength) {
    return preview;
  }

  if (maxLength <= 0) {
    return '';
  }

  if (maxLength === 1) {
    return '…';
  }

  return `${preview.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * @deprecated Use {@link createMarkdownPreview} — kept as an alias so
 * existing callers (web list, mobile list, domain re-export) keep working.
 */
export const createNotePreview = createMarkdownPreview;

export { EMPTY_NOTE_PREVIEW as EMPTY_PREVIEW };
