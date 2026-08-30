import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryStorage } from '@bigmind/storage';
import { authStore } from '../features/auth/auth-store';
import {
  SyncEngine,
  type ConflictSink,
  type SyncEngineDependencies,
  type SyncEngineOptions,
  type SyncOutbox,
  type SyncStateStore,
} from './sync-engine';
import type { SyncTransport } from './sync-transport';
import type { SyncStatus } from './sync.types';
import type { OutboxRecord } from '../storage';

const mockStorage = vi.hoisted(() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
});

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    writable: true,
  });
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    writable: true,
  });
});

function mockOutbox(): SyncOutbox {
  const pending: OutboxRecord[] = [];
  return {
    resetStaleProcessing: vi.fn().mockResolvedValue(undefined),
    listPending: vi.fn().mockResolvedValue(pending),
    markProcessing: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(undefined),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    listForEntity: vi.fn().mockResolvedValue([]),
    incrementRetryCount: vi.fn().mockResolvedValue(0),
    add: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    removeMany: vi.fn().mockResolvedValue(undefined),
    countPending: vi.fn().mockResolvedValue(0),
    transactionWithEntities: vi
      .fn()
      .mockImplementation((cb: () => Promise<void>) => cb()),
    transactionWithEntitiesAndSyncState: vi
      .fn()
      .mockImplementation((cb: () => Promise<void>) => cb()),
    transactionWithNotes: vi
      .fn()
      .mockImplementation((cb: () => Promise<void>) => cb()),
    transactionWithNoteGraph: vi
      .fn()
      .mockImplementation((cb: () => Promise<void>) => cb()),
    transactionWithCategories: vi
      .fn()
      .mockImplementation((cb: () => Promise<void>) => cb()),
    transactionWithTodos: vi
      .fn()
      .mockImplementation((cb: () => Promise<void>) => cb()),
    transactionWithReminders: vi
      .fn()
      .mockImplementation((cb: () => Promise<void>) => cb()),
    transactionWithNotesAndSyncState: vi
      .fn()
      .mockImplementation((cb: () => Promise<void>) => cb()),
  };
}

function mockSyncState(): SyncStateStore {
  return {
    getCursor: vi.fn().mockResolvedValue('0'),
    recordSuccessfulSync: vi.fn().mockResolvedValue(undefined),
  };
}

function mockConflicts(): ConflictSink {
  return {
    create: vi.fn().mockResolvedValue(undefined),
  };
}

function mockConflictSnapshots() {
  return vi.fn().mockReturnValue({
    conflictType: 'generic',
    localVersion: 1,
    remoteVersion: 2,
    localSnapshot: {},
    remoteSnapshot: {},
    baseVersion: 0,
  });
}

describe('SyncEngine auth integration', () => {
  let engine: SyncEngine;
  let transport: SyncTransport;
  let statusHistory: SyncStatus[];

  function createEngine(
    deps: Partial<SyncEngineDependencies> = {},
    options: SyncEngineOptions = {},
  ): SyncEngine {
    return new SyncEngine(
      {
        transport,
        storage: createInMemoryStorage(),
        outbox: mockOutbox(),
        syncState: mockSyncState(),
        conflicts: mockConflicts(),
        buildConflictSnapshots: mockConflictSnapshots(),
        getAuthState: () => authStore.getState(),
        ...deps,
      },
      {
        now: () => new Date('2026-01-01T00:00:00.000Z'),
        isOnline: () => true,
        backoffBaseMs: 1_000,
        ...options,
      },
    );
  }

  beforeEach(() => {
    mockStorage.clear();
    authStore['accessToken'] = null;
    authStore['refreshToken'] = null;
    authStore['user'] = null;
    authStore['state'] = 'unauthenticated';

    statusHistory = [];

    transport = {
      push: vi.fn().mockResolvedValue([]),
      pull: vi.fn().mockResolvedValue({ changes: [], cursor: '0' }),
    };

    engine = createEngine();
    engine.subscribe((status) => {
      statusHistory.push(status);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs normally when authenticated', async () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });

    await engine.sync();

    expect(transport.pull).toHaveBeenCalled();
    expect(statusHistory).toContain('idle');
  });

  it('sets auth_required status when auth state is auth_required before sync', async () => {
    authStore['state'] = 'auth_required';

    await engine.sync();

    expect(transport.pull).not.toHaveBeenCalled();
    expect(statusHistory).toContain('auth_required');
  });

  it('sets status to auth_required when transport fails and auth store is auth_required', async () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    transport.push = vi.fn().mockRejectedValue(new Error('push failed'));
    authStore['state'] = 'auth_required';

    await engine.sync();

    expect(statusHistory).toContain('auth_required');
    expect(statusHistory).not.toContain('syncing');
  });

  it('does not set auth_required on generic transport errors', async () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    transport.push = vi.fn().mockRejectedValue(new Error('Network timeout'));

    await engine.sync();

    expect(statusHistory).not.toContain('auth_required');
  });

  it('transitions from auth_required to syncing after re-authentication', async () => {
    authStore['state'] = 'auth_required';
    await engine.sync();
    expect(statusHistory).toContain('auth_required');

    authStore.setTokens('new-access', 'new-refresh', {
      id: 'u1',
      email: 'a@b.com',
    });
    vi.mocked(transport.pull).mockClear();
    statusHistory.length = 0;

    await engine.sync();

    expect(transport.pull).toHaveBeenCalled();
    expect(statusHistory).toContain('idle');
  });

  it('sets offline status when not online', async () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });

    engine = createEngine({}, { isOnline: () => false });
    engine.subscribe((status) => {
      statusHistory.push(status);
    });

    await engine.sync();

    expect(transport.pull).not.toHaveBeenCalled();
    expect(statusHistory).toContain('offline');
  });

  it('keeps offline and auth_required as separate statuses', async () => {
    authStore['state'] = 'auth_required';
    await engine.sync();

    expect(statusHistory).toContain('auth_required');
    expect(statusHistory).not.toContain('offline');
  });

  it('calls failAuthOperations instead of failStillProcessing on auth error', async () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    transport.push = vi.fn().mockRejectedValue(new Error('Auth fail'));
    authStore['state'] = 'auth_required';

    await engine.sync();

    expect(statusHistory).toContain('auth_required');
  });
});
