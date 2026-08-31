import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CategoryRepository } from '../categories/category-repository';
import {
  ConflictRepository,
  ConflictRepositoryError,
  subscribeToConflictCreations,
} from './conflict-repository';
import { storage, type CategoryRecord, type NoteRecord } from '../../storage';
import { OutboxRepository } from '../../sync/outbox-repository';
import type { RemoteChange } from '../../sync/sync.types';

const outbox = new OutboxRepository(storage);
const conflicts = new ConflictRepository(storage, outbox);
const categories = new CategoryRepository(storage, outbox);

beforeEach(async () => {
  await storage.delete();
  await storage.open();
});

afterEach(async () => {
  await storage.delete();
});

function createNoteRecord(
  id: string,
  overrides: Partial<NoteRecord> = {},
): NoteRecord {
  return {
    id,
    title: 'Test note',
    content: '',
    categoryId: null,
    templateType: 'MARKDOWN',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    syncStatus: 'synced',
    ...overrides,
  };
}

function createCategoryRecord(
  id: string,
  overrides: Partial<CategoryRecord> = {},
): CategoryRecord {
  return {
    id,
    name: 'Category',
    description: '',
    icon: null,
    parentId: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    deletedAt: null,
    syncStatus: 'synced',
    ...overrides,
  };
}

function createRemoteChange(
  entityType: 'note' | 'category',
  entityId: string,
  payload: NoteRecord | CategoryRecord,
  version: number,
): RemoteChange {
  return {
    entityId,
    entityType,
    operation: 'update',
    version,
    payload,
    changedAt: '2026-01-01T00:01:00.000Z',
  };
}

describe('conflict repository persistence', () => {
  it('creates an open conflict and counts it', async () => {
    const note = createNoteRecord('note-1', { version: 1 });
    await storage.notes.add(note);
    const remote = createRemoteChange(
      'note',
      note.id,
      { ...note, content: 'Remote', version: 2 },
      2,
    );

    const id = await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note },
      remoteSnapshot: {
        version: 2,
        entity: remote.payload,
        changedAt: remote.changedAt,
        operation: 'update',
      },
    });

    expect(await conflicts.countOpen()).toBe(1);
    const stored = await conflicts.find(id);
    expect(stored).toMatchObject({
      id,
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      status: 'open',
    });
  });

  it('updates an existing open conflict instead of duplicating it', async () => {
    const note = createNoteRecord('note-2');
    await storage.notes.add(note);
    const first = await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note },
      remoteSnapshot: { version: 2, entity: note },
    });
    const second = await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      localVersion: 2,
      remoteVersion: 3,
      localSnapshot: { version: 2, entity: note },
      remoteSnapshot: { version: 3, entity: note },
    });

    expect(second).toBe(first);
    expect(await conflicts.listOpen()).toHaveLength(1);
    expect(await conflicts.countOpen()).toBe(1);
  });

  it('notifies subscribers when a conflict is created', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToConflictCreations(listener);

    const note = createNoteRecord('note-notify');
    await storage.notes.add(note);
    const id = await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note },
      remoteSnapshot: { version: 2, entity: note },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ id, status: 'open' });
    unsubscribe();
    await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note },
      remoteSnapshot: { version: 2, entity: note },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('lists open and resolved conflicts separately', async () => {
    const first = createNoteRecord('note-open');
    const second = createNoteRecord('note-resolved');
    await storage.notes.bulkAdd([first, second]);
    const openId = await conflicts.create({
      entityType: 'note',
      entityId: first.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: first },
      remoteSnapshot: { version: 2, entity: first },
    });
    const resolvedId = await conflicts.create({
      entityType: 'note',
      entityId: second.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: second },
      remoteSnapshot: { version: 2, entity: second },
    });
    await conflicts.dismiss(resolvedId);

    expect(await conflicts.listOpen()).toMatchObject([{ id: openId }]);
    expect(await conflicts.listResolved()).toMatchObject([
      { id: resolvedId, status: 'dismissed' },
    ]);
  });
});

