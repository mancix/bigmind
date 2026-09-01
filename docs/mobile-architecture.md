# BigMind Mobile Architecture

## Overview

BigMind's mobile client is an **Expo (React Native) application**, Android-first, living in `apps/mobile`. The goal of the mobile port is **maximum code sharing** with the existing web PWA (`apps/web`) and the NestJS API (`apps/api`): domain models, contracts, auth state machine, sync protocol, and storage records are all shared, platform-specific code is kept thin.

```
┌────────────────────────────────────────────────────────────────────┐
│                        Shared libraries (libs/)                     │
│                                                                    │
│  @bigmind/domain     Pure domain types + business rules (no I/O)   │
│  @bigmind/contracts  Zod schemas + ts-rest API contracts            │
│  @bigmind/sync       Sync protocol types + SyncTransport interface  │
│  @bigmind/storage    Local records + StorageAdapter abstraction   │
│  @bigmind/auth       AuthStore state machine (token refresh,        │
│                      offline auth) + TokenStorage interface          │
└───────┬───────────────────────────┬──────────────────────┬─────────┘
        │                           │                      │
┌───────▼──────────┐   ┌────────────▼──────────┐   ┌───────▼──────────┐
│  Web PWA         │   │  Mobile (Expo/RN)     │   │  NestJS API      │
│  apps/web        │   │  apps/mobile          │   │  apps/api        │
│  · Dexie/IndexedDB│   │  · expo-sqlite (next)│   │  · ts-rest        │
│  · Http sync      │   │  · React Navigation  │   │  · Sync push/pull │
└─────────────────┘   └──────────────────────┘   └──────────────────┘
```

## Platform snapshot (bootstrap)

| Concern       | Web                            | Mobile                                                                |
| ------------- | ------------------------------ | --------------------------------------------------------------------- |
| Runtime       | React 19 + Vite                | React 19 + React Native 0.83 (Expo SDK 55)                            |
| Navigation    | TanStack Router                | React Navigation (bottom tabs)                                        |
| Local storage | Dexie / IndexedDB              | **SqliteStorageAdapter (expo-sqlite)** via the storage provider;      |
|               |                                | memory adapter is the jest default                                     |
| Tokens        | `localStorage`                 | **Expo SecureStore** (never AsyncStorage)                             |
| API base URL  | `import.meta.env.VITE_API_URL` | `process.env.EXPO_PUBLIC_API_URL` (defaults to `10.0.2.2` on Android) |
| Test runner   | Vitest (jsdom)                 | Jest + jest-expo                                                      |

## What is shared and why

### 1. Domain (`@bigmind/domain`) — fully reusable

Pure TypeScript types and rules with no I/O: `Note`, `Category`, `TodoItem`, `Reminder`, `Notification`, `Conflict`, wiki-link parsing, title normalization, category tree, conflict classification, sync entity/operation enums.

Reused verbatim by the mobile screens (see `apps/mobile/src/screens/*`).

### 2. Contracts (`@bigmind/contracts`) — fully reusable

Zod schemas and ts-rest contracts for auth, sync push/pull, search, workspaces, and health. The mobile app validates a note through `noteDataSchema` in the Home screen, proving the schema layer runs on Hermes.

### 3. Sync (`@bigmind/sync`) — shared engine + platform abstractions

`@bigmind/sync` hosts the **platform-independent sync engine** (`SyncEngine`), the protocol types, the transports, the shared repositories (outbox, sync state), and the shared conflict classifier:

- `SyncOperation`, `RemoteChange`, `PushOperationResult`, `PullResult`, `SyncError`, `SyncStatus`, and the `SyncTransport` interface (`push` / `pull`)
- `SyncEngine` — the push/pull loop, with storage, repositories, auth state, and transport injected; it never touches `navigator`, `localStorage`, IndexedDB, or mobile APIs
- `OutboxRepository` / `SyncStateRepository` — pure logic over the `StorageAdapter` abstraction
- `ConflictService` — conflict classification + snapshot building (web and mobile share it)
- `HttpSyncTransport` — ts-rest HTTP transport with injected auth headers/refresh (works on Hermes and the web)
- `FakeSyncTransport` — in-memory transport for tests and fake-sync mode

