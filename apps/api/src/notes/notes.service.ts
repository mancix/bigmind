import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { NoteData, NoteSyncOperation } from '@bigmind/contracts';
import { normalizeNoteTitle } from '@bigmind/domain/notes';
import { randomUUID } from 'node:crypto';

import { DatabaseService, type DatabaseTransaction } from '../database/database.service';
import { LinksService } from '../links/links.service';
import { WorkspaceRepository } from '../workspaces/workspaces.repository';
import { NotesRepository, type NoteRow } from './notes.repository';

export type NoteMutationResult =
  | { status: 'accepted'; note: NoteRow }
  | { status: 'not_found' }
  | { status: 'conflict'; note: NoteRow };

@Injectable()
export class NotesService {
  constructor(
    private readonly notesRepository: NotesRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly linksService: LinksService,
    private readonly databaseService: DatabaseService,
  ) {}

  async create(
    transaction: DatabaseTransaction,
    workspaceId: string,
    operation: NoteSyncOperation,
  ): Promise<NoteMutationResult> {
    const created = await this.notesRepository.create(transaction, {
      id: operation.entityId,
      workspaceId,
      title: normalizeNoteTitle(operation.payload.title),
      content: operation.payload.content,
      categoryId: operation.payload.categoryId,
      templateType: operation.payload.templateType ?? 'MARKDOWN',
      version: 1,
      createdAt: new Date(operation.payload.createdAt),
      updatedAt: new Date(operation.payload.updatedAt),
      deletedAt: null,
    });

    if (created) return { status: 'accepted', note: created };

    const current = await this.notesRepository.findById(
      transaction,
      workspaceId,
      operation.entityId,
    );

    return current
      ? { status: 'conflict', note: current }
      : { status: 'not_found' };
  }

  async update(
    transaction: DatabaseTransaction,
    workspaceId: string,
    operation: NoteSyncOperation,
  ): Promise<NoteMutationResult> {
    const updated = await this.notesRepository.update(
      transaction,
      workspaceId,
      operation.entityId,
      operation.baseVersion,
      {
        title: normalizeNoteTitle(operation.payload.title),
        content: operation.payload.content,
        categoryId: operation.payload.categoryId,
        updatedAt: new Date(operation.payload.updatedAt),
      },
    );

    if (updated) return { status: 'accepted', note: updated };
    return this.notFoundOrConflict(transaction, workspaceId, operation.entityId);
  }

  async delete(
    transaction: DatabaseTransaction,
    workspaceId: string,
    operation: NoteSyncOperation,
  ): Promise<NoteMutationResult> {
    const deleted = await this.notesRepository.softDelete(
      transaction,
      workspaceId,
      operation.entityId,
      operation.baseVersion,
      operation.payload.deletedAt
        ? new Date(operation.payload.deletedAt)
        : new Date(),
    );

    if (deleted) return { status: 'accepted', note: deleted };
    return this.notFoundOrConflict(transaction, workspaceId, operation.entityId);
  }

  async moveNote(
    noteId: string,
    destinationWorkspaceId: string,
    requesterUserId: string,
  ): Promise<NoteRow> {
    return this.databaseService.db.transaction(async (tx) => {
      const note = await this.notesRepository.findAnywhere(tx, noteId);
      if (!note || note.deletedAt) {
        throw new NotFoundException('Note not found');
      }

      if (note.workspaceId === destinationWorkspaceId) {
        throw new ConflictException('Note is already in the destination workspace');
      }

      const sourceRole = await this.workspaceRepository.getUserRole(
        note.workspaceId,
        requesterUserId,
        tx,
      );
      if (!sourceRole || sourceRole === 'VIEWER') {
        throw new ForbiddenException('You do not have permission to move notes from the source workspace');
      }

      const destRole = await this.workspaceRepository.getUserRole(
        destinationWorkspaceId,
        requesterUserId,
        tx,
      );
      if (!destRole || destRole === 'VIEWER') {
        throw new ForbiddenException('You do not have permission to add notes to the destination workspace');
      }

      await this.linksService.deleteForNote(tx, note.workspaceId, noteId, new Date());

      const moved = await this.notesRepository.moveToWorkspace(
        tx,
        noteId,
        destinationWorkspaceId,
        new Date(),
      );

      if (!moved) {
        throw new NotFoundException('Note not found');
      }

      return moved;
    });
  }

  async copyNote(
    noteId: string,
    destinationWorkspaceId: string,
    requesterUserId: string,
  ): Promise<NoteRow> {
    const destRole = await this.workspaceRepository.getUserRole(
      destinationWorkspaceId,
      requesterUserId,
    );
    if (!destRole || destRole === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to copy notes to the destination workspace');
    }

    return this.databaseService.db.transaction(async (tx) => {
      const note = await this.notesRepository.findAnywhere(tx, noteId);
      if (!note || note.deletedAt) {
        throw new NotFoundException('Note not found');
      }

      const sourceRole = await this.workspaceRepository.getUserRole(
        note.workspaceId,
        requesterUserId,
        tx,
      );
      if (!sourceRole) {
        throw new ForbiddenException('You do not have access to the source workspace');
      }

      const now = new Date();
      const copy = await this.notesRepository.create(tx, {
        id: randomUUID(),
        workspaceId: destinationWorkspaceId,
        title: note.title,
        content: note.content,
        categoryId: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });

      if (!copy) throw new Error('Failed to create note copy');
      return copy;
    });
  }

  toContractNote(note: NoteRow): NoteData {
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      categoryId: note.categoryId,
      templateType: note.templateType,
      version: note.version,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      ...(note.deletedAt ? { deletedAt: note.deletedAt.toISOString() } : {}),
    };
  }

  private async notFoundOrConflict(
    transaction: DatabaseTransaction,
    workspaceId: string,
    entityId: string,
  ): Promise<NoteMutationResult> {
    const current = await this.notesRepository.findById(
      transaction,
      workspaceId,
      entityId,
    );

    return current
      ? { status: 'conflict', note: current }
      : { status: 'not_found' };
  }
}
