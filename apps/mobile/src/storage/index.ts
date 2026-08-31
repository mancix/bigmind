import {
  createInMemoryStorage,
  createSqliteStorageAdapter,
  type StorageAdapter,
} from '@bigmind/storage';

import { createExpoSqliteDriver } from './expo-sqlite-driver';

/**
 * Mobile storage provider (dependency injection).
 *
 * Switches the `StorageAdapter` implementation WITHOUT touching repository
 * code: notes/categories/links/todos/outbox/sync-state repositories and the
 * sync engine all receive whatever adapter this provider returns.
 *
 * Engines:
 * - `sqlite` (default) — `SqliteStorageAdapter` over expo-sqlite. Fast,
 *   transactional, and persistent across app restarts / device reboots, which
 *   is the offline-first requirement.
 * - `memory` — `MemoryStorageAdapter`; used by tests (jest sets
 *   `EXPO_PUBLIC_STORAGE_ENGINE=memory` in `src/test-setup.ts`) and as an
 *   emergency override.
 *
 * Override at runtime with `EXPO_PUBLIC_STORAGE_ENGINE=memory` (Expo inlines
 * it at bundle time) or by passing `{ engine }` explicitly.
 */
export type MobileStorageEngine = 'memory' | 'sqlite';

/** Default on-device database name (Expo SQLite). */
export const DEFAULT_DATABASE_NAME = 'bigmind.db';

export interface MobileStorageProviderOptions {
  engine?: MobileStorageEngine;
  databaseName?: string;
}

export function createMobileStorageProvider(
  options: MobileStorageProviderOptions = {},
): StorageAdapter {
  const engine: MobileStorageEngine =
    options.engine ??
    (process.env.EXPO_PUBLIC_STORAGE_ENGINE === 'memory' ? 'memory' : 'sqlite');

  if (engine === 'memory') {
    return createInMemoryStorage();
  }
  return createSqliteStorageAdapter(
    createExpoSqliteDriver(options.databaseName ?? DEFAULT_DATABASE_NAME),
  );
}

/**
 * The application-wide storage singleton. Constructed once at startup;
 * repositories and the sync engine depend on this single instance so the
 * outbox, conflicts and local data never diverge.
 */
export const mobileStorage: StorageAdapter = createMobileStorageProvider();

export { mobileStorage as storage };