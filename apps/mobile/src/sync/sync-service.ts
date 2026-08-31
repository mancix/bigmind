import { conflictService, SyncEngine } from '@bigmind/sync';
import { authStore } from '../features/auth/auth-store';
import { mobileOutbox, mobileSyncState } from '../features/data/repositories';
import { storage } from '../storage';
import { createMobileHttpTransport } from './transport';
import { createMobileSyncConflictSink } from './conflicts';

/**
 * Mobile sync engine: the SAME platform-independent engine used by the web
 * app (see apps/web/src/sync/sync-service.ts), wired with the mobile storage
 * adapter (SqliteStorageAdapter via the storage provider; memory in tests),
 * the shared outbox/sync-state repositories, the shared conflict classifier,
 * and the mobile auth store.
 *
 * Real-time triggering is handled by `startMobileSyncSupervisor()` (AppState
 * + NetInfo). Activated by `SyncActivator` while signed in: the initial
 * pull brings server data (e.g. categories created on the web) to the device.
 */
export function createMobileSyncEngine(): SyncEngine {
  return new SyncEngine(
    {
      transport: createMobileHttpTransport(),
      storage,
      outbox: mobileOutbox,
      syncState: mobileSyncState,
      conflicts: createMobileSyncConflictSink(),
      buildConflictSnapshots: (input) => conflictService.buildSnapshots(input),
      getAuthState: () => authStore.getState(),
    },
    {
      // Connectivity transitions are pushed via engine.setOnline() from the
      // supervisor (the same pattern the web SyncConnectivity uses).
      isOnline: () => true,
    },
  );
}

export const mobileSyncEngine = createMobileSyncEngine();
