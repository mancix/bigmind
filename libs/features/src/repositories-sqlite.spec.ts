import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createSqliteStorageAdapter,
  type SqliteDriver,
  type StorageAdapter,
} from '@bigmind/storage';
import { createNodeSqliteDriver } from '@bigmind/storage/node-sqlite-driver';
import { OutboxRepository } from '@bigmind/sync';

import { CategoryRepository } from './categories/category-repository.js';
import { ConflictRepository } from './conflicts/conflict-repository.js';
import { NoteRepository } from './notes/note-repository.js';
import { NotificationsRepository } from './notifications/notification-repository.js';
import { RemindersRepository } from './reminders/reminder-repository.js';
import { StaticWorkspaceContext } from './workspace/workspace-context.js';

/**
 * Repository behavior over `SqliteStorageAdapter`.
 *
 * `libs/storage/src/adapter-parity.spec.ts` proves the adapter contract is
 * identical for Memory and SQLite; this suite proves the REPOSITORIES behave
 * identically too — the same business assertions that run against the memory
 * adapter (see repositories.spec.ts) also pass against real SQLite, including
 * persistence across a close/reopen "restart".
 */
function createHarness(
  storage: StorageAdapter,
  workspaceId: string | null = null,
) {
  const outbox = new OutboxRepository(storage);
  const workspace = new StaticWorkspaceContext(workspaceId);
  const notes = new NoteRepository(storage, outbox);
  const categories = new CategoryRepository(storage, outbox);
  const reminders = new RemindersRepository(storage, outbox, workspace);
  const notifications = new NotificationsRepository(
    storage,
    outbox,
    workspace,
  );
  const conflicts = new ConflictRepository(storage, outbox);
  return {
    storage,
    outbox,
    notes,
    categories,
    reminders,
    notifications,
    conflicts,
  };
}

function sqlite(): SqliteDriver {
  return createNodeSqliteDriver(':memory:');
}

