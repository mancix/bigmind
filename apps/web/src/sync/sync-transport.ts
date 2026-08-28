import type {
  PullResult,
  PushOperationResult,
  SyncOperation,
} from './sync.types';

export interface SyncTransport {
  push(
    operations: SyncOperation[],
    signal?: AbortSignal,
  ): Promise<PushOperationResult[]>;
  pull(cursor?: string, signal?: AbortSignal): Promise<PullResult>;
}
