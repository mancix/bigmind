/**
 * Plain-text note preview — canonical implementation shared by web and
 * mobile. Ported verbatim from `@bigmind/domain/notes` so every client
 * generates the same preview (kept in the markdown library as the single
 * source of the plain-text extraction).
 */
export const EMPTY_NOTE_PREVIEW = 'Empty note';

export function createNotePreview(
  markdown: string,
  maxLength?: number,
): string {
  const plainText = markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
