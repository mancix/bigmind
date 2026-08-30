import Dexie, { type EntityTable } from 'dexie';
import { extractWikiLinks, normalizeWikiLinkName } from '@bigmind/domain/links';

/**
 * Dexie schema and migrations (IndexedDB).
 *
 * This module is intentionally platform-specific: it declares the Dexie
 * database, the versioned schemas, and the upgrade migrations. Application
 * code must NOT import it directly — use the `StorageAdapter` facade from
 * `./dexie-storage-adapter.ts` / `./index.ts` instead.
 */
import type {
  CategoryRecord,
  ConflictRecord,
  NoteAliasRecord,
  NoteLinkRecord,
  NoteRecord,
  NotificationRecord,
  OutboxRecord,
  ReminderRecord,
  SyncStateRecord,
  TodoItemRecord,
} from '@bigmind/storage';

import type { RemoteChange } from '../sync/sync.types';

export type {
  CategoryConflict,
  CategoryRecord,
  ConflictRecord,
  ConflictSnapshotRecord,
  NoteAliasRecord,
  NoteConflict,
  NoteLinkRecord,
  NoteRecord,
  NotificationRecord,
  OutboxRecord,
  ReminderRecord,
  SyncRecord,
  SyncStateRecord,
  TodoItemRecord,
} from '@bigmind/storage';

export class BigMindDatabase extends Dexie {
  notes!: EntityTable<NoteRecord, 'id'>;
  categories!: EntityTable<CategoryRecord, 'id'>;
  noteLinks!: EntityTable<NoteLinkRecord, 'id'>;
  noteAliases!: EntityTable<NoteAliasRecord, 'id'>;
  todoItems!: EntityTable<TodoItemRecord, 'id'>;
  reminders!: EntityTable<ReminderRecord, 'id'>;
  notifications!: EntityTable<NotificationRecord, 'id'>;
  outbox!: EntityTable<OutboxRecord, 'id'>;
  syncState!: EntityTable<SyncStateRecord, 'key'>;
  conflicts!: EntityTable<ConflictRecord, 'id'>;

