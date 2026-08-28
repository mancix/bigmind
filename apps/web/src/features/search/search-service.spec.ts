import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, type NoteRecord } from '../../storage/database';
import { SearchService } from './search-service';

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

let service: SearchService;

beforeEach(async () => {
  service = new SearchService();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  service.destroy();
  await db.delete();
});

describe('SearchService', () => {
  it('loads existing notes on initialization', async () => {
    await db.notes.add(createNote('1', { title: 'Alpha', content: 'First note' }));
    await db.notes.add(createNote('2', { title: 'Beta', content: 'Second note' }));

    await service.initialize();

    const results = service.search('alpha');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('excludes deleted notes on initialization', async () => {
    await db.notes.add(createNote('1', { title: 'Active', content: 'Here' }));
    await db.notes.add(createNote('2', { title: 'Deleted', content: 'Gone', deletedAt: '2026-01-02T00:00:00.000Z' }));

    await service.initialize();

    expect(service.search('active')).toHaveLength(1);
    expect(service.search('deleted')).toHaveLength(0);
  });

  it('indexes a newly created note via Dexie hook', async () => {
    await service.initialize();

    await db.notes.add(createNote('1', { title: 'Fresh note', content: 'Brand new content' }));

    const results = service.search('fresh');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('updates index when a note title changes via Dexie', async () => {
    await db.notes.add(createNote('1', { title: 'Apple', content: 'A fruit' }));

    await service.initialize();

    expect(service.search('apple')).toHaveLength(1);
    expect(service.search('banana')).toHaveLength(0);

    await db.notes.update('1', { title: 'Banana' });

    expect(service.search('banana')).toHaveLength(1);
    expect(service.search('apple')).toHaveLength(0);
  });

  it('updates index when a note content changes via Dexie', async () => {
    await db.notes.add(createNote('1', { title: 'Article', content: 'xylophone zebra' }));

    await service.initialize();

    expect(service.search('xylophone')).toHaveLength(1);
    expect(service.search('quantum')).toHaveLength(0);

    await db.notes.update('1', { content: 'quantum physics' });

    expect(service.search('quantum')).toHaveLength(1);
    expect(service.search('xylophone')).toHaveLength(0);
  });

  it('removes note from index when soft-deleted via Dexie', async () => {
    await db.notes.add(createNote('1', { title: 'To delete', content: 'Will be gone' }));

    await service.initialize();

    expect(service.search('delete')).toHaveLength(1);

    await db.notes.update('1', { deletedAt: '2026-01-02T00:00:00.000Z' });

    expect(service.search('delete')).toHaveLength(0);
  });

  it('removes note from index when hard-deleted via Dexie', async () => {
    await db.notes.add(createNote('1', { title: 'To delete', content: 'Will be gone' }));

    await service.initialize();

    expect(service.search('delete')).toHaveLength(1);

    await db.notes.delete('1');

    expect(service.search('delete')).toHaveLength(0);
  });

  it('re-indexes a restored note (deletedAt removed)', async () => {
    await db.notes.add(createNote('1', { title: 'Restored', content: 'Back again', deletedAt: '2026-01-02T00:00:00.000Z' }));

    await service.initialize();

    expect(service.search('restored')).toHaveLength(0);

    await db.notes.update('1', { deletedAt: undefined });

    expect(service.search('restored')).toHaveLength(1);
  });

  it('replaces note data in index after a full put', async () => {
    await db.notes.add(createNote('1', { title: 'Original', content: 'Original text' }));

    await service.initialize();

    expect(service.search('original')).toHaveLength(1);

    await db.notes.put(createNote('1', { title: 'Replaced', content: 'Replaced text' }));

    expect(service.search('replaced')).toHaveLength(1);
    expect(service.search('original')).toHaveLength(0);
  });

  it('returns empty results for empty query', async () => {
    await db.notes.add(createNote('1', { title: 'Test', content: 'Hello' }));

    await service.initialize();

    expect(service.search('')).toEqual([]);
  });

  it('handles initialization with no notes', async () => {
    await service.initialize();

    expect(service.search('anything')).toEqual([]);
  });
});
