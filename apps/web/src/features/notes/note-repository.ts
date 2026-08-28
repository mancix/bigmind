import {
  db,
  type NoteRecord,
  type OutboxRecord,
} from '../../storage/database';
import {
  isNoteDeleted,
  normalizeNoteTitle,
  updateNoteContent,
  type TemplateType,
} from '@bigmind/domain/notes';
import {
  OutboxRepository,
  outboxRepository,
} from '../../sync/outbox-repository';
import { requestBackgroundSync } from '../../sync/background-sync';
import { LinkRepository } from '../links/link-repository';

export interface CreateNoteInput {
  title?: string;
  content?: string;
  categoryId?: string | null;
  templateType?: TemplateType;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  categoryId?: string | null;
}

export interface NoteListQuery {
  search?: string;
  categoryId?: string | null;
  includeAllCategories?: boolean;
}

export class NoteRepository {
  constructor(
    private readonly outbox: OutboxRepository = outboxRepository,
    private readonly links: LinkRepository = new LinkRepository(outbox),
  ) {}

  async list(query: NoteListQuery = {}): Promise<NoteRecord[]> {
    const notes = await db.notes
      .orderBy('updatedAt')
      .reverse()
      .filter((note) => !isNoteDeleted(note))
      .toArray();
    const search = query.search?.trim().toLocaleLowerCase();
    const aliases = search ? await db.noteAliases.toArray() : [];
    const aliasesByNote = new Map<string, string[]>();
    for (const alias of aliases) {
      const values = aliasesByNote.get(alias.noteId) ?? [];
      values.push(alias.normalizedAlias);
      aliasesByNote.set(alias.noteId, values);
    }
    const hasCategoryFilter =
      !query.includeAllCategories && 'categoryId' in query;
    return notes.filter(
      (note) =>
        (!hasCategoryFilter || note.categoryId === query.categoryId) &&
        (!search ||
          note.title.toLocaleLowerCase().includes(search) ||
          note.content.toLocaleLowerCase().includes(search) ||
          (aliasesByNote.get(note.id) ?? []).some((alias) =>
            alias.includes(search)
          )),
    );
  }

  async findById(id: string): Promise<NoteRecord | undefined> {
    const note = await db.notes.get(id);

    return note && !isNoteDeleted(note) ? note : undefined;
  }

  async create(input: CreateNoteInput = {}): Promise<string> {
    const timestamp = this.now();
    const noteId = this.generateId();
    const note: NoteRecord = {
      id: noteId,
      title: normalizeNoteTitle(input.title ?? ''),
      content: input.content ?? '',
      categoryId: input.categoryId ?? null,
      templateType: input.templateType ?? 'MARKDOWN',
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 0,
      syncStatus: 'pending',
    };

    await this.outbox.transactionWithNoteGraph(async () => {
      await db.notes.add(note);
      await this.outbox.add(this.createOperation('create', note, timestamp));
      await this.links.rebuildForNote(note);
      await this.links.resolveUnresolvedLinks(note);
    });

    requestBackgroundSync();
    return noteId;
  }

  async update(id: string, changes: UpdateNoteInput): Promise<void> {
    await this.outbox.transactionWithNoteGraph(async () => {
      const existingNote = await db.notes.get(id);

      if (!existingNote || isNoteDeleted(existingNote)) {
        throw new Error(`Note "${id}" was not found.`);
      }

      const timestamp = this.now();
      const updatedNote: NoteRecord = {
        ...updateNoteContent(existingNote, changes, timestamp),
        syncStatus: 'pending',
        conflict: undefined,
      };

      await db.notes.put(updatedNote);

      if (existingNote.title !== updatedNote.title) {
        await this.links.recordAlias(id, existingNote.title, timestamp);
      }
      await this.links.rebuildForNote(updatedNote);
      await this.links.resolveUnresolvedLinks(updatedNote);

      const operations = await this.coalescableOperations(id);
      const pendingCreate = operations.find(
        (operation) => operation.operation === 'create',
      );

      if (pendingCreate) {
        await this.outbox.save(
          this.resetOperation(pendingCreate, updatedNote),
        );
        return;
      }

      const pendingUpdate = operations.find(
        (operation) => operation.operation === 'update',
      );

      if (pendingUpdate) {
        await this.outbox.save(
          this.resetOperation(pendingUpdate, updatedNote),
        );
        return;
      }

      await this.outbox.add(
        this.createOperation('update', updatedNote, timestamp),
      );
    });

    requestBackgroundSync();
  }

  async delete(id: string): Promise<void> {
    await this.outbox.transactionWithNoteGraph(async () => {
      const existingNote = await db.notes.get(id);

      if (!existingNote || isNoteDeleted(existingNote)) {
        return;
      }

      const operations = await this.coalescableOperations(id);
      const pendingCreate = operations.find(
        (operation) => operation.operation === 'create',
      );

      if (pendingCreate) {
        await this.links.deleteLinksForNote(id);
        await db.notes.delete(id);
        await this.outbox.removeMany(
          operations.map((operation) => operation.id),
        );
        return;
      }

      const timestamp = this.now();
      const deletedNote: NoteRecord = {
        ...existingNote,
        deletedAt: timestamp,
        updatedAt: timestamp,
        syncStatus: 'pending',
        conflict: undefined,
      };

      await db.notes.put(deletedNote);
      await this.links.deleteLinksForNote(id, timestamp);

      const existingDelete = operations.find(
        (operation) => operation.operation === 'delete',
      );
      const pendingUpdate = operations.find(
        (operation) => operation.operation === 'update',
      );
      const operationToReuse = existingDelete ?? pendingUpdate;

      if (operationToReuse) {
        await this.outbox.save({
          ...this.resetOperation(operationToReuse, deletedNote),
          operation: 'delete',
        });
        return;
      }

      await this.outbox.add(
        this.createOperation('delete', deletedNote, timestamp),
      );
    });

    requestBackgroundSync();
  }

  async search(query: string | NoteListQuery): Promise<NoteRecord[]> {
    return this.list(typeof query === 'string' ? { search: query } : query);
  }

  async count(): Promise<number> {
    return db.notes.filter((note) => !isNoteDeleted(note)).count();
  }

  private async coalescableOperations(id: string): Promise<OutboxRecord[]> {
    const operations = await this.outbox.listForEntity(id, 'note');

    return operations.filter(
      (operation) =>
        operation.status === 'pending' || operation.status === 'failed',
    );
  }

  private createOperation(
    operation: OutboxRecord['operation'],
    note: NoteRecord,
    createdAt: string,
  ): OutboxRecord {
    return {
      id: this.generateId(),
      entityId: note.id,
      entityType: 'note',
      operation,
      baseVersion: note.version,
      payload: note,
      createdAt,
      retryCount: 0,
      status: 'pending',
    };
  }

  private resetOperation(
    operation: OutboxRecord,
    payload: NoteRecord,
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
    return crypto.randomUUID();
  }

  private now(): string {
    return new Date().toISOString();
  }
}

export const noteRepository = new NoteRepository();
