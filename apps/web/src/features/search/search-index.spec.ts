import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, type NoteRecord } from '../../storage/database';
import { NoteSearchIndex } from './search-index';

function createNote(id: string, overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id,
    title: 'Untitled note',
    content: '',
    categoryId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    syncStatus: 'synced',
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('NoteSearchIndex', () => {
  it('is not ready before initialization', () => {
    const index = new NoteSearchIndex();
    expect(index.isReady).toBe(false);
  });

  it('initializes from Dexie with non-deleted notes', async () => {
    await db.notes.add(createNote('1', { title: 'Hello world', content: 'Some content' }));
    await db.notes.add(createNote('2', { title: 'Goodbye world', content: 'More content' }));
    await db.notes.add(createNote('3', { title: 'Deleted note', content: 'Should not appear', deletedAt: '2026-01-02T00:00:00.000Z' }));

    const index = new NoteSearchIndex();
    await index.initialize();

    expect(index.isReady).toBe(true);

    const results = index.search('hello');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('returns empty results when nothing matches', async () => {
    const index = new NoteSearchIndex();
    await index.initialize();

    const results = index.search('nonexistent');
    expect(results).toEqual([]);
  });

  it('searches case-insensitively', async () => {
    await db.notes.add(createNote('1', { title: 'JavaScript Guide', content: 'Learn JS' }));

    const index = new NoteSearchIndex();
    await index.initialize();

    const upper = index.search('JAVASCRIPT');
    const lower = index.search('javascript');
    const mixed = index.search('JavaScript');

    expect(upper).toHaveLength(1);
    expect(lower).toHaveLength(1);
    expect(mixed).toHaveLength(1);
    expect(upper[0].id).toBe('1');
    expect(lower[0].id).toBe('1');
    expect(mixed[0].id).toBe('1');
  });

  it('supports partial word prefix matching', async () => {
    await db.notes.add(createNote('1', { title: 'Motorcycle maintenance', content: 'Tips for bikes' }));

    const index = new NoteSearchIndex();
    await index.initialize();

    const partial = index.search('motor');
    expect(partial).toHaveLength(1);
    expect(partial[0].id).toBe('1');
  });

  it('ranks title matches higher than content matches', async () => {
    await db.notes.add(createNote('1', { title: 'Cooking recipes', content: 'Some text about cars' }));
    await db.notes.add(createNote('2', { title: 'Car repair', content: 'Cooking is fun but cars are complex' }));

    const index = new NoteSearchIndex();
    await index.initialize();

    const results = index.search('cooking');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('1');
    expect(results[1].id).toBe('2');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('excludes deleted notes', async () => {
    await db.notes.add(createNote('1', { title: 'Active note', content: 'Searchable' }));
    await db.notes.add(createNote('2', { title: 'Deleted note', content: 'Hidden', deletedAt: '2026-01-02T00:00:00.000Z' }));

    const index = new NoteSearchIndex();
    await index.initialize();

    const results = index.search('note');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('indexes a note added after initialization', async () => {
    const index = new NoteSearchIndex();
    await index.initialize();

    await db.notes.add(createNote('1', { title: 'New note', content: 'Fresh content' }));
    await index.addNote(createNote('1', { title: 'New note', content: 'Fresh content' }));

    const results = index.search('fresh');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('removes a note from the index', async () => {
    await db.notes.add(createNote('1', { title: 'Temporary', content: 'Gone soon' }));
    const index = new NoteSearchIndex();
    await index.initialize();

    expect(index.search('temporary')).toHaveLength(1);

    index.removeNote('1');
    expect(index.search('temporary')).toHaveLength(0);
  });

  it('removes note from index when addNote receives a deleted note', async () => {
    await db.notes.add(createNote('1', { title: 'Will be deleted', content: 'Some text' }));
    const index = new NoteSearchIndex();
    await index.initialize();

    expect(index.search('deleted')).toHaveLength(1);

    await index.addNote(createNote('1', { title: 'Will be deleted', content: 'Some text', deletedAt: '2026-01-02T00:00:00.000Z' }));
    expect(index.search('deleted')).toHaveLength(0);
  });

  it('updates a note in the index', async () => {
    await db.notes.add(createNote('1', { title: 'Alpha concept', content: 'First version' }));
    const index = new NoteSearchIndex();
    await index.initialize();

    expect(index.search('alpha')).toHaveLength(1);
    expect(index.search('beta')).toHaveLength(0);

    await index.addNote(createNote('1', { title: 'Beta concept', content: 'Second version' }));
    expect(index.search('beta')).toHaveLength(1);
    expect(index.search('alpha')).toHaveLength(0);
  });

  it('clears the index', async () => {
    await db.notes.add(createNote('1', { title: 'Something', content: 'Content' }));
    const index = new NoteSearchIndex();
    await index.initialize();

    expect(index.isReady).toBe(true);
    expect(index.search('something')).toHaveLength(1);

    index.clear();
    expect(index.isReady).toBe(false);
    expect(index.search('something')).toHaveLength(0);
  });

  it('generates a preview snippet around the matched term', async () => {
    const content = 'This is a very long paragraph about programming languages. JavaScript is widely used for web development. Python is popular for data science. Both have extensive ecosystems.';
    await db.notes.add(createNote('1', { title: 'Programming', content }));

    const index = new NoteSearchIndex();
    await index.initialize();

    const results = index.search('JavaScript');
    expect(results).toHaveLength(1);
    expect(results[0].preview).toContain('JavaScript');
    expect(results[0].preview.length).toBeLessThanOrEqual(content.length + 2);
  });

  it('returns empty for blank query', async () => {
    await db.notes.add(createNote('1', { title: 'Test', content: 'Hello' }));
    const index = new NoteSearchIndex();
    await index.initialize();

    expect(index.search('')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
  });

  it('handles empty database', async () => {
    const index = new NoteSearchIndex();
    await index.initialize();

    expect(index.isReady).toBe(true);
    expect(index.search('anything')).toEqual([]);
  });
});
