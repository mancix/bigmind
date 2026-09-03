import type { OutboxRecord, ReminderRecord, StorageAdapter } from '@bigmind/storage';
import { requestBackgroundSync, type SyncOutbox } from '@bigmind/sync';

import { generateId } from '../id.js';
import {
  nullWorkspaceContext,
  resolveWorkspaceId,
  type WorkspaceContext,
} from '../workspace/workspace-context.js';

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

/**
 * Optional mutation hooks invoked by {@link RemindersRepository} after a
 * local write succeeds. Platforms use this to keep external effects in sync
 * with reminder state — the mobile app schedules/cancels native local
 * notifications here (see apps/mobile/src/notifications/).
 *
 * Hooks are best-effort: repository persistence never depends on them, and a
 * thrown error inside a hook is swallowed by the repository (a notification
 * failure must never break a reminder save). The web app does not pass hooks
 * and is therefore unaffected.
 */
export interface ReminderNotificationHooks {
  /** A reminder was created locally (outbox operation queued). */
  onReminderCreated?(reminder: ReminderRecord): void | Promise<void>;
  /** A reminder was updated locally (any field, including completion). */
  onReminderUpdated?(reminder: ReminderRecord): void | Promise<void>;
  /** A reminder was deleted locally (coalesced-away or tombstoned). */
  onReminderDeleted?(reminder: ReminderRecord): void | Promise<void>;
}

/**
 * Reminder repository shared by the web app and the mobile app.
 *
 * Pure logic over the {@link StorageAdapter} + outbox abstractions — no
 * browser, React Native, or localStorage APIs. The current workspace is
 * injected as a {@link WorkspaceContext} so the same class runs on web
 * (localStorage), mobile (AsyncStorage) and future desktop apps.
 */
export class RemindersRepository {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly outbox: SyncOutbox,
    private readonly workspace: WorkspaceContext = nullWorkspaceContext,
    private readonly notificationHooks: ReminderNotificationHooks = {},
  ) {}

  async list(): Promise<ReminderRecord[]> {
    const wsId = resolveWorkspaceId(this.workspace);
    return this.storage.reminders.where('workspaceId').equals(wsId).sortBy('dueAt');
  }

  /** Load a single reminder by id (used by detail screens; undefined when missing). */
  async findById(id: string): Promise<ReminderRecord | undefined> {
    return this.storage.reminders.get(id);
  }

  /**
   * Reminders linked to a note in the current workspace, due-date-ascending
   * (used by the note detail screen's “Related reminders” section).
   */
  async listForNote(noteId: string): Promise<ReminderRecord[]> {
    const wsId = resolveWorkspaceId(this.workspace);
    return this.storage.reminders
      .where('workspaceId')
      .equals(wsId)
      .filter((reminder) => reminder.linkedNoteId === noteId)
      .sortBy('dueAt');
  }

  async create(input: CreateReminderInput): Promise<string> {
    const timestamp = this.now();
    const id = this.generateId();
    const wsId = resolveWorkspaceId(this.workspace);
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
      await this.storage.reminders.add(reminder);
      await this.outbox.add(
        this.createOperation('create', reminder, timestamp),
      );
    });

    // Schedule a local notification for the new due time (best-effort).
    await this.notify(() =>
      this.notificationHooks.onReminderCreated?.(reminder),
    );
    requestBackgroundSync();
    return id;
  }

  async update(id: string, changes: UpdateReminderInput): Promise<void> {
    const timestamp = this.now();
    // Hoisted so the notification hook receives the post-update record.
    let updated: ReminderRecord | undefined;
    await this.outbox.transactionWithReminders(async () => {
      const existing = await this.storage.reminders.get(id);
      if (!existing) return;
      updated = {
        ...existing,
        title:
          changes.title !== undefined ? changes.title.trim() : existing.title,
        description:
          changes.description !== undefined
            ? changes.description
            : existing.description,
        dueAt: changes.dueAt !== undefined ? changes.dueAt : existing.dueAt,
        completed:
          changes.completed !== undefined
            ? changes.completed
            : existing.completed,
        linkedNoteId:
          changes.linkedNoteId !== undefined
            ? changes.linkedNoteId
            : existing.linkedNoteId,
        updatedAt: timestamp,
        syncStatus: 'pending',
      };
      await this.storage.reminders.put(updated);
      await this.upsertOperation(updated, timestamp);
    });

    if (updated) {
      // Reschedule for the new due time, or cancel when completed (best-effort).
      const reminder = updated;
      await this.notify(() =>
        this.notificationHooks.onReminderUpdated?.(reminder),
      );
    }
    requestBackgroundSync();
  }

  async toggle(id: string): Promise<void> {
    const existing = await this.storage.reminders.get(id);
    if (!existing) return;
    await this.update(id, { completed: !existing.completed });
  }

  async remove(id: string): Promise<void> {
    const timestamp = this.now();
    // Hoisted so the notification hook can cancel with the pre-delete record.
    let existing: ReminderRecord | undefined;
    await this.outbox.transactionWithReminders(async () => {
      existing = await this.storage.reminders.get(id);
      const reminder = existing;
      if (!reminder) return;
      const operations = await this.coalescableOperations(id);
      const pendingCreate = operations.find((op) => op.operation === 'create');
      if (pendingCreate) {
        await this.storage.reminders.delete(id);
        await this.outbox.removeMany(operations.map((op) => op.id));
        return;
      }
      const deleted: ReminderRecord = {
        ...reminder,
        syncStatus: 'pending',
      };
      await this.storage.reminders.put(deleted);
      await this.outbox.add(this.createOperation('delete', deleted, timestamp));
    });

    if (existing) {
      // Cancel the local notification for the removed reminder (best-effort).
      const reminder = existing;
      await this.notify(() =>
        this.notificationHooks.onReminderDeleted?.(reminder),
      );
    }
    requestBackgroundSync();
  }

  /**
   * Run a notification hook best-effort: persistence must never fail because
   * scheduling a local notification failed (e.g. permissions were denied).
   */
  private async notify(
    hook: () => void | Promise<void>,
  ): Promise<void> {
    try {
      await hook();
    } catch {
      // Swallow — notifications are an optimization over local persistence.
    }
  }

  private async coalescableOperations(id: string): Promise<OutboxRecord[]> {
    return (await this.outbox.listForEntity(id, 'reminder')).filter(
      (op) => op.status === 'pending' || op.status === 'failed',
    );
  }

  private async upsertOperation(
    reminder: ReminderRecord,
    timestamp: string,
  ): Promise<void> {
    const operations = await this.coalescableOperations(reminder.id);
    const reusable =
      operations.find((op) => op.operation === 'create') ??
      operations.find((op) => op.operation === 'update');
    if (reusable) {
      await this.outbox.save(this.resetOperation(reusable, reminder));
    } else {
      await this.outbox.add(
        this.createOperation('update', reminder, timestamp),
      );
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

  private resetOperation(
    operation: OutboxRecord,
    payload: ReminderRecord,
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