import type {
  CategoryRecord,
  NoteLinkRecord,
  NoteRecord,
  SyncRecord,
} from '../storage/database';
import type { SyncTransport } from './sync-transport';
import type {
  PullResult,
  PushOperationResult,
  RemoteChange,
  SyncOperation,
} from './sync.types';

interface ServerRecord {
  record: SyncRecord;
  version: number;
  deleted: boolean;
}

export class FakeSyncTransport implements SyncTransport {
  private readonly records: Record<string, Map<string, ServerRecord>> = {
    note: new Map<string, ServerRecord>(),
    category: new Map<string, ServerRecord>(),
    link: new Map<string, ServerRecord>(),
    todo_item: new Map<string, ServerRecord>(),
    reminder: new Map<string, ServerRecord>(),
    notification: new Map<string, ServerRecord>(),
  };
  private readonly processedOperations = new Map<
    string,
    PushOperationResult
  >();
  private readonly changes: RemoteChange<SyncRecord>[] = [];

  async push(operations: SyncOperation[]): Promise<PushOperationResult[]> {
    return operations.map((operation) => this.process(operation));
  }

  async pull(cursor?: string): Promise<PullResult> {
    const parsedCursor = Number(cursor ?? '0');
    const start = Number.isInteger(parsedCursor) && parsedCursor >= 0
      ? parsedCursor
      : 0;

    return {
      changes: this.changes.slice(start),
      cursor: String(this.changes.length),
    };
  }

  private process(operation: SyncOperation): PushOperationResult {
    const previousResult = this.processedOperations.get(operation.id);

    if (previousResult) {
      return previousResult;
    }

    if (!isPayload(operation.entityType, operation.payload)) {
      return this.remember(operation.id, {
        operationId: operation.id,
        status: 'rejected',
        error: {
          code: 'invalid_payload',
          message: `The ${operation.entityType} payload is invalid.`,
          retryable: false,
        },
      });
    }

    const current = this.records[operation.entityType].get(operation.entityId);

    if (operation.operation === 'create') {
      if (current && !current.deleted) {
        return this.conflict(operation, current);
      }

      return this.accept(operation, operation.payload, 1, false);
    }

    if (!current || current.deleted || operation.baseVersion !== current.version) {
      return this.conflict(operation, current);
    }

    return this.accept(
      operation,
      operation.payload,
      current.version + 1,
      operation.operation === 'delete',
    );
  }

  private accept(
    operation: SyncOperation,
    record: SyncRecord,
    version: number,
    deleted: boolean,
  ): PushOperationResult {
    const changedAt = new Date().toISOString();
    const versionedRecord: SyncRecord = {
      ...record,
      version,
      syncStatus: 'synced',
      ...(deleted && 'deletedAt' in record ? { deletedAt: record.deletedAt ?? changedAt } : {}),
    };

    this.records[operation.entityType].set(operation.entityId, {
      record: versionedRecord,
      version,
      deleted,
    });
    this.changes.push({
      entityId: operation.entityId,
      entityType: operation.entityType,
      operation: operation.operation,
      version,
      payload: versionedRecord,
      changedAt,
    });

    return this.remember(operation.id, {
      operationId: operation.id,
      status: 'accepted',
      entityId: operation.entityId,
      entityType: operation.entityType,
      version,
    });
  }

  private conflict(
    operation: SyncOperation,
    current?: ServerRecord,
  ): PushOperationResult {
    return this.remember(operation.id, {
      operationId: operation.id,
      status: 'conflict',
      error: {
        code: 'version_conflict',
        message: `The server ${operation.entityType} has changed since the local edit.`,
        retryable: false,
      },
      remoteChange: current
        ? {
            entityId: operation.entityId,
            entityType: operation.entityType,
            operation: current.deleted ? 'delete' : 'update',
            version: current.version,
            payload: current.record,
            changedAt: 'updatedAt' in current.record
              ? current.record.updatedAt
              : current.record.createdAt,
          }
        : undefined,
    });
  }

  private remember(
    operationId: string,
    result: PushOperationResult,
  ): PushOperationResult {
    this.processedOperations.set(operationId, result);
    return result;
  }
}

function isNoteRecord(value: unknown): value is NoteRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const note = value as Partial<NoteRecord>;

  return (
    typeof note.id === 'string' &&
    typeof note.title === 'string' &&
    typeof note.content === 'string' &&
    typeof note.createdAt === 'string' &&
    typeof note.updatedAt === 'string' &&
    typeof note.version === 'number'
  );
}

function isCategoryRecord(value: unknown): value is CategoryRecord {
  if (!value || typeof value !== 'object') return false;
  const category = value as Partial<CategoryRecord>;
  return (
    typeof category.id === 'string' &&
    typeof category.name === 'string' &&
    (category.icon === null || typeof category.icon === 'string') &&
    (category.parentId === null || typeof category.parentId === 'string') &&
    typeof category.position === 'number' &&
    typeof category.createdAt === 'string' &&
    typeof category.updatedAt === 'string' &&
    typeof category.version === 'number'
  );
}

function isNoteLinkRecord(value: unknown): value is NoteLinkRecord {
  if (!value || typeof value !== 'object') return false;
  const link = value as Partial<NoteLinkRecord>;
  return (
    typeof link.id === 'string' &&
    typeof link.sourceNoteId === 'string' &&
    typeof link.targetNoteId === 'string' &&
    typeof link.createdAt === 'string' &&
    typeof link.version === 'number'
  );
}

function isPayload(
  entityType: SyncOperation['entityType'],
  value: unknown,
): value is SyncRecord {
  if (entityType === 'note') return isNoteRecord(value);
  if (entityType === 'category') return isCategoryRecord(value);
  return isNoteLinkRecord(value);
}
