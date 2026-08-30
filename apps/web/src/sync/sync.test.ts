import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { conflictRepository } from '../features/conflicts/conflict-repository';
import { conflictService } from '../features/conflicts/conflict-service';
import { authStore } from '../features/auth/auth-store';
import { NoteRepository } from '../features/notes/note-repository';
import { CategoryRepository } from '../features/categories/category-repository';
import { LinkRepository } from '../features/links/link-repository';
import {
  storage,
  type CategoryRecord,
  type NoteLinkRecord,
  type NoteRecord,
} from '../storage';
import { FakeSyncTransport } from './fake-sync-transport';
import { HttpSyncTransport } from './http-sync-transport';
import { OutboxRepository } from './outbox-repository';
import {
  requestBackgroundSync,
  subscribeToBackgroundSyncRequests,
} from './background-sync';
import { SyncEngine } from './sync-engine';
import { SyncStateRepository } from './sync-state-repository';
import type { SyncTransport } from './sync-transport';
import type {
  PullResult,
  PushOperationResult,
  SyncOperation,
} from './sync.types';

const outbox = new OutboxRepository(storage);
const syncState = new SyncStateRepository(storage);

const TEST_AUTH = {
  getHeaders: () => ({}),
  getAuthState: () => 'authenticated' as const,
  refreshAccessToken: () => Promise.resolve('ok' as const),
};
const noteRepository = new NoteRepository(storage, outbox);
const categoryRepository = new CategoryRepository(storage, outbox);

