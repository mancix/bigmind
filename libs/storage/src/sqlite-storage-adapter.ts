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
} from './records.js';
import type {
  StorageAdapter,
  StorageCollection,
  StorageKeyValueTable,
  StorageTable,
  StorageTableHook,
  StorageWhereClause,
} from './storage-adapter.js';
import type {
  SqliteBindValue,
  SqliteDriver,
  SqliteTransaction,
} from './sqlite-driver.js';
import {
  buildInitialSqliteMigrations,
  runSqliteMigrations,
  type SqliteMigration,
} from './sqlite-migrations.js';
import { SQLITE_TABLE_MAP, type SqliteTableSchema } from './sqlite-schema.js';

/**
 * SQLite implementation of {@link StorageAdapter}.
 *
 * Platform-independent: the adapter talks only to the {@link SqliteDriver}
 * contract, so the same class powers Expo (expo-sqlite driver) and Node tests
 * (node:sqlite driver). Query algebra (`where`/`orderBy`/`filter`/`sortBy`),
 * Dexie-style `update` undefined-removal, change hooks, transactions and the
 * migration lifecycle are all implemented here — nothing else knows about SQL.
 *
 * Storage layout: one row per record (`id`/`key` TEXT PRIMARY KEY, `data`
 * TEXT = canonical JSON, plus duplicated index columns). See sqlite-schema.ts.
 */

type HookEvent = 'creating' | 'updating' | 'deleting';

type SingleHook = (...args: unknown[]) => unknown;

const isStringy = (value: unknown): value is string | null | undefined =>
  value === null || value === undefined || typeof value === 'string';

const isPlainString = (value: unknown): value is string =>
  typeof value === 'string';

/** Field values used as WHERE bind params (index columns are TEXT). */
const toBind = (value: unknown): SqliteBindValue =>
  value === undefined || value === null ? null : String(value);

/** Dexie semantics: `undefined` removes the property from the record. */
function applyChanges<T>(record: T, changes: Partial<T>): void {
  const target = record as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
}

/** Identical ordering rules to the in-memory adapter (parity requirement). */
function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

const compoundParts = (index: string): string[] | null =>
  index.startsWith('[') && index.endsWith(']')
    ? index.slice(1, -1).split('+')
    : null;

class SqliteTable<T extends { id: string }> implements StorageTable<T> {
  private readonly listeners: Record<HookEvent, SingleHook[]> = {
    creating: [],
    updating: [],
    deleting: [],
  };

  constructor(
    private readonly adapter: SqliteStorageAdapter,
    private readonly schema: SqliteTableSchema,
  ) {}

  // ---- helpers -----------------------------------------------------------

  private handle(): Promise<SqliteTransaction> {
    return this.adapter.readyHandle();
  }

  private sqlColumnFor(index: string): string | undefined {
    if (index === this.schema.keyField) {
      return this.schema.keyColumn;
    }
    return this.schema.indexColumns[index];
  }

  private indexValue(record: T, index: string): unknown {
    if (index === this.schema.keyField) {
      return (record as Record<string, unknown>)[this.schema.keyField];
    }
    const parts = compoundParts(index);
    if (parts) {
      return parts.map(
        (part) => (record as Record<string, unknown>)[part],
      );
    }
    return (record as Record<string, unknown>)[index];
  }

  private matchesIndex(record: T, index: string, values: unknown[]): boolean {
    const parts = compoundParts(index);
    if (parts) {
      const valueArray = values[0];
      if (!Array.isArray(valueArray) || valueArray.length < parts.length) {
        return false;
      }
      return parts.every((part, position) => {
        return (
          (record as Record<string, unknown>)[part] === valueArray[position]
        );
      });
    }
    const recordValue = this.indexValue(record, index);
    return values.some((value) => recordValue === value);
  }

  private emit(event: HookEvent, ...args: unknown[]): void {
    for (const listener of this.listeners[event]) {
      listener(...args);
    }
  }

  private serialize(record: T): {
    data: string;
    columns: string[];
    values: SqliteBindValue[];
  } {
    const data = JSON.stringify(record);
    const columns = [this.schema.keyColumn];
    const values: SqliteBindValue[] = [
      (record as Record<string, unknown>)[this.schema.keyField] as string,
    ];
    for (const [queryIndex, sqlColumn] of Object.entries(
      this.schema.indexColumns,
    )) {
      columns.push(sqlColumn);
      values.push(toBind((record as Record<string, unknown>)[queryIndex]));
    }
    return { data, columns, values };
  }

