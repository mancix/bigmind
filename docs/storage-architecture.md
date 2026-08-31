# BigMind Client Storage Architecture

## Purpose

BigMind is **offline-first**: the application must remain fully usable without
a network connection and never lose local work. This document describes how
client-side data is stored, why the design is the way it is, and how it
evolves (SQLite migrations, encrypted storage, multi-workspace caching).

## Storage adapter — the only storage contract

All application code (repositories, sync engine, screens, tests) depends on a
single interface:

```
StorageAdapter (libs/storage)
├── StorageTable<T>          notes · categories · noteLinks · noteAliases ·
│                            todoItems · reminders · notifications · outbox ·
│                            conflicts
├── StorageKeyValueTable<T>  syncState (last cursor, last sync timestamp)
├── StorageCollection<T>     where/orderBy/filter/sortBy/reverse/first/count/
│                            modify/delete
├── StorageTableHook         creating/updating/deleting change events
└── transaction / clearAll / open / close / delete
```

No repository, sync-engine component, or screen ever imports a table
implementation. Business logic (in `@bigmind/features` and `@bigmind/sync`)
receives the adapter through constructor injection and stays 100%
platform-independent. Repositories are assembled by the shared DI provider
`createRepositoryProvider(storage, outbox, { workspace })` — see
[Shared Repository Architecture](shared-repository-architecture.md).

Two implementations of the adapter exist today:

| Implementation          | Where                                | Backing store            | Used by                          |
| ----------------------- | ------------------------------------ | ------------------------ | -------------------------------- |
| `DexieStorageAdapter`   | `apps/web/src/storage/`              | IndexedDB (via Dexie)    | Web PWA                          |
| `SqliteStorageAdapter`  | `libs/storage/src/sqlite-storage-adapter.ts` | SQLite (driver-based)    | Mobile (expo-sqlite) + CI (node:sqlite) |
| `MemoryStorageAdapter`  | `libs/storage/src/storage-adapter.ts` | In-memory maps           | Tests (default) and bootstrap    |

### Why a driver split for SQLite

`SqliteStorageAdapter` is platform-independent: it talks to a minimal
`SqliteDriver` interface (`execAsync`, `runAsync`, `getFirstAsync`,
`getAllAsync`, `withTransactionAsync`, `close`, `deleteDatabase`) — never to
expo-sqlite directly.

- **Mobile** supplies the `expo-sqlite` driver
  (`apps/mobile/src/storage/expo-sqlite-driver.ts`, wraps
  `openDatabaseSync`).
- **CI/tests** supply the `node:sqlite` driver
  (`libs/storage/src/node-sqlite-driver.ts`, exported only from the
  `@bigmind/storage/node-sqlite-driver` subpath so Metro/Hermes never
  resolves `node:sqlite`).

The adapter therefore runs against **real SQLite** in automated tests —
migrations, transactions, and persistence-across-restart are verified without
an emulator, and the memory/SQLite behavior parity is enforced by a shared
behavior suite (`libs/storage/src/adapter-parity.spec.ts`).

## Storage layout (SQLite)

Every record is stored as **one row**:

```
┌─────────────────────────────────────────────┐
│ table (e.g. `notes`)                        │
│                                             │
│  id               TEXT PRIMARY KEY          │  ← `id` or `key`
│  data             TEXT NOT NULL             │  ← canonical record as JSON
│  title            TEXT                      │  ┐
│  category_id      TEXT                      │  │ duplicated "index columns"
│  updated_at       TEXT                      │  │ (the fields the app queries
│  deleted_at       TEXT                      │  │  via where()/orderBy())
│  sync_status      TEXT                      │  ┘
│  … (per table)                              │
│                                             │
│ + SQL indexes on each index column          │
│ + compound indexes ([parentId+position],    │
│   [sourceNoteId+targetNoteId],              │
│   [noteId+normalizedAlias], [entityId+status]) │
└─────────────────────────────────────────────┘
```

- The `data` JSON column is the single source of truth.
- Index columns are duplicated for typed, index-backed queries; adding a
  record field never requires a schema migration unless it must be queried.
- `where()` on a known index column compiles to SQL (`WHERE col = ?` /
  `IN (…)`, `IS NULL` for `null`); unknown/compound indexes fall back to an
  in-memory scan with the exact same matching rules as the memory adapter.
- Ordering (`orderBy`/`sortBy`) uses the same JavaScript comparator as the
  memory adapter to guarantee byte-identical results across engines.

This mirrors the web Dexie schema v11 one-to-one (see
`apps/web/src/storage/database.ts`).

## Schema and migrations

