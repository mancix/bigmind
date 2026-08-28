import {
  db,
  type NotificationRecord,
  type OutboxRecord,
} from '../../storage/database';
import { OutboxRepository, outboxRepository } from '../../sync/outbox-repository';
import { requestBackgroundSync } from '../../sync/background-sync';
import { getStoredWorkspaceId } from '../workspaces/workspace-store';
import type { NotificationType } from '@bigmind/domain/notifications';

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
}

export class NotificationsRepository {
  constructor(private readonly outbox: OutboxRepository = outboxRepository) {}

  async list(): Promise<NotificationRecord[]> {
    const wsId = getStoredWorkspaceId() ?? '';
    return db.notifications
      .where('workspaceId')
      .equals(wsId)
      .reverse()
      .sortBy('createdAt');
  }

  async countUnread(): Promise<number> {
    const wsId = getStoredWorkspaceId() ?? '';
    return db.notifications
      .where('workspaceId')
      .equals(wsId)
      .filter((n) => !n.read)
      .count();
  }

  async createLocal(input: CreateNotificationInput): Promise<string> {
    const timestamp = this.now();
    const id = this.generateId();
    const wsId = getStoredWorkspaceId() ?? '';
    const notification: NotificationRecord = {
      id,
      workspaceId: wsId,
      type: input.type,
      title: input.title.trim(),
      body: input.body ?? '',
      read: false,
      createdAt: timestamp,
      version: 0,
      syncStatus: 'pending',
    };

    await this.outbox.transactionWithReminders(async () => {
      await db.notifications.add(notification);
      await this.outbox.add(this.createOperation('create', notification, timestamp));
    });

    requestBackgroundSync();
    return id;
  }

  async markRead(id: string): Promise<void> {
    const timestamp = this.now();
    await this.outbox.transactionWithReminders(async () => {
      const existing = await db.notifications.get(id);
      if (!existing) return;
      const updated: NotificationRecord = {
        ...existing,
        read: true,
        syncStatus: 'pending',
      };
      await db.notifications.put(updated);
      await this.upsertOperation(updated, timestamp);
    });
    requestBackgroundSync();
  }

  async markAllRead(): Promise<void> {
    const wsId = getStoredWorkspaceId() ?? '';
    const timestamp = this.now();
    const unread = await db.notifications
      .where('workspaceId')
      .equals(wsId)
      .filter((n) => !n.read)
      .toArray();
    for (const n of unread) {
      const updated: NotificationRecord = { ...n, read: true, syncStatus: 'pending' };
      await db.notifications.put(updated);
      await this.upsertOperation(updated, timestamp);
    }
    requestBackgroundSync();
  }

  async remove(id: string): Promise<void> {
    const timestamp = this.now();
    await this.outbox.transactionWithReminders(async () => {
      const existing = await db.notifications.get(id);
      if (!existing) return;
      const operations = await this.coalescableOperations(id);
      const pendingCreate = operations.find((op) => op.operation === 'create');
      if (pendingCreate) {
        await db.notifications.delete(id);
        await this.outbox.removeMany(operations.map((op) => op.id));
        return;
      }
      await db.notifications.delete(id);
      const deleted: NotificationRecord = { ...existing, syncStatus: 'pending' };
      await this.outbox.add(this.createOperation('delete', deleted, timestamp));
    });
    requestBackgroundSync();
  }

  private async coalescableOperations(id: string): Promise<OutboxRecord[]> {
    return (await this.outbox.listForEntity(id, 'notification')).filter(
      (op) => op.status === 'pending' || op.status === 'failed',
    );
  }

  private async upsertOperation(notification: NotificationRecord, timestamp: string): Promise<void> {
    const operations = await this.coalescableOperations(notification.id);
    const reusable = operations.find((op) => op.operation === 'create')
      ?? operations.find((op) => op.operation === 'update');
    if (reusable) {
      await this.outbox.save(this.resetOperation(reusable, notification));
    } else {
      await this.outbox.add(this.createOperation('update', notification, timestamp));
    }
  }

  private createOperation(
    operation: OutboxRecord['operation'],
    notification: NotificationRecord,
    createdAt: string,
  ): OutboxRecord {
    return {
      id: this.generateId(),
      entityId: notification.id,
      entityType: 'notification',
      operation,
      baseVersion: notification.version,
      payload: notification,
      createdAt,
      retryCount: 0,
      status: 'pending',
    };
  }

  private resetOperation(operation: OutboxRecord, payload: NotificationRecord): OutboxRecord {
    return {
      ...operation,
      payload,
      retryCount: 0,
      status: 'pending',
      lastError: undefined,
      nextRetryAt: undefined,
      processingStartedAt: undefined,
    };
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  private now(): string {
    return new Date().toISOString();
  }
}

export const notificationsRepository = new NotificationsRepository();
