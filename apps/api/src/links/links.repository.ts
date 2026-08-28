import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '../database/database.service';
import { noteLinks, notes } from '../database/schema';

export type NoteLinkRow = typeof noteLinks.$inferSelect;

@Injectable()
export class LinksRepository {
  async notesExist(
    transaction: DatabaseTransaction,
    workspaceId: string,
    noteIds: string[],
  ): Promise<boolean> {
    const rows = await transaction
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(
          eq(notes.workspaceId, workspaceId),
          isNull(notes.deletedAt),
          or(...noteIds.map((id) => eq(notes.id, id))),
        ),
      );
    return new Set(rows.map(({ id }) => id)).size === new Set(noteIds).size;
  }

  async findById(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
  ): Promise<NoteLinkRow | undefined> {
    const [link] = await transaction
      .select()
      .from(noteLinks)
      .where(and(eq(noteLinks.workspaceId, workspaceId), eq(noteLinks.id, id)))
      .for('update')
      .limit(1);
    return link;
  }

  async create(
    transaction: DatabaseTransaction,
    values: typeof noteLinks.$inferInsert,
  ): Promise<NoteLinkRow | undefined> {
    const [link] = await transaction
      .insert(noteLinks)
      .values(values)
      .onConflictDoNothing()
      .returning();
    return link;
  }

  async softDelete(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
    baseVersion: number,
    deletedAt: Date,
  ): Promise<NoteLinkRow | undefined> {
    const [link] = await transaction
      .update(noteLinks)
      .set({
        deletedAt,
        version: sql`${noteLinks.version} + 1`,
      })
      .where(
        and(
          eq(noteLinks.workspaceId, workspaceId),
          eq(noteLinks.id, id),
          eq(noteLinks.version, baseVersion),
          isNull(noteLinks.deletedAt),
        ),
      )
      .returning();
    return link;
  }

  async softDeleteForNote(
    transaction: DatabaseTransaction,
    workspaceId: string,
    noteId: string,
    deletedAt: Date,
  ): Promise<NoteLinkRow[]> {
    return transaction
      .update(noteLinks)
      .set({ deletedAt, version: sql`${noteLinks.version} + 1` })
      .where(
        and(
          eq(noteLinks.workspaceId, workspaceId),
          isNull(noteLinks.deletedAt),
          or(
            eq(noteLinks.sourceNoteId, noteId),
            eq(noteLinks.targetNoteId, noteId),
          ),
        ),
      )
      .returning();
  }
}
