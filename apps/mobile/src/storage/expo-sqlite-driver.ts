import { openDatabaseSync } from 'expo-sqlite';

import type { SqliteDriver } from '@bigmind/storage';

/**
 * Expo (React Native) driver for {@link SqliteDriver}.
 *
 * The ONLY mobile module that imports `expo-sqlite`. It wraps
 * `openDatabaseSync` so the shared `SqliteStorageAdapter` runs against the
 * native SQLite engine on device; the native module is bundled in Expo Go and
 * development builds. Tests never load this module (the storage provider
 * defaults to the memory adapter under jest — see `src/test-setup.ts`).
 */
export function createExpoSqliteDriver(databaseName: string): SqliteDriver {
  return openDatabaseSync(databaseName) as unknown as SqliteDriver;
}