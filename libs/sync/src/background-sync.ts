/**
 * Background sync request bus.
 *
 * Repositories signal "local data changed, please sync soon" through
 * `requestBackgroundSync()`. The platform supervisor (web
 * `SyncConnectivity`, mobile `startMobileSyncSupervisor`) subscribes and maps
 * these requests onto the shared {@link SyncScheduler}.
 *
 * Exported by `@bigmind/sync`; web code keeps importing it from its local
 * `background-sync.ts` re-export module.
 */
export type SyncRequestListener = () => void;

const listeners = new Set<SyncRequestListener>();

export function requestBackgroundSync(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToBackgroundSyncRequests(
  listener: SyncRequestListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
