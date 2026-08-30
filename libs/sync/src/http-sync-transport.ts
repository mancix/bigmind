import {
  categoryDataSchema,
  noteLinkDataSchema,
  noteDataSchema,
  syncContract,
  type PushOperationResult as ContractPushResult,
} from '@bigmind/contracts';
import { initClient, type ApiFetcher } from '@ts-rest/core';
import type { AuthState } from '@bigmind/auth';

import type { SyncTransport } from './sync-transport.js';
import type {
  PullResult,
  PushOperationResult,
  RemoteChange,
  SyncOperation,
} from './sync-types.js';

const PULL_PAGE_LIMIT = 100;

export class SyncTransportError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SyncTransportError';
    this.cause = cause;
  }
}

/**
 * Platform-specific auth concerns the HTTP transport needs:
 * - `getHeaders()` supplies `Authorization` and `X-Workspace-Id` for every request.
 * - `refreshAccessToken()` is called on a 401 so the request can be retried.
 *
 * Web wires these to the shared AuthStore + local workspace id; mobile wires
 * them to its own stores.
 */
export interface HttpSyncTransportAuth {
  getHeaders(): Record<string, string>;
  getAuthState(): AuthState;
  refreshAccessToken(): Promise<'ok' | 'network_error' | 'auth_error'>;
}

export interface HttpSyncTransportOptions {
  baseUrl: string;
  auth: HttpSyncTransportAuth;
  /** Optional custom fetch implementation (tests, React Native). */
  api?: ApiFetcher;
}

/**
 * ts-rest based HTTP transport for `/sync/push` and `/sync/pull`.
 * Platform independent: everything browser-specific is injected via
 * {@link HttpSyncTransportOptions.auth}.
 */
export class HttpSyncTransport implements SyncTransport {
  private readonly client;

  constructor(options: HttpSyncTransportOptions) {
    const { baseUrl, api } = options;
    this.client = initClient(syncContract, {
      baseUrl: baseUrl.replace(/\/$/, ''),
      baseHeaders: {},
      throwOnUnknownStatus: true,
      validateResponse: true,
      ...(api ? { api } : {}),
    });
    this.auth = options.auth;
  }

  private readonly auth: HttpSyncTransportAuth;

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
    const auth = this.auth;
    const headers = auth.getHeaders();

    try {
      return await fn(headers);
    } catch (error) {
      if (
        error instanceof SyncTransportError &&
        error.cause === 'unauthorized'
      ) {
        const result = await auth.refreshAccessToken();
        if (result === 'ok') {
          return fn(auth.getHeaders());
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
