import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { DatabaseService, type DatabaseTransaction } from '../database/database.service';
import {
  reminders,
  type NewReminder,
  type ReminderRow,
} from '../database/schema';

@Injectable()
export class RemindersRepository {
  constructor(private readonly database: DatabaseService) {}

  private db(tx?: DatabaseTransaction) {
    return tx ?? this.database.db;
  }

  async list(
    workspaceId: string,
    tx?: DatabaseTransaction,
  ): Promise<ReminderRow[]> {
    return this.db(tx)
      .select()
      .from(reminders)
      .where(eq(reminders.workspaceId, workspaceId))
      .orderBy(asc(reminders.dueAt));
  }

  async findById(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<ReminderRow | undefined> {
    const [reminder] = await this.db(tx)
      .select()
      .from(reminders)
      .where(eq(reminders.id, id))
      .limit(1);
    return reminder;
  }

  async create(
    values: NewReminder,
    tx?: DatabaseTransaction,
  ): Promise<ReminderRow> {
    const [reminder] = await this.db(tx)
      .insert(reminders)
      .values(values)
      .onConflictDoNothing()
      .returning();
    if (!reminder) throw new NotFoundException('Reminder not found');
    return reminder;
  }

  async update(
    id: string,
    data: Partial<Pick<ReminderRow, 'title' | 'description' | 'dueAt' | 'completed' | 'linkedNoteId' | 'updatedAt'>>,
    tx?: DatabaseTransaction,
  ): Promise<ReminderRow> {
    const [reminder] = await this.db(tx)
      .update(reminders)
      .set(data)
      .where(eq(reminders.id, id))
      .returning();
    if (!reminder) throw new NotFoundException('Reminder not found');
    return reminder;
  }

  async softDelete(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    await this.db(tx)
      .delete(reminders)
      .where(eq(reminders.id, id));
  }
}
