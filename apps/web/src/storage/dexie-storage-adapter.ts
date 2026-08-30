import Dexie from 'dexie';
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
import type {
  StorageAdapter,
  StorageKeyValueTable,
  StorageTable,
} from '@bigmind/storage';

import { db, type BigMindDatabase } from './database';

/**
 * IndexedDB implementation of {@link StorageAdapter}, built on Dexie.
 *
 * This is the ONLY module (besides `database.ts`, which owns the schema and
 * migrations) that knows about Dexie. Application repositories, the sync
 * engine, components, and tests depend exclusively on the `StorageAdapter`
 * contract from `@bigmind/storage`.
 *
 * The Dexie `EntityTable` types are structurally compatible with the
 * abstraction for the query surface BigMind uses; the casts below are confined
 * to this adapter boundary (Dexie's `hook` property carries extra call
 * signatures that TypeScript does not assign structurally).
 */
export class DexieStorageAdapter implements StorageAdapter {
  constructor(private readonly database: BigMindDatabase = db) {}

  get notes(): StorageTable<NoteRecord> {
    return this.database.notes as unknown as StorageTable<NoteRecord>;
  }

  get categories(): StorageTable<CategoryRecord> {
    return this.database.categories as unknown as StorageTable<CategoryRecord>;
  }

  get noteLinks(): StorageTable<NoteLinkRecord> {
    return this.database.noteLinks as unknown as StorageTable<NoteLinkRecord>;
  }

  get noteAliases(): StorageTable<NoteAliasRecord> {
    return this.database
      .noteAliases as unknown as StorageTable<NoteAliasRecord>;
  }

  get todoItems(): StorageTable<TodoItemRecord> {
    return this.database.todoItems as unknown as StorageTable<TodoItemRecord>;
  }

  get reminders(): StorageTable<ReminderRecord> {
    return this.database.reminders as unknown as StorageTable<ReminderRecord>;
  }

  get notifications(): StorageTable<NotificationRecord> {
    return this.database
      .notifications as unknown as StorageTable<NotificationRecord>;
  }

  get outbox(): StorageTable<OutboxRecord> {
    return this.database.outbox as unknown as StorageTable<OutboxRecord>;
  }

  get conflicts(): StorageTable<ConflictRecord> {
    return this.database.conflicts as unknown as StorageTable<ConflictRecord>;
  }

  get syncState(): StorageKeyValueTable<SyncStateRecord> {
    return this.database
      .syncState as unknown as StorageKeyValueTable<SyncStateRecord>;
  }

  transaction<TResult>(callback: () => Promise<TResult>): Promise<TResult> {
    return this.database.transaction('rw', this.database.tables, callback);
  }

  clearAll(): Promise<void> {
    return this.database.transaction('rw', this.database.tables, async () => {
      await Promise.all(
        this.database.tables.map((table: Dexie.Table) => table.clear()),
      );
    });
  }

  async open(): Promise<void> {
    await this.database.open();
  }

  close(): void {
    this.database.close();
  }

  delete(): Promise<void> {
    return this.database.delete();
  }
}

/** The application-wide storage adapter singleton. */
export const storage: StorageAdapter = new DexieStorageAdapter();
