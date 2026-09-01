import type { NoteRecord } from '@bigmind/storage';

import {
  buildNoteList,
  NOTE_PAGE_SIZE,
  noteIsArchived,
  paginateNotes,
  searchNotes,
  sortNotes,
} from './note-list';

function makeNote(
  id: string,
  title: string,
  content: string,
  updatedAt: string,
): NoteRecord {
  return {
    id,
    title,
    content,
    categoryId: null,
    templateType: 'MARKDOWN',
    createdAt: updatedAt,
    updatedAt,
    version: 0,
    syncStatus: 'synced',
  };
}

const A = makeNote('a', 'Research', 'alpha content', '2026-01-03T00:00:00.000Z');
const B = makeNote('b', 'Journal', 'beta content', '2026-01-05T00:00:00.000Z');
const C = makeNote('c', 'Ideas', 'gamma content', '2026-01-01T00:00:00.000Z');

describe('note-list helpers', () => {
  it('searches titles and content case-insensitively', () => {
    expect(searchNotes([A, B, C], 'journal')).toEqual([B]);
    expect(searchNotes([A, B, C], 'gamma')).toEqual([C]);
    expect(searchNotes([A, B, C], 'RESEARCH')).toEqual([A]);
    expect(searchNotes([A, B, C], '  ideas  ')).toEqual([C]);
  });

  it('returns the full list for an empty query', () => {
    expect(searchNotes([A, B, C], '   ')).toEqual([A, B, C]);
  });

  it('sorts by recency (updated) and alphabetically', () => {
    expect(sortNotes([A, B, C], 'updated').map((n) => n.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(sortNotes([A, B, C], 'alpha').map((n) => n.id)).toEqual([
      'c', // Ideas
      'b', // Journal
      'a', // Research
    ]);
  });

  it('paginates with a slice of the first N records', () => {
    expect(paginateNotes([A, B, C], 2)).toEqual([A, B]);
    expect(paginateNotes([A, B, C], 99)).toEqual([A, B, C]);
  });

  it('builds the visible list: filter → sort → paginate', () => {
    const result = buildNoteList([A, B, C], {
      query: 'a',
      sortMode: 'alpha',
      limit: 1,
    });
    expect(result).toEqual([C]);
  });

  it('keeps repository recency order on the fast path (no search)', () => {
    expect(
      buildNoteList([A, B, C], { query: '', sortMode: 'updated', limit: 100 }),
    ).toEqual([A, B, C]);
  });

  it('respects the configured page size', () => {
    expect(NOTE_PAGE_SIZE).toBe(50);
  });

  it('reports archived notes only when archivedAt is set (archive prep)', () => {
    expect(noteIsArchived(A)).toBe(false);
    expect(noteIsArchived({ ...A, archivedAt: '2026-02-01T00:00:00.000Z' })).toBe(
      true,
    );
  });
});