  private upsertSql(
    data: string,
    columns: string[],
    values: SqliteBindValue[],
  ): { sql: string; params: SqliteBindValue[] } {
    const insertColumns = [...columns, this.schema.dataColumn];
    const placeholders = insertColumns.map(() => '?').join(', ');
    const assignment = [...columns, this.schema.dataColumn]
      .map((column) => `"${column}" = excluded."${column}"`)
      .join(', ');
    const sql =
      `INSERT INTO "${this.schema.table}" (${insertColumns
        .map((column) => `"${column}"`)
        .join(', ')}) VALUES (${placeholders}) ` +
      `ON CONFLICT("${this.schema.keyColumn}") DO UPDATE SET ${assignment};`;
    return { sql, params: [...values, data] };
  }

  private async loadAll(): Promise<T[]> {
    const rows = await this.handle().then((tx) =>
      tx.getAllAsync<{ data: string }>(
        `SELECT "${this.schema.dataColumn}" AS data FROM "${this.schema.table}" ORDER BY rowid;`,
      ),
    );
    return rows.map((row) => JSON.parse(row.data) as T);
  }

  private async loadWhere(
    predicate: (record: T) => boolean,
  ): Promise<T[]> {
    return (await this.loadAll()).filter(predicate);
  }

  private async loadBySql(
    sql: string,
    params: SqliteBindValue[],
  ): Promise<T[]> {
    const rows = await this.handle().then((tx) =>
      tx.getAllAsync<{ data: string }>(sql, ...params),
    );
    return rows.map((row) => JSON.parse(row.data) as T);
  }

  private async writeRow(record: T): Promise<void> {
    const { data, columns, values } = this.serialize(record);
    const { sql, params } = this.upsertSql(data, columns, values);
    await this.handle().then((tx) => tx.runAsync(sql, ...params));
  }

  private async indexParamsFor(record: T): Promise<{
    data: string;
    assignments: string[];
    params: SqliteBindValue[];
  }> {
    const data = JSON.stringify(record);
    const assignments: string[] = [`"${this.schema.dataColumn}" = ?`];
    const params: SqliteBindValue[] = [data];
    for (const [queryIndex, sqlColumn] of Object.entries(
      this.schema.indexColumns,
    )) {
      const recordValue = (record as Record<string, unknown>)[queryIndex];
      assignments.push(`"${sqlColumn}" = ?`);
      params.push(toBind(recordValue));
    }
    return { data, assignments, params };
  }

  private async updateRow(id: string, record: T): Promise<void> {
    const { assignments, params } = await this.indexParamsFor(record);
    params.push(id);
    await this.handle().then((tx) =>
      tx.runAsync(
        `UPDATE "${this.schema.table}" SET ${assignments.join(', ')} WHERE "${this.schema.keyColumn}" = ?;`,
        ...params,
      ),
    );
  }

  private async deleteRow(id: string): Promise<void> {
    await this.handle().then((tx) =>
      tx.runAsync(
        `DELETE FROM "${this.schema.table}" WHERE "${this.schema.keyColumn}" = ?;`,
        id,
      ),
    );
  }

  /**
   * Build the `where` SQL for a single-column index when every value is
   * string-like (the common case); returns `null` when the index is unknown
   * or a value needs JS matching (falls back to an in-memory scan so memory
   * and SQLite adapters behave identically).
   */
  private whereSql(
    index: string,
    values: unknown[],
    flattenArrays: boolean,
  ): { sql: string; params: SqliteBindValue[] } | null {
    const column = this.sqlColumnFor(index);
    if (!column || !values.every(isStringy)) {
      return null;
    }
    // `anyOf([a, b])` and `anyOf(a, b)` are equivalent; `equals()` never
    // flattens (mirrors the in-memory adapter exactly).
    const list =
      flattenArrays && values.length === 1 && Array.isArray(values[0])
        ? values[0]
        : values;
    const present = list.filter(isPlainString);
    const hasNull = list.some((value) => value === null || value === undefined);
    if (list.length === 0) {
      return { sql: `WHERE 0`, params: [] };
    }
    const clauses: string[] = [];
    const params: SqliteBindValue[] = [];
    if (present.length > 0) {
      clauses.push(
        `"${column}" IN (${present.map(() => '?').join(', ')})`,
      );
      params.push(...present);
    }
    if (hasNull) {
      clauses.push(`"${column}" IS NULL`);
    }
    return { sql: `WHERE ${clauses.join(' OR ')}`, params };
  }

