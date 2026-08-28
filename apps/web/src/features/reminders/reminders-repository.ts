import {
  db,
  type OutboxRecord,
  type ReminderRecord,
} from '../../storage/database';
import { OutboxRepository, outboxRepository } from '../../sync/outbox-repository';
import { requestBackgroundSync } from '../../sync/background-sync';
import { getStoredWorkspaceId } from '../workspaces/workspace-store';

export interface CreateReminderInput {
  title: string;
  description?: string;
  dueAt: string;
  linkedNoteId?: string | null;
}

export interface UpdateReminderInput {
  title?: string;
  description?: string;
  dueAt?: string;
  completed?: boolean;
  linkedNoteId?: string | null;
}

export class RemindersRepository {
  constructor(private readonly outbox: OutboxRepository = outboxRepository) {}

  async list(): Promise<ReminderRecord[]> {
    const wsId = getStoredWorkspaceId() ?? '';
    return db.reminders
      .where('workspaceId')
      .equals(wsId)
      .sortBy('dueAt');
  }

  async create(input: CreateReminderInput): Promise<string> {
    const timestamp = this.now();
    const id = this.generateId();
    const wsId = getStoredWorkspaceId() ?? '';
    const reminder: ReminderRecord = {
      id,
      workspaceId: wsId,
      title: input.title.trim(),
      description: input.description ?? '',
      dueAt: input.dueAt,
      completed: false,
      createdBy: '',
      linkedNoteId: input.linkedNoteId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 0,
      syncStatus: 'pending',
    };

    await this.outbox.transactionWithReminders(async () => {
      await db.reminders.add(reminder);
      await this.outbox.add(this.createOperation('create', reminder, timestamp));
    });

    requestBackgroundSync();
    return id;
  }

  async update(id: string, changes: UpdateReminderInput): Promise<void> {
    const timestamp = this.now();
    await this.outbox.transactionWithReminders(async () => {
      const existing = await db.reminders.get(id);
      if (!existing) return;
      const updated: ReminderRecord = {
        ...existing,
        title: changes.title !== undefined ? changes.title.trim() : existing.title,
        description: changes.description !== undefined ? changes.description : existing.description,
        dueAt: changes.dueAt !== undefined ? changes.dueAt : existing.dueAt,
        completed: changes.completed !== undefined ? changes.completed : existing.completed,
        linkedNoteId: changes.linkedNoteId !== undefined ? changes.linkedNoteId : existing.linkedNoteId,
        updatedAt: timestamp,
        syncStatus: 'pending',
      };
      await db.reminders.put(updated);
      await this.upsertOperation(updated, timestamp);
    });
    requestBackgroundSync();
  }

  async toggle(id: string): Promise<void> {
    const existing = await db.reminders.get(id);
    if (!existing) return;
    await this.update(id, { completed: !existing.completed });
  }

  async remove(id: string): Promise<void> {
    const timestamp = this.now();
    await this.outbox.transactionWithReminders(async () => {
      const existing = await db.reminders.get(id);
      if (!existing) return;
      const operations = await this.coalescableOperations(id);
      const pendingCreate = operations.find((op) => op.operation === 'create');
      if (pendingCreate) {
        await db.reminders.delete(id);
        await this.outbox.removeMany(operations.map((op) => op.id));
        return;
      }
      const deleted: ReminderRecord = {
        ...existing,
        syncStatus: 'pending',
      };
      await db.reminders.put(deleted);
      await this.outbox.add(this.createOperation('delete', deleted, timestamp));
    });
    requestBackgroundSync();
  }

  private async coalescableOperations(id: string): Promise<OutboxRecord[]> {
    return (await this.outbox.listForEntity(id, 'reminder')).filter(
      (op) => op.status === 'pending' || op.status === 'failed',
    );
  }

  private async upsertOperation(reminder: ReminderRecord, timestamp: string): Promise<void> {
    const operations = await this.coalescableOperations(reminder.id);
    const reusable = operations.find((op) => op.operation === 'create')
      ?? operations.find((op) => op.operation === 'update');
    if (reusable) {
      await this.outbox.save(this.resetOperation(reusable, reminder));
    } else {
      await this.outbox.add(this.createOperation('update', reminder, timestamp));
    }
  }

  private createOperation(
    operation: OutboxRecord['operation'],
    reminder: ReminderRecord,
    createdAt: string,
  ): OutboxRecord {
    return {
      id: this.generateId(),
      entityId: reminder.id,
      entityType: 'reminder',
      operation,
      baseVersion: reminder.version,
      payload: reminder,
      createdAt,
      retryCount: 0,
      status: 'pending',
    };
  }

  private resetOperation(operation: OutboxRecord, payload: ReminderRecord): OutboxRecord {
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

export const remindersRepository = new RemindersRepository();
