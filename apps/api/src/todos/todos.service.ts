import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { DatabaseService } from '../database/database.service';
import { WorkspaceRepository } from '../workspaces/workspaces.repository';
import { NotesRepository } from '../notes/notes.repository';
import { TodosRepository } from './todos.repository';

@Injectable()
export class TodosService {
  constructor(
    private readonly todosRepository: TodosRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly notesRepository: NotesRepository,
    private readonly databaseService: DatabaseService,
  ) {}

  async getItems(noteId: string, requesterUserId: string) {
    return this.databaseService.db.transaction(async (tx) => {
      const note = await this.notesRepository.findAnywhere(tx, noteId);
      if (!note || note.deletedAt) {
        throw new NotFoundException('Note not found');
      }
      if (note.templateType !== 'TODO_LIST') {
        throw new BadRequestException('Note is not a TODO_LIST type');
      }
      const role = await this.workspaceRepository.getUserRole(
        note.workspaceId,
        requesterUserId,
        tx,
      );
      if (!role) {
        throw new ForbiddenException('Access denied');
      }
      const list = await this.todosRepository.findListByNoteId(noteId, tx);
      if (!list) {
        return [];
      }
      return this.todosRepository.findItemsByListId(list.id, tx);
    });
  }

  async createItem(
    noteId: string,
    text: string,
    requesterUserId: string,
  ) {
    if (!text.trim()) {
      throw new BadRequestException('Todo item text is required');
    }

    return this.databaseService.db.transaction(async (tx) => {
      const note = await this.notesRepository.findAnywhere(tx, noteId);
      if (!note || note.deletedAt) {
        throw new NotFoundException('Note not found');
      }
      if (note.templateType !== 'TODO_LIST') {
        throw new BadRequestException('Note is not a TODO_LIST type');
      }
      const role = await this.workspaceRepository.getUserRole(
        note.workspaceId,
        requesterUserId,
        tx,
      );
      if (!role || role === 'VIEWER') {
        throw new ForbiddenException('Access denied');
      }
      let list = await this.todosRepository.findListByNoteId(noteId, tx);
      if (!list) {
        const now = new Date();
        list = await this.todosRepository.createList(
          { id: randomUUID(), noteId, createdAt: now, updatedAt: now },
          tx,
        );
      }
      const itemCount = await this.todosRepository.countItems(list.id, tx);
      const now = new Date();
      return this.todosRepository.createItem(
        {
          id: randomUUID(),
          todoListId: list.id,
          text: text.trim(),
          completed: false,
          position: itemCount,
          createdAt: now,
          updatedAt: now,
        },
        tx,
      );
    });
  }

  async updateItem(
    noteId: string,
    itemId: string,
    text: string,
    requesterUserId: string,
  ) {
    if (!text.trim()) {
      throw new BadRequestException('Todo item text is required');
    }

    return this.databaseService.db.transaction(async (tx) => {
      const note = await this.notesRepository.findAnywhere(tx, noteId);
      if (!note || note.deletedAt) {
        throw new NotFoundException('Note not found');
      }
      const role = await this.workspaceRepository.getUserRole(
        note.workspaceId,
        requesterUserId,
        tx,
      );
      if (!role || role === 'VIEWER') {
        throw new ForbiddenException('Access denied');
      }
      return this.todosRepository.updateItem(
        itemId,
        { text: text.trim(), updatedAt: new Date() },
        tx,
      );
    });
  }

  async toggleItem(
    noteId: string,
    itemId: string,
    requesterUserId: string,
  ) {
    return this.databaseService.db.transaction(async (tx) => {
      const note = await this.notesRepository.findAnywhere(tx, noteId);
      if (!note || note.deletedAt) {
        throw new NotFoundException('Note not found');
      }
      const role = await this.workspaceRepository.getUserRole(
        note.workspaceId,
        requesterUserId,
        tx,
      );
      if (!role || role === 'VIEWER') {
        throw new ForbiddenException('Access denied');
      }
      const item = await this.todosRepository.findItemById(itemId, tx);
      if (!item) {
        throw new NotFoundException('Todo item not found');
      }
      return this.todosRepository.updateItem(
        itemId,
        { completed: !item.completed, updatedAt: new Date() },
        tx,
      );
    });
  }

  async deleteItem(
    noteId: string,
    itemId: string,
    requesterUserId: string,
  ) {
    return this.databaseService.db.transaction(async (tx) => {
      const note = await this.notesRepository.findAnywhere(tx, noteId);
      if (!note || note.deletedAt) {
        throw new NotFoundException('Note not found');
      }
      const role = await this.workspaceRepository.getUserRole(
        note.workspaceId,
        requesterUserId,
        tx,
      );
      if (!role || role === 'VIEWER') {
        throw new ForbiddenException('Access denied');
      }
      await this.todosRepository.deleteItem(itemId, tx);
    });
  }

  async reorderItem(
    noteId: string,
    itemId: string,
    newPosition: number,
    requesterUserId: string,
  ) {
    return this.databaseService.db.transaction(async (tx) => {
      const note = await this.notesRepository.findAnywhere(tx, noteId);
      if (!note || note.deletedAt) {
        throw new NotFoundException('Note not found');
      }
      const role = await this.workspaceRepository.getUserRole(
        note.workspaceId,
        requesterUserId,
        tx,
      );
      if (!role || role === 'VIEWER') {
        throw new ForbiddenException('Access denied');
      }
      const list = await this.todosRepository.findListByNoteId(noteId, tx);
      if (!list) {
        throw new NotFoundException('Todo list not found');
      }
      const items = await this.todosRepository.findItemsByListId(list.id, tx);
      const maxIndex = items.length - 1;
      const clamped = Math.max(0, Math.min(newPosition, maxIndex));
      const item = items.find((i) => i.id === itemId);
      if (!item) {
        throw new NotFoundException('Todo item not found');
      }
      const without = items.filter((i) => i.id !== itemId);
      const reordered = [...without];
      reordered.splice(clamped, 0, item);
      const now = new Date();
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].position !== i || reordered[i].id === itemId) {
          await this.todosRepository.updateItem(
            reordered[i].id,
            { position: i, updatedAt: now },
            tx,
          );
        }
      }
      return reordered.map((it) => ({ ...it, position: reordered.indexOf(it) }));
    });
  }
}
