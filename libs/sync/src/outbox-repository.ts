import type { StorageAdapter, OutboxRecord } from '@bigmind/storage';
import type { SyncError } from './sync-types.js';

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Outbox persistence shared by every platform.
 *
 * Implemented purely over the {@link StorageAdapter} abstraction — no browser
 * or native APIs. Web and mobile construct it with their own storage adapter
 * (Dexie / in-memory / future SQLite).
 */
export class OutboxRepository {
  constructor(private readonly storage: StorageAdapter) {}

  async transactionWithNotes<T>(callback: () => Promise<T>): Promise<T> {
    return this.storage.transaction(callback);
  }

  async transactionWithNoteGraph<T>(callback: () => Promise<T>): Promise<T> {
    return this.storage.transaction(callback);
  }

  async transactionWithCategories<T>(callback: () => Promise<T>): Promise<T> {
    return this.storage.transaction(callback);
  }

  async transactionWithTodos<T>(callback: () => Promise<T>): Promise<T> {
    return this.storage.transaction(callback);
  }

  async transactionWithEntities<T>(callback: () => Promise<T>): Promise<T> {
    return this.storage.transaction(callback);
  }

  async transactionWithReminders<T>(callback: () => Promise<T>): Promise<T> {
    return this.storage.transaction(callback);
  }

  async transactionWithNotesAndSyncState<T>(
    callback: () => Promise<T>,
  ): Promise<T> {
    return this.storage.transaction(callback);
  }

  async transactionWithEntitiesAndSyncState<T>(
    callback: () => Promise<T>,
  ): Promise<T> {
    return this.storage.transaction(callback);
  }

  async get(operationId: string): Promise<OutboxRecord | undefined> {
    return this.storage.outbox.get(operationId);
  }

  async listPending(now = new Date()): Promise<OutboxRecord[]> {
    const nowValue = now.toISOString();
    const operations = await this.storage.outbox
      .where('status')
      .anyOf('pending', 'failed')
      .toArray();

    return operations
      .filter(
        (operation) =>
          operation.status === 'pending' ||
          (operation.lastError?.retryable !== false &&
            (!operation.nextRetryAt || operation.nextRetryAt <= nowValue)),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listForEntity(
    entityId: string,
    entityType?: OutboxRecord['entityType'],
  ): Promise<OutboxRecord[]> {
    const operations = await this.storage.outbox
      .where('entityId')
      .equals(entityId)
      .toArray();
    return entityType
      ? operations.filter((operation) => operation.entityType === entityType)
      : operations;
  }

  async add(operation: OutboxRecord): Promise<void> {
    await this.storage.outbox.add(operation);
  }

  async save(operation: OutboxRecord): Promise<void> {
    await this.storage.outbox.put(operation);
  }

  async remove(operationId: string): Promise<void> {
    await this.storage.outbox.delete(operationId);
  }

  async removeMany(operationIds: string[]): Promise<void> {
    await this.storage.outbox.bulkDelete(operationIds);
  }

  async markProcessing(
    operationIds: string[],
    startedAt = new Date(),
  ): Promise<void> {
    const processingStartedAt = startedAt.toISOString();

    await this.storage.outbox.where('id').anyOf(operationIds).modify({
      status: 'processing',
      processingStartedAt,
      lastError: undefined,
    });
  }

  async markCompleted(operationId: string, remove = true): Promise<void> {
    if (remove) {
      await this.remove(operationId);
      return;
    }

    await this.storage.outbox.update(operationId, {
      status: 'completed',
      processingStartedAt: undefined,
      nextRetryAt: undefined,
      lastError: undefined,
    });
  }

  async markFailed(
    operationId: string,
    error: SyncError,
    nextRetryAt?: Date,
  ): Promise<void> {
    await this.storage.outbox.update(operationId, {
      status: 'failed',
      processingStartedAt: undefined,
      lastError: error,
      nextRetryAt: nextRetryAt?.toISOString(),
    });
  }

  async incrementRetryCount(operationId: string): Promise<number> {
    const operation = await this.storage.outbox.get(operationId);

    if (!operation) {
      return 0;
    }

    const retryCount = operation.retryCount + 1;
    await this.storage.outbox.update(operationId, { retryCount });
    return retryCount;
  }

  async resetStaleProcessing(
    now = new Date(),
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
  ): Promise<number> {
    const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();

    return this.storage.outbox
      .where('status')
      .equals('processing')
      .filter(
        (operation) =>
          !operation.processingStartedAt ||
          operation.processingStartedAt <= staleBefore,
      )
      .modify({
        status: 'pending',
        processingStartedAt: undefined,
      });
  }

  async countPending(): Promise<number> {
    return this.storage.outbox
      .where('status')
      .anyOf('pending', 'processing', 'failed')
      .count();
  }
}
