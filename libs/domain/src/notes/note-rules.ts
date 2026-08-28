import type { IsoTimestamp } from '../shared/timestamps.js';
import type { Note, NoteContentChanges } from './note.js';

export const UNTITLED_NOTE_TITLE = 'Untitled note';
export const EMPTY_NOTE_PREVIEW = 'Empty note';

export function normalizeNoteTitle(title: string): string {
  return title.trim() || UNTITLED_NOTE_TITLE;
}

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

export function isNoteDeleted(note: Pick<Note, 'deletedAt'>): boolean {
  return note.deletedAt !== undefined;
}

export function updateNoteContent<TNote extends Note>(
  note: TNote,
  changes: NoteContentChanges,
  timestamp: IsoTimestamp,
): TNote {
  return {
    ...note,
    ...changes,
    title: normalizeNoteTitle(changes.title ?? note.title),
    updatedAt: timestamp,
  };
}
