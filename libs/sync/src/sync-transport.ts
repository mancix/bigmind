import type {
  PullResult,
  PushOperationResult,
  SyncOperation,
} from './sync-types.js';

/**
 * Platform-agnostic transport contract for the sync engine.
 *
 * `HttpSyncTransport` (web) and any future mobile transport implement this
 * interface. The engine only depends on this abstraction, so the same engine
 * logic can run on the web, on React Native, and in tests (fake transport).
 */
export interface SyncTransport {
  push(
    operations: SyncOperation[],
    signal?: AbortSignal,
  ): Promise<PushOperationResult[]>;
  pull(cursor?: string, signal?: AbortSignal): Promise<PullResult>;
}