  private collection(
    source: () => Promise<T[]>,
    filters: Array<(record: T) => boolean>,
    descending = false,
  ): StorageCollection<T> {
    const evaluate = async (): Promise<T[]> => {
      let rows = await source();
      if (descending) {
        rows = [...rows].reverse();
      }
      for (const filter of filters) {
        rows = rows.filter(filter);
      }
      return rows;
    };

    const collection: StorageCollection<T> = {
      filter: (predicate) =>
        this.collection(source, [...filters, predicate], descending),
      reverse: () => this.collection(source, filters, !descending),
      sortBy: async (index) => {
        const rows = await evaluate();
        const direction = descending ? -1 : 1;
        return rows.sort(
          (left, right) =>
            compareValues(
              this.indexValue(left, index),
              this.indexValue(right, index),
            ) * direction,
        );
      },
      toArray: () => evaluate(),
      first: async () => (await evaluate())[0],
      count: async () => (await evaluate()).length,
      modify: async (changes) => {
        const rows = await evaluate();
        for (const row of rows) {
          this.emit('updating', changes, row.id, row);
          applyChanges(row, changes);
          await this.updateRow(row.id, row);
        }
        return rows.length;
      },
      delete: async () => {
        const rows = await evaluate();
        for (const row of rows) {
          this.emit('deleting', row.id);
          await this.deleteRow(row.id);
        }
      },
    };
    return collection;
  }

  // ---- StorageTable contract ---------------------------------------------

  hook(event: HookEvent): StorageTableHook {
    return {
      subscribe: (listener: SingleHook) => {
        this.listeners[event].push(listener);
      },
      unsubscribe: (listener: SingleHook) => {
        const index = this.listeners[event].indexOf(listener);
        if (index !== -1) {
          this.listeners[event].splice(index, 1);
        }
      },
    };
  }

  async get(id: string): Promise<T | undefined>;
  async get(ids: string[]): Promise<T[]>;
  async get(idOrIds: string | string[]): Promise<T | undefined | T[]> {
    if (Array.isArray(idOrIds)) {
      if (idOrIds.length === 0) {
        return [];
      }
      const rows = await this.handle().then((tx) =>
        tx.getAllAsync<{ data: string }>(
          `SELECT "${this.schema.dataColumn}" AS data FROM "${this.schema.table}" WHERE "${this.schema.keyColumn}" IN (${idOrIds
            .map(() => '?')
            .join(', ')});`,
          ...idOrIds,
        ),
      );
      const byKey = new Map(
        rows.map((row) => [JSON.parse(row.data)[this.schema.keyField], row]),
      );
      return idOrIds
        .map((id) => byKey.get(id))
        .filter((row): row is { data: string } => Boolean(row))
        .map((row) => JSON.parse(row.data) as T);
    }
    const row = await this.handle().then((tx) =>
      tx.getFirstAsync<{ data: string }>(
        `SELECT "${this.schema.dataColumn}" AS data FROM "${this.schema.table}" WHERE "${this.schema.keyColumn}" = ?;`,
        idOrIds,
      ),
    );
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  async put(record: T): Promise<void> {
    const existing = await this.get((record as Record<string, string>)[
      this.schema.keyField
    ] as string);
    if (existing) {
      this.emit('updating', record, (record as { id: string }).id, existing);
    } else {
      this.emit('creating', (record as { id: string }).id, record);
    }
    await this.writeRow(record);
  }

  async add(record: T): Promise<string> {
    this.emit('creating', (record as { id: string }).id, record);
    await this.writeRow(record);
    return (record as { id: string }).id;
  }

  async bulkAdd(records: T[]): Promise<void> {
    for (const record of records) {
      this.emit('creating', (record as { id: string }).id, record);
      await this.writeRow(record);
    }
  }

  async bulkGet(ids: string[]): Promise<T[]> {
    return this.get(ids) as Promise<T[]>;
  }

  async bulkPut(records: T[]): Promise<void> {
    for (const record of records) {
      await this.put(record);
    }
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      const existing = await this.get(id);
      if (existing) {
        this.emit('deleting', id);
        await this.deleteRow(id);
      }
    }
  }

  async update(id: string, changes: Partial<T>): Promise<number> {
    const existing = await this.get(id);
    if (!existing) {
      return 0;
    }
    this.emit('updating', changes, id, existing);
    applyChanges(existing, changes);
    await this.updateRow(id, existing);
    return 1;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    if (existing) {
      this.emit('deleting', id);
      await this.deleteRow(id);
    }
  }

