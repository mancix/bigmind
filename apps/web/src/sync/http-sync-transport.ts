import {
  categoryDataSchema,
  noteLinkDataSchema,
  noteDataSchema,
  syncContract,
  type PushOperationResult as ContractPushResult,
} from '@bigmind/contracts';
import {
  initClient,
  type ApiFetcher,
} from '@ts-rest/core';

import { authStore } from '../features/auth/auth-store';
import { getStoredWorkspaceId } from '../features/workspaces/workspace-store';
import type { SyncTransport } from './sync-transport';
import type {
  PullResult,
  PushOperationResult,
  RemoteChange,
  SyncOperation,
} from './sync.types';

const PULL_PAGE_LIMIT = 100;

export class SyncTransportError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SyncTransportError';
    this.cause = cause;
  }
}

function authHeaders(): Record<string, string> {
  const token = authStore.getAccessToken();
  const wsId = getStoredWorkspaceId();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(wsId ? { 'X-Workspace-Id': wsId } : {}),
  };
}

export class HttpSyncTransport implements SyncTransport {
  private readonly client;

  constructor(baseUrl: string, api?: ApiFetcher) {
    this.client = initClient(syncContract, {
      baseUrl: baseUrl.replace(/\/$/, ''),
      baseHeaders: {},
      throwOnUnknownStatus: true,
      validateResponse: true,
      ...(api ? { api } : {}),
    });
  }

  async push(
    operations: SyncOperation[],
    signal?: AbortSignal,
  ): Promise<PushOperationResult[]> {
    return this.pushWithRetry(async (headers) => {
      const response = await this.client.push({
        body: {
          operations: operations.map((operation) =>
            operation.entityType === 'note'
              ? {
                  operationId: operation.id,
                  entityId: operation.entityId,
                  entityType: 'note' as const,
                  operationType: operation.operation,
                  baseVersion: operation.baseVersion,
                  payload: noteDataSchema.parse(operation.payload),
                  createdAt: operation.createdAt,
                }
              : operation.entityType === 'category'
                ? {
                  operationId: operation.id,
                  entityId: operation.entityId,
                  entityType: 'category' as const,
                  operationType: operation.operation,
                  baseVersion: operation.baseVersion,
                  payload: categoryDataSchema.parse(operation.payload),
                  createdAt: operation.createdAt,
                }
                : {
                    operationId: operation.id,
                    entityId: operation.entityId,
                    entityType: 'link' as const,
                    operationType: operation.operation as 'create' | 'delete',
                    baseVersion: operation.baseVersion,
                    payload: noteLinkDataSchema.parse(operation.payload),
                    createdAt: operation.createdAt,
                  },
          ),
        },
        extraHeaders: headers,
        fetchOptions: { signal },
      });

      if (response.status !== 200) {
        throw new SyncTransportError(
          `Sync push failed with status ${response.status}.`,
          response.status === 401 ? 'unauthorized' : undefined,
        );
      }

      return response.body.results.map(mapPushResult);
    });
  }

  async pull(cursor?: string, signal?: AbortSignal): Promise<PullResult> {
    const changes: RemoteChange[] = [];
    let nextCursor = parseCursor(cursor);

    return this.pushWithRetry(async (headers) => {
      let hasMore: boolean;

      do {
        const response = await this.client.pull({
          query: {
            cursor: nextCursor,
            limit: PULL_PAGE_LIMIT,
          },
          extraHeaders: headers,
          fetchOptions: { signal },
        });

        if (response.status !== 200) {
          throw new SyncTransportError(
            `Sync pull failed with status ${response.status}.`,
            response.status === 401 ? 'unauthorized' : undefined,
          );
        }

        changes.push(
          ...response.body.changes.map((change) => ({
            entityId: change.entityId,
            entityType: change.entityType,
            operation: change.operationType,
            version: change.version,
            payload: change.payload,
            changedAt: change.changedAt,
          })),
        );
        nextCursor = response.body.nextCursor;
        hasMore = response.body.hasMore;
      } while (hasMore);

      return {
        changes,
        cursor: String(nextCursor),
      };
    });
  }

  private async pushWithRetry<T>(
    fn: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    const headers = authHeaders();

    try {
      return await fn(headers);
    } catch (error) {
      if (
        error instanceof SyncTransportError &&
        error.cause === 'unauthorized'
      ) {
        const result = await authStore.refreshAccessToken();
        if (result === 'ok') {
          return fn(authHeaders());
        }
        throw new SyncTransportError(
          result === 'auth_error'
            ? 'Session expired. Please log in again.'
            : 'Authentication failed. Network may be unavailable.',
          result === 'auth_error' ? 'auth_required' : 'unauthorized',
        );
      }
      throw error;
    }
  }
}

function mapPushResult(result: ContractPushResult): PushOperationResult {
  if (result.status === 'accepted') {
    return {
      operationId: result.operationId,
      status: 'accepted',
      entityId: result.entityId,
      entityType: result.entityType,
      version: result.serverVersion,
    };
  }

  if (result.status === 'rejected') {
    return {
      operationId: result.operationId,
      status: 'rejected',
      error: {
        code: result.errorCode,
        message: result.message,
        retryable: false,
      },
    };
  }

  return {
    operationId: result.operationId,
    status: 'conflict',
    error: {
      code: 'version_conflict',
      message: `The server ${result.entityType} has changed since the local edit.`,
      retryable: false,
    },
    remoteChange: {
      entityId: result.entityId,
      entityType: result.entityType,
      operation: result.currentServerData.deletedAt ? 'delete' : 'update',
      version: result.currentServerVersion,
      payload: result.currentServerData,
      changedAt: result.currentServerData.updatedAt,
    },
  };
}

function parseCursor(cursor?: string): number {
  const parsed = Number(cursor ?? '0');
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
