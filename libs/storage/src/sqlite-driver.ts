/**
 * Minimal SQLite driver contract.
 *
 * `SqliteStorageAdapter` depends ONLY on this interface — never on a concrete
 * SQLite library. Each platform supplies a driver that implements it:
 *
 * - Mobile/Expo: `createExpoSqliteDriver()` (apps/mobile/src/storage)
 *   wraps the `expo-sqlite` `SQLiteDatabase` (VACUUM-ready, transactional).
 * - Tests/CI: `createNodeSqliteDriver()` (libs/storage/node-sqlite-driver)
 *   wraps `node:sqlite` `DatabaseSync` so real SQLite semantics run without a
 *   native runtime.
 *
 * The surface intentionally mirrors the subset of `expo-sqlite` used by the
 * adapter: raw statements plus positional-`?` bound queries. The adapter never
 * relies on driver-specific extras (named params, statement objects, …).
 */

/** Values accepted as positional bind parameters. */
export type SqliteBindValue = string | number | null | Uint8Array;

/** Result of a single `INSERT`/`UPDATE`/`DELETE` statement. */
export interface SqliteRunResult {
  lastInsertRowId: number | bigint;
  changes: number | bigint;
}

/**
 * Read/write handle used inside a transaction. `expo-sqlite`'s
 * `SQLiteTransaction` extends `SQLiteDatabase`, and the node driver supplies
 * the same surface, so adapters can execute through either.
 */
export interface SqliteTransaction {
  execAsync(source: string): Promise<void>;
  runAsync(
    source: string,
    ...params: SqliteBindValue[]
  ): Promise<SqliteRunResult>;
  getFirstAsync<T extends Record<string, unknown>>(
    source: string,
    ...params: SqliteBindValue[]
  ): Promise<T | null>;
  getAllAsync<T extends Record<string, unknown>>(
    source: string,
    ...params: SqliteBindValue[]
  ): Promise<T[]>;
}

/**
 * The full database handle. `withTransactionAsync` starts an atomic
 * read-write transaction, commits on success and rolls back on error; the
 * callback receives a transaction handle that must be used for all work.
 */
export interface SqliteDriver extends SqliteTransaction {
  withTransactionAsync<TResult>(
    task: (transaction: SqliteTransaction) => Promise<TResult>,
  ): Promise<TResult>;
  /** Close the underlying database (idempotent). */
  close(): void | Promise<void>;
  /** Close and destroy the database file. */
  deleteDatabase(): Promise<void>;
}