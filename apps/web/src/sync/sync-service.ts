import { SyncEngine } from '@bigmind/sync';
import { authStore } from '../features/auth/auth-store';
import { conflictRepository } from '../features/conflicts/conflict-repository';
import { conflictService } from '../features/conflicts/conflict-service';
import { storage } from '../storage';
import { createSyncTransport } from './create-sync-transport';
import { outboxRepository } from './outbox-repository';
import { syncStateRepository } from './sync-state-repository';

export const syncTransport = createSyncTransport();

/**
 * Web sync engine: the platform-independent engine from `@bigmind/sync`
 * wired with web adapters (Dexie storage, web repositories, auth store,
 * and the configured transport).
 */
export const syncEngine = new SyncEngine(
  {
    transport: syncTransport,
    storage,
    outbox: outboxRepository,
    syncState: syncStateRepository,
    conflicts: conflictRepository,
    buildConflictSnapshots: (input) => conflictService.buildSnapshots(input),
    getAuthState: () => authStore.getState(),
  },
  {
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
  },
);