  clear(): Promise<void> {
    return this.handle().then((tx) =>
      tx.runAsync(`DELETE FROM "${this.schema.table}";`),
    ).then(() => undefined);
  }

  async count(): Promise<number> {
    const row = await this.handle().then((tx) =>
      tx.getFirstAsync<{ n: number | bigint }>(
        `SELECT COUNT(*) AS n FROM "${this.schema.table}";`,
      ),
    );
    return row ? Number(row.n) : 0;
  }

  toArray(): Promise<T[]> {
    return this.loadAll();
  }

  filter(predicate: (record: T) => boolean): StorageCollection<T> {
    return this.collection(
      async () => (await this.loadAll()).filter(predicate),
      [],
    );
  }

  where(index: string): StorageWhereClause<T> {
    const clause: StorageWhereClause<T> = {
      equals: (...values) => {
        const sql = this.whereSql(index, values, false);
        if (sql) {
          return this.collection(
            () =>
              this.loadBySql(
                `SELECT "${this.schema.dataColumn}" AS data FROM "${this.schema.table}" ${sql.sql};`,
                sql.params,
              ),
            [],
          );
        }
        return this.collection(
          () => this.loadWhere((record) => this.matchesIndex(record, index, values)),
          [],
        );
      },
      anyOf: (...values) => {
        const sql = this.whereSql(index, values, true);
        if (sql) {
          return this.collection(
            () =>
              this.loadBySql(
                `SELECT "${this.schema.dataColumn}" AS data FROM "${this.schema.table}" ${sql.sql};`,
                sql.params,
              ),
            [],
          );
        }
        const list =
          values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
        return this.collection(
          () =>
            this.loadWhere((record) =>
              this.matchesIndex(record, index, list as unknown[]),
            ),
          [],
        );
      },
    };
    return clause;
  }

  orderBy(index: string): StorageCollection<T> {
    const sorted = async (): Promise<T[]> => {
      const rows = await this.loadAll();
      return rows.sort((left, right) =>
        compareValues(this.indexValue(left, index), this.indexValue(right, index)),
      );
    };
    return this.collection(sorted, []);
  }
}

class SqliteKeyValueTable<
  T extends { key: string },
