/**
 * Web storage facade.
 *
 * Application code imports `storage` (typed as {@link StorageAdapter} from
 * `@bigmind/storage`) from here and never touches Dexie directly. The concrete
 * IndexedDB implementation lives in `dexie-storage-adapter.ts` (Dexie schema
 * and migrations stay in `database.ts`).
 */
export { storage } from './dexie-storage-adapter';

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

export type {
  StorageAdapter,
  StorageCollection,
  StorageKeyValueTable,
  StorageTable,
  StorageTableHook,
  StorageWhereClause,
} from '@bigmind/storage';
