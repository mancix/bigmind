import { Injectable } from '@nestjs/common';
import type { NoteLinkData, NoteLinkSyncOperation } from '@bigmind/contracts';

import type { DatabaseTransaction } from '../database/database.service';
import { LinksRepository, type NoteLinkRow } from './links.repository';

export type LinkMutationResult =
  | { status: 'accepted'; link: NoteLinkRow }
  | { status: 'not_found' }
  | { status: 'conflict'; link: NoteLinkRow }
  | { status: 'rejected'; code: string; message: string };

@Injectable()
export class LinksService {
  constructor(private readonly links: LinksRepository) {}

  async create(
    transaction: DatabaseTransaction,
    workspaceId: string,
    operation: NoteLinkSyncOperation,
  ): Promise<LinkMutationResult> {
    if (!(await this.links.notesExist(transaction, workspaceId, [
      operation.payload.sourceNoteId,
      operation.payload.targetNoteId,
    ]))) {
      return {
        status: 'rejected',
        code: 'LINK_NOTE_NOT_FOUND',
        message: 'The source or target note does not exist.',
      };
    }

    const created = await this.links.create(transaction, {
      id: operation.entityId,
      workspaceId,
      sourceNoteId: operation.payload.sourceNoteId,
      targetNoteId: operation.payload.targetNoteId,
      version: 1,
      createdAt: new Date(operation.payload.createdAt),
      deletedAt: null,
    });
    if (created) return { status: 'accepted', link: created };

    const current = await this.links.findById(transaction, workspaceId, operation.entityId);
    return current
      ? { status: 'conflict', link: current }
      : {
          status: 'rejected',
          code: 'LINK_ALREADY_EXISTS',
          message: 'This link already exists.',
        };
  }

  async delete(
    transaction: DatabaseTransaction,
    workspaceId: string,
    operation: NoteLinkSyncOperation,
  ): Promise<LinkMutationResult> {
    const deleted = await this.links.softDelete(
      transaction,
      workspaceId,
      operation.entityId,
      operation.baseVersion,
      operation.payload.deletedAt
        ? new Date(operation.payload.deletedAt)
        : new Date(),
    );
    if (deleted) return { status: 'accepted', link: deleted };

    const current = await this.links.findById(transaction, workspaceId, operation.entityId);
    return current
      ? { status: 'conflict', link: current }
      : { status: 'not_found' };
  }

  deleteForNote(
    transaction: DatabaseTransaction,
    workspaceId: string,
    noteId: string,
    deletedAt: Date,
  ): Promise<NoteLinkRow[]> {
    return this.links.softDeleteForNote(transaction, workspaceId, noteId, deletedAt);
  }

  toContractLink(link: NoteLinkRow): NoteLinkData {
    return {
      id: link.id,
      sourceNoteId: link.sourceNoteId,
      targetNoteId: link.targetNoteId,
      createdAt: link.createdAt.toISOString(),
      deletedAt: link.deletedAt?.toISOString() ?? null,
      version: link.version,
    };
  }
}
