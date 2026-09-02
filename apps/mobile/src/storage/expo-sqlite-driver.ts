import { deleteDatabaseAsync, openDatabaseSync } from 'expo-sqlite';

import type {
  SqliteBindValue,
  SqliteDriver,
  SqliteRunResult,
  SqliteTransaction,
} from '@bigmind/storage';

/**
 * Expo (React Native) driver for {@link SqliteDriver}.
 *
 * The ONLY mobile module that imports `expo-sqlite`. It wraps
 * `openDatabaseSync` so the shared `SqliteStorageAdapter` runs against the
 * native SQLite engine on device; the native module is bundled in Expo Go and
 * development builds. Tests never load this module (the storage provider
 * defaults to the memory adapter under jest — see `src/test-setup.ts`).
 *
 * NOTE on transactions: the shared adapter's {@link SqliteDriver} contract
 * requires `withTransactionAsync` to hand its callback a transaction handle
 * (`SqliteTransaction`). `expo-sqlite`'s `SQLiteDatabase.withTransactionAsync`
 * runs the callback with NO arguments (SDK 52+), so casting the raw
 * `SQLiteDatabase` to `SqliteDriver` makes every `transaction.execAsync(...)`
 * inside a migration/transaction fail with
 * `TypeError: Cannot read property 'execAsync' of undefined`.
 *
 * `withExclusiveTransactionAsync` is the expo-sqlite API that DOES provide a
 * transaction object (with the full `SQLiteDatabase` surface). We bridge
 * through it and expose the adapter-facing transaction handle, matching the
 * `BEGIN ... COMMIT / ROLLBACK` semantics of the node driver used in tests
 * (`libs/storage/src/node-sqlite-driver.ts`).
 */
export function createExpoSqliteDriver(databaseName: string): SqliteDriver {
  const database = openDatabaseSync(databaseName);
  let closed = false;

  const withTransactionAsync = async <TResult>(
    task: (transaction: SqliteTransaction) => Promise<TResult>,
  ): Promise<TResult> => {
    let result!: TResult;
    await database.withExclusiveTransactionAsync(async (txn) => {
      // Queries inside the exclusive transaction must go through `txn`.
      const transaction: SqliteTransaction = {
        execAsync: (source: string): Promise<void> => txn.execAsync(source),
        runAsync: (
          source: string,
          ...params: SqliteBindValue[]
        ): Promise<SqliteRunResult> => txn.runAsync(source, ...params),
        getFirstAsync: <T extends Record<string, unknown>>(
          source: string,
          ...params: SqliteBindValue[]
        ): Promise<T | null> => txn.getFirstAsync<T>(source, ...params),
        getAllAsync: <T extends Record<string, unknown>>(
          source: string,
          ...params: SqliteBindValue[]
        ): Promise<T[]> => txn.getAllAsync<T>(source, ...params),
      };
      result = await task(transaction);
    });
    return result;
  };

  return {
    execAsync: (source: string): Promise<void> => database.execAsync(source),
    runAsync: (
      source: string,
      ...params: SqliteBindValue[]
    ): Promise<SqliteRunResult> => database.runAsync(source, ...params),
    getFirstAsync: <T extends Record<string, unknown>>(
      source: string,
      ...params: SqliteBindValue[]
    ): Promise<T | null> => database.getFirstAsync<T>(source, ...params),
    getAllAsync: <T extends Record<string, unknown>>(
      source: string,
      ...params: SqliteBindValue[]
    ): Promise<T[]> => database.getAllAsync<T>(source, ...params),
    withTransactionAsync,
    close: () => {
      // `SqliteDriver.close` is idempotent.
      if (!closed) {
        closed = true;
        database.closeSync();
      }
    },
    deleteDatabase: async () => {
      if (!closed) {
        closed = true;
        database.closeSync();
      }
      await deleteDatabaseAsync(databaseName);
    },
  };
}