**Platform abstractions** (implemented by each platform, consumed by the engine/scheduler):

| Abstraction     | Interface                             | Web                                                                      | Mobile                                                    |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| Connectivity    | `Connectivity.isOnline()/subscribe()` | `navigator.onLine` + window events (`apps/web/src/sync/connectivity.ts`) | NetInfo (`apps/mobile/src/sync/connectivity.ts`)          |
| Storage         | `StorageAdapter`                      | `DexieStorageAdapter`                                                    | `SqliteStorageAdapter` (expo-sqlite; provider-switchable to memory) |
| Background sync | `SyncScheduler` + request bus         | `SyncConnectivity` (visibility/online/auth)                              | `apps/mobile/src/sync/supervisor.ts` (AppState + NetInfo) |

### 4. Auth (`@bigmind/auth`) — shared state machine

`AuthStore` was extracted from `apps/web/src/features/auth/auth-store.ts` into `@bigmind/auth`. It implements the four-state offline model (`authenticated`, `offline_authenticated`, `auth_required`, `unauthenticated`), periodic token refresh, and token persistence through a `TokenStorage` interface:

- Web: `createLocalStorageTokenStorage()` (browser `localStorage`)
- Mobile: `SecureStoreTokenStorage` (`apps/mobile/src/features/auth/token-storage.ts`) backed by **Expo SecureStore** (Keychain / Android encrypted storage). Tokens are never stored in AsyncStorage.

Web and mobile share the exact same refresh/offline logic; the web spec suite (`auth-store.spec.ts`) and the new lib spec (`libs/auth/src/auth-store.spec.ts`) both cover it.

### 5. Storage (`@bigmind/storage`) — abstraction + platform adapters

The client storage records (notes, categories, links, todos, reminders, notifications, outbox, sync state, conflicts) were extracted from `apps/web/src/storage/database.ts` into `@bigmind/storage` and are **re-exported** by the web storage module, so there is a single source of truth.

The module also defines the platform-independent `StorageAdapter` contract:

- `StorageTable<T>` — entity table CRUD + query surface (`get`/`put`/`add`/`update`/`bulk*`, `where().equals()/anyOf()`, `orderBy()/reverse()/filter()/sortBy()`, `modify()`, change `hook`s)
- `StorageKeyValueTable<T>` — the sync-state table
- `StorageCollection<T>` / `StorageWhereClause<T>` — terminal query results
- `StorageAdapter` — the complete database surface (the six core capabilities **notes, categories, reminders, links, conflicts, outbox**, plus todo items, notifications, sync state) with `transaction`, `clearAll`, and lifecycle (`open`/`close`/`delete`)
- `MemoryStorageAdapter` — in-memory implementation (default for tests)
- `SqliteStorageAdapter` + `SqliteDriver` — SQLite implementation over a tiny driver contract (expo-sqlite on device, node:sqlite in CI); schema + versioned migrations live in `libs/storage/src/{sqlite-schema,sqlite-migrations}.ts` (see [Storage Architecture](storage-architecture.md))

The web app implements this contract with `DexieStorageAdapter` (`apps/web/src/storage/dexie-storage-adapter.ts`), a thin wrapper over the existing Dexie schema (`database.ts`). The mobile app uses `SqliteStorageAdapter` through the storage provider (`apps/mobile/src/storage/index.ts`). **Only the adapter layer knows about its backing store** — repositories, the sync engine, components, and tests depend exclusively on `StorageAdapter`.

### 6. Features (`@bigmind/features`) — shared repositories

The note, category, and wiki-link repositories that power the web app were extracted verbatim into `@bigmind/features` (they only depend on `StorageAdapter`, the shared outbox, and domain rules). Web wires them to Dexie; mobile wires them to its storage adapter through `apps/mobile/src/features/data/repositories.ts` — same classes, no duplicated business logic. See “Notes & Categories (mobile)” below.

