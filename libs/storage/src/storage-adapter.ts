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

/**
 * Platform-independent storage abstraction.
 *
 * `StorageAdapter` is the ONLY storage contract application code depends on:
 *
 * - Web: `DexieStorageAdapter` (apps/web/src/storage/dexie-storage-adapter.ts)
 *   wraps IndexedDB via Dexie.
 * - Mobile: `SqliteStorageAdapter` (libs/storage/src/sqlite-storage-adapter.ts)
 *   over expo-sqlite (see docs/storage-architecture.md).
 * - Tests/bootstrap: `MemoryStorageAdapter` in this file.
 *
 * Capabilities exposed by the adapter: notes, categories, reminders, links
 * (noteLinks + noteAliases), conflicts, and the sync outbox, plus the
 * remaining local tables clients use (todo items, notifications, sync state).
 * Business logic never touches a table implementation directly; it only uses
 * these interface shapes.
 */

/** Terminal query result set, mirroring the Dexie collection subset used by BigMind. */
export interface StorageCollection<T> {
  filter(predicate: (record: T) => boolean): StorageCollection<T>;
  reverse(): StorageCollection<T>;
  toArray(): Promise<T[]>;
  /** Sort by an index; descending when `reverse()` was applied before it (Dexie semantics). */
  sortBy(index: string): Promise<T[]>;
  first(): Promise<T | undefined>;
  count(): Promise<number>;
  /** Apply a partial update to every matched record. Returns the number of modified records. */
  modify(changes: Partial<T>): Promise<number>;
  delete(): Promise<void>;
}

export interface StorageWhereClause<T> {
  /**
   * Match records whose index key equals the given value(s).
   * Compound indexes are declared as `[a+b]` and matched with the key as an array.
   */
  equals(...values: unknown[]): StorageCollection<T>;
  anyOf(...values: unknown[]): StorageCollection<T>;
}

/**
 * Change hooks, equivalent to Dexie's table hooks. Listeners are invoked
 * positionally, exactly like Dexie:
 * - creating:  (primKey, obj)
 * - updating:  (modifications, primKey, obj)
 * - deleting:  (primKey)
 *
 * Write operations performed through the adapter fire these events so
 * platform code (e.g. the web search index) stays in sync.
 */
export interface StorageTableHook {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribe(listener: (...args: any[]) => unknown): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsubscribe(listener: (...args: any[]) => unknown): void;
}

/**
 * An entity table keyed by `id`.
 *
 * Method semantics follow Dexie (the web adapter is a thin wrapper over it):
 * - `update(id, changes)` / `modify(changes)`: a `changes` value of `undefined`
 *   removes the property from the stored record (matching Dexie's behavior).
 * - `get(ids)` returns records for the given keys (missing keys become `undefined`).
 */
export interface StorageTable<T extends { id: string }> {
  get(id: string): Promise<T | undefined>;
  get(ids: string[]): Promise<T[]>;
  put(record: T): Promise<void>;
  add(record: T): Promise<string>;
  bulkAdd(records: T[]): Promise<void>;
  bulkGet(ids: string[]): Promise<T[]>;
  bulkPut(records: T[]): Promise<void>;
  bulkDelete(ids: string[]): Promise<void>;
  update(id: string, changes: Partial<T>): Promise<number>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  toArray(): Promise<T[]>;
  filter(predicate: (record: T) => boolean): StorageCollection<T>;
  where(index: string): StorageWhereClause<T>;
  orderBy(index: string): StorageCollection<T>;
  hook(event: 'creating' | 'updating' | 'deleting'): StorageTableHook;
}

/** A key-value table (the sync state table is keyed by `key`). */
export interface StorageKeyValueTable<T extends { key: string }> {
  get(key: string): Promise<T | undefined>;
  put(record: T): Promise<void>;
  bulkPut(records: T[]): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  toArray(): Promise<T[]>;
}

/** The full client-side database surface shared by every platform. */
export interface StorageAdapter {
  notes: StorageTable<NoteRecord>;
  categories: StorageTable<CategoryRecord>;
  noteLinks: StorageTable<NoteLinkRecord>;
  noteAliases: StorageTable<NoteAliasRecord>;
  todoItems: StorageTable<TodoItemRecord>;
  reminders: StorageTable<ReminderRecord>;
  notifications: StorageTable<NotificationRecord>;
  outbox: StorageTable<OutboxRecord>;
  conflicts: StorageTable<ConflictRecord>;
  syncState: StorageKeyValueTable<SyncStateRecord>;

  /** Run a read-write transaction around the callback. */
  transaction<TResult>(callback: () => Promise<TResult>): Promise<TResult>;

  /** Wipe every table (used on logout, login, and workspace switches). */
  clearAll(): Promise<void>;

