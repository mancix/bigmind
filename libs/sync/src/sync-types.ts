import type {
  RemoteChange,
  SyncEntityType,
  SyncError,
  SyncOperationType,
} from '@bigmind/domain/sync';

export type { SyncEntityType, SyncOperationType } from '@bigmind/domain/sync';
// Protocol primitives shared with the contracts and storage layers; defined
// in @bigmind/domain to keep the sync engine free of dependency cycles.
export type { RemoteChange, SyncError } from '@bigmind/domain/sync';

/**
 * A single outbox operation queued for push to the server.
 *
 * `operation` mirrors the transport-level `operationType` field exposed by
 * {@link @bigmind/contracts}, but keeps the engine-level vocabulary (`create`,
 * `update`, `delete`) used by the sync engine and the local storage layer.
 */
export interface SyncOperation<TPayload = unknown> {
  id: string;
  entityId: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  baseVersion: number;
  payload: TPayload;
  createdAt: string;
}

export type PushOperationResult =
  | {
      operationId: string;
      status: 'accepted';
      entityId: string;
      entityType: SyncEntityType;
      version: number;
    }
  | {
      operationId: string;
      status: 'rejected';
      error: SyncError;
    }
  | {
      operationId: string;
      status: 'conflict';
      error: SyncError;
      remoteChange?: RemoteChange;
    };

export interface PullResult {
  changes: RemoteChange[];
  cursor: string;
}

export type SyncStatus =
  'idle' | 'syncing' | 'offline' | 'auth_required' | 'error';