describe('shared feature repositories over SqliteStorageAdapter', () => {
  it('creates and lists notes with outbox operations', async () => {
    const { notes, outbox } = createHarness(
      createSqliteStorageAdapter(createNodeSqliteDriver(':memory:')),
    );

    const id = await notes.create({ title: '  Hello  ', content: '**bold**' });
    const list = await notes.list();

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id,
      title: 'Hello', // normalized by the shared domain rule
      templateType: 'MARKDOWN',
      syncStatus: 'pending',
    });
    expect(await outbox.listForEntity(id, 'note')).toMatchObject([
      { entityType: 'note', operation: 'create', status: 'pending' },
    ]);
  });

  it('coalesces edits into a single outbox operation', async () => {
    const { notes, outbox } = createHarness(
      createSqliteStorageAdapter(createNodeSqliteDriver(':memory:')),
    );

    const id = await notes.create({ title: 'First' });
    await notes.update(id, { title: 'Second' });
    await notes.update(id, { content: 'Content' });

    const operations = await outbox.listForEntity(id, 'note');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operation: 'create',
      status: 'pending',
    });
    expect((operations[0].payload as { title: string }).title).toBe('Second');
    expect((operations[0].payload as { content: string }).content).toBe(
      'Content',
    );
  });

  it('builds the category tree and respects delete guards', async () => {
    const { categories, notes } = createHarness(
      createSqliteStorageAdapter(createNodeSqliteDriver(':memory:')),
    );

    const root = await categories.create({ name: 'Research', icon: '🔬' });
    const child = await categories.create({ name: ' Papers ', parentId: root });

    const tree = await categories.listTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'Research', icon: '🔬' });
    expect(tree[0].children).toMatchObject([{ name: 'Papers' }]);

    await expect(categories.delete(root)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_EMPTY',
    });

    const noteId = await notes.create({ title: 'Assigned', categoryId: child });
    await expect(categories.delete(child)).rejects.toMatchObject({
      code: 'CATEGORY_HAS_NOTES',
    });

    await notes.delete(noteId);
    await categories.delete(child);
    expect(await categories.list()).toHaveLength(1);
  });

  it('filters notes by category', async () => {
    const { notes, categories } = createHarness(
      createSqliteStorageAdapter(sqlite()),
    );

    const cat = await categories.create({ name: 'Work' });
    await notes.create({ title: 'In category', categoryId: cat });
    await notes.create({ title: 'Uncategorized' });

    const filtered = await notes.list({ categoryId: cat });
    expect(filtered.map((note) => note.title)).toEqual(['In category']);
  });

  it('manages the reminder lifecycle with outbox coalescing', async () => {
    const { reminders, outbox } = createHarness(
      createSqliteStorageAdapter(sqlite()),
    );

    const id = await reminders.create({
      title: '  Review  ',
      dueAt: '2026-02-01T09:00:00.000Z',
    });
    expect((await reminders.list())[0]).toMatchObject({
      id,
      title: 'Review',
      completed: false,
      syncStatus: 'pending',
    });

    await reminders.toggle(id);
    expect((await reminders.list())[0].completed).toBe(true);

    const operations = await outbox.listForEntity(id, 'reminder');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operation: 'create',
      payload: { completed: true },
    });

    await reminders.remove(id);
    expect(await reminders.list()).toHaveLength(0);
    expect(await outbox.listForEntity(id, 'reminder')).toHaveLength(0);
  });

  it('creates, lists, and reads notifications', async () => {
    const { notifications } = createHarness(
      createSqliteStorageAdapter(sqlite()),
    );

    const a = await notifications.createLocal({
      type: 'reminder_due',
      title: 'Task due',
    });
    const b = await notifications.createLocal({
      type: 'note_modified',
      title: 'Note updated',
    });

    expect(await notifications.countUnread()).toBe(2);
    expect((await notifications.list()).map((n) => n.title).sort()).toEqual([
      'Note updated',
      'Task due',
    ]);

    await notifications.markRead(a);
    expect(await notifications.countUnread()).toBe(1);

    await notifications.markAllRead();
    expect(await notifications.countUnread()).toBe(0);
    expect((await notifications.list()).map((n) => n.id).sort()).toEqual(
      [a, b].sort(),
    );
  });

  it('isolates reminders by workspace (identical to the memory adapter)', async () => {
    const wsA = createHarness(createSqliteStorageAdapter(sqlite()), 'ws-a');
    const wsB = createHarness(createSqliteStorageAdapter(sqlite()), 'ws-b');

    await wsA.reminders.create({ title: 'Work', dueAt: '2026-02-01T08:00:00.000Z' });
    await wsB.reminders.create({ title: 'Personal', dueAt: '2026-02-02T08:00:00.000Z' });

    expect((await wsA.reminders.list()).map((r) => r.title)).toEqual(['Work']);
    expect((await wsB.reminders.list()).map((r) => r.title)).toEqual([
      'Personal',
    ]);
    expect((await wsA.reminders.list())[0].workspaceId).toBe('ws-a');
  });

  it('creates and resolves conflicts over SQLite', async () => {
    const { conflicts, storage, outbox } = createHarness(
      createSqliteStorageAdapter(sqlite()),
    );

    const note = {
      id: 'note-1',
      title: 'Test note',
      content: 'local content',
      categoryId: null,
      templateType: 'MARKDOWN' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 2,
      syncStatus: 'conflict' as const,
    };
    await storage.notes.put(note);

    const conflictId = await conflicts.create({
      entityType: 'note',
      entityId: 'note-1',
      conflictType: 'content',
      localVersion: 2,
      remoteVersion: 3,
      localSnapshot: { version: 2, entity: note },
      remoteSnapshot: {
        version: 3,
        entity: { ...note, content: 'remote content' },
        changedAt: '2026-01-01T00:01:00.000Z',
      },
    });

    expect((await conflicts.listOpen())[0]).toMatchObject({
      id: conflictId,
      status: 'open',
    });

    await outbox.add({
      id: 'op-1',
      entityId: 'note-1',
      entityType: 'note',
      operation: 'update',
      baseVersion: 2,
      payload: note,
      createdAt: '2026-01-01T00:00:00.000Z',
      retryCount: 0,
      status: 'failed',
    });

    await conflicts.resolve(conflictId, 'keep_mine');

    expect(await conflicts.countOpen()).toBe(0);
    const stored = await storage.notes.get('note-1');
    expect(stored?.syncStatus).toBe('pending');
    expect((await conflicts.listResolved())[0]).toMatchObject({
      resolution: 'keep_mine',
    });
  });

  it('survives a close/reopen restart with outbox + sync state intact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bigmind-repos-sqlite-'));
    const dbPath = join(dir, 'notes.db');

    try {
      // Session 1: create data and "exit" the app.
      const { notes, storage } = createHarness(
        createSqliteStorageAdapter(createNodeSqliteDriver(dbPath)),
      );
      const id = await notes.create({ title: 'Persisted', content: 'body' });
      storage.close();

      // Session 2: reopen and read through the repositories again.
      const reopened = createHarness(
        createSqliteStorageAdapter(createNodeSqliteDriver(dbPath)),
      );
      const after = await reopened.notes.findById(id);
      expect(after).toMatchObject({ title: 'Persisted', content: 'body' });
      expect(await reopened.notes.count()).toBe(1);

      // The outbox operation survives the restart too (pending, via the
      // where('status') query path).
      const pending = await reopened.outbox.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        entityId: id,
        operation: 'create',
        status: 'pending',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});