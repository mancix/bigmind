import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';

import { DatabaseService, type DatabaseTransaction } from '../database/database.service';
import {
  todoItems,
  todoLists,
  type NewTodoItem,
  type NewTodoList,
  type TodoItemRow,
  type TodoListRow,
} from '../database/schema';

@Injectable()
export class TodosRepository {
  constructor(private readonly database: DatabaseService) {}

  private db(tx?: DatabaseTransaction) {
    return tx ?? this.database.db;
  }

  async findListByNoteId(
    noteId: string,
    tx?: DatabaseTransaction,
  ): Promise<TodoListRow | undefined> {
    const [list] = await this.db(tx)
      .select()
      .from(todoLists)
      .where(eq(todoLists.noteId, noteId))
      .limit(1);
    return list;
  }

  async createList(
    values: NewTodoList,
    tx?: DatabaseTransaction,
  ): Promise<TodoListRow> {
    const [list] = await this.db(tx)
      .insert(todoLists)
      .values(values)
      .returning();
    return list;
  }

  async findItemsByListId(
    todoListId: string,
    tx?: DatabaseTransaction,
  ): Promise<TodoItemRow[]> {
    return this.db(tx)
      .select()
      .from(todoItems)
      .where(eq(todoItems.todoListId, todoListId))
      .orderBy(asc(todoItems.position));
  }

  async findItemById(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<TodoItemRow | undefined> {
    const [item] = await this.db(tx)
      .select()
      .from(todoItems)
      .where(eq(todoItems.id, id))
      .limit(1);
    return item;
  }

  async createItem(
    values: NewTodoItem,
    tx?: DatabaseTransaction,
  ): Promise<TodoItemRow> {
    const [item] = await this.db(tx)
      .insert(todoItems)
      .values(values)
      .returning();
    return item;
  }

  async updateItem(
    id: string,
    data: Partial<Pick<TodoItemRow, 'text' | 'completed' | 'position' | 'updatedAt'>>,
    tx?: DatabaseTransaction,
  ): Promise<TodoItemRow> {
    const [item] = await this.db(tx)
      .update(todoItems)
      .set(data)
      .where(eq(todoItems.id, id))
      .returning();
    if (!item) throw new NotFoundException('Todo item not found');
    return item;
  }

  async deleteItem(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    await this.db(tx)
      .delete(todoItems)
      .where(eq(todoItems.id, id));
  }

  async countItems(
    todoListId: string,
    tx?: DatabaseTransaction,
  ): Promise<number> {
    const [result] = await this.db(tx)
      .select({ cnt: count() })
      .from(todoItems)
      .where(eq(todoItems.todoListId, todoListId));
    return result?.cnt ?? 0;
  }
}
