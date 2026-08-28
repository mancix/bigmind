import { db, type OutboxRecord } from '../storage/database';
import type { SyncError } from './sync.types';

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

export class OutboxRepository {
  async transactionWithNotes<T>(callback: () => Promise<T>): Promise<T> {
    return db.transaction('rw', db.notes, db.outbox, db.conflicts, callback);
  }

  async transactionWithNoteGraph<T>(callback: () => Promise<T>): Promise<T> {
    return db.transaction(
      'rw',
      db.notes,
      db.noteLinks,
      db.noteAliases,
      db.outbox,
      db.conflicts,
      callback,
    );
  }

  async transactionWithCategories<T>(callback: () => Promise<T>): Promise<T> {
    return db.transaction(
      'rw',
      db.categories,
      db.outbox,
      db.conflicts,
      callback,
    );
  }

  async transactionWithTodos<T>(callback: () => Promise<T>): Promise<T> {
    return db.transaction(
      'rw',
      db.todoItems,
      db.outbox,
      db.conflicts,
      callback,
    );
  }

  async transactionWithEntities<T>(callback: () => Promise<T>): Promise<T> {
    return db.transaction(
      'rw',
      db.notes,
      db.categories,
      db.noteLinks,
      db.outbox,
      db.conflicts,
      callback,
    );
  }

  async transactionWithReminders<T>(callback: () => Promise<T>): Promise<T> {
    return db.transaction(
      'rw',
      db.reminders,
      db.notifications,
      db.outbox,
      db.conflicts,
      callback,
    );
  }

  async transactionWithNotesAndSyncState<T>(
    callback: () => Promise<T>,
  ): Promise<T> {
    return db.transaction(
      'rw',
      db.notes,
      db.outbox,
      db.syncState,
      db.conflicts,
      callback,
    );
  }

  async transactionWithEntitiesAndSyncState<T>(
    callback: () => Promise<T>,
  ): Promise<T> {
    return db.transaction(
      'rw',
      [db.notes, db.categories, db.noteLinks, db.outbox, db.syncState, db.conflicts],
      callback,
    );
  }

  async get(operationId: string): Promise<OutboxRecord | undefined> {
    return db.outbox.get(operationId);
  }

  async listPending(now = new Date()): Promise<OutboxRecord[]> {
    const nowValue = now.toISOString();
    const operations = await db.outbox
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
    const operations = await db.outbox.where('entityId').equals(entityId).toArray();
    return entityType
      ? operations.filter((operation) => operation.entityType === entityType)
      : operations;
  }

  async add(operation: OutboxRecord): Promise<void> {
    await db.outbox.add(operation);
  }

  async save(operation: OutboxRecord): Promise<void> {
    await db.outbox.put(operation);
  }

  async remove(operationId: string): Promise<void> {
    await db.outbox.delete(operationId);
  }

  async removeMany(operationIds: string[]): Promise<void> {
    await db.outbox.bulkDelete(operationIds);
  }

  async markProcessing(
    operationIds: string[],
    startedAt = new Date(),
  ): Promise<void> {
    const processingStartedAt = startedAt.toISOString();

    await db.outbox.where('id').anyOf(operationIds).modify({
      status: 'processing',
      processingStartedAt,
      lastError: undefined,
    });
  }

  async markCompleted(
    operationId: string,
    remove = true,
  ): Promise<void> {
    if (remove) {
      await this.remove(operationId);
      return;
    }

    await db.outbox.update(operationId, {
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
    await db.outbox.update(operationId, {
      status: 'failed',
      processingStartedAt: undefined,
      lastError: error,
      nextRetryAt: nextRetryAt?.toISOString(),
    });
  }

  async incrementRetryCount(operationId: string): Promise<number> {
    const operation = await db.outbox.get(operationId);

    if (!operation) {
      return 0;
    }

    const retryCount = operation.retryCount + 1;
    await db.outbox.update(operationId, { retryCount });
    return retryCount;
  }

  async resetStaleProcessing(
    now = new Date(),
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
  ): Promise<number> {
    const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();

    return db.outbox
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
    return db.outbox
      .where('status')
      .anyOf('pending', 'processing', 'failed')
      .count();
  }
}

export const outboxRepository = new OutboxRepository();