Migrations live in `libs/storage/src/sqlite-migrations.ts` and are applied by
the adapter on `open()` (and lazily on first access):

- `schema_meta` (single row) records the applied `version`.
- Each `SqliteMigration` (`{ version, up(tx) }`) runs inside its **own
  transaction**; the version is recorded atomically with the migration, so a
  failed migration rolls back completely.
- `buildInitialSqliteMigrations()` is version **1** — the full BigMind schema
  (mirrors Dexie v11, so mobile starts on the same shape as the web app).
- Future changes append strictly increasing versions; `up()` steps should be
  **additive** (new tables/columns/indexes) so devices upgrade in place.
- `EXPO_PUBLIC_*`-style rollouts are not needed: `runSqliteMigrations` is a
  no-op when the database is already current.

Because the mobile app ships from schema v1 directly, the historical Dexie
upgrades 1→11 are NOT replayed on device; they exist in the web codebase only
for IndexedDB users.

### Migration example (version 1 → 2)

```ts
const v2: SqliteMigration = {
  version: 2,
  up: async (tx) => {
    await tx.execAsync('ALTER TABLE notes ADD COLUMN pinned INTEGER;');
    await tx.execAsync('CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes (pinned);');
  },
};

const adapter = createSqliteStorageAdapter(driver, [
  ...buildInitialSqliteMigrations(),
  v2,
]);
```

## Dependency injection / storage provider

`apps/mobile/src/storage/index.ts` exposes `createMobileStorageProvider()`:

```ts
const storage: StorageAdapter = engine === 'memory'
  ? createInMemoryStorage()
  : createSqliteStorageAdapter(createExpoSqliteDriver('bigmind.db'));
```

- **Default engine: `sqlite`** (offline-first persistence).
- **Tests: `memory`** — `src/test-setup.ts` sets
  `EXPO_PUBLIC_STORAGE_ENGINE=memory` (inlined by `babel-preset-expo` before
  module load), so the mobile jest suite runs on the memory adapter and never
  touches the native module. The `expo-sqlite` import is mocked to throw, so
  an accidental engine flip fails loudly.
- Switching engines requires **no repository changes** — repositories already
  only know `StorageAdapter`.

## Offline requirements — how they are met

| Requirement                        | Mechanism                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Survive app restarts               | SQLite file persisted on device (default engine); adapter `open()` reruns migrations idempotently            |
| Survive device reboots             | Same file; verified in CI by close→reopen tests on a real SQLite file (`sqlite-storage-adapter.spec.ts`)    |
| Long offline periods               | Full local write path (outbox + local tables) is engine-independent; sync resumes from the persisted cursor  |
| Large note collections             | Row-based storage with SQL indexes on hot paths; collection queries narrow rows in SQL before JS filtering   |
| Synchronization queues             | `outbox` table with `status`/`entityId`/`nextRetryAt` indexes; atomic marking via `transaction()`            |
| Conflicts                          | `conflicts` table + inline conflict metadata; persisted like any other table                                |

## Future compatibility

The design intentionally leaves room for the next storage milestones without
changing the `StorageAdapter` API:

- **Encrypted storage** — encrypt the `data` payload column (and optionally
  index columns) transparently inside `SqliteStorageAdapter`; the contract
  stays identical. Keys would come from `expo-secure-store` (already used for
  tokens).
- **Workspace isolation** — add a `workspace_id` index column per table and
  scope queries through the adapter; repositories keep passing plain
  `StorageAdapter` (or a workspace-scoped decorator).
- **Multi-workspace caching** — multiple databases per workspace name, or a
  `workspace_id` column + view; migrations make either additive.
- **Conflict persistence** — already first-class (`conflicts` table,
  snapshots, status lifecycle).
- **Attachment storage** — new add-only tables (blob content stays out of the
  `data` JSON; binary-safe columns are additive migrations).

## Testing strategy

- `libs/storage/src/adapter-parity.spec.ts` — the same behavior suite runs
  against `MemoryStorageAdapter` **and** `SqliteStorageAdapter` (node:sqlite),
  proving the two behave identically (requirement for safe engine switching).
- `libs/storage/src/sqlite-storage-adapter.spec.ts` — migration execution
  (fresh init, ordered application, idempotency, preservation of existing
  rows, rollback of failed migrations) and persistence across close/reopen.
- Existing suites (`features`, `sync`, `apps/web`, `apps/mobile`) run against
  the memory adapter unchanged, keeping the shared business logic green; the
  `features` suite also runs the same repository assertions against real
  SQLite (`repositories-sqlite.spec.ts`).