#### Migration path (executed for SQLite, remaining work for notifications/UI)

1. **Done** — `SqliteStorageAdapter` (`libs/storage/src/sqlite-storage-adapter.ts`) implements `StorageAdapter` over a `SqliteDriver`; schema v1 mirrors the Dexie v11 shape; versioned migrations in `libs/storage/src/sqlite-migrations.ts`.
2. **Done** — `apps/mobile/src/storage/` now ships the storage provider (`createMobileStorageProvider`) with **SQLite as the production default** (`EXPO_PUBLIC_STORAGE_ENGINE=memory` opts back into the in-memory adapter; jest uses memory).
3. Shared `@bigmind/sync` types and the shared `HttpSyncTransport` are already wired with the mobile auth store + workspace store; background sync triggers (AppState + NetInfo) are handled by `apps/mobile/src/sync/supervisor.ts`.
4. Remaining platform work: notifications UI (expo-notifications) and any follow-up schema migrations documented in [Storage Architecture](storage-architecture.md).

## Mobile app structure

```text
apps/mobile/
  index.js                  Expo entry (registerRootComponent)
  app.json                  Expo config (slug `bigmind`, Android package com.bigmind.mobile)
  metro.config.js           @nx/expo withNxMetro (monorepo watch/symlinks)
  src/
    app/
      App.tsx               Providers: SafeArea → Auth → NavigationContainer
      App.spec.tsx          Smoke test: renders the tab navigator (jest-expo)
    navigation/
      types.ts              RootTabParamList + per-tab stack param lists
      RootNavigator.tsx     Bottom tabs; Notes/Categories host nested stacks
      NotesNavigator.tsx    Notes tab stack: list ⇄ detail
      CategoriesNavigator.tsx Categories tab stack: tree ⇄ detail
      AuthNavigator.tsx     Signed-out stack: login ⇄ register
    screens/
      HomeScreen.tsx        Overview + shared-code showcase (domain/contracts/storage)
      RemindersScreen.tsx   Placeholder (shared reminder rules)
      SettingsScreen.tsx    Auth state, API URL, local-data controls
      notes/                Notes stack (see docs/mobile-notes.md): list with
                           search/sort/pagination + sync pill;
                           detail with MarkdownEditView, links, delete
        NotesListScreen.tsx   Recent-first note list (shared NoteRepository)
        NoteDetailScreen.tsx  Edit title/content/category, delete, contract-validated save
      categories/           Categories stack (see docs/mobile-categories.md):
                           lazy tree + note counts + hierarchy-aware search;
                           detail with breadcrumb, move, markdown description
        CategoriesListScreen.tsx  Category tree (domain buildCategoryTree)
        CategoryDetailScreen.tsx  Rename/move/description/delete guards + notes
    components/             Screen + Card + AuthLayout/AuthField scaffolds,
                           MarkdownText (shared tokenizer preview),
                           MarkdownEditView (toolbar + wiki suggestions +
                           preview toggle), TodoListView (shared TodoRepository)
    features/
      auth/                 api-url, token-storage (SecureStore), auth-store,
                           auth-api (shared contracts), auth-provider, auth-flow tests
      data/repositories.ts  Shared NoteRepository/CategoryRepository + outbox/sync-state
                           wired over the mobile storage (single source for sync + UI)
      workspaces/           workspace-store (AsyncStorage-selected workspace id),
                           workspace-client (shared contracts), workspace-context
                           (list/switch/create, offline-cached), workspace-roles
    storage/                Storage provider + adapters (SqliteStorageAdapter is shared in
                           `libs/storage`; this folder wires it to expo-sqlite and exposes
                           the engine switch used by tests) — see storage-architecture.md
    sync/
      sync-service.ts       Shared SyncEngine wired over the mobile storage + auth
      transport.ts          HttpSyncTransport with mobile auth headers + refresh
      conflicts.ts          Mobile ConflictSink (persists via storage.conflicts)
      connectivity.ts       NetInfo Connectivity adapter
      supervisor.ts         AppState + NetInfo + shared scheduler (background sync)
    theme.ts                Colors / spacing / typography
```

