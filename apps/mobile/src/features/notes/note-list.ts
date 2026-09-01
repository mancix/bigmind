import type { NoteRecord } from '@bigmind/storage';

/**
 * Pure, platform-independent note-list helpers: in-memory search, sorting, and
 * pagination for the Notes list. Everything is a plain function so the ordering
 * and filtering semantics are unit-testable and identical on web and mobile.
 *
 * The shared `NoteRepository` stays the single source of truth for persistence
 * (list/findById/create/update/delete); these helpers only shape the already
 * loaded records for fast, offline-safe rendering.
 */

export type NoteSortMode = 'updated' | 'alpha';

/** Sort-mode registry — future modes (created, title-desc, category…) slot in here. */
export const NOTE_SORT_MODES: readonly NoteSortMode[] = ['updated', 'alpha'];

export const NOTE_SORT_LABELS: Record<NoteSortMode, string> = {
  updated: 'Updated',
  alpha: 'A–Z',
};

/** Default page size for the pagination-ready FlatList. */
export const NOTE_PAGE_SIZE = 50;

export function noteIsArchived(note: NoteRecord): boolean {
  // Archive preparation: nothing writes this yet; when the future archive /
  // trash feature ships, archived notes are filtered out here without touching
  // the repository or the screen.
  return typeof note.archivedAt === 'string' && note.archivedAt.length > 0;
}

/** Case-insensitive title + content search (mirrors the repository search). */
export function searchNotes(notes: NoteRecord[], query: string): NoteRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return notes;
  }
  return notes.filter(
    (note) =>
      note.title.toLocaleLowerCase().includes(needle) ||
      note.content.toLocaleLowerCase().includes(needle),
  );
}

/** Stable sorting by mode. `updated` = recency (desc); `alpha` = title A–Z. */
export function sortNotes(notes: NoteRecord[], mode: NoteSortMode): NoteRecord[] {
  const sorted = [...notes];
  switch (mode) {
    case 'alpha': {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    }
    case 'updated':
    default: {
      sorted.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      break;
    }
  }
  return sorted;
}

/**
 * Pagination-ready slicing used by the FlatList's `onEndReached`.
 * Returns the first `limit` records; the screen grows `limit` by
 * `NOTE_PAGE_SIZE` as the user scrolls, so rendering stays flat even with
 * thousands of notes.
 */
export function paginateNotes(
  notes: NoteRecord[],
  limit: number,
): NoteRecord[] {
  return notes.slice(0, limit);
}

/** Build the visible list: filter → sort → paginate, in one pass. */
export function buildNoteList(
  notes: NoteRecord[],
  options: { query: string; sortMode: NoteSortMode; limit: number },
): NoteRecord[] {
  if (options.query.trim() || options.sortMode !== 'updated') {
    // Search/sort reorder everything; keep the whole dataset in memory so
    // filtering stays instant while typing (offline-safe).
    return paginateNotes(
      sortNotes(searchNotes(notes, options.query), options.sortMode),
      options.limit,
    );
  }
  // Fast path: the repository already returns recency-sorted notes.
  return paginateNotes(notes, options.limit);
}