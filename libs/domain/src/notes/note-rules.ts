import type { IsoTimestamp } from '../shared/timestamps.js';
import type { Note, NoteContentChanges } from './note.js';

// Note-preview generation lives in `@bigmind/markdown` (single source shared
// by web and mobile); these re-exports keep the domain API stable.
export { EMPTY_NOTE_PREVIEW, createNotePreview } from '@bigmind/markdown';

export const UNTITLED_NOTE_TITLE = 'Untitled note';

export function normalizeNoteTitle(title: string): string {
  return title.trim() || UNTITLED_NOTE_TITLE;
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