## Authentication flow (mobile)

While signed out, the app renders the shared `AuthNavigator` (React Navigation native stack with **Login** and **Register** screens) instead of the main tabs. The `RootGate` in `src/app/App.tsx` switches between them based on the shared `AuthStore` state. The full mobile auth experience — SecureStore persistence, the `offline_authenticated` startup path, the `auth_required` behavior, and the auth lifecycle — is documented in [Mobile Authentication](mobile-authentication.md).

- Both screens reuse the **shared ts-rest zod contracts** (`loginRequestSchema` / `registerRequestSchema`) for client-side validation and `authResponseSchema` / `errorResponseSchema` for response handling (`src/features/auth/auth-api.ts`).
- On success the returned token pair is stored through the shared `AuthStore` (four-state offline model, periodic refresh) into **Expo SecureStore**.
- Register also signs the user in: the API returns a token pair immediately.
- Logging out (Settings → Log out) clears the tokens and returns to the login screen.

## Notes & Categories (mobile)

The Notes and Categories tabs use the idiomatic **tabs with nested native stacks** pattern:

```
Bottom Tab Navigator
├── Home
├── Notes (native stack)
│     ├── NotesList      → NoteDetail { noteId }
├── Categories (native stack)
│     ├── CategoriesList → CategoryDetail { categoryId }
…
```

**No business logic is duplicated on mobile.** The repositories `NoteRepository`, `CategoryRepository`, `LinkRepository`, `TodoRepository`, `RemindersRepository`, `NotificationsRepository`, and `ConflictRepository` are all shared in `@bigmind/features` (they only depend on `StorageAdapter`, the shared outbox, and the domain rules). Both apps now run the same code:

- note create/update/delete with **outbox coalescing** and wiki-link maintenance (`LinkRepository`)
- title normalization (`normalizeNoteTitle`), plain-text previews (`createNotePreview`)
- category tree building (`buildCategoryTree`), cycle guards (`wouldCreateCategoryCycle`), delete guards (children/notes), icon/name normalization
- todo items as synced entities (`TodoRepository`)
- reminder and notification CRUD with outbox coalescing and **workspace scoping** (`RemindersRepository`, `NotificationsRepository` — the workspace id is injected via `WorkspaceContext`)
- conflict persistence and resolution strategies (`ConflictRepository`) — the sync engine uses it as its `ConflictSink` on both platforms, replacing the old mobile-only `storage.conflicts` sink

Web wiring: `apps/web/src/features/{notes,categories,links,todos,reminders,notifications,conflicts}/*-repository.ts` become thin re-export modules that construct the singletons with the Dexie storage adapter (behavior unchanged — the web suite still passes 159/159). Mobile wiring: `apps/mobile/src/features/data/repositories.ts` constructs the same classes over the mobile storage adapter; the sync engine uses those same outbox/sync-state singletons, so UI writes and sync never diverge.

### Mobile Markdown editor (Option B — shipped)

The note detail embeds `MarkdownEditView` (`apps/mobile/src/components/`): a raw multiline `TextInput` for authorship (source of truth stays the markdown text), a formatting toolbar implemented as **pure string transforms** (`@bigmind/markdown/format`), `[[` wiki-link suggestions from the shared ranking helper, and an edit ⇄ **preview** toggle rendered by `MarkdownText` over the shared tokenizer. `TODO_LIST` notes switch to a native `TodoListView` (create/check/reorder via the shared `TodoRepository`). Backlinks and outgoing links are shown under the editor via the shared `LinkRepository`. See [Mobile Editor Evaluation](mobile-editor.md) — Fases 1–2 shipped, Phase 3 (tablet split, web preview parity, reminders integration) pending.

The note editor also validates the assembled record with the shared `noteDataSchema` (`@bigmind/contracts`) before saving.