  /** Lifecycle used by tests and embedders. */
  open(): Promise<void>;
  close(): void;
  /** Destroys the whole database (recreate with `open()`). */
  delete(): Promise<void>;
}

/**
 * Purely in-memory implementation of `StorageAdapter` (see
 * {@link MemoryStorageAdapter}). It implements the same query algebra
 * (where/orderBy/filter) and change hooks as the Dexie and SQLite adapters,
 * and is the default implementation used by tests.
 */
type HookEvent = 'creating' | 'updating' | 'deleting';

  const keyParts = (index: string): string[] =>
    index.startsWith('[') && index.endsWith(']')
      ? index.slice(1, -1).split('+')
      : [index];

  const getValue = <T>(record: T, index: string): unknown => {
    const parts = keyParts(index);
    return parts.length > 1
      ? parts.map((part) => (record as Record<string, unknown>)[part])
      : (record as Record<string, unknown>)[parts[0]];
  };

  const matchesIndex = <T extends { id: string }>(
    record: T,
    index: string,
    values: unknown[],
  ): boolean => {
    const parts = keyParts(index);
    if (parts.length > 1) {
      const valueArray = values[0];
      if (!Array.isArray(valueArray) || valueArray.length < parts.length) {
        return false;
      }
      return parts.every((part, i) => {
        return (record as Record<string, unknown>)[part] === valueArray[i];
      });
    }
    const recordValue = (record as Record<string, unknown>)[parts[0]];
    return values.some((value) => recordValue === value);
  };

  const applyChanges = <T>(record: T, changes: Partial<T>): void => {
    const target = record as Record<string, unknown>;
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) {
        delete target[key];
      } else {
        target[key] = value;
      }
    }
  };

  const compareValues = (left: unknown, right: unknown): number => {
    if (typeof left === 'number' && typeof right === 'number') {
      return left - right;
    }
    return String(left).localeCompare(String(right));
  };

  class MemoryTable<T extends { id: string }> implements StorageTable<T> {
    private readonly records = new Map<string, T>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly listeners: Record<
      HookEvent,
      Array<(...args: any[]) => unknown>
    > = { creating: [], updating: [], deleting: [] };

    private emit(event: HookEvent, ...args: unknown[]): void {
      for (const listener of this.listeners[event]) {
        listener(...args);
      }
    }

    hook(event: HookEvent): StorageTableHook {
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        subscribe: (listener: (...args: any[]) => unknown) => {
          this.listeners[event].push(listener);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        unsubscribe: (listener: (...args: any[]) => unknown) => {
          const index = this.listeners[event].indexOf(listener);
          if (index !== -1) {
            this.listeners[event].splice(index, 1);
          }
        },
      };
    }

    get(id: string): Promise<T | undefined>;
    get(ids: string[]): Promise<T[]>;
    get(idOrIds: string | string[]): Promise<T | undefined | T[]> {
      if (Array.isArray(idOrIds)) {
        return Promise.resolve(
          idOrIds
            .map((id) => this.records.get(id))
            .filter((record): record is T => record !== undefined),
        );
      }
      return Promise.resolve(this.records.get(idOrIds));
    }

    put(record: T): Promise<void> {
      const existing = this.records.get(record.id);
      if (existing) {
        this.emit('updating', record, record.id, existing);
      } else {
        this.emit('creating', record.id, record);
      }
      this.records.set(record.id, record);
      return Promise.resolve();
    }

    add(record: T): Promise<string> {
      this.emit('creating', record.id, record);
      this.records.set(record.id, record);
      return Promise.resolve(record.id);
    }

    bulkAdd(records: T[]): Promise<void> {
      for (const record of records) {
        this.emit('creating', record.id, record);
        this.records.set(record.id, record);
      }
      return Promise.resolve();
    }

    bulkGet(ids: string[]): Promise<T[]> {
      return this.get(ids) as Promise<T[]>;
    }

    bulkPut(records: T[]): Promise<void> {
      for (const record of records) {
        void this.put(record);
      }
      return Promise.resolve();
    }

    bulkDelete(ids: string[]): Promise<void> {
      for (const id of ids) {
        if (this.records.has(id)) {
          this.emit('deleting', id);
          this.records.delete(id);
        }
      }
      return Promise.resolve();
    }

    update(id: string, changes: Partial<T>): Promise<number> {
      const existing = this.records.get(id);
      if (!existing) {
        return Promise.resolve(0);
      }
      this.emit('updating', changes, id, existing);
      applyChanges(existing, changes);
      return Promise.resolve(1);
    }

    delete(id: string): Promise<void> {
      if (this.records.has(id)) {
        this.emit('deleting', id);
        this.records.delete(id);
      }
      return Promise.resolve();
    }

    clear(): Promise<void> {
      this.records.clear();
      return Promise.resolve();
    }

    count(): Promise<number> {
      return Promise.resolve(this.records.size);
    }

    toArray(): Promise<T[]> {
      return Promise.resolve([...this.records.values()]);
    }

    filter(predicate: (record: T) => boolean): StorageCollection<T> {
      return this.collection([predicate]);
    }

    where(index: string): StorageWhereClause<T> {
      return {
        equals: (...values) =>
          this.collection([(record) => matchesIndex(record, index, values)]),
        anyOf: (...values) =>
          this.collection([
            (record) => {
              // Dexie-style: `anyOf([a, b])` and `anyOf(a, b)` are equivalent.
              const list =
                values.length === 1 && Array.isArray(values[0])
                  ? values[0]
                  : values;
              return matchesIndex(record, index, list as unknown[]);
            },
          ]),
      };
    }

    orderBy(index: string): StorageCollection<T> {
      return this.collection([], () =>
        [...this.records.values()].sort((left, right) =>
          compareValues(getValue(left, index), getValue(right, index)),
        ),
      );
    }

    private collection(
      filters: Array<(record: T) => boolean>,
      sorted?: () => T[],
      descending = false,
    ): StorageCollection<T> {
      const evaluate = (): T[] => {
        let rows = sorted ? sorted() : [...this.records.values()];
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
          this.collection([...filters, predicate], sorted, descending),
        reverse: () => this.collection(filters, sorted, !descending),
        sortBy: async (index) => {
          const rows = evaluate();
          const direction = descending ? -1 : 1;
          return rows.sort(
            (left, right) =>
              compareValues(getValue(left, index), getValue(right, index)) *
              direction,
          );
        },
        toArray: () => Promise.resolve(evaluate()),
        first: async () => evaluate()[0],
        count: () => Promise.resolve(evaluate().length),
        modify: async (changes) => {
          const rows = evaluate();
          for (const row of rows) {
            this.emit('updating', changes, row.id, row);
            applyChanges(row, changes);
          }
          return rows.length;
        },
        delete: async () => {
          const rows = evaluate();
          for (const row of rows) {
            this.emit('deleting', row.id);
            this.records.delete(row.id);
          }
        },
      };
      return collection;
    }
  }

  class MemoryKeyValueTable<
    T extends { key: string },
  > implements StorageKeyValueTable<T> {
    private readonly records = new Map<string, T>();

    get(key: string): Promise<T | undefined> {
      return Promise.resolve(this.records.get(key));
    }

    put(record: T): Promise<void> {
      this.records.set(record.key, record);
      return Promise.resolve();
    }

    bulkPut(records: T[]): Promise<void> {
      for (const record of records) {
        this.records.set(record.key, record);
      }
      return Promise.resolve();
    }

    clear(): Promise<void> {
      this.records.clear();
      return Promise.resolve();
    }

    count(): Promise<number> {
      return Promise.resolve(this.records.size);
    }

    toArray(): Promise<T[]> {
      return Promise.resolve([...this.records.values()]);
    }
  }