describe('conflict resolution workflows', () => {
  it('Keep Mine recreates a pending update op with the remote version as baseVersion', async () => {
    const note = createNoteRecord('note-keep-mine', {
      content: 'Local content',
      syncStatus: 'conflict',
    });
    await storage.notes.add(note);
    const conflictId = await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note, operation: 'none' },
      remoteSnapshot: {
        version: 2,
        entity: { ...note, content: 'Remote content', version: 2 },
        operation: 'update',
        changedAt: '2026-01-01T00:01:00.000Z',
      },
      baseVersion: 1,
    });

    await conflicts.resolveKeepMine(conflictId);

    expect(await conflicts.countOpen()).toBe(0);
    const operations = await outbox.listForEntity(note.id, 'note');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operation: 'update',
      baseVersion: 2,
      status: 'pending',
      payload: { content: 'Local content' },
    });
    expect((await storage.notes.get(note.id))?.syncStatus).toBe('pending');
    const resolved = await conflicts.find(conflictId);
    expect(resolved).toMatchObject({
      status: 'resolved',
      resolution: 'keep_mine',
    });
    expect(resolved?.resolvedAt).toBeDefined();
  });

  it('Keep Remote overwrites the local note with the remote snapshot and clears pending ops', async () => {
    const note = createNoteRecord('note-keep-remote', {
      content: 'Local content',
      syncStatus: 'conflict',
    });
    await storage.notes.add(note);
    const remote = {
      ...note,
      content: 'Remote content',
      version: 2,
      updatedAt: '2026-01-01T00:01:00.000Z',
    };
    await outbox.add({
      id: crypto.randomUUID(),
      entityId: note.id,
      entityType: 'note',
      operation: 'update',
      baseVersion: 1,
      payload: note,
      createdAt: '2026-01-01T00:00:00.000Z',
      retryCount: 0,
      status: 'pending',
    });
    const conflictId = await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note },
      remoteSnapshot: {
        version: 2,
        entity: remote,
        changedAt: '2026-01-01T00:01:00.000Z',
        operation: 'update',
      },
    });

    await conflicts.resolveKeepRemote(conflictId);

    expect(await storage.notes.get(note.id)).toMatchObject({
      content: 'Remote content',
      version: 2,
      syncStatus: 'synced',
    });
    expect(await outbox.listForEntity(note.id, 'note')).toEqual([]);
    expect(await conflicts.countOpen()).toBe(0);
  });

  it('Merge Manually stores the merged content and queues a pending update operation', async () => {
    const note = createNoteRecord('note-merge', {
      content: 'Local',
      version: 1,
      syncStatus: 'conflict',
    });
    await storage.notes.add(note);
    const remote = { ...note, content: 'Remote', version: 2 };
    const conflictId = await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note },
      remoteSnapshot: { version: 2, entity: remote, operation: 'update' },
    });

    await conflicts.resolveMergeManually(conflictId, {
      content: 'Merged content',
    });

    expect(await storage.notes.get(note.id)).toMatchObject({
      content: 'Merged content',
      version: 2,
      syncStatus: 'pending',
    });
    const operations = await outbox.listForEntity(note.id, 'note');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operation: 'update',
      baseVersion: 2,
      status: 'pending',
    });
  });

  it('Delete Mine accepts the remote deletion and marks the note as synced', async () => {
    const note = createNoteRecord('note-delete-mine', {
      content: 'Local edit',
      syncStatus: 'conflict',
    });
    await storage.notes.add(note);
    const conflictId = await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'delete_vs_edit',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note, operation: 'none' },
      remoteSnapshot: {
        version: 2,
        entity: { ...note, deletedAt: '2026-01-01T00:01:00.000Z' },
        operation: 'delete',
        changedAt: '2026-01-01T00:01:00.000Z',
      },
    });

    await conflicts.resolveDeleteMine(conflictId);

    expect(await storage.notes.get(note.id)).toMatchObject({
      deletedAt: '2026-01-01T00:01:00.000Z',
      version: 2,
      syncStatus: 'synced',
    });
    expect(await outbox.listForEntity(note.id, 'note')).toEqual([]);
    expect(await conflicts.countOpen()).toBe(0);
  });

  it('Restore preserves local note content and queues a pending update op', async () => {
    const note = createNoteRecord('note-restore', {
      content: 'Keep mine',
      syncStatus: 'conflict',
    });
    await storage.notes.add(note);
    const conflictId = await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'delete_vs_edit',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note, operation: 'none' },
      remoteSnapshot: {
        version: 2,
        entity: { ...note, deletedAt: '2026-01-01T00:01:00.000Z' },
        operation: 'delete',
        changedAt: '2026-01-01T00:01:00.000Z',
      },
    });

    await conflicts.resolveRestore(conflictId);

    expect(await storage.notes.get(note.id)).toMatchObject({
      content: 'Keep mine',
      syncStatus: 'pending',
    });
    expect((await outbox.listForEntity(note.id, 'note'))[0]).toMatchObject({
      operation: 'update',
      status: 'pending',
    });
  });

  it('Dismiss keeps the entity unchanged but marks the conflict dismissed', async () => {
    const note = createNoteRecord('note-dismiss', {
      content: 'Local only',
      syncStatus: 'conflict',
    });
    await storage.notes.add(note);
    const conflictId = await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note },
      remoteSnapshot: { version: 2, entity: note },
    });

    await conflicts.dismiss(conflictId);

    expect(await conflicts.countOpen()).toBe(0);
    expect(await conflicts.find(conflictId)).toMatchObject({
      status: 'dismissed',
      resolution: 'dismiss',
    });
    expect(await storage.notes.get(note.id)).toMatchObject({
      content: 'Local only',
    });
  });

  it('Category conflict: Keep Remote applies the remote parent when the move is cycle-free', async () => {
    const parent = createCategoryRecord('parent');
    const moved = createCategoryRecord('moved', {
      parentId: 'parent',
      position: 0,
    });
    await storage.categories.bulkAdd([parent, moved]);
    const remote = { ...moved, parentId: null };
    const conflictId = await conflicts.create({
      entityType: 'category',
      entityId: moved.id,
      conflictType: 'category_move',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: moved },
      remoteSnapshot: {
        version: 2,
        entity: remote,
        operation: 'update',
        changedAt: '2026-01-01T00:01:00.000Z',
      },
    });

    await conflicts.resolveKeepRemote(conflictId);

    expect(await storage.categories.get(moved.id)).toMatchObject({
      parentId: null,
      version: 2,
      syncStatus: 'synced',
    });
  });

  it('Category conflict: Keep Remote rejects a move that would create a cycle', async () => {
    const parentId = await categories.create({ name: 'Parent' });
    const childId = await categories.create({ name: 'Child', parentId });
    const child = await categories.findById(childId);
    if (!child) throw new Error('child category missing');
    const remote = { ...child, parentId: childId };
    const conflictId = await conflicts.create({
      entityType: 'category',
      entityId: childId,
      conflictType: 'category_move',
      localVersion: child.version,
      remoteVersion: child.version + 1,
      localSnapshot: { version: child.version, entity: child },
      remoteSnapshot: {
        version: child.version + 1,
        entity: remote,
        operation: 'update',
        changedAt: '2026-01-01T00:01:00.000Z',
      },
    });

    await expect(conflicts.resolveKeepRemote(conflictId)).rejects.toMatchObject(
      {
        code: 'CATEGORY_CYCLE',
      },
    );
    expect(await conflicts.countOpen()).toBe(1);
  });
});

describe('conflict counts and reloading', () => {
  it('keeps conflicts across database reopens', async () => {
    const note = createNoteRecord('note-persist');
    await storage.notes.add(note);
    await conflicts.create({
      entityType: 'note',
      entityId: note.id,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: note },
      remoteSnapshot: { version: 2, entity: note },
    });

    expect(await conflicts.countOpen()).toBe(1);
    storage.close();
    await storage.open();

    const reloaded = new ConflictRepository(storage, outbox);
    expect(await reloaded.countOpen()).toBe(1);
    const stored = await reloaded.listOpen();
    expect(stored[0]?.entityId).toBe(note.id);
  });

  it('throws a typed error when resolving a missing conflict', async () => {
    await expect(
      conflicts.resolveKeepMine('does-not-exist'),
    ).rejects.toBeInstanceOf(ConflictRepositoryError);
  });
});
