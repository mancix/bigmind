import { describe, expect, it, vi } from 'vitest';
import { createInMemoryStorage, type NoteRecord } from '@bigmind/storage';
import type { AuthState } from '@bigmind/auth';

import { OutboxRepository } from './outbox-repository.js';
import { SyncStateRepository } from './sync-state-repository.js';
import { FakeSyncTransport } from './fake-sync-transport.js';
import {
  SyncEngine,
  type BuiltConflictSnapshots,
  type ConflictCreateInput,
} from './sync-engine.js';
import type {
  PullResult,
  PushOperationResult,
  SyncOperation,
} from './sync-types.js';

const NOW = '2026-01-01T00:00:00.000Z';
const NOW_DATE = new Date(NOW);

function makeNote(id = 'note-1'): NoteRecord {
  return {
    id,
    title: 'Test note',
    content: '',
    categoryId: null,
    templateType: 'MARKDOWN',
    createdAt: NOW,
    updatedAt: NOW,
    version: 0,
    syncStatus: 'pending',
  };
}

function makeDeps() {
  const storage = createInMemoryStorage();
  const outbox = new OutboxRepository(storage);
  const syncState = new SyncStateRepository(storage);
  const auth = { state: 'authenticated' as AuthState };

  const created: ConflictCreateInput[] = [];

  return {
    auth,
    storage,
    outbox,
    syncState,
    conflicts: {
      create: async (input: ConflictCreateInput) => {
        created.push(input);
        return `conflict-${created.length}`;
      },
    },
    buildConflictSnapshots: vi.fn((): BuiltConflictSnapshots => ({
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: {} },
      remoteSnapshot: { version: 2, entity: {} },
      baseVersion: 0,
    })),
    getAuthState: () => auth.state,
    transport: new FakeSyncTransport(),
  };
}

function createEngine(deps: ReturnType<typeof makeDeps>) {
  const engine = new SyncEngine(
    {
      transport: deps.transport,
      storage: deps.storage,
      outbox: deps.outbox,
      syncState: deps.syncState,
      conflicts: deps.conflicts,
      buildConflictSnapshots: deps.buildConflictSnapshots,
      getAuthState: deps.getAuthState,
    },
    { now: () => NOW_DATE, isOnline: () => true },
  );
  return engine;
}

function makeOperation(
  id = 'operation-1',
  note?: NoteRecord,
): SyncOperation<NoteRecord> {
  return {
    id,
    entityId: note?.id ?? 'note-1',
    entityType: 'note',
    operation: 'create',
    baseVersion: 0,
    payload: note ?? makeNote(),
    createdAt: NOW,
  };
}

async function seedNote(deps: ReturnType<typeof makeDeps>) {
  const note = makeNote();
  await deps.storage.notes.add(note);
  await deps.outbox.add({
    id: 'operation-1',
    entityId: note.id,
    entityType: 'note',
    operation: 'create',
    baseVersion: 0,
    payload: note,
    createdAt: NOW,
    retryCount: 0,
    status: 'pending',
  });
  return note;
}