describe('background sync requests', () => {
  it('notifies active subscribers and supports unsubscribing', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToBackgroundSyncRequests(listener);

    requestBackgroundSync();
    unsubscribe();
    requestBackgroundSync();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

beforeEach(async () => {
  await storage.delete();
  await storage.open();
});

afterEach(async () => {
  await storage.delete();
});

describe('note outbox coalescing', () => {
  it('coalesces a create followed by multiple updates into one operation', async () => {
    const noteId = await noteRepository.create({ title: 'First' });

    await noteRepository.update(noteId, { title: 'Second' });
    await noteRepository.update(noteId, { content: 'Latest content' });

    const operations = await outbox.listForEntity(noteId);

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      entityId: noteId,
      operation: 'create',
      status: 'pending',
      payload: {
        title: 'Second',
        content: 'Latest content',
      },
    });
  });

  it('removes a never-synced note and its pending create operation', async () => {
    const noteId = await noteRepository.create();

    await noteRepository.delete(noteId);

    expect(await storage.notes.get(noteId)).toBeUndefined();
    expect(await outbox.listForEntity(noteId)).toEqual([]);
  });
});

describe('fake sync transport', () => {
  it('handles duplicate operation delivery idempotently', async () => {
    const transport = new FakeSyncTransport();
    const operation = createOperation('operation-1');

    const first = await transport.push([operation]);
    const duplicate = await transport.push([operation]);
    const pulled = await transport.pull();

    expect(duplicate).toEqual(first);
    expect(pulled.changes).toHaveLength(1);
  });

  it('returns a conflict for stale base versions', async () => {
    const transport = new FakeSyncTransport();
    const create = createOperation('create-1');
    await transport.push([create]);

    const staleUpdate: SyncOperation = {
      ...create,
      id: 'update-1',
      operation: 'update',
      baseVersion: 0,
      payload: { ...create.payload, title: 'Stale update' },
    };
    const [result] = await transport.push([staleUpdate]);

    expect(result).toMatchObject({
      status: 'conflict',
      error: { code: 'version_conflict' },
    });
  });

  it('synchronizes category create, update and delete changes', async () => {
    const transport = new FakeSyncTransport();
    const create = createCategoryOperation('category-create');
    const [created] = await transport.push([create]);
    const update = {
      ...create,
      id: 'category-update',
      operation: 'update' as const,
      baseVersion: 1,
      payload: { ...create.payload, name: 'Renamed category', version: 1 },
    };
    const [updated] = await transport.push([update]);
    const deletion = {
      ...update,
      id: 'category-delete',
      operation: 'delete' as const,
      baseVersion: 2,
      payload: {
        ...update.payload,
        deletedAt: '2026-01-01T00:02:00.000Z',
        version: 2,
      },
    };
    const [deleted] = await transport.push([deletion]);

    expect([created, updated, deleted]).toMatchObject([
      { status: 'accepted', version: 1 },
      { status: 'accepted', version: 2 },
      { status: 'accepted', version: 3 },
    ]);
    expect(
      (await transport.pull()).changes.map(({ entityType, operation }) => ({
        entityType,
        operation,
      })),
    ).toEqual([
      { entityType: 'category', operation: 'create' },
      { entityType: 'category', operation: 'update' },
      { entityType: 'category', operation: 'delete' },
    ]);
  });

  it('keeps category delivery idempotent and detects stale updates', async () => {
    const transport = new FakeSyncTransport();
    const create = createCategoryOperation('category-create-once');
    const first = await transport.push([create]);
    expect(await transport.push([create])).toEqual(first);

    const [stale] = await transport.push([
      {
        ...create,
        id: 'category-stale',
        operation: 'update',
        baseVersion: 0,
      },
    ]);
    expect(stale).toMatchObject({ status: 'conflict' });
    expect((await transport.pull()).changes).toHaveLength(1);
  });

  it('pushes and pulls immutable note link changes', async () => {
    const transport = new FakeSyncTransport();
    const create = createLinkOperation('link-create');
    const [created] = await transport.push([create]);
    const deletion: SyncOperation<NoteLinkRecord> = {
      ...create,
      id: 'link-delete',
      operation: 'delete',
      baseVersion: 1,
      payload: {
        ...create.payload,
        version: 1,
        deletedAt: '2026-01-01T00:01:00.000Z',
      },
    };
    const [deleted] = await transport.push([deletion]);

    expect([created, deleted]).toMatchObject([
      { status: 'accepted', entityType: 'link', version: 1 },
      { status: 'accepted', entityType: 'link', version: 2 },
    ]);
    expect((await transport.pull()).changes).toMatchObject([
      { entityType: 'link', operation: 'create' },
      { entityType: 'link', operation: 'delete' },
    ]);
  });
});

describe('HTTP sync transport', () => {
  it('maps an accepted server result to the existing sync model', async () => {
    const operation = createOperation(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    );
    const transport = new HttpSyncTransport({
      baseUrl: 'http://localhost:3000',
      auth: TEST_AUTH,
      api: vi.fn().mockResolvedValue({
        status: 200,
        body: {
          results: [
            {
              status: 'accepted',
              operationId: operation.id,
              entityId: operation.entityId,
              entityType: 'note',
              serverVersion: 1,
              serverSequence: 1,
            },
          ],
        },
        headers: new Headers(),
      }),
    });

    await expect(transport.push([operation])).resolves.toEqual([
      {
        operationId: operation.id,
        status: 'accepted',
        entityId: operation.entityId,
        entityType: 'note',
        version: 1,
      },
    ]);
  });

  it('maps a server version conflict and its current note', async () => {
    const operation = createOperation(
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
    );
    const currentServerData = {
      ...createNote(operation.entityId),
      version: 2,
      updatedAt: '2026-01-01T00:01:00.000Z',
    };
    const transport = new HttpSyncTransport({
      baseUrl: 'http://localhost:3000',
      auth: TEST_AUTH,
      api: vi.fn().mockResolvedValue({
        status: 200,
        body: {
          results: [
            {
              status: 'conflict',
              operationId: operation.id,
              entityId: operation.entityId,
              entityType: 'note',
              clientBaseVersion: 0,
              currentServerVersion: 2,
              currentServerData,
            },
          ],
        },
        headers: new Headers(),
      }),
    });

    await expect(transport.push([operation])).resolves.toMatchObject([
      {
        operationId: operation.id,
        status: 'conflict',
        remoteChange: {
          entityId: operation.entityId,
          operation: 'update',
          version: 2,
          payload: currentServerData,
        },
      },
    ]);
  });

  it('keeps an operation queued when the API is unavailable', async () => {
    const noteId = await noteRepository.create({ title: 'Offline note' });
    const transport = new HttpSyncTransport({
      baseUrl: 'http://localhost:3000',
      auth: TEST_AUTH,
      api: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });

    await createEngine(transport).sync();

    expect(await outbox.countPending()).toBe(1);
    expect(await outbox.listForEntity(noteId)).toMatchObject([
      {
        status: 'failed',
        retryCount: 1,
        lastError: { code: 'transport_error', retryable: true },
      },
    ]);
  });
});

describe('sync engine', () => {
  it('persists a pulled category tree and note assignment', async () => {
    const transport = new FakeSyncTransport();
    const category = createCategoryOperation(
      'remote-category-create',
      'remote-category',
    );
    const note = createOperation(
      'remote-note-create',
      'remote-categorized-note',
    );
    note.payload.categoryId = category.entityId;
    await transport.push([note, category]);

    await createEngine(transport).sync();

    expect(await categoryRepository.listTree()).toMatchObject([
      { id: 'remote-category', name: 'Category' },
    ]);
    expect(await storage.notes.get('remote-categorized-note')).toMatchObject({
      categoryId: 'remote-category',
      syncStatus: 'synced',
    });
  });

  it('persists pulled links after their notes and exposes backlinks', async () => {
    const transport = new FakeSyncTransport();
    const source = createOperation('remote-source-create', 'remote-source');
    const target = createOperation('remote-target-create', 'remote-target');
    target.payload.title = 'Remote target';
    const link = createLinkOperation('remote-link-create');
    link.entityId = 'remote-link';
    link.payload.id = 'remote-link';
    link.payload.sourceNoteId = source.entityId;
    link.payload.targetNoteId = target.entityId;
    await transport.push([link, target, source]);

    await createEngine(transport).sync();

    expect(await storage.noteLinks.get('remote-link')).toMatchObject({
      sourceNoteId: source.entityId,
      targetNoteId: target.entityId,
      syncStatus: 'synced',
    });
    expect(
      await new LinkRepository(storage, outbox).getBacklinks(target.entityId),
    ).toMatchObject([{ id: source.entityId }]);
  });
  it('removes accepted operations and marks notes synced', async () => {
    const noteId = await noteRepository.create({ title: 'Queued note' });
    const engine = createEngine(new FakeSyncTransport());

    await engine.sync();

    expect(await outbox.countPending()).toBe(0);
    expect(await storage.notes.get(noteId)).toMatchObject({
      version: 1,
      syncStatus: 'synced',
    });
  });

  it('keeps failed operations for retry', async () => {
    const noteId = await noteRepository.create();
    const transport: SyncTransport = {
      push: vi.fn().mockRejectedValue(new Error('Temporary outage')),
      pull: vi.fn(),
    };
    const engine = createEngine(transport);

    await engine.sync();

    const [operation] = await outbox.listForEntity(noteId);
    expect(operation).toMatchObject({
      status: 'failed',
      retryCount: 1,
      lastError: { code: 'transport_error', retryable: true },
    });
    expect(operation.nextRetryAt).toBeDefined();
    expect(engine.getStatus()).toBe('error');
  });

  it('preserves local note content when the server reports a conflict', async () => {
    const localNote = {
      ...createNote('conflicted-note'),
      content: 'Keep this local edit',
      version: 1,
      syncStatus: 'synced' as const,
    };
    await storage.notes.add(localNote);
    await noteRepository.update(localNote.id, {
      content: 'Keep this newer local edit',
    });

    const remoteNote = {
      ...localNote,
      content: 'Remote edit',
      version: 2,
    };
    const remoteChange = {
      entityId: localNote.id,
      entityType: 'note' as const,
      operation: 'update' as const,
      version: 2,
      payload: remoteNote,
      changedAt: '2026-01-01T00:01:00.000Z',
    };
    const transport: SyncTransport = {
      push: vi.fn(async (operations) =>
        operations.map((operation: SyncOperation) => ({
          operationId: operation.id,
          status: 'conflict' as const,
          error: {
            code: 'version_conflict',
            message: 'Stale version',
            retryable: false,
          },
          remoteChange,
        })),
      ),
      pull: vi.fn().mockResolvedValue({
        changes: [remoteChange],
        cursor: '1',
      }),
    };

    await createEngine(transport).sync();

    const conflictedNote = await storage.notes.get(localNote.id);

    expect(conflictedNote).toMatchObject({
      content: 'Keep this newer local edit',
      syncStatus: 'conflict',
    });
    expect(conflictedNote?.conflict).toBeUndefined();

    const openConflicts = await conflictRepository.listOpen();
    expect(openConflicts).toHaveLength(1);
    expect(openConflicts[0]).toMatchObject({
      entityType: 'note',
      entityId: localNote.id,
      conflictType: 'content',
      status: 'open',
      remoteSnapshot: {
        version: 2,
        operation: 'update',
        entity: { content: 'Remote edit' },
      },
      localSnapshot: { entity: { content: 'Keep this newer local edit' } },
    });
  });

  it('advances the pull cursor only after every change applies', async () => {
    let pullResult: PullResult = {
      cursor: '1',
      changes: [
        {
          entityId: 'remote-note',
          entityType: 'note',
          operation: 'create',
          version: 1,
          payload: { invalid: true },
          changedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const transport: SyncTransport = {
      push: vi.fn().mockResolvedValue([]),
      pull: vi.fn(async () => pullResult),
    };
    const engine = createEngine(transport);

    await engine.sync();
    expect(await syncState.getCursor()).toBeUndefined();

    pullResult = {
      cursor: '1',
      changes: [
        {
          entityId: 'remote-note',
          entityType: 'note',
          operation: 'create',
          version: 1,
          payload: createNote('remote-note'),
          changedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };

    await engine.sync();
    expect(await syncState.getCursor()).toBe('1');
    expect(await storage.notes.get('remote-note')).toMatchObject({
      title: 'Test note',
      syncStatus: 'synced',
    });
  });

  it('shares one active execution across concurrent sync calls', async () => {
    await noteRepository.create();
    let releasePush: (results: PushOperationResult[]) => void = () => undefined;
    const push = vi.fn(
      (_operations: SyncOperation[]) =>
        new Promise<PushOperationResult[]>((resolve) => {
          releasePush = resolve;
        }),
    );
    const transport: SyncTransport = {
      push,
      pull: vi.fn().mockResolvedValue({ changes: [], cursor: '0' }),
    };
    const engine = createEngine(transport);

    const first = engine.sync();
    const second = engine.sync();

    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(second).toBe(first);

    const pushedOperations = push.mock.calls.at(0)?.[0];

    if (!pushedOperations) {
      throw new Error('Expected one push call.');
    }

    const pushedOperation = pushedOperations[0];
    releasePush([
      {
        operationId: pushedOperation.id,
        status: 'accepted',
        entityId: pushedOperation.entityId,
        entityType: 'note',
        version: 1,
      },
    ]);

    await Promise.all([first, second]);
    expect(push).toHaveBeenCalledTimes(1);
  });
});

function createEngine(transport: SyncTransport): SyncEngine {
  return new SyncEngine(
    {
      transport,
      storage,
      outbox,
      syncState,
      conflicts: conflictRepository,
      buildConflictSnapshots: (input) => conflictService.buildSnapshots(input),
      getAuthState: () => authStore.getState(),
    },
    {
      isOnline: () => true,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    },
  );
}

function createOperation(
  id: string,
  entityId = 'note-1',
): SyncOperation<NoteRecord> {
  return {
    id,
    entityId,
    entityType: 'note',
    operation: 'create',
    baseVersion: 0,
    payload: createNote(entityId),
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function createNote(id: string): NoteRecord {
  return {
    id,
    title: 'Test note',
    content: '',
    categoryId: null,
    templateType: 'MARKDOWN',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 0,
    syncStatus: 'pending',
  };
}

function createCategoryOperation(
  id: string,
  entityId = 'category-1',
): SyncOperation<CategoryRecord> {
  return {
    id,
    entityId,
    entityType: 'category',
    operation: 'create',
    baseVersion: 0,
    payload: {
      id: entityId,
      name: 'Category',
      description: '',
      icon: null,
      parentId: null,
      position: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 0,
      deletedAt: null,
      syncStatus: 'pending',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function createLinkOperation(id: string): SyncOperation<NoteLinkRecord> {
  return {
    id,
    entityId: 'link-1',
    entityType: 'link',
    operation: 'create',
    baseVersion: 0,
    payload: {
      id: 'link-1',
      sourceNoteId: 'note-1',
      targetNoteId: 'note-2',
      targetTitle: 'Target',
      createdAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      version: 0,
      syncStatus: 'pending',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