  constructor() {
    super('bigmind');

    this.version(1).stores({
      notes: 'id, title, updatedAt, deletedAt, syncStatus',
      outbox: 'id, entityId, createdAt, status',
      syncState: 'key',
    });

    this.version(2)
      .stores({
        notes: 'id, title, updatedAt, deletedAt, syncStatus',
        outbox:
          'id, entityId, createdAt, status, nextRetryAt, [entityId+status]',
        syncState: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<OutboxRecord>('outbox')
          .toCollection()
          .modify((operation) => {
            operation.retryCount ??= 0;
            operation.status ??= 'pending';
          });
      });

    this.version(3)
      .stores({
        notes: 'id, title, categoryId, updatedAt, deletedAt, syncStatus',
        categories:
          'id, parentId, position, updatedAt, deletedAt, syncStatus, [parentId+position]',
        outbox:
          'id, entityId, entityType, createdAt, status, nextRetryAt, [entityId+status]',
        syncState: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<NoteRecord>('notes')
          .toCollection()
          .modify((note) => {
            note.categoryId ??= null;
          });
        await transaction
          .table<OutboxRecord>('outbox')
          .toCollection()
          .modify((operation) => {
            if (operation.entityType === 'note') {
              (operation.payload as NoteRecord).categoryId ??= null;
            }
          });
      });

    this.version(4)
      .stores({
        notes: 'id, title, categoryId, updatedAt, deletedAt, syncStatus',
        categories:
          'id, parentId, position, updatedAt, deletedAt, syncStatus, [parentId+position]',
        outbox:
          'id, entityId, entityType, createdAt, status, nextRetryAt, [entityId+status]',
        syncState: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<CategoryRecord>('categories')
          .toCollection()
          .modify((category) => {
            category.icon ??= null;
          });
        await transaction
          .table<OutboxRecord>('outbox')
          .toCollection()
          .modify((operation) => {
            if (operation.entityType === 'category') {
              (operation.payload as CategoryRecord).icon ??= null;
            }
          });
      });

    this.version(5)
      .stores({
        notes: 'id, title, categoryId, updatedAt, deletedAt, syncStatus',
        categories:
          'id, parentId, position, updatedAt, deletedAt, syncStatus, [parentId+position]',
        noteLinks:
          'id, sourceNoteId, targetNoteId, syncStatus, [sourceNoteId+targetNoteId]',
        noteAliases: 'id, noteId, normalizedAlias, [noteId+normalizedAlias]',
        outbox:
          'id, entityId, entityType, createdAt, status, nextRetryAt, [entityId+status]',
        syncState: 'key',
      })
      .upgrade(async (transaction) => {
        const notes = await transaction.table<NoteRecord>('notes').toArray();
        const activeNotes = notes.filter((note) => !note.deletedAt);
        const notesByTitle = new Map(
          activeNotes.map((note) => [normalizeWikiLinkName(note.title), note]),
        );

        for (const source of activeNotes) {
          for (const targetTitle of extractWikiLinks(source.content)) {
            const target = notesByTitle.get(normalizeWikiLinkName(targetTitle));
            const timestamp = source.updatedAt;
            const link: NoteLinkRecord = {
              id: crypto.randomUUID(),
              sourceNoteId: source.id,
              targetNoteId: target?.id ?? null,
              targetTitle,
              createdAt: timestamp,
              deletedAt: null,
              version: 0,
              syncStatus: target ? 'pending' : 'local',
            };

            await transaction.table<NoteLinkRecord>('noteLinks').add(link);
            if (target) {
              await transaction.table<OutboxRecord>('outbox').add({
                id: crypto.randomUUID(),
                entityId: link.id,
                entityType: 'link',
                operation: 'create',
                baseVersion: 0,
                payload: link,
                createdAt: timestamp,
                retryCount: 0,
                status: 'pending',
              });
            }
          }
        }
      });

    this.version(6)
      .stores({
        notes: 'id, title, categoryId, updatedAt, deletedAt, syncStatus',
        categories:
          'id, parentId, position, updatedAt, deletedAt, syncStatus, [parentId+position]',
        noteLinks:
          'id, sourceNoteId, targetNoteId, syncStatus, [sourceNoteId+targetNoteId]',
        noteAliases: 'id, noteId, normalizedAlias, [noteId+normalizedAlias]',
        outbox:
          'id, entityId, entityType, createdAt, status, nextRetryAt, [entityId+status]',
        syncState: 'key',
        conflicts: 'id, entityId, entityType, status, createdAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<NoteRecord>('notes')
          .filter(
            (note) => note.syncStatus === 'conflict' && Boolean(note.conflict),
          )
          .modify((note) => {
            const inline = note.conflict as
              | {
                  operationId?: string;
                  baseVersion: number;
                  localPayload: NoteRecord;
                  remoteChange?: RemoteChange;
                  detectedAt: string;
                }
              | undefined;

            if (!inline || !inline.remoteChange) {
              note.conflict = undefined;
              return;
            }

            const remote = inline.remoteChange;
            const conflict: ConflictRecord = {
              id: crypto.randomUUID(),
              entityType: 'note',
              entityId: note.id,
              conflictType: 'generic',
              localVersion: inline.baseVersion,
              remoteVersion: remote.version,
              localSnapshot: {
                version: inline.baseVersion,
                entity: inline.localPayload,
              },
              remoteSnapshot: {
                version: remote.version,
                entity: remote.payload,
                changedAt: remote.changedAt,
                operation: remote.operation,
              },
              baseVersion: inline.baseVersion,
              createdAt: inline.detectedAt,
              status: 'open',
            };

            transaction.table<ConflictRecord>('conflicts').add(conflict);
            note.conflict = undefined;
          });

        await transaction
          .table<CategoryRecord>('categories')
          .filter(
            (category) =>
              category.syncStatus === 'conflict' && Boolean(category.conflict),
          )
          .modify((category) => {
            const inline = category.conflict as
              | {
                  operationId?: string;
                  baseVersion: number;
                  localPayload: CategoryRecord;
                  remoteChange?: RemoteChange;
                  detectedAt: string;
                }
              | undefined;

            if (!inline || !inline.remoteChange) {
              category.conflict = undefined;
              return;
            }

            const remote = inline.remoteChange;
            const conflict: ConflictRecord = {
              id: crypto.randomUUID(),
              entityType: 'category',
              entityId: category.id,
              conflictType: 'generic',
              localVersion: inline.baseVersion,
              remoteVersion: remote.version,
              localSnapshot: {
                version: inline.baseVersion,
                entity: inline.localPayload,
              },
              remoteSnapshot: {
                version: remote.version,
                entity: remote.payload,
                changedAt: remote.changedAt,
                operation: remote.operation,
              },
              baseVersion: inline.baseVersion,
              createdAt: inline.detectedAt,
              status: 'open',
            };

            transaction.table<ConflictRecord>('conflicts').add(conflict);
            category.conflict = undefined;
          });
      });

    this.version(7)
      .stores({
        notes:
          'id, title, categoryId, templateType, updatedAt, deletedAt, syncStatus',
        categories:
          'id, parentId, position, updatedAt, deletedAt, syncStatus, [parentId+position]',
        noteLinks:
          'id, sourceNoteId, targetNoteId, syncStatus, [sourceNoteId+targetNoteId]',
        noteAliases: 'id, noteId, normalizedAlias, [noteId+normalizedAlias]',
        outbox:
          'id, entityId, entityType, createdAt, status, nextRetryAt, [entityId+status]',
        syncState: 'key',
        conflicts: 'id, entityId, entityType, status, createdAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<NoteRecord>('notes')
          .toCollection()
          .modify((note) => {
            (note as any).templateType = 'MARKDOWN';
          });
        await transaction
          .table<OutboxRecord>('outbox')
          .toCollection()
          .modify((operation) => {
            if (operation.entityType === 'note') {
              (operation.payload as any).templateType ??= 'MARKDOWN';
            }
          });
      });

    this.version(8)
      .stores({
        notes:
          'id, title, categoryId, templateType, updatedAt, deletedAt, syncStatus',
        categories:
          'id, parentId, position, updatedAt, deletedAt, syncStatus, [parentId+position]',
        noteLinks:
          'id, sourceNoteId, targetNoteId, syncStatus, [sourceNoteId+targetNoteId]',
        noteAliases: 'id, noteId, normalizedAlias, [noteId+normalizedAlias]',
        todoItems: 'id, todoListId, syncStatus',
        outbox:
          'id, entityId, entityType, createdAt, status, nextRetryAt, [entityId+status]',
        syncState: 'key',
        conflicts: 'id, entityId, entityType, status, createdAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<OutboxRecord>('outbox')
          .toCollection()
          .modify((operation) => {
            if (operation.entityType === 'todo_item') {
              (operation.payload as any).version ??= 0;
              (operation.payload as any).deletedAt ??= null;
            }
          });
      });
    this.version(9)
      .stores({
        notes:
          'id, title, categoryId, templateType, updatedAt, deletedAt, syncStatus',
        categories:
          'id, parentId, position, updatedAt, deletedAt, syncStatus, [parentId+position]',
        noteLinks:
          'id, sourceNoteId, targetNoteId, syncStatus, [sourceNoteId+targetNoteId]',
        noteAliases: 'id, noteId, normalizedAlias, [noteId+normalizedAlias]',
        todoItems: 'id, todoListId, syncStatus',
        outbox:
          'id, entityId, entityType, createdAt, status, nextRetryAt, [entityId+status]',
        syncState: 'key',
        conflicts: 'id, entityId, entityType, status, createdAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<CategoryRecord>('categories')
          .toCollection()
          .modify((category) => {
            (category as any).description = '';
          });
        await transaction
          .table<OutboxRecord>('outbox')
          .toCollection()
          .modify((operation) => {
            if (operation.entityType === 'category') {
              (operation.payload as any).description ??= '';
            }
          });
      });

    this.version(10).stores({
      notes:
        'id, title, categoryId, templateType, updatedAt, deletedAt, syncStatus',
      categories:
        'id, parentId, position, updatedAt, deletedAt, syncStatus, [parentId+position]',
      noteLinks:
        'id, sourceNoteId, targetNoteId, syncStatus, [sourceNoteId+targetNoteId]',
      noteAliases: 'id, noteId, normalizedAlias, [noteId+normalizedAlias]',
      todoItems: 'id, todoListId, syncStatus',
      reminders: 'id, workspaceId, dueAt, completed, syncStatus',
      outbox:
        'id, entityId, entityType, createdAt, status, nextRetryAt, [entityId+status]',
      syncState: 'key',
      conflicts: 'id, entityId, entityType, status, createdAt',
    });

    this.version(11).stores({
      notes:
        'id, title, categoryId, templateType, updatedAt, deletedAt, syncStatus',
      categories:
        'id, parentId, position, updatedAt, deletedAt, syncStatus, [parentId+position]',
      noteLinks:
        'id, sourceNoteId, targetNoteId, syncStatus, [sourceNoteId+targetNoteId]',
      noteAliases: 'id, noteId, normalizedAlias, [noteId+normalizedAlias]',
      todoItems: 'id, todoListId, syncStatus',
      reminders: 'id, workspaceId, dueAt, completed, syncStatus',
      notifications: 'id, workspaceId, type, read, createdAt, syncStatus',
      outbox:
        'id, entityId, entityType, createdAt, status, nextRetryAt, [entityId+status]',
      syncState: 'key',
      conflicts: 'id, entityId, entityType, status, createdAt',
    });
  }
}

export const db = new BigMindDatabase();