export class MemoryStorageAdapter implements StorageAdapter {
  readonly notes = new MemoryTable<NoteRecord>();
  readonly categories = new MemoryTable<CategoryRecord>();
  readonly noteLinks = new MemoryTable<NoteLinkRecord>();
  readonly noteAliases = new MemoryTable<NoteAliasRecord>();
  readonly todoItems = new MemoryTable<TodoItemRecord>();
  readonly reminders = new MemoryTable<ReminderRecord>();
  readonly notifications = new MemoryTable<NotificationRecord>();
  readonly outbox = new MemoryTable<OutboxRecord>();
  readonly conflicts = new MemoryTable<ConflictRecord>();
  readonly syncState = new MemoryKeyValueTable<SyncStateRecord>();

  private readonly allTables: Array<{ clear(): Promise<void> }> = [
    this.notes,
    this.categories,
    this.noteLinks,
    this.noteAliases,
    this.todoItems,
    this.reminders,
    this.notifications,
    this.outbox,
    this.conflicts,
    this.syncState,
  ];

  transaction<TResult>(callback: () => Promise<TResult>): Promise<TResult> {
    return callback();
  }

  async clearAll(): Promise<void> {
    for (const table of this.allTables) {
      await table.clear();
    }
  }

  open(): Promise<void> {
    return Promise.resolve();
  }

  close(): void {
    /* in-memory: nothing to close */
  }

  async delete(): Promise<void> {
    for (const table of this.allTables) {
      await table.clear();
    }
  }
}

/**
 * Create a purely in-memory implementation of `StorageAdapter`.
 *
 * Backed by {@link MemoryStorageAdapter}; kept as a convenience factory for
 * repository test harnesses and the mobile bootstrap placeholder.
 */
export function createInMemoryStorage(): StorageAdapter {
  return new MemoryStorageAdapter();
}