Validation matrices for behavior parity: `libs/features/src/repositories.spec.ts` (platform-independent), `apps/mobile/src/features/data/repositories.spec.ts` + `apps/mobile/src/screens/notes/notes-experience.spec.tsx` (mobile), plus the full web suite.

## Navigation (React Navigation)

React Navigation was chosen over expo-router for the bootstrap because the requested structure (Home / Notes / Categories / Reminders / Settings) is a flat set of tabs and React Navigation is the framework-agnostic recommendation in the requirements. The signed-out flow uses a native stack (`AuthNavigator` with Login/Register) and the signed-in flow uses the bottom tabs:

```
NavigationContainer
└── (RootGate: shared auth state)
    ├── signed out → AuthNavigator (native stack)
    │     ├── Login ⇄ Register
    └── signed in → Bottom Tab Navigator
            ├── Home
            ├── Notes
            ├── Categories
            ├── Reminders
            └── Settings
```

Future screens (reminders, conflict review, deeper categories) can be added as native stacks above the tabs. The note editor strategy is evaluated in [Mobile Editor Evaluation](mobile-editor.md) — recommendation: native Markdown editing + shared preview renderer (Phase 1 of the roadmap), no editor code shipped yet.

## API connectivity

- Base URL: `getApiUrl()` in `apps/mobile/src/features/auth/api-url.ts`
  - `EXPO_PUBLIC_API_URL` overrides (Expo inlines it at bundle time)
  - Android emulator default: `http://10.0.2.2:3000`
  - iOS simulator / web default: `http://localhost:3000`
- Sync push/pull and auth refresh use `fetch` (available on Hermes) and the shared contracts.

## Running the mobile app

```bash
# 1. Build shared libs (Metro resolves @bigmind/* via dist + package exports)
pnpm exec nx run-many -t build -p @bigmind/domain @bigmind/contracts @bigmind/auth @bigmind/sync @bigmind/storage

# 2. Start the Expo dev server (Expo Go or emulator)
pnpm exec nx serve @bigmind/mobile

# 3. Android emulator / device
pnpm exec nx run @bigmind/mobile:run-android

# Validate the Android JS bundle without a device
pnpm exec nx run @bigmind/mobile:build        # = expo export --platform android

# Tests (jest-expo)
pnpm exec nx run @bigmind/mobile:test
```

## Monorepo integration notes

- **Buildable shared libs**: `@bigmind/*` libs emit `dist/` (Vite lib mode + `vite-plugin-dts`) and expose package `exports` with an `@bigmind/source` condition pointing at TS sources (used by TypeScript via `customConditions`). Metro resolves the `import`/`default` conditions against `dist/`.
- The mobile `export`/`build` targets depend on `^build`, so Metro always sees fresh lib outputs.
- The mobile project registers targets through the `@nx/expo` plugin (`nx.json`), with a local `build` override in `apps/mobile/project.json` (`expo export --platform android`) so CI can validate the bundle without EAS credentials.
- Tests: `apps/mobile` uses jest-expo with mocks for AsyncStorage, react-native-screens, and safe-area-context (`src/test-setup.ts`).

## Known platform deltas (documented for follow-ups)

| Concern                   | Web current                 | Mobile need                                                                                      |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `crypto.randomUUID()`     | available                   | not guaranteed on Hermes — use `expo-crypto` or a local id helper                                |
| `navigator.onLine`        | engine online gate          | `@react-native-community/netinfo` (wired via the shared Connectivity abstraction)                |
| Background sync           | service worker + 30s timer  | AppState listener + push (expo-notifications)                                                    |
| Notifications UI          | browser Notification Center | expo-notifications + SQLite silo                                                                 |
| Search index (MiniSearch) | in-memory + Dexie           | keep MiniSearch (pure JS)                                                                        |
| Rich text                 | Milkdown Crepe (web-only)   | native Markdown `TextInput` + shared renderer preview (see [mobile-editor.md](mobile-editor.md)) |
