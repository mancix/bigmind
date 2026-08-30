import { createInMemoryStorage, type StorageAdapter } from '@bigmind/storage';

/**
 * Mobile storage adapter.
 *
 * This is a bootstrapping placeholder: it uses the shared
 * `createInMemoryStorage()` from `@bigmind/storage` so the app wires up the
 * `StorageAdapter` abstraction end-to-end (and tests work in CI) before the
 * real adapter lands.
 *
 * Migration path (see docs/mobile-architecture.md):
 * 1. Implement the shared `StorageAdapter` contract on top of expo-sqlite as
 *    `SqliteStorageAdapter` (port the web Dexie schema from
 *    `apps/web/src/storage/database.ts`).
 * 2. Swap this singleton for the SQLite-backed adapter.
 * 3. Reuse the shared @bigmind/sync engine against the new adapter.
 */
export const mobileStorage: StorageAdapter = createInMemoryStorage();

export { mobileStorage as storage };
