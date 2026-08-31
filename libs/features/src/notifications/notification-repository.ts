import type {
  NotificationRecord,
  OutboxRecord,
  StorageAdapter,
} from '@bigmind/storage';
import type { NotificationType } from '@bigmind/domain/notifications';
import { requestBackgroundSync, type SyncOutbox } from '@bigmind/sync';

import { generateId } from '../id.js';
import {
  nullWorkspaceContext,
  resolveWorkspaceId,
  type WorkspaceContext,
} from '../workspace/workspace-context.js';

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
}

/**
 * Notification repository shared by the web app and the mobile app.
 *
 * Pure logic over the {@link StorageAdapter} + outbox abstractions (same
 * pattern as every other repository in `@bigmind/features`). The workspace is
 * injected as a {@link WorkspaceContext} — no browser or native APIs.
 */
export class NotificationsRepository {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly outbox: SyncOutbox,
    private readonly workspace: WorkspaceContext = nullWorkspaceContext,
  ) {}

  async list(): Promise<NotificationRecord[]> {
    const wsId = resolveWorkspaceId(this.workspace);
    return this.storage.notifications
      .where('workspaceId')
      .equals(wsId)
      .reverse()
      .sortBy('createdAt');
  }

  async countUnread(): Promise<number> {
    const wsId = resolveWorkspaceId(this.workspace);
    return this.storage.notifications
      .where('workspaceId')
      .equals(wsId)
      .filter((n) => !n.read)
      .count();
  }

  async createLocal(input: CreateNotificationInput): Promise<string> {
    const timestamp = this.now();
    const id = this.generateId();
    const wsId = resolveWorkspaceId(this.workspace);
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
      await this.storage.notifications.add(notification);
      await this.outbox.add(
        this.createOperation('create', notification, timestamp),
      );
    });

    requestBackgroundSync();
    return id;
  }

  async markRead(id: string): Promise<void> {
    const timestamp = this.now();
    await this.outbox.transactionWithReminders(async () => {
      const existing = await this.storage.notifications.get(id);
      if (!existing) return;
      const updated: NotificationRecord = {
        ...existing,
        read: true,
        syncStatus: 'pending',
      };
      await this.storage.notifications.put(updated);
      await this.upsertOperation(updated, timestamp);
    });
    requestBackgroundSync();
  }

  async markAllRead(): Promise<void> {
    const wsId = resolveWorkspaceId(this.workspace);
    const timestamp = this.now();
    const unread = await this.storage.notifications
      .where('workspaceId')
      .equals(wsId)
      .filter((n) => !n.read)
      .toArray();
    for (const n of unread) {
      const updated: NotificationRecord = {
        ...n,
        read: true,
        syncStatus: 'pending',
      };
      await this.storage.notifications.put(updated);
      await this.upsertOperation(updated, timestamp);
    }
    requestBackgroundSync();
  }

  async remove(id: string): Promise<void> {
    const timestamp = this.now();
    await this.outbox.transactionWithReminders(async () => {
      const existing = await this.storage.notifications.get(id);
      if (!existing) return;
      const operations = await this.coalescableOperations(id);
      const pendingCreate = operations.find((op) => op.operation === 'create');
      if (pendingCreate) {
        await this.storage.notifications.delete(id);
        await this.outbox.removeMany(operations.map((op) => op.id));
        return;
      }
      await this.storage.notifications.delete(id);
      const deleted: NotificationRecord = {
        ...existing,
        syncStatus: 'pending',
      };
      await this.outbox.add(this.createOperation('delete', deleted, timestamp));
    });
    requestBackgroundSync();
  }

  private async coalescableOperations(id: string): Promise<OutboxRecord[]> {
    return (await this.outbox.listForEntity(id, 'notification')).filter(
      (op) => op.status === 'pending' || op.status === 'failed',
    );
  }

  private async upsertOperation(
    notification: NotificationRecord,
    timestamp: string,
  ): Promise<void> {
    const operations = await this.coalescableOperations(notification.id);
    const reusable =
      operations.find((op) => op.operation === 'create') ??
      operations.find((op) => op.operation === 'update');
    if (reusable) {
      await this.outbox.save(this.resetOperation(reusable, notification));
    } else {
      await this.outbox.add(
        this.createOperation('update', notification, timestamp),
      );
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

  private resetOperation(
    operation: OutboxRecord,
    payload: NotificationRecord,
  ): OutboxRecord {
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
    return generateId();
  }

  private now(): string {
    return new Date().toISOString();
  }
}