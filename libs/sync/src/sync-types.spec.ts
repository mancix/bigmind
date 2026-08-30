import { describe, expect, it } from 'vitest';

import type {
  PushOperationResult,
  RemoteChange,
  SyncOperation,
} from './sync-types.js';

describe('sync protocol types', () => {
  it('carries push operations with an entity type from the domain', () => {
    const operation: SyncOperation = {
      id: '11111111-1111-4111-8111-111111111111',
      entityId: '22222222-2222-4222-8222-222222222222',
      entityType: 'note',
      operation: 'update',
      baseVersion: 3,
      payload: { title: 'Hello' },
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    expect(operation.entityType).toBe('note');
    expect(operation.operation).toBe('update');
  });

  it('distinguishes remote changes from push operations', () => {
    const change: RemoteChange = {
      entityId: '22222222-2222-4222-8222-222222222222',
      entityType: 'category',
      operation: 'delete',
      version: 4,
      payload: { name: 'Archive' },
      changedAt: '2025-01-01T00:00:00.000Z',
    };

    expect(change.operation).toBe('delete');
    expect(change.version).toBe(4);
  });

  it('models accepted push results with the server version', () => {
    const result: PushOperationResult = {
      operationId: '11111111-1111-4111-8111-111111111111',
      status: 'accepted',
      entityId: '22222222-2222-4222-8222-222222222222',
      entityType: 'note',
      version: 5,
    };

    expect(result.status).toBe('accepted');
  });
});
