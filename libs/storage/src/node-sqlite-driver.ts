import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  SqliteBindValue,
  SqliteDriver,
  SqliteRunResult,
  SqliteTransaction,
} from './sqlite-driver.js';

/**
 * Node driver for {@link SqliteDriver}: wraps `node:sqlite`'s `DatabaseSync`
 * so the `SqliteStorageAdapter` runs against REAL SQLite in tests and CI —
 * without an emulator or a native runtime.
 *
 * Persistence across "restarts" is trivially testable: open a driver on a
 * file path, close it, reopen with a second driver, and the data is still
 * there (see sqlite-storage-adapter.spec.ts).
 *
 * This module is intentionally NOT part of the main `@bigmind/storage` entry
 * (Metro/Hermes must never resolve `node:sqlite`); import it from the
 * `@bigmind/storage/node-sqlite-driver` subpath only.
 */
export function createNodeSqliteDriver(target?: string): SqliteDriver {
  const path = target ?? ':memory:';
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const database = new DatabaseSync(path);
  let closed = false;

  const run = (
    source: string,
    ...params: SqliteBindValue[]
  ): SqliteRunResult => {
    const result = database.prepare(source).run(...params);
    return {
      changes: result.changes,
      lastInsertRowId: result.lastInsertRowid,
    };
  };

  const transactionObject: SqliteTransaction = {
    execAsync: async (source) => {
      database.exec(source);
    },
    runAsync: async (source, ...params) => run(source, ...params),
    getFirstAsync: async <T extends Record<string, unknown>>(
      source: string,
      ...params: SqliteBindValue[]
    ) => {
      const row = database.prepare(source).get(...params);
      return (row as T | undefined) ?? null;
    },
    getAllAsync: async <T extends Record<string, unknown>>(
      source: string,
      ...params: SqliteBindValue[]
    ) => {
      const rows = database.prepare(source).all(...params);
      return rows as T[];
    },
  };

  return {
    ...transactionObject,
    withTransactionAsync: async (task) => {
      database.exec('BEGIN IMMEDIATE;');
      try {
        const result = await task(transactionObject);
        database.exec('COMMIT;');
        return result;
      } catch (error) {
        database.exec('ROLLBACK;');
        throw error;
      }
    },
    close: () => {
      if (!closed) {
        closed = true;
        database.close();
      }
    },
    deleteDatabase: async () => {
      if (!closed) {
        closed = true;
        database.close();
      }
      if (path !== ':memory:') {
        rmSync(path, { force: true });
      }
    },
  };
}
