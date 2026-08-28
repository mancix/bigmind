import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '../database/database.service';
import { categories, notes } from '../database/schema';

export type CategoryRow = typeof categories.$inferSelect;

@Injectable()
export class CategoriesRepository {
  async findById(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
  ): Promise<CategoryRow | undefined> {
    const [category] = await transaction
      .select()
      .from(categories)
      .where(and(eq(categories.workspaceId, workspaceId), eq(categories.id, id)))
      .for('update')
      .limit(1);
    return category;
  }

  async create(
    transaction: DatabaseTransaction,
    values: typeof categories.$inferInsert,
  ): Promise<CategoryRow | undefined> {
    const [created] = await transaction
      .insert(categories)
      .values(values)
      .onConflictDoNothing()
      .returning();
    return created;
  }

  async update(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
    baseVersion: number,
    values: Pick<
      CategoryRow,
      'name' | 'description' | 'icon' | 'parentId' | 'position' | 'updatedAt'
    >,
  ): Promise<CategoryRow | undefined> {
    const [updated] = await transaction
      .update(categories)
      .set({ ...values, version: sql`${categories.version} + 1` })
      .where(
        and(
          eq(categories.workspaceId, workspaceId),
          eq(categories.id, id),
          eq(categories.version, baseVersion),
          isNull(categories.deletedAt),
        ),
      )
      .returning();
    return updated;
  }

  async softDelete(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
    baseVersion: number,
    deletedAt: Date,
  ): Promise<CategoryRow | undefined> {
    const [deleted] = await transaction
      .update(categories)
      .set({
        deletedAt,
        updatedAt: deletedAt,
        version: sql`${categories.version} + 1`,
      })
      .where(
        and(
          eq(categories.workspaceId, workspaceId),
          eq(categories.id, id),
          eq(categories.version, baseVersion),
          isNull(categories.deletedAt),
        ),
      )
      .returning();
    return deleted;
  }

  async hasActiveChildren(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
  ): Promise<boolean> {
    const [child] = await transaction
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.workspaceId, workspaceId),
          eq(categories.parentId, id),
          isNull(categories.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(child);
  }

  async hasActiveNotes(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
  ): Promise<boolean> {
    const [note] = await transaction
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(
          eq(notes.workspaceId, workspaceId),
          eq(notes.categoryId, id),
          isNull(notes.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(note);
  }
}
