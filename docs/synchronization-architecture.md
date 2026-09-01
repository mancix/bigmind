# Synchronization Architecture

## Overview

BigMind is **offline-first**. Every change is written to the local store first and
the client synchronizes with the NestJS API in the background. The web PWA and the
mobile app run the **exact same synchronization engine** (`@bigmind/sync`); only
connectivity, storage, and background-sync triggers are platform-specific and are
injected as abstractions.

This document covers:

- the shared sync core and how a sync pass works,
- the platform abstractions the engine depends on,
- the connectivity layer,
- authentication integration,
- sync status, conflict management, and automatic-sync triggers,
- future compatibility (push, background sync, attachments, E2E encryption).

## Sync core (`@bigmind/sync`)

All synchronization behavior lives in `libs/sync`. The core never imports React,
React Native, browser APIs, IndexedDB, or SQLite — it only depends on injected
abstractions.

| Module                    | Responsibility                                                          |
| ------------------------- | ----------------------------------------------------------------------- |
| `SyncEngine`              | Push logic, pull logic, retry/backoff, outbox processing, sync state, conflict detection dispatch, status transitions |
| `SyncScheduler`           | Debounce + periodic timing; decides *when* to run a sync pass            |
| `OutboxRepository`        | Persists and coalesces pending operations over the `StorageAdapter`      |
| `SyncStateRepository`     | Persists the pull cursor (`recordSuccessfulSync` / `getCursor`)          |
| `HttpSyncTransport`       | ts-rest HTTP client for `/sync/push` + `/sync/pull`, token-refresh retry |
| `FakeSyncTransport`       | In-memory transport for tests and fake-sync dev mode                     |
| `ConflictService`         | Conflict classification + snapshot building (shared by both platforms)   |
| `background-sync.ts`      | Global request bus; repositories signal "local data changed, sync soon"  |

### One sync pass

```
sync()
  ├─ isOnline()?                  → no → status = offline
  ├─ getAuthState()?  auth_required → status = auth_required (skip transport)
  ├─ status = syncing
  ├─ outbox.resetStaleProcessing()      (un-stick operations left 'processing')
  ├─ outbox.listPending() + markProcessing()
  ├─ transport.push(operations)         → push results (accepted / rejected / conflict)
  ├─ process push results:
  │     accepted  → apply server version, mark completed (coalesce siblings)
  │     rejected  → fail operation (retry or drop)
  │     conflict  → persist local+remote snapshots, mark entity 'conflict'
  ├─ transport.pull(cursor)             → remote changes (cursor-paginated)
  ├─ applyPullResult()
  │     apply each change (ordered by entity type)
  │     conflict if local state is dirty / in conflict
  │     after ALL changes apply → syncState.recordSuccessfulSync(cursor)
  └─ status = idle
```

Key invariants (unchanged behavior):

- **Local-first**: the cursor is advanced only after every pulled change applied
  successfully; a failure leaves the cursor untouched so nothing is skipped.
- **Never lose data**: on a detected conflict the local record is kept and marked
  `conflict`; local changes are never overwritten or discarded.
- **Retry with backoff**: failed operations stay in the outbox and are retried
  (`backoffBaseMs * 2^retryCount`, capped at 1 hour).
- **Concurrency-safe**: concurrent `sync()` calls share one active execution.

## Platform abstractions

The engine receives every platform dependency through a constructor object
(`SyncEngineDependencies`) and two constructor options. Mandated abstrations:

| Requirement          | Abstraction                                             | Web implementation                         | Mobile implementation                      |
| -------------------- | ------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| ConnectivityProvider | `Connectivity` (`isOnline()` + `subscribe`)             | `apps/web/src/sync/connectivity.ts`        | `apps/mobile/src/sync/connectivity.ts`     |
| AuthenticationProvider | `getAuthState()` + `HttpSyncTransportAuth`           | `webSyncAuth` (`web-sync-auth.ts`) + AuthStore | `mobileSyncAuth` (`transport.ts`) + AuthStore |
| StorageProvider      | `StorageAdapter` (`@bigmind/storage`)                   | `DexieStorageAdapter` (IndexedDB)          | `SqliteStorageAdapter` (expo-sqlite)       |
| Transport            | `SyncTransport` (`push` / `pull`)                       | `HttpSyncTransport` or `FakeSyncTransport` | `HttpSyncTransport`                        |

The engine is wired once per platform in a thin factory:

- **Web** — `apps/web/src/sync/sync-service.ts` (Dexie storage, web auth, transport).
- **Mobile** — `apps/mobile/src/sync/sync-service.ts` (Sqlite storage, mobile auth, transport).

