import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { DatabaseService, type DatabaseTransaction } from '../database/database.service';
import {
  notifications,
  type NewNotification,
  type NotificationRow,
} from '../database/schema';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly database: DatabaseService) {}

  private db(tx?: DatabaseTransaction) {
    return tx ?? this.database.db;
  }

  async list(
    workspaceId: string,
    tx?: DatabaseTransaction,
  ): Promise<NotificationRow[]> {
    return this.db(tx)
      .select()
      .from(notifications)
      .where(eq(notifications.workspaceId, workspaceId))
      .orderBy(desc(notifications.createdAt));
  }

  async findById(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<NotificationRow | undefined> {
    const [n] = await this.db(tx)
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);
    return n;
  }

  async create(
    values: NewNotification,
    tx?: DatabaseTransaction,
  ): Promise<NotificationRow> {
    const [n] = await this.db(tx)
      .insert(notifications)
      .values(values)
      .onConflictDoNothing()
      .returning();
    return n!;
  }

  async markRead(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    await this.db(tx)
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, id));
  }

  async markAllRead(
    workspaceId: string,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    await this.db(tx)
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.workspaceId, workspaceId));
  }

  async delete(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    await this.db(tx)
      .delete(notifications)
      .where(eq(notifications.id, id));
  }
}
