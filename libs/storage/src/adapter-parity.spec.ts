import { describe, expect, it, vi } from 'vitest';

import type { NoteRecord } from './records.js';
import type { StorageAdapter } from './storage-adapter.js';
import { createInMemoryStorage } from './storage-adapter.js';
import { createNodeSqliteDriver } from './node-sqlite-driver.js';
import { createSqliteStorageAdapter } from './sqlite-storage-adapter.js';

/**
 * Behavior suite shared by every {@link StorageAdapter} implementation.
 *
 * Requirement: the Memory and SQLite adapters must behave identically — any
 * consumer (repositories, sync engine, screens, tests) must be able to swap
 * engines without observable differences. This suite runs the same assertions
 * against `createInMemoryStorage()` and a real SQLite database (via the
 * node:sqlite driver), so drift is caught in CI.
 */

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

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

function describeStorageAdapter(
  name: string,
  createAdapter: () => Promise<StorageAdapter>,
): void {
  describe(name, () => {
    it('persists and reads records per table', async () => {
      const storage = await createAdapter();
      const note = makeNote(ID_A);

      await storage.notes.add(note);
      expect(await storage.notes.get(note.id)).toEqual(note);
      expect((await storage.notes.toArray()).map((n) => n.id)).toEqual([
        note.id,
      ]);
      expect(await storage.notes.count()).toBe(1);
    });

    it('updates records with put and removes them with delete', async () => {
      const storage = await createAdapter();
      const note = makeNote(ID_A);

      await storage.notes.add(note);
      await storage.notes.put({ ...note, title: 'Renamed' });
      expect((await storage.notes.get(note.id))?.title).toBe('Renamed');

      await storage.notes.delete(note.id);
      expect(await storage.notes.get(note.id)).toBeUndefined();
    });

    it('returns records in request order for get(ids)', async () => {
      const storage = await createAdapter();
      await storage.notes.bulkAdd([
        makeNote(ID_A),
        makeNote(ID_B),
        makeNote(ID_C),
      ]);

      const rows = await storage.notes.get([ID_C, ID_A, ID_B]);
      expect(rows.map((n) => n.id)).toEqual([ID_C, ID_A, ID_B]);

      // Missing keys are skipped (memory semantics).
      const partial = await storage.notes.get([ID_A, 'missing-id']);
      expect(partial.map((n) => n.id)).toEqual([ID_A]);
    });

    it('supports update() with Dexie-style undefined removal', async () => {
      const storage = await createAdapter();
      const note = makeNote(ID_A, { title: 'With alias' });

      await storage.notes.add(note);
      const changed = await storage.notes.update(ID_A, {
        title: undefined,
        syncStatus: 'synced',
      });

      expect(changed).toBe(1);
      const stored = await storage.notes.get(ID_A);
      expect(stored?.title).toBeUndefined();
      expect(stored).not.toHaveProperty('title');
      expect(stored?.syncStatus).toBe('synced');

      expect(await storage.notes.update('missing-id', { title: 'x' })).toBe(0);
    });

    it('queries with where().equals() and .anyOf()', async () => {
      const storage = await createAdapter();
      await storage.notes.bulkAdd([
        makeNote(ID_A, { categoryId: 'cat-a' }),
        makeNote(ID_B, { categoryId: 'cat-b' }),
        makeNote(ID_C, { categoryId: 'cat-a' }),
      ]);

      const catA = await storage.notes
        .where('categoryId')
        .equals('cat-a')
        .toArray();
      expect(catA.map((n) => n.id).sort()).toEqual([ID_A, ID_C]);

      const two = await storage.notes
        .where('id')
        .anyOf(ID_A, ID_B)
        .toArray();
      expect(two).toHaveLength(2);

      expect(
        await storage.notes.where('categoryId').equals('cat-a').count(),
      ).toBe(2);
    });

    it('matches null values through where().equals(null)', async () => {
      const storage = await createAdapter();
      await storage.notes.bulkAdd([
        makeNote(ID_A, { categoryId: 'cat-a' }),
        makeNote(ID_B, { categoryId: null }),
      ]);

      const uncategorized = await storage.notes
        .where('categoryId')
        .equals(null)
        .toArray();
      expect(uncategorized.map((n) => n.id)).toEqual([ID_B]);
    });

    it('does not flatten array arguments passed to equals()', async () => {
      const storage = await createAdapter();
      await storage.notes.bulkAdd([makeNote(ID_A, { categoryId: 'cat-a' })]);

      const byArray = await storage.notes
        .where('categoryId')
        .equals(['cat-a', 'cat-b'])
        .toArray();
      expect(byArray).toEqual([]);
    });

    it('falls back to index-less matching for unknown/compound indexes', async () => {
      const storage = await createAdapter();
      await storage.noteAliases.bulkAdd([
        {
          id: 'alias-1',
          noteId: ID_A,
          alias: 'Alpha',
          normalizedAlias: 'alpha',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          id: 'alias-2',
          noteId: ID_B,
          alias: 'Beta',
          normalizedAlias: 'beta',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ]);

      const byTuple = await storage.noteAliases
        .where('[noteId+normalizedAlias]')
        .equals([ID_A, 'alpha'])
        .toArray();
      expect(byTuple.map((a) => a.id)).toEqual(['alias-1']);

      const byUnknown = await storage.noteAliases
        .where('alias')
        .equals('Alpha')
        .toArray();
      expect(byUnknown.map((a) => a.id)).toEqual(['alias-1']);
    });

    it('orders by index and supports reverse + filter chains', async () => {
      const storage = await createAdapter();
      await storage.notes.bulkAdd([
        makeNote(ID_A, { updatedAt: '2025-01-03T00:00:00.000Z' }),
        makeNote(ID_B, { updatedAt: '2025-01-01T00:00:00.000Z' }),
        makeNote(ID_C, { updatedAt: '2025-01-02T00:00:00.000Z' }),
      ]);

      const newestFirst = await storage.notes
        .orderBy('updatedAt')
        .reverse()
        .filter((note) => !note.deletedAt)
        .toArray();
      expect(newestFirst.map((n) => n.id)).toEqual([ID_A, ID_C, ID_B]);

      expect(
        (await storage.notes.orderBy('updatedAt').toArray()).map((n) => n.id),
      ).toEqual([ID_B, ID_C, ID_A]);
    });

    it('sorts with sortBy() descending when the collection was reversed', async () => {
      const storage = await createAdapter();
      await storage.todoItems.bulkAdd([
        {
          id: 'todo-1',
          todoListId: 'list-a',
          text: 'third',
          completed: false,
          position: 3,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          deletedAt: null,
          version: 0,
          syncStatus: 'pending',
        },
        {
          id: 'todo-2',
          todoListId: 'list-a',
          text: 'first',
          completed: false,
          position: 1,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          deletedAt: null,
          version: 0,
          syncStatus: 'pending',
        },
        {
          id: 'todo-3',
          todoListId: 'list-a',
          text: 'second',
          completed: false,
          position: 2,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          deletedAt: null,
          version: 0,
          syncStatus: 'pending',
        },
      ]);

      const ascending = await storage.todoItems
        .where('todoListId')
        .equals('list-a')
        .sortBy('position');
      expect(ascending.map((t) => t.text)).toEqual(['first', 'second', 'third']);

      const descending = await storage.todoItems
        .where('todoListId')
        .equals('list-a')
        .reverse()
        .sortBy('position');
      expect(descending.map((t) => t.text)).toEqual(['third', 'second', 'first']);
    });

    it('modifies and deletes matched collections', async () => {
      const storage = await createAdapter();
      await storage.notes.bulkAdd([
        makeNote(ID_A, { categoryId: 'cat-a' }),
        makeNote(ID_B, { categoryId: 'cat-b' }),
        makeNote(ID_C, { categoryId: 'cat-a' }),
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

    it('fires creating/updating/deleting hooks', async () => {
      const storage = await createAdapter();
      const creating = vi.fn();
      const updating = vi.fn();
      const deleting = vi.fn();

      storage.notes.hook('creating').subscribe(creating);
      storage.notes.hook('updating').subscribe(updating);
      storage.notes.hook('deleting').subscribe(deleting);

      const note = makeNote(ID_A);
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

      // put over an existing record fires updating, not creating
      await storage.notes.add(note);
      creating.mockClear();
      updating.mockClear();
      await storage.notes.put({ ...note, title: 'Overwrite' });
      expect(creating).not.toHaveBeenCalled();
      expect(updating).toHaveBeenCalled();

      // unsubscribe works
      deleting.mockClear();
      storage.notes.hook('deleting').unsubscribe(deleting);
      await storage.notes.add(note);
      await storage.notes.delete(note.id);
      expect(deleting).not.toHaveBeenCalled();
    });

    it('keeps tables isolated, clears them and clears everything', async () => {
      const storage = await createAdapter();
      const note = makeNote(ID_A);

      await storage.notes.add(note);
      await storage.syncState.put({ key: 'cursor', value: '42' });

      expect(await storage.categories.toArray()).toEqual([]);

      await storage.notes.clear();
      expect(await storage.notes.toArray()).toEqual([]);
      expect(await storage.syncState.toArray()).toHaveLength(1);

      await storage.clearAll();
      expect(await storage.notes.toArray()).toEqual([]);
      expect(await storage.syncState.toArray()).toEqual([]);
    });

    it('runs transactional callbacks atomically', async () => {
      const storage = await createAdapter();
      const note = makeNote(ID_A);

      await storage.transaction(async () => {
        await storage.notes.add(note);
        await storage.outbox.add({
          id: ID_B,
          entityId: note.id,
          entityType: 'note',
          operation: 'create',
          baseVersion: 0,
          payload: note,
          createdAt: note.createdAt,
          retryCount: 0,
          status: 'pending',
        });
      });

      expect(await storage.notes.toArray()).toHaveLength(1);
      expect(await storage.outbox.toArray()).toHaveLength(1);
    });

    it('supports first() and empty results', async () => {
      const storage = await createAdapter();
      await storage.notes.bulkAdd([
        makeNote(ID_A),
        makeNote(ID_B),
      ]);

      expect((await storage.notes.orderBy('updatedAt').first())?.id).toBe(ID_A);
      expect(
        await storage.notes.where('categoryId').equals('nope').first(),
      ).toBeUndefined();
      expect(
        await storage.notes.where('categoryId').equals('nope').count(),
      ).toBe(0);
    });

    it('persists through open/close on the same adapter instance', async () => {
      const storage = await createAdapter();
      await storage.notes.add(makeNote(ID_A, { title: 'Kept' }));
      await storage.open();
      expect((await storage.notes.get(ID_A))?.title).toBe('Kept');
    });
  });
}

describeStorageAdapter('MemoryStorageAdapter', async () => {
  return createInMemoryStorage();
});

describeStorageAdapter('SqliteStorageAdapter (node:sqlite)', async () => {
  return createSqliteStorageAdapter(createNodeSqliteDriver(':memory:'));
});