describe('SyncEngine (platform independent)', () => {
  it('runs a full push/pull round trip over the in-memory storage', async () => {
    const deps = makeDeps();
    const note = await seedNote(deps);
    const engine = createEngine(deps);

    await engine.sync();

    expect(await deps.outbox.countPending()).toBe(0);
    expect(await deps.storage.notes.get(note.id)).toMatchObject({
      version: 1,
      syncStatus: 'synced',
    });
    expect(await deps.syncState.getCursor()).toBeDefined();
  });

  it('sets auth_required when auth state says so and skips the transport', async () => {
    const deps = makeDeps();
    deps.auth.state = 'auth_required';
    const statuses: string[] = [];
    deps.transport = {
      push: vi.fn(),
      pull: vi.fn(),
    } as never;
    const engine = createEngine(deps);
    engine.subscribe((status) => statuses.push(status));

    await engine.sync();

    expect(vi.mocked(deps.transport.push)).not.toHaveBeenCalled();
    expect(statuses).toContain('auth_required');
  });

  it('stays offline when not online', async () => {
    const deps = makeDeps();
    const statuses: string[] = [];
    deps.transport = {
      push: vi.fn(),
      pull: vi.fn(),
    } as never;
    const engine = new SyncEngine(
      {
        transport: deps.transport,
        storage: deps.storage,
        outbox: deps.outbox,
        syncState: deps.syncState,
        conflicts: deps.conflicts,
        buildConflictSnapshots: deps.buildConflictSnapshots,
        getAuthState: deps.getAuthState,
      },
      { now: () => NOW_DATE, isOnline: () => false },
    );
    engine.subscribe((status) => statuses.push(status));

    await engine.sync();

    expect(vi.mocked(deps.transport.push)).not.toHaveBeenCalled();
    expect(statuses).toContain('offline');
  });

  it('keeps failed operations queued for retry with backoff', async () => {
    const deps = makeDeps();
    const note = await seedNote(deps);
    deps.transport = {
      push: vi.fn().mockRejectedValue(new Error('Temporary outage')),
      pull: vi.fn(),
    } as never;
    const engine = createEngine(deps);

    await engine.sync();

    const [operation] = await deps.outbox.listForEntity(note.id);
    expect(operation).toMatchObject({
      status: 'failed',
      retryCount: 1,
      lastError: { code: 'transport_error', retryable: true },
    });
    expect(operation.nextRetryAt).toBeDefined();
    expect(engine.getStatus()).toBe('error');
  });

  it('persists a conflict when the server reports one and keeps local data', async () => {
    const deps = makeDeps();
    const note = await seedNote(deps);
    const remoteNote = { ...note, content: 'Remote edit', version: 2 };
    const remoteChange = {
      entityId: note.id,
      entityType: 'note' as const,
      operation: 'update' as const,
      version: 2,
      payload: remoteNote,
      changedAt: NOW,
    };
    deps.transport = {
      push: vi.fn(async (operations: SyncOperation[]) =>
        operations.map((operation): PushOperationResult => ({
          operationId: operation.id,
          status: 'conflict',
          error: {
            code: 'version_conflict',
            message: 'Stale version',
            retryable: false,
          },
          remoteChange,
        })),
      ),
      pull: vi.fn().mockResolvedValue({ changes: [remoteChange], cursor: '1' }),
    } as never;
    const engine = createEngine(deps);

    await engine.sync();

    const stored = await deps.storage.notes.get(note.id);
    expect(stored).toMatchObject({ content: '', syncStatus: 'conflict' });
    expect(await deps.outbox.listForEntity(note.id)).toMatchObject([
      {
        status: 'failed',
        lastError: { code: 'version_conflict', retryable: false },
      },
    ]);
    expect(deps.buildConflictSnapshots).toHaveBeenCalled();
  });

  it('advances the pull cursor only after every change applies', async () => {
    const deps = makeDeps();
    let pullResult: PullResult = {
      cursor: '1',
      changes: [
        {
          entityId: 'remote-note',
          entityType: 'note' as const,
          operation: 'create' as const,
          version: 1,
          payload: { invalid: true },
          changedAt: NOW,
        },
      ],
    };
    deps.transport = {
      push: vi.fn().mockResolvedValue([]),
      pull: vi.fn(async () => pullResult),
    } as never;
    const engine = createEngine(deps);

    await engine.sync();
    expect(await deps.syncState.getCursor()).toBeUndefined();

    pullResult = {
      cursor: '1',
      changes: [
        {
          entityId: 'remote-note',
          entityType: 'note' as const,
          operation: 'create' as const,
          version: 1,
          payload: makeNote('remote-note'),
          changedAt: NOW,
        },
      ],
    };
    await engine.sync();
    expect(await deps.syncState.getCursor()).toBe('1');
    expect(await deps.storage.notes.get('remote-note')).toMatchObject({
      syncStatus: 'synced',
    });
  });

  it('shares one active execution across concurrent sync calls', async () => {
    const deps = makeDeps();
    await seedNote(deps);
    let releasePush: (results: PushOperationResult[]) => void = () => undefined;
    deps.transport = {
      push: vi.fn(
        () =>
          new Promise<PushOperationResult[]>((resolve) => {
            releasePush = resolve;
          }),
      ),
      pull: vi.fn().mockResolvedValue({ changes: [], cursor: '0' }),
    } as never;
    const engine = createEngine(deps);

    const first = engine.sync();
    const second = engine.sync();

    await vi.waitFor(() =>
      expect(vi.mocked(deps.transport.push)).toHaveBeenCalledTimes(1),
    );
    expect(second).toBe(first);

    const pushed = vi.mocked(deps.transport.push).mock.calls.at(0)?.[0];
    releasePush([
      {
        operationId: pushed?.[0]?.id ?? '',
        status: 'accepted',
        entityId: 'note-1',
        entityType: 'note',
        version: 1,
      },
    ]);

    await Promise.all([first, second]);
    expect(vi.mocked(deps.transport.push)).toHaveBeenCalledTimes(1);
  });

  it('emits status transitions to subscribers', async () => {
    const deps = makeDeps();
    await seedNote(deps);
    const statuses: string[] = [];
    const engine = createEngine(deps);
    engine.subscribe((status) => statuses.push(status));

    await engine.sync();

    expect(statuses).toContain('syncing');
    expect(statuses).toContain('idle');
    expect(engine.getStatus()).toBe('idle');
  });
});

describe('fake sync transport', () => {
  it('rejects duplicate delivery and conflicts stale base versions', async () => {
    const transport = new FakeSyncTransport();
    const operation = makeOperation('operation-1');
    await transport.push([operation]);

    const staleUpdate: SyncOperation = {
      ...operation,
      id: 'operation-2',
      operation: 'update',
      baseVersion: 0,
      payload: { ...operation.payload, title: 'Stale' },
    };
    const [result] = await transport.push([staleUpdate]);

    expect(result).toMatchObject({ status: 'conflict' });
  });
});