Neither factory re-implements any sync logic; each only constructs the shared
`SyncEngine` with platform adapters. Because the engine is identical, a scenario
that passes on web passes on mobile (see [Testing](#testing)).

## Connectivity layer

`Connectivity` is the single contract for "are we online?":

```ts
interface Connectivity {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}
```

- **Web** (`createBrowserConnectivity`): `navigator.onLine` plus the global
  `online` / `offline` events; falls back to always-online in non-browser
  environments (SSR, tests).
- **Mobile** (`createMobileConnectivity`): `@react-native-community/netinfo`;
  online when `isConnected === true && isInternetReachable !== false`.
- **Tests / embedded**: `createAlwaysOnlineConnectivity()`.

The sync core and scheduler never reference `navigator` or NetInfo. Connectivity
transitions are forwarded to `engine.setOnline()` by the platform supervisor, which
also requests an immediate sync when connectivity returns.

## Authentication integration

Both platforms share the `AuthStore` state machine (`@bigmind/auth`), which
distinguishes `authenticated`, `offline_authenticated`, `auth_required`, and
`unauthenticated` so local data survives offline and auth failures.

| State                   | Meaning                                       | Sync                                    |
| ----------------------- | --------------------------------------------- | --------------------------------------- |
| `authenticated`         | Valid access + refresh tokens                  | Active                                  |
| `offline_authenticated` | Valid stored tokens but the network is down during refresh | Paused (offline)         |
| `auth_required`         | Refresh failed; session expired / invalid      | Paused — status `auth_required`         |
| `unauthenticated`       | No credentials (logged out)                    | Not started (app restarts auth flow)    |

Integration points:

- **Pre-sync gate**: the engine checks `getAuthState()` before pushing/pulling and
  sets status `auth_required` instead of touching the transport.
- **Token refresh on 401**: `HttpSyncTransport.pushWithRetry()` detects
  `SyncTransportError(cause: 'unauthorized')`, calls `refreshAccessToken()`, and
  retries the request once with the new token. On `auth_error` it fails the session;
  on `network_error` it transitions to `offline_authenticated`.
- **Periodic refresh**: the `AuthStore` proactively refreshes the access token on an
  interval so long-lived sessions rarely see a 401.

Behavior is identical on web and mobile because the same `AuthStore` and the same
`HttpSyncTransport` are used; only the `TokenStorage` (localStorage vs.
SecureStore/AsyncStorage) and the workspace-id source differ.

## Sync status

`SyncStatus` is exposed consistently on both platforms (`engine.getStatus()` +
`engine.subscribe()`):

| Status        | Meaning                                             |
| ------------- | --------------------------------------------------- |
| `idle`        | Not syncing; no outstanding problem                 |
| `syncing`     | A push/pull pass is running                         |
| `offline`     | Connectivity is down; sync paused                   |
| `auth_required` | Session cannot authenticate; sync paused re-login |
| `error`       | A transport error occurred; retries will continue   |

UI mirrors this (web sidebar shows `Saved locally`, `Syncing`, `Synced`, `Offline`,
`Login required`, `Sync error`, `Conflict`).

## Conflict management

Conflicts reuse the shared conflict architecture:

- The engine detects a conflict when the server returns `conflict` on push or when a
  pulled `update`/`delete` arrives for a locally dirty or already-conflicted entity.
- `ConflictService` (shared) classifies the conflict (`content`, `rename`,
  `category_move`, `delete_vs_edit`, `generic`) and builds local/remote snapshots.
- Both platforms persist conflicts through the **shared `ConflictRepository`**
  (`@bigmind/features`) — the `ConflictSink` surface the engine needs.
- Resolution strategies (`keep_mine`, `keep_remote`, dismiss) live in the shared
  repository and work identically on web and mobile.

Note/alias/category conflicts are persisted as full conflicts. Link, todo, reminder,
and notification changes follow the existing protocol: because they are derived
records, a version conflict on push is recorded as a failed operation rather than a
full entity conflict — matching the previous behavior exactly.

## Automatic sync triggers

`createSyncScheduler()` owns all timing and is platform-neutral. Platform
supervisors forward their events into `scheduler.request()` / `start()` / `stop()`:

| Trigger                | Web (`SyncConnectivity`)         | Mobile (`startMobileSyncSupervisor`) |
| ---------------------- | -------------------------------- | ------------------------------------ |
| Local change           | `requestBackgroundSync` bus      | `requestBackgroundSync` bus          |
| Connectivity restored  | `online` event                   | NetInfo transition                   |
| App foreground         | `visibilitychange` → visible     | `AppState` → active                  |
| Periodic               | `setInterval` (30 s, via scheduler) | `setInterval` (30 s, via scheduler) |

All scheduling logic (debounce, gating on online + auth, periodic heartbeat) lives
in the shared `SyncScheduler`; the supervisors only subscribe to platform events.

## Future compatibility

The core is designed so new capabilities do not require redesign:

- **Push notifications** — new `SyncTransport`/supervisor adapters and a notification
  channel sit outside the engine; the outbox/conflict/status model is unchanged.
- **Background sync** — already abstracted behind `requestBackgroundSync` +
  `SyncScheduler`; a native background task (e.g. WorkManager) only needs a new
  supervisor that forwards into the same scheduler.
- **Attachment synchronization** — a new `StorageAdapter` table + a new
  `SyncEntityType`/transport mapping slots into the existing push/pull/cursor model.
- **End-to-end encryption** — encryption is a storage/transport cross-cutting
  concern; because the engine touches data only through the `StorageAdapter` and
  `SyncTransport` abstractions, encrypting at those boundaries requires no changes to
  the sync core.

## Testing

The same engine is tested once in `libs/sync/src/sync-engine.spec.ts` and through the
web and mobile wiring suites; because the platforms share the exact same code,
behavior is identical by construction:

- **Push flow** — full push/pull round trip, operation acceptance + cursor advance.
- **Pull flow** — cursor advanced only after every change applies.
- **Retries** — failed operations stay queued with backoff and `nextRetryAt`.
- **Auth failures / auth_required** — pre-sync gate, transport-401 → refresh →
  auth_required, offline vs auth_required separation (`sync-engine-auth.spec.ts`).
- **Conflict creation** — server conflict persists local+remote snapshots, keeps
  local data, marks entity `conflict` (`sync-engine.spec.ts`).
- **Conflict resolution** — keep_mine / keep_remote / dismiss over both the memory
  adapter (`repositories.spec.ts`) and SQLite (`repositories-sqlite.spec.ts`).
- **Platform parity** — mobile runs the shared engine over the mobile storage
  adapter (`apps/mobile/src/sync/sync-service.spec.ts`); storage adapter parity is
  verified in `libs/storage/src/adapter-parity.spec.ts`.
