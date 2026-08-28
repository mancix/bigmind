type SyncRequestListener = () => void;

const listeners = new Set<SyncRequestListener>();

export function requestBackgroundSync(): void {
  for (const listener of listeners) listener();
}

export function subscribeToBackgroundSyncRequests(
  listener: SyncRequestListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
