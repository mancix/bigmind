import { describe, expect, it, vi } from 'vitest';

import { createInMemoryStorage } from './storage-adapter.js';
import type { NoteRecord } from './records.js';

function makeNote(id: string, overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id,
    title: `Note ${id}`,
    content: 'Hello world',
    categoryId: null,
    templateType: 'MARKDOWN',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    version: 0,
    syncStatus: 'pending',
    ...overrides,
  };
}

describe('createInMemoryStorage', () => {
  it('persists and reads records per table', async () => {
    const storage = createInMemoryStorage();
    const note = makeNote('11111111-1111-4111-8111-111111111111');

    await storage.notes.add(note);
    expect(await storage.notes.get(note.id)).toEqual(note);
    expect((await storage.notes.toArray()).map((n) => n.id)).toEqual([note.id]);
    expect(await storage.notes.count()).toBe(1);
  });

  it('updates records with put and removes them with delete', async () => {
    const storage = createInMemoryStorage();
    const note = makeNote('11111111-1111-4111-8111-111111111111');

    await storage.notes.add(note);
    await storage.notes.put({ ...note, title: 'Renamed' });
    expect((await storage.notes.get(note.id))?.title).toBe('Renamed');

    await storage.notes.delete(note.id);
    expect(await storage.notes.get(note.id)).toBeUndefined();
  });

  it('supports update() with Dexie-style undefined removal', async () => {
    const storage = createInMemoryStorage();
    const note = makeNote('11111111-1111-4111-8111-111111111111', {
      title: 'With alias',
    });

    await storage.notes.add(note);
    const changed = await storage.notes.update(note.id, {
      title: undefined,
      syncStatus: 'synced',
    });

    expect(changed).toBe(1);
    const stored = await storage.notes.get(note.id);
    expect(stored?.title).toBeUndefined();
    expect(stored).not.toHaveProperty('title');
    expect(stored?.syncStatus).toBe('synced');

    expect(await storage.notes.update('missing-id', { title: 'x' })).toBe(0);
  });

  it('queries with where().equals() and .anyOf()', async () => {
    const storage = createInMemoryStorage();
    await storage.notes.bulkAdd([
      makeNote('11111111-1111-4111-8111-111111111111', { categoryId: 'cat-a' }),
      makeNote('22222222-2222-4222-8222-222222222222', { categoryId: 'cat-b' }),
      makeNote('33333333-3333-4333-8333-333333333333', { categoryId: 'cat-a' }),
    ]);

    const catA = await storage.notes
      .where('categoryId')
      .equals('cat-a')
      .toArray();
    expect(catA.map((n) => n.id).sort()).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    ]);

    const two = await storage.notes
      .where('id')
      .anyOf(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      )
      .toArray();
    expect(two).toHaveLength(2);

    expect(
      await storage.notes.where('categoryId').equals('cat-a').count(),
    ).toBe(2);
  });

  it('orders by index and supports reverse + filter chains', async () => {
    const storage = createInMemoryStorage();
    await storage.notes.bulkAdd([
      makeNote('11111111-1111-4111-8111-111111111111', {
        updatedAt: '2025-01-03T00:00:00.000Z',
      }),
      makeNote('22222222-2222-4222-8222-222222222222', {
        updatedAt: '2025-01-01T00:00:00.000Z',
      }),
      makeNote('33333333-3333-4333-8333-333333333333', {
        updatedAt: '2025-01-02T00:00:00.000Z',
      }),
    ]);

    const newestFirst = await storage.notes
      .orderBy('updatedAt')
      .reverse()
      .filter((note) => !note.deletedAt)
      .toArray();
    expect(newestFirst.map((n) => n.id)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
    ]);

    expect(
      (await storage.notes.orderBy('updatedAt').toArray()).map((n) => n.id),
    ).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('modifies and deletes matched collections', async () => {
    const storage = createInMemoryStorage();
    await storage.notes.bulkAdd([
      makeNote('11111111-1111-4111-8111-111111111111', { categoryId: 'cat-a' }),
      makeNote('22222222-2222-4222-8222-222222222222', { categoryId: 'cat-b' }),
      makeNote('33333333-3333-4333-8333-333333333333', { categoryId: 'cat-a' }),
    ]);

    const catA = storage.notes.where('categoryId').equals('cat-a');
    expect(await catA.modify({ syncStatus: 'synced' })).toBe(2);

    const synced = await storage.notes
      .where('syncStatus')
      .equals('synced')
      .toArray();
    expect(synced).toHaveLength(2);

    await catA.delete();
    expect(await storage.notes.count()).toBe(1);
  });

  it('fires creating/updating/deleting hooks like Dexie', async () => {
    const storage = createInMemoryStorage();
    const creating = vi.fn();
    const updating = vi.fn();
    const deleting = vi.fn();

    storage.notes.hook('creating').subscribe(creating);
    storage.notes.hook('updating').subscribe(updating);
    storage.notes.hook('deleting').subscribe(deleting);

    const note = makeNote('11111111-1111-4111-8111-111111111111');
    await storage.notes.add(note);
    expect(creating).toHaveBeenCalledWith(note.id, note);

    await storage.notes.update(note.id, { title: 'Changed' });
    expect(updating).toHaveBeenCalledWith(
      { title: 'Changed' },
      note.id,
      expect.anything(),
    );

    await storage.notes.delete(note.id);
    expect(deleting).toHaveBeenCalledWith(note.id);

    // unsubscribe works
    deleting.mockClear();
    storage.notes.hook('deleting').unsubscribe(deleting);
    await storage.notes.add(note);
    await storage.notes.delete(note.id);
    expect(deleting).not.toHaveBeenCalled();
  });

  it('keeps tables isolated and clears everything on clearAll', async () => {
    const storage = createInMemoryStorage();
    const note = makeNote('11111111-1111-4111-8111-111111111111');

    await storage.notes.add(note);
    await storage.syncState.put({ key: 'cursor', value: '42' });

    expect(await storage.categories.toArray()).toEqual([]);

    await storage.clearAll();
    expect(await storage.notes.toArray()).toEqual([]);
    expect(await storage.syncState.toArray()).toEqual([]);
  });

  it('runs transactional callbacks', async () => {
    const storage = createInMemoryStorage();
    const note = makeNote('11111111-1111-4111-8111-111111111111');

    await storage.transaction(async () => {
      await storage.notes.add(note);
      await storage.outbox.add({
        id: '22222222-2222-4222-8222-222222222222',
        entityId: note.id,
        entityType: 'note' as const,
        operation: 'create' as const,
        baseVersion: 0,
        payload: note,
        createdAt: note.createdAt,
        retryCount: 0,
        status: 'pending' as const,
      });
    });

    expect(await storage.notes.toArray()).toHaveLength(1);
    expect(await storage.outbox.toArray()).toHaveLength(1);
  });
});
