/**
 * SQLite table definitions for the BigMind client database.
 *
 * The on-device schema mirrors the web IndexedDB (Dexie) schema v11
 * (`apps/web/src/storage/database.ts`). Every record is stored as one row:
 *
 * - `id` / `key` — primary key (TEXT).
 * - `data` — the canonical record serialized as JSON (single source of truth;
 *   adding a non-indexed field never requires a schema migration).
 * - duplicated index columns — the fields the application queries
 *   (`where`/`orderBy`), declared as separate typed TEXT columns with SQL
 *   indexes so hot paths stay index-backed.
 *
 * This format keeps the adapter forward-compatible: encrypted storage can
 * encrypt just the `data` payload, and workspace isolation can scope queries
 * through new index columns without breaking the `StorageAdapter` contract.
 */

export interface SqliteTableSchema {
  /** SQLite table name. */
  table: string;
  /** Primary key column. */
  keyColumn: string;
  /** The record field that carries the primary key (`id` or `key`). */
  keyField: 'id' | 'key';
  /** Column holding the serialized JSON record. */
  dataColumn: string;
  /** Query index name (as used by `where()`/`orderBy()`) → SQLite column. */
  indexColumns: Record<string, string>;
  /** Compound indexes declared as `[a+b]`; parts must be `indexColumns` keys. */
  compoundIndexes: string[];
}

export const SQLITE_TABLES: SqliteTableSchema[] = [
  {
    table: 'notes',
    keyColumn: 'id',
    keyField: 'id',
    dataColumn: 'data',
    indexColumns: {
      title: 'title',
      categoryId: 'category_id',
      templateType: 'template_type',
      updatedAt: 'updated_at',
      deletedAt: 'deleted_at',
      syncStatus: 'sync_status',
    },
    compoundIndexes: [],
  },
  {
    table: 'categories',
    keyColumn: 'id',
    keyField: 'id',
    dataColumn: 'data',
    indexColumns: {
      parentId: 'parent_id',
      position: 'position',
      updatedAt: 'updated_at',
      deletedAt: 'deleted_at',
      syncStatus: 'sync_status',
    },
    compoundIndexes: ['[parentId+position]'],
  },
  {
    table: 'note_links',
    keyColumn: 'id',
    keyField: 'id',
    dataColumn: 'data',
    indexColumns: {
      sourceNoteId: 'source_note_id',
      targetNoteId: 'target_note_id',
      syncStatus: 'sync_status',
    },
    compoundIndexes: ['[sourceNoteId+targetNoteId]'],
  },
  {
    table: 'note_aliases',
    keyColumn: 'id',
    keyField: 'id',
    dataColumn: 'data',
    indexColumns: {
      noteId: 'note_id',
      normalizedAlias: 'normalized_alias',
    },
    compoundIndexes: ['[noteId+normalizedAlias]'],
  },
  {
    table: 'todo_items',
    keyColumn: 'id',
    keyField: 'id',
    dataColumn: 'data',
    indexColumns: {
      todoListId: 'todo_list_id',
      syncStatus: 'sync_status',
    },
    compoundIndexes: [],
  },
  {
    table: 'reminders',
    keyColumn: 'id',
    keyField: 'id',
    dataColumn: 'data',
    indexColumns: {
      workspaceId: 'workspace_id',
      dueAt: 'due_at',
      completed: 'completed',
      syncStatus: 'sync_status',
    },
    compoundIndexes: [],
  },
  {
    table: 'notifications',
    keyColumn: 'id',
    keyField: 'id',
    dataColumn: 'data',
    indexColumns: {
      workspaceId: 'workspace_id',
      type: 'type',
      read: 'read',
      createdAt: 'created_at',
      syncStatus: 'sync_status',
    },
    compoundIndexes: [],
  },
  {
    table: 'outbox',
    keyColumn: 'id',
    keyField: 'id',
    dataColumn: 'data',
    indexColumns: {
      entityId: 'entity_id',
      entityType: 'entity_type',
      createdAt: 'created_at',
      status: 'status',
      nextRetryAt: 'next_retry_at',
    },
    compoundIndexes: ['[entityId+status]'],
  },
  {
    table: 'conflicts',
    keyColumn: 'id',
    keyField: 'id',
    dataColumn: 'data',
    indexColumns: {
      entityId: 'entity_id',
      entityType: 'entity_type',
      status: 'status',
      createdAt: 'created_at',
    },
    compoundIndexes: [],
  },
  {
    table: 'sync_state',
    keyColumn: 'key',
    keyField: 'key',
    dataColumn: 'data',
    indexColumns: {},
    compoundIndexes: [],
  },
];

export const SQLITE_TABLE_MAP: ReadonlyMap<string, SqliteTableSchema> =
  new Map(SQLITE_TABLES.map((table) => [table.table, table]));

/** The meta table that tracks the applied schema version. */
export const SCHEMA_META_TABLE = 'schema_meta';