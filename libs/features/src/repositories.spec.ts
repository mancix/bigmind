import { describe, expect, it } from 'vitest';
import {
  createInMemoryStorage,
  type CategoryRecord,
  type NoteRecord,
} from '@bigmind/storage';
import { OutboxRepository } from '@bigmind/sync';

import { CategoryRepository } from './categories/category-repository.js';
import { ConflictRepository } from './conflicts/conflict-repository.js';
import { subscribeToConflictCreations } from './conflicts/conflict-repository.js';
import { LinkRepository } from './links/link-repository.js';
import { NoteRepository } from './notes/note-repository.js';
import { NotificationsRepository } from './notifications/notification-repository.js';
import { RemindersRepository } from './reminders/reminder-repository.js';
import { createRepositoryProvider } from './repository-provider.js';
import { TodoRepository } from './todos/todo-repository.js';
import { StaticWorkspaceContext } from './workspace/workspace-context.js';

function createHarness(workspaceId: string | null = null) {
  const storage = createInMemoryStorage();
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

function createNoteConflict(
  id: string,
  note: NoteRecord,
  remote: Partial<NoteRecord>,
  remoteVersion: number,
) {
  return {
    entityType: 'note' as const,
    entityId: id,
    conflictType: 'content' as const,
    localVersion: note.version,
    remoteVersion,
    localSnapshot: { version: note.version, entity: note },
    remoteSnapshot: {
      version: remoteVersion,
      entity: { ...note, ...remote, version: remoteVersion },
      changedAt: '2026-01-01T00:01:00.000Z',
    },
  };
}

describe('shared feature repositories (platform independent)', () => {
  it('creates and lists notes with outbox operations', async () => {
    const { notes, outbox } = createHarness();

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
    const { notes, outbox } = createHarness();

    const id = await notes.create({ title: 'First' });
    await notes.update(id, { title: 'Second' });
    await notes.update(id, { content: 'Content' });

    const operations = await outbox.listForEntity(id, 'note');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operation: 'create',
      payload: { title: 'Second', content: 'Content' },
    });
  });

  it('builds the category tree and respects delete guards', async () => {
    const { categories, notes, outbox } = createHarness();

    const root = await categories.create({ name: 'Research', icon: '🔬' });
    const child = await categories.create({ name: ' Papers ', parentId: root });

    const tree = await categories.listTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'Research', icon: '🔬' });
    expect(tree[0].children).toMatchObject([{ name: 'Papers' }]);

    // A category with children cannot be deleted.
    await expect(categories.delete(root)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_EMPTY',
    });

    // A category with notes cannot be deleted.
    const noteId = await notes.create({ title: 'Assigned', categoryId: child });
    await expect(categories.delete(child)).rejects.toMatchObject({
      code: 'CATEGORY_HAS_NOTES',
    });

    await notes.delete(noteId);
    await categories.delete(child);
    expect(await categories.list()).toHaveLength(1);

    void outbox;
  });

  it('filters notes by category', async () => {
    const { notes, categories } = createHarness();

    const cat = await categories.create({ name: 'Work' });
    await notes.create({ title: 'In category', categoryId: cat });
    await notes.create({ title: 'Uncategorized' });

    const filtered = await notes.list({ categoryId: cat });
    expect(filtered.map((note) => note.title)).toEqual(['In category']);
  });

  it('manages the reminder lifecycle with outbox coalescing', async () => {
    const { reminders, outbox } = createHarness();

    const id = await reminders.create({
      title: '  Review notes  ',
      dueAt: '2026-02-01T09:00:00.000Z',
    });

    expect((await reminders.list())[0]).toMatchObject({
      id,
      title: 'Review notes', // trimmed by the shared repository
      dueAt: '2026-02-01T09:00:00.000Z',
      completed: false,
      syncStatus: 'pending',
    });

    await reminders.toggle(id);
    expect((await reminders.list())[0].completed).toBe(true);

    // Edits after create coalesce into the pending create operation.
    const operations = await outbox.listForEntity(id, 'reminder');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operation: 'create',
      payload: { completed: true },
    });

    // Deleting an entity that was never synced removes it and its operations.
    await reminders.remove(id);
    expect(await reminders.list()).toHaveLength(0);
    expect(await outbox.listForEntity(id, 'reminder')).toHaveLength(0);

    // Once the create op is consumed, updates/removes queue real operations.
    const otherId = await reminders.create({
      title: 'Second',
      dueAt: '2026-03-01T09:00:00.000Z',
    });
    await outbox.removeMany(
      (await outbox.listForEntity(otherId, 'reminder')).map(
        (operation) => operation.id,
      ),
    );
    await reminders.update(otherId, { title: 'Renamed' });
    await reminders.remove(otherId);
    const finalOps = await outbox.listForEntity(otherId, 'reminder');
    // Once the create op is consumed, remove() queues a delete operation
    // (the prior update op is left in place — mirrors the web behavior).
    expect(finalOps.map((operation) => operation.operation)).toEqual([
      'update',
      'delete',
    ]);
    expect(finalOps[1]).toMatchObject({ operation: 'delete', status: 'pending' });
    // The reminder stays readable locally until the delete is pushed.
    expect((await reminders.list())[0]).toMatchObject({
      id: otherId,
      title: 'Renamed',
    });
  });

  it('isolates reminders and notifications by workspace', async () => {
    const wsA = createHarness('ws-a');
    const wsB = createHarness('ws-b');

    await wsA.reminders.create({
      title: 'Work',
      dueAt: '2026-02-01T08:00:00.000Z',
    });
    await wsB.reminders.create({
      title: 'Personal',
      dueAt: '2026-02-02T08:00:00.000Z',
    });
    await wsA.notifications.createLocal({ type: 'reminder_due', title: 'Due' });
    await wsB.notifications.createLocal({
      type: 'note_modified',
      title: 'Edited',
    });

    expect((await wsA.reminders.list()).map((r) => r.title)).toEqual(['Work']);
    expect((await wsB.reminders.list()).map((r) => r.title)).toEqual([
      'Personal',
    ]);
    expect((await wsA.notifications.list()).map((n) => n.title)).toEqual([
      'Due',
    ]);
    expect((await wsB.notifications.list()).map((n) => n.title)).toEqual([
      'Edited',
    ]);
    // Records carry the workspace id they were created under.
    expect((await wsA.reminders.list())[0].workspaceId).toBe('ws-a');
    expect((await wsB.reminders.list())[0].workspaceId).toBe('ws-b');
  });

  it('creates notifications and marks them read', async () => {
    const { notifications, outbox } = createHarness();

    const a = await notifications.createLocal({
      type: 'reminder_due',
      title: 'Task due',
      body: 'Your task is due now',
    });
    const b = await notifications.createLocal({
      type: 'note_modified',
      title: 'Note updated',
    });

    expect(await notifications.countUnread()).toBe(2);
    expect(await notifications.list()).toHaveLength(2);

    await notifications.markRead(a);
    expect(await notifications.countUnread()).toBe(1);

    await notifications.markAllRead();
    expect(await notifications.countUnread()).toBe(0);

    await notifications.remove(b);
    expect((await notifications.list()).map((n) => n.id)).toEqual([a]);

    // The unsynced create was fully removed locally (create → delete).
    expect(await outbox.listForEntity(b, 'notification')).toHaveLength(0);
  });

  it('creates open conflicts and merges re-detections for the same entity', async () => {
    const { conflicts, storage } = createHarness();

    const note = createNoteRecord('note-1', { version: 2 });
    await storage.notes.put(note);

    const id = await conflicts.create(
      createNoteConflict('note-1', note, { content: 'remote' }, 3),
    );

    expect((await conflicts.listOpen())[0]).toMatchObject({
      id,
      entityType: 'note',
      conflictType: 'content',
      status: 'open',
    });

    // A second detection for the same entity updates the OPEN conflict
    // instead of creating a duplicate.
    const retryId = await conflicts.create({
      ...createNoteConflict('note-1', note, { title: 'Renamed' }, 4),
      conflictType: 'rename',
    });

    expect(retryId).toBe(id);
    const open = await conflicts.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ remoteVersion: 4, conflictType: 'rename' });
  });

  it('resolves keep_mine by requeueing the local entity as pending', async () => {
    const { conflicts, storage, outbox } = createHarness();

    const note = createNoteRecord('note-1', {
      version: 2,
      syncStatus: 'conflict',
    });
    await storage.notes.put(note);

    const conflictId = await conflicts.create(
      createNoteConflict('note-1', note, { content: 'remote' }, 3),
    );

    await outbox.add({
      id: 'op-keep',
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
    expect((await conflicts.listResolved())[0]).toMatchObject({
      id: conflictId,
      resolution: 'keep_mine',
    });

    const stored = await storage.notes.get('note-1');
    expect(stored?.syncStatus).toBe('pending');
    expect(stored?.conflict).toBeUndefined();

    const operations = await outbox.listForEntity('note-1', 'note');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      id: 'op-keep',
      operation: 'update',
      status: 'pending',
      baseVersion: 3,
    });
  });

  it('resolves keep_remote by applying the remote snapshot', async () => {
    const { conflicts, storage, outbox } = createHarness();

    const note = createNoteRecord('note-1', {
      version: 2,
      content: 'local content',
    });
    await storage.notes.put(note);

    const conflictId = await conflicts.create(
      createNoteConflict('note-1', note, { content: 'remote content' }, 3),
    );

    await conflicts.resolve(conflictId, 'keep_remote');

    const stored = await storage.notes.get('note-1');
    expect(stored?.content).toBe('remote content');
    expect(stored?.version).toBe(3);
    expect(stored?.syncStatus).toBe('synced');
    expect((await conflicts.listResolved())[0]).toMatchObject({
      resolution: 'keep_remote',
    });
    // Remote application consumes pending local operations.
    expect(await outbox.listForEntity('note-1', 'note')).toHaveLength(0);
  });

  it('dismisses conflicts without touching the underlying entity', async () => {
    const { conflicts, storage } = createHarness();

    const note = createNoteRecord('note-1', { version: 1 });
    await storage.notes.put(note);

    const id = await conflicts.create(
      createNoteConflict('note-1', note, { content: 'remote' }, 2),
    );

    await conflicts.dismiss(id);
    expect(await conflicts.countOpen()).toBe(0);
    expect(await conflicts.listDismissed()).toHaveLength(1);
    expect((await storage.notes.get('note-1'))?.title).toBe('Test note');
  });

  it('guards invalid resolutions and entity types', async () => {
    const { conflicts } = createHarness();

    await expect(
      conflicts.resolve('missing-conflict', 'keep_mine'),
    ).rejects.toMatchObject({ code: 'CONFLICT_NOT_FOUND' });

    const { conflicts: moreConflicts, storage } = createHarness();
    const category = createCategoryRecord('cat-1', { version: 1 });
    await storage.categories.put(category);
    const id = await moreConflicts.create({
      entityType: 'category',
      entityId: 'cat-1',
      conflictType: 'category_move',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: category },
      remoteSnapshot: {
        version: 2,
        entity: { ...category, parentId: 'missing-parent' },
        changedAt: '2026-01-01T00:01:00.000Z',
      },
    });
    await expect(
      moreConflicts.resolve(id, 'merge_manually', {}),
    ).rejects.toMatchObject({
      code: 'INVALID_RESOLUTION',
    });
  });

  it('notifies listeners when conflicts are created', async () => {
    const { conflicts, storage } = createHarness();

    const note = createNoteRecord('note-1', { version: 1 });
    await storage.notes.put(note);

    const seen: string[] = [];
    const unsubscribe = subscribeToConflictCreations((conflict) => {
      seen.push(conflict.id);
    });

    try {
      await conflicts.create(
        createNoteConflict('note-1', note, { content: 'remote' }, 2),
      );
    } finally {
      unsubscribe();
    }

    expect(seen).toHaveLength(1);
  });

  it('wires every repository through the DI provider (swappable storage)', async () => {
    const storage = createInMemoryStorage();
    const outbox = new OutboxRepository(storage);
    const repos = createRepositoryProvider(storage, outbox, {
      workspace: new StaticWorkspaceContext('ws-provider'),
    });

    const noteId = await repos.notes.create({ title: 'Provider note' });
    const reminderId = await repos.reminders.create({
      title: 'Remind me',
      dueAt: '2026-02-01T09:00:00.000Z',
    });

    // Every repository is wired and functional against the same adapter.
    expect(repos.categories).toBeInstanceOf(CategoryRepository);
    expect(repos.links).toBeInstanceOf(LinkRepository);
    expect(repos.todos).toBeInstanceOf(TodoRepository);
    expect(repos.notifications).toBeInstanceOf(NotificationsRepository);
    expect(repos.conflicts).toBeInstanceOf(ConflictRepository);
    expect(await repos.notes.findById(noteId)).toMatchObject({
      title: 'Provider note',
    });
    expect((await repos.reminders.list())[0]).toMatchObject({
      id: reminderId,
      workspaceId: 'ws-provider',
    });
  });
});