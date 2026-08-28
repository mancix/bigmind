import type { SyncEntityType, SyncOperationType } from '@bigmind/domain/sync';

export type { SyncEntityType, SyncOperationType } from '@bigmind/domain/sync';

export interface SyncOperation<TPayload = unknown> {
  id: string;
  entityId: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  baseVersion: number;
  payload: TPayload;
  createdAt: string;
}

export interface SyncError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface RemoteChange<TPayload = unknown> {
  entityId: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  version: number;
  payload: TPayload;
  changedAt: string;
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

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'auth_required' | 'error';
