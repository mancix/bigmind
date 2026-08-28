import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '../database/database.service';
import { notes } from '../database/schema';

export type NoteRow = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;

@Injectable()
export class NotesRepository {
  async findById(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
  ): Promise<NoteRow | undefined> {
    const [note] = await transaction
      .select()
      .from(notes)
      .where(and(eq(notes.workspaceId, workspaceId), eq(notes.id, id)))
      .for('update')
      .limit(1);

    return note;
  }

  async findAnywhere(
    transaction: DatabaseTransaction,
    id: string,
  ): Promise<NoteRow | undefined> {
    const [note] = await transaction
      .select()
      .from(notes)
      .where(eq(notes.id, id))
      .for('update')
      .limit(1);

    return note;
  }

  async create(
    transaction: DatabaseTransaction,
    values: NewNote,
  ): Promise<NoteRow | undefined> {
    const [created] = await transaction
      .insert(notes)
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
    values: Pick<NoteRow, 'title' | 'content' | 'categoryId' | 'updatedAt'>,
  ): Promise<NoteRow | undefined> {
    const [updated] = await transaction
      .update(notes)
      .set({
        ...values,
        version: sql`${notes.version} + 1`,
      })
      .where(
        and(
          eq(notes.workspaceId, workspaceId),
          eq(notes.id, id),
          eq(notes.version, baseVersion),
          isNull(notes.deletedAt),
        ),
      )
      .returning();

    return updated;
  }

  async moveToWorkspace(
    transaction: DatabaseTransaction,
    id: string,
    destinationWorkspaceId: string,
    now: Date,
  ): Promise<NoteRow | undefined> {
    const [moved] = await transaction
      .update(notes)
      .set({
        workspaceId: destinationWorkspaceId,
        updatedAt: now,
        version: sql`${notes.version} + 1`,
      })
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
      .returning();

    return moved;
  }

  async softDelete(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
    baseVersion: number,
    deletedAt: Date,
  ): Promise<NoteRow | undefined> {
    const [deleted] = await transaction
      .update(notes)
      .set({
        deletedAt,
        updatedAt: deletedAt,
        version: sql`${notes.version} + 1`,
      })
      .where(
        and(
          eq(notes.workspaceId, workspaceId),
          eq(notes.id, id),
          eq(notes.version, baseVersion),
          isNull(notes.deletedAt),
        ),
      )
      .returning();

    return deleted;
  }
}
