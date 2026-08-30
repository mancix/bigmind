/**
 * Sync protocol primitives shared by the storage layer, contracts, and the
 * sync engine. Kept in the domain so platform libs (`storage`, `sync`,
 * `contracts`) never form a cycle.
 */

export interface SyncError {
  code: string;
  message: string;
  retryable: boolean;
}

/** A server-side change delivered by `pull`, identified by an opaque cursor. */
export interface RemoteChange<TPayload = unknown> {
  entityId: string;
  entityType: import('./sync-operation.js').SyncEntityType;
  operation: import('./sync-operation.js').SyncOperationType;
  version: number;
  payload: TPayload;
  changedAt: string;
}
