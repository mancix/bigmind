import type {
  OutboxRecord,
  StorageAdapter,
  TodoItemRecord,
} from '@bigmind/storage';
import { requestBackgroundSync, type SyncOutbox } from '@bigmind/sync';

import { generateId } from '../id.js';

/**
 * Todo-item repository shared by the web app and the mobile app.
 * Pure logic over the {@link StorageAdapter} + outbox abstractions.
 */
export class TodoRepository {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly outbox: SyncOutbox,
  ) {}

  async listByNoteId(noteId: string): Promise<TodoItemRecord[]> {
    const todoListId = await this.findOrCreateListId(noteId);
    return this.storage.todoItems
      .where('todoListId')
      .equals(todoListId)
      .filter((item) => !item.deletedAt)
      .sortBy('position');
  }

  private async findOrCreateListId(noteId: string): Promise<string> {
    const todoListId = `list-${noteId}`;
    const existing = await this.storage.todoItems
      .where('todoListId')
      .equals(todoListId)
      .filter((item) => !item.deletedAt)
      .first();
    if (existing) return todoListId;
    return todoListId;
  }

  async create(noteId: string, text: string): Promise<TodoItemRecord> {
    const timestamp = this.now();
    const todoListId = `list-${noteId}`;
    const existing = await this.storage.todoItems
      .where('todoListId')
      .equals(todoListId)
      .filter((item) => !item.deletedAt)
      .count();

    const item: TodoItemRecord = {
      id: this.generateId(),
      todoListId,
      text,
      completed: false,
      position: existing,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      version: 0,
      syncStatus: 'pending',
    };

    await this.outbox.transactionWithTodos(async () => {
      await this.storage.todoItems.add(item);
      await this.outbox.add(this.createOperation('create', item, timestamp));
    });

    requestBackgroundSync();
    return item;
  }

  async update(id: string, text: string): Promise<TodoItemRecord> {
    const timestamp = this.now();

    await this.outbox.transactionWithTodos(async () => {
      const existing = await this.storage.todoItems.get(id);
      if (!existing) throw new Error('Todo item not found');

      const updated: TodoItemRecord = {
        ...existing,
        text,
        updatedAt: timestamp,
        syncStatus: 'pending',
      };

      await this.storage.todoItems.put(updated);

      const operations = await this.coalescableOperations(id);
      const pendingCreate = operations.find((op) => op.operation === 'create');
      if (pendingCreate) {
        await this.outbox.save(this.resetOperation(pendingCreate, updated));
        return;
      }
      const pendingUpdate = operations.find((op) => op.operation === 'update');
      if (pendingUpdate) {
        await this.outbox.save(this.resetOperation(pendingUpdate, updated));
        return;
      }
      await this.outbox.add(this.createOperation('update', updated, timestamp));
    });

    requestBackgroundSync();
    return (await this.storage.todoItems.get(id))!;
  }

  async remove(id: string): Promise<void> {
    const timestamp = this.now();

    await this.outbox.transactionWithTodos(async () => {
      const existing = await this.storage.todoItems.get(id);
      if (!existing) return;

      const operations = await this.coalescableOperations(id);
      const pendingCreate = operations.find((op) => op.operation === 'create');
      if (pendingCreate) {
        await this.storage.todoItems.delete(id);
        await this.outbox.removeMany(operations.map((op) => op.id));
        return;
      }

      const deleted: TodoItemRecord = {
        ...existing,
        deletedAt: timestamp,
        updatedAt: timestamp,
        syncStatus: 'pending',
      };

      await this.storage.todoItems.put(deleted);

      const existingOp = operations.find((op) => op.operation === 'delete');
      if (existingOp) {
        await this.outbox.save(this.resetOperation(existingOp, deleted));
        return;
      }
      await this.outbox.add(this.createOperation('delete', deleted, timestamp));
    });

    requestBackgroundSync();
  }

  async reorder(
    noteId: string,
    itemId: string,
    newPosition: number,
  ): Promise<TodoItemRecord[]> {
    const items = await this.listByNoteId(noteId);
    const maxIndex = items.length - 1;
    const clamped = Math.max(0, Math.min(newPosition, maxIndex));
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new Error('Todo item not found');

    const without = items.filter((i) => i.id !== itemId);
    const reordered = [...without];
    reordered.splice(clamped, 0, item);

    await this.outbox.transactionWithTodos(async () => {
      for (let i = 0; i < reordered.length; i++) {
        const current = reordered[i];
        if (current.position !== i) {
          current.position = i;
          current.updatedAt = this.now();
          current.syncStatus = 'pending';
          await this.storage.todoItems.put(current);

          const ops = await this.coalescableOperations(current.id);
          const pendingOp = ops.find((op) => op.operation === 'update');
          if (pendingOp) {
            await this.outbox.save(this.resetOperation(pendingOp, current));
          } else {
            await this.outbox.add(
              this.createOperation('update', current, this.now()),
            );
          }
        }
      }
    });

    requestBackgroundSync();
    return reordered;
  }

  async toggle(id: string): Promise<TodoItemRecord> {
    const existing = await this.storage.todoItems.get(id);
    if (!existing) throw new Error('Todo item not found');
    return this.updateInternal(id, { completed: !existing.completed });
  }

  private async updateInternal(
    id: string,
    changes: Partial<TodoItemRecord>,
  ): Promise<TodoItemRecord> {
    const timestamp = this.now();

    await this.outbox.transactionWithTodos(async () => {
      const existing = await this.storage.todoItems.get(id);
      if (!existing) throw new Error('Todo item not found');

      const updated: TodoItemRecord = {
        ...existing,
        ...changes,
        updatedAt: timestamp,
        syncStatus: 'pending',
      };

      await this.storage.todoItems.put(updated);

      const operations = await this.coalescableOperations(id);
      const pendingCreate = operations.find((op) => op.operation === 'create');
      if (pendingCreate) {
        await this.outbox.save(this.resetOperation(pendingCreate, updated));
        return;
      }
      const pendingUpdate = operations.find((op) => op.operation === 'update');
      if (pendingUpdate) {
        await this.outbox.save(this.resetOperation(pendingUpdate, updated));
        return;
      }
      await this.outbox.add(this.createOperation('update', updated, timestamp));
    });

    requestBackgroundSync();
    return (await this.storage.todoItems.get(id))!;
  }

  private async coalescableOperations(id: string): Promise<OutboxRecord[]> {
    const operations = await this.outbox.listForEntity(id, 'todo_item');
    return operations.filter(
      (op) => op.status === 'pending' || op.status === 'failed',
    );
  }

  private createOperation(
    operation: OutboxRecord['operation'],
    item: TodoItemRecord,
    createdAt: string,
  ): OutboxRecord {
    return {
      id: this.generateId(),
      entityId: item.id,
      entityType: 'todo_item',
      operation,
      baseVersion: item.version,
      payload: item,
      createdAt,
      retryCount: 0,
      status: 'pending',
    };
  }

  private resetOperation(
    operation: OutboxRecord,
    payload: TodoItemRecord,
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