> implements StorageKeyValueTable<T> {
  constructor(
    private readonly adapter: SqliteStorageAdapter,
    private readonly schema: SqliteTableSchema,
  ) {}

  async get(key: string): Promise<T | undefined> {
    const row = await this.adapter.readyHandle().then((tx) =>
      tx.getFirstAsync<{ data: string }>(
        `SELECT "${this.schema.dataColumn}" AS data FROM "${this.schema.table}" WHERE "${this.schema.keyColumn}" = ?;`,
        key,
      ),
    );
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  async put(record: T): Promise<void> {
    await this.adapter.readyHandle().then((tx) =>
      tx.runAsync(
        `INSERT INTO "${this.schema.table}" ("${this.schema.keyColumn}", "${this.schema.dataColumn}") VALUES (?, ?) ` +
          `ON CONFLICT("${this.schema.keyColumn}") DO UPDATE SET "${this.schema.dataColumn}" = excluded."${this.schema.dataColumn}";`,
        record.key,
        JSON.stringify(record),
      ),
    );
  }

  async bulkPut(records: T[]): Promise<void> {
    for (const record of records) {
      await this.put(record);
    }
  }

  async clear(): Promise<void> {
    await this.adapter
      .readyHandle()
      .then((tx) => tx.runAsync(`DELETE FROM "${this.schema.table}";`));
  }

  async count(): Promise<number> {
    const row = await this.adapter.readyHandle().then((tx) =>
      tx.getFirstAsync<{ n: number | bigint }>(
        `SELECT COUNT(*) AS n FROM "${this.schema.table}";`,
      ),
    );
    return row ? Number(row.n) : 0;
  }

  async toArray(): Promise<T[]> {
    const rows = await this.adapter.readyHandle().then((tx) =>
      tx.getAllAsync<{ data: string }>(
        `SELECT "${this.schema.dataColumn}" AS data FROM "${this.schema.table}" ORDER BY rowid;`,
      ),
    );
    return rows.map((row) => JSON.parse(row.data) as T);
  }
}

/** Config for every table of the {@link StorageAdapter} contract. */
function tableConfig(name: string): SqliteTableSchema {
  return SQLITE_TABLE_MAP.get(name) as SqliteTableSchema;
}

const TABLE_CONFIG = {
  notes: tableConfig('notes'),
  categories: tableConfig('categories'),
  noteLinks: tableConfig('note_links'),
  noteAliases: tableConfig('note_aliases'),
  todoItems: tableConfig('todo_items'),
  reminders: tableConfig('reminders'),
  notifications: tableConfig('notifications'),
  outbox: tableConfig('outbox'),
  syncState: tableConfig('sync_state'),
  conflicts: tableConfig('conflicts'),
} as const;

export class SqliteStorageAdapter implements StorageAdapter {
  readonly notes: StorageTable<NoteRecord>;
  readonly categories: StorageTable<CategoryRecord>;
  readonly noteLinks: StorageTable<NoteLinkRecord>;
  readonly noteAliases: StorageTable<NoteAliasRecord>;
  readonly todoItems: StorageTable<TodoItemRecord>;
  readonly reminders: StorageTable<ReminderRecord>;
  readonly notifications: StorageTable<NotificationRecord>;
  readonly outbox: StorageTable<OutboxRecord>;
  readonly conflicts: StorageTable<ConflictRecord>;
  readonly syncState: StorageKeyValueTable<SyncStateRecord>;

  private readonly migrations: SqliteMigration[];
  private ready: Promise<void> | null = null;
  private transactionHandle: SqliteTransaction | null = null;

  constructor(
    private readonly driver: SqliteDriver,
    migrations?: SqliteMigration[],
  ) {
    this.migrations = migrations ?? buildInitialSqliteMigrations();
    this.notes = new SqliteTable<NoteRecord>(this, TABLE_CONFIG.notes);
    this.categories = new SqliteTable<CategoryRecord>(
      this,
      TABLE_CONFIG.categories,
    );
    this.noteLinks = new SqliteTable<NoteLinkRecord>(
      this,
      TABLE_CONFIG.noteLinks,
    );
    this.noteAliases = new SqliteTable<NoteAliasRecord>(
      this,
      TABLE_CONFIG.noteAliases,
    );
    this.todoItems = new SqliteTable<TodoItemRecord>(
      this,
      TABLE_CONFIG.todoItems,
    );
    this.reminders = new SqliteTable<ReminderRecord>(
      this,
      TABLE_CONFIG.reminders,
    );
    this.notifications = new SqliteTable<NotificationRecord>(
      this,
      TABLE_CONFIG.notifications,
    );
    this.outbox = new SqliteTable<OutboxRecord>(this, TABLE_CONFIG.outbox);
    this.conflicts = new SqliteTable<ConflictRecord>(
      this,
      TABLE_CONFIG.conflicts,
    );
    this.syncState = new SqliteKeyValueTable<SyncStateRecord>(
      this,
      TABLE_CONFIG.syncState,
    );
  }

  /**
   * Apply any pending schema migrations. Lazy: the first table operation also
   * triggers it, so callers can use the adapter without an explicit boot step.
   */
  open(): Promise<void> {
    this.ready ??= runSqliteMigrations(this.driver, this.migrations).then(
      () => undefined,
    );
    return this.ready;
  }

  close(): void {
    void this.driver.close();
  }

  async delete(): Promise<void> {
    await this.driver.deleteDatabase();
    this.ready = null;
    this.transactionHandle = null;
  }

  async transaction<TResult>(
    callback: () => Promise<TResult>,
  ): Promise<TResult> {
    await this.open();
    if (this.transactionHandle) {
      // Nested transaction: reuse the outer one (same composition semantics
      // as the in-memory adapter and Dexie's "transaction belt").
      return callback();
    }
    return this.driver.withTransactionAsync(async (transaction) => {
      this.transactionHandle = transaction;
      try {
        return await callback();
      } finally {
        this.transactionHandle = null;
      }
    });
  }

  async clearAll(): Promise<void> {
    await this.open();
    await this.driver.withTransactionAsync(async (transaction) => {
      for (const table of SQLITE_TABLE_MAP.values()) {
        await transaction.runAsync(`DELETE FROM "${table.table}";`);
      }
    });
  }

  /** Internal: resolves the transaction handle (or the driver when idle). */
  async readyHandle(): Promise<SqliteTransaction> {
    await this.open();
    return this.transactionHandle ?? this.driver;
  }
}

/** Create a {@link StorageAdapter} over any {@link SqliteDriver}. */
export function createSqliteStorageAdapter(
  driver: SqliteDriver,
  migrations?: SqliteMigration[],
): StorageAdapter {
  return new SqliteStorageAdapter(driver, migrations);
}

