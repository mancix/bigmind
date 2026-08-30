# BigMind Architecture

## Overview

BigMind is a local-first personal knowledge base built as an Nx monorepo with a React PWA frontend, an Expo/React Native mobile app (Android-first), a NestJS API backend, and a PostgreSQL database. Clients share domain models, contracts, sync protocol types, storage records, and the auth state machine through `@bigmind/*` libraries. The primary ownership model is **workspace-based**: all user data (notes, categories, links, sync operations) belongs to a workspace, not directly to a user.

## High-level diagram

```
┌──────────────────────────────────────────────────────────┐
│  React PWA (apps/web)                                    │
│                                                          │
│  ┌─────────────┐   ┌─────────────┐   ┌──────────────┐   │
│  │ Auth Pages  │   │ Notes UI    │   │ Sync Engine  │   │
│  │ /login      │   │ (Milkdown)  │   │ (Http/Fake)  │   │
│  │ /register   │   │             │   │              │   │
│  └──────┬──────┘   └──────┬──────┘   └──────┬───────┘   │
│         │                 │                 │            │
│  ┌──────┴─────────────────┴─────────────────┴──────┐    │
│  │            AuthStore (localStorage)             │    │
│  │   access token · refresh token · user            │    │
│  └──────────────────────────────────────────────────┘    │
│         │ IndexedDB (Dexie)                             │
└─────────┼────────────────────────────────────────────────┘
          │ JWT Bearer token
          ▼
┌──────────────────────────────────────────────────────────┐
│  NestJS API (apps/api)                                   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ AuthModule   │  │ SyncModule   │  │ SearchModule   │ │
│  │  register    │  │  push (JWT)  │  │  search (JWT)  │ │
│  │  login       │  │  pull (JWT)  │  │                │ │
│  │  refresh     │  └──────┬───────┘  └───────┬────────┘ │
│  │  logout      │         │                  │          │
│  └──────┬───────┘         │                  │          │
│         │          ┌──────┴──────────────────┴──────┐   │
│         │          │     JwtAuthGuard +             │   │
│         │          │     WorkspaceGuard            │   │
│         │          │  (extract user → resolve       │   │
│         │          │   workspace → inject wsId)      │   │
│         │          └──────┬─────────────────────────┘   │
│  ┌──────┴──────────────────┴─────────────────────────┐ │
│  │              WorkspaceModule                       │ │
│  │  WorkspaceRepository · WorkspaceService            │ │
│  └──────────────────────┬─────────────────────────────┘ │
│                         │                               │
│  ┌──────────┐  ┌────────┴───────┐  ┌─────────────────┐  │
│  │ Notes    │  │ Categories     │  │ NoteLinks       │  │
│  │ (ws_id)  │  │ (ws_id)        │  │ (ws_id)         │  │
│  └────┬─────┘  └───────┬────────┘  └────────┬────────┘  │
│       │                │                    │            │
│       ▼                ▼                    ▼            │
│  ┌─────────────────────────────────────────────────────┐ │
│  │            PostgreSQL (Drizzle ORM)                 │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## Workspace model

### Database tables

**`workspaces`**

| Column        | Type          | Notes    |
| ------------- | ------------- | -------- |
| `id`          | `uuid` PK     |          |
| `name`        | `text`        | Not null |
| `description` | `text`        | Nullable |
| `created_at`  | `timestamptz` | Not null |
| `updated_at`  | `timestamptz` | Not null |

**`workspace_members`**

| Column         | Type                        | Notes                                |
| -------------- | --------------------------- | ------------------------------------ |
| `workspace_id` | `uuid` FK → `workspaces.id` | Part of composite PK, cascade delete |
| `user_id`      | `uuid` FK → `users.id`      | Part of composite PK, cascade delete |
| `role`         | `workspace_role` enum       | `OWNER`, `EDITOR`, `VIEWER`          |
| `created_at`   | `timestamptz`               | Not null, defaults to `now()`        |

Composite primary key: `(workspace_id, user_id)`.

### Owned tables

The following tables carry a `workspace_id` FK and are scoped on every query:

- `notes`
- `categories`
- `note_links`
- `sync_operations`
- `change_log`

### Backend module

```
apps/api/src/workspaces/
  workspaces.module.ts       NestJS module (providers + exports)
  workspaces.service.ts      Business logic (transactional membership)
  workspaces.repository.ts   Drizzle ORM data access (6 methods)
```

**Repository methods:**

| Method               | Returns                      | Description                          |
| -------------------- | ---------------------------- | ------------------------------------ |
| `createWorkspace`    | `WorkspaceRow`               | Inserts a new workspace              |
| `addMember`          | `WorkspaceMemberRow`         | Inserts a membership (role + user)   |
| `removeMember`       | `void`                       | Deletes a membership (404 if absent) |
| `listUserWorkspaces` | `WorkspaceWithRole[]`        | All workspaces for a user + role     |
| `findWorkspaceById`  | `WorkspaceRow \| undefined`  | Single workspace lookup              |
| `getUserRole`        | `WorkspaceRole \| undefined` | User's role in a workspace           |

### Personal Workspace

Created during user registration inside a single Drizzle transaction:

1. Insert user (`users` table)
2. Insert workspace (`workspaces` table, name = `<email> Personal Workspace`)
3. Insert membership (`workspace_members`, role = `OWNER`)

If any step fails, the entire transaction rolls back.

## Authentication flow

### Registration

```
Client → POST /auth/register { email, password }
  → Argon2 hash password
  → Transaction:
      1. Create user
      2. Create Personal Workspace
      3. Add OWNER membership
  → Sign JWT (15 min)
  → Generate refresh token (30 days, SHA-256 hashed)
  → Return { accessToken, refreshToken, user }
```

### Login

```
Client → POST /auth/login { email, password }
  → Verify Argon2 hash
  → Sign JWT + refresh token
  → Return { accessToken, refreshToken, user }
```

### Protected request

```
Client → Authorization: Bearer <accessToken>
  → JwtAuthGuard: validate JWT → req.user = { userId, email }
  → WorkspaceGuard: listUserWorkspaces(userId) → req.workspaceId = first workspace
  → Controller uses req.workspaceId for all queries
```

### Token refresh

```
Client → sync request gets 401
  → AuthStore.refreshAccessToken()
  → POST /auth/refresh { refreshToken }
  → New token pair returned, old refresh token revoked
  → Original request retried with new token
```

## Frontend architecture

### Shared client libraries

Client-facing logic that must work identically on the web PWA and the mobile app lives in shared libs (all `platform:shared`):

- `@bigmind/domain` — pure domain types and rules.
- `@bigmind/contracts` — Zod schemas and ts-rest API contracts.
- `@bigmind/sync` — the shared synchronization engine plus the sync protocol types (`SyncOperation`, `RemoteChange`, `PushOperationResult`, `SyncStatus`), transports (`SyncTransport`, HTTP, fake), repositories (outbox, sync state), and the platform abstractions for connectivity, storage, and background sync.
- `@bigmind/storage` — local record types plus the platform-independent `StorageAdapter` abstraction. Web implements it with `DexieStorageAdapter` (IndexedDB); mobile uses the shared in-memory adapter as a placeholder and will ship a `SqliteStorageAdapter` (expo-sqlite).
- `@bigmind/auth` — the `AuthStore` token-refresh / offline-auth state machine with an injectable `TokenStorage` (localStorage on web, SecureStore on mobile).
- `@bigmind/features` — the shared note, category, wiki-link, and todo repositories (`NoteRepository`, `CategoryRepository`, `LinkRepository`, `TodoRepository`), extracted from the web app and used by both platforms.
- `@bigmind/markdown` — the single source for Markdown handling: block/inline tokenizer, the canonical HTML renderer (`renderMarkdown`, ported from the web's `render-markdown.ts`), wiki-link extraction/normalization, note-preview generation, suggestion ranking, and formatting transforms. The web editor, the web category-description renderer (`apps/web/src/features/categories/render-markdown.ts` is now a re-export), and the mobile editor (Option B: native editor + shared preview renderer — see [Mobile Editor Evaluation](mobile-editor.md)) all consume it, so web and mobile cannot diverge.

### Storage abstraction

All client persistence flows through the `StorageAdapter` interface in `@bigmind/storage`. Application code (repositories, sync engine, components, tests) depends only on this contract — no module outside the adapter layer imports Dexie.

```text
libs/@bigmind/storage
  records.ts          local record types (shared by every platform)
  storage-adapter.ts  StorageAdapter + StorageTable/Collection/WhereClause
                      interfaces + createInMemoryStorage()

apps/web/src/storage
  database.ts               Dexie schema + migrations (platform-specific)
  dexie-storage-adapter.ts  DexieStorageAdapter implements StorageAdapter
  index.ts                  exports `storage: StorageAdapter` (the only
                            import application code needs)

apps/mobile/src/storage     future: SqliteStorageAdapter (expo-sqlite)
```

The adapter exposes the six core capabilities — **notes, categories, reminders, links (noteLinks + noteAliases), conflicts, outbox** — plus the remaining tables clients use (todo items, notifications, sync state). Its query surface mirrors the Dexie subset BigMind uses (`get`/`put`/`add`/`update`/`bulk*`, `where().equals()/anyOf()`, `orderBy()/reverse()/filter()/sortBy()`, `modify()`, change `hook`s) so existing behavior is preserved exactly while remaining implementable on SQLite.

- `DexieStorageAdapter` (web) wraps the unchanged `BigMindDatabase`, including transactions, lifecycle (`open`/`close`/`delete`), and hook events (the search index subscribes to them).
- `createInMemoryStorage()` (shared) is the mobile placeholder and a real test double.
- `SqliteStorageAdapter` (planned) will implement the same contract on expo-sqlite inside the mobile app; no mobile SQLite code ships yet.

### Synchronization engine (shared)

The sync engine lives in `@bigmind/sync` and is **platform independent**: it receives every dependency through a constructor object and never touches `navigator`, `localStorage`, IndexedDB, or mobile APIs.

```text
SyncEngine (libs/sync/src/sync-engine.ts)
  deps:
    transport           SyncTransport (HTTP / fake)
    storage             StorageAdapter (entity tables + transactions)
    outbox              SyncOutbox  (shared OutboxRepository over StorageAdapter)
    syncState           SyncStateStore (shared SyncStateRepository)
    conflicts           ConflictSink (web: ConflictRepository · mobile: storage.conflicts sink)
    buildConflictSnapshots  shared ConflictService
    getAuthState        () => AuthState (web/mobile AuthStore)
  options:
    now / isOnline / backoffBaseMs
```

Platform abstractions in `@bigmind/sync` keep browser/mobile-specific triggers out of the engine:

- **Connectivity** — `Connectivity` interface (`isOnline` + `subscribe`). Web: `navigator.onLine` + window events (`apps/web/src/sync/connectivity.ts`). Mobile: `@react-native-community/netinfo` (`apps/mobile/src/sync/connectivity.ts`).
- **Storage** — the engine depends on the `StorageAdapter` abstraction; both platforms inject their own implementation.
- **Background sync** — `createSyncScheduler()` owns the debounce/periodic timing and the local-change request bus (`requestBackgroundSync`). Web maps visibility/online/auth events through it (`SyncConnectivity`), mobile maps AppState + NetInfo events through it (`apps/mobile/src/sync/supervisor.ts`).

The engine, outbox repository, sync-state repository, fake/HTTP transports, and conflict classifier are the exact same code on both platforms: web wires them in `apps/web/src/sync/sync-service.ts`, mobile in `apps/mobile/src/sync/sync-service.ts`.

### Auth

```
apps/web/src/features/auth/
  auth-store.ts       Singleton: tokens + user in localStorage
  auth-context.tsx    React context: login, register, logout
  authProvider.tsx    Wraps router, provides auth state
  login-page.tsx      /login route
  register-page.tsx   /register route
  api-url.ts          VITE_API_URL helper
```

### Route protection

- Root layout checks `auth.isAuthenticated` in `useEffect`.
- If not authenticated and not on `/login` or `/register`, redirects to `/login`.
- Public routes render only `<Outlet />` (no sidebar, no sync).
- Authenticated routes render the full app layout.

### Data reset

On every `login`, `register`, `logout`, and **workspace switch**, all IndexedDB tables are cleared. This ensures no data leaks between user accounts or workspaces. The sync cursor is reset so the engine pulls only the new user's workspace data from scratch.

### Workspace selection

```
apps/web/src/features/workspaces/
  workspace-store.ts       Persists selected workspace ID in localStorage
  workspace-client.ts      Fetches workspaces from GET /workspaces
  workspace-context.tsx    React context: workspaces, currentWorkspace, switchWorkspace
  workspace-switcher.tsx   Dropdown at top of sidebar
```

The frontend sends an `X-Workspace-Id` header on every sync and search request. The backend `WorkspaceGuard` reads this header, validates the user's membership via `getUserRole`, and sets `req.workspaceId`. If the header is absent, the guard falls back to the user's first workspace.

## Mobile note editing (planned)

The technical evaluation and recommendation for the mobile note editor live in [Mobile Editor Evaluation](mobile-editor.md). Decision summary: keep Markdown as the source of truth, edit with a native `TextInput` + live preview on a **shared Markdown tokenizer/renderer** (`@bigmind/markdown` planned, Phase 1), keep structured features (todo lists, category picker, reminders) as native components over the shared `@bigmind/features` repositories, and treat a WebView+Milkdown port only as a documented escape hatch. No editor code has been shipped yet.

## Mobile app (Expo / React Native)

BigMind also ships a React Native application in `apps/mobile` (Expo SDK 55, Android-first, iOS-compatible) that reuses the shared client libraries above. React Navigation provides bottom tabs for **Home**, **Notes**, **Categories**, **Reminders**, and **Settings**.

```
┌──────────────────────────────────────────────────────────────┐
│  Expo / React Native app (apps/mobile)                      │
│                                                             │
│  NavigationContainer → Bottom Tabs                          │
│   Home · Notes · Categories · Reminders · Settings          │
│                                                             │
│  Providers: SafeAreaProvider → AuthProvider (shared AuthStore│
│  API URL: EXPO_PUBLIC_API_URL · Android emulator: 10.0.2.2  │
│  Storage: shared StorageAdapter (in-memory placeholder)     │
└──────────────────────────────┬───────────────────────────────┘
                               │ @bigmind/domain · contracts ·
                               │ sync · storage · auth (dist)
```

Key properties:

- **Maximum sharing**: all domain models, zod schemas, sync protocol types, and the auth state machine are consumed from `@bigmind/*` libs — nothing is duplicated in `apps/mobile`.
- **Storage**: the mobile app consumes the shared `StorageAdapter` abstraction (`@bigmind/storage`). The web implementation (`DexieStorageAdapter`) wraps the existing Dexie schema; the mobile adapter (`SqliteStorageAdapter` on expo-sqlite) is the next step — see [Mobile Architecture](mobile-architecture.md).
- **Sync**: the mobile app runs the SAME engine as the web app (`@bigmind/sync`), wired over the mobile storage adapter, auth store, and HTTP transport (`apps/mobile/src/sync/sync-service.ts`), with AppState + NetInfo background-sync supervision (`supervisor.ts`). Sync is activated once the storage adapter is no longer in-memory.
- **Monorepo wiring**: `@nx/expo` infers targets; the `build` target is overridden locally to run `expo export --platform android` so CI can validate the Android JS bundle without EAS credentials. All shared libs must be built before Metro runs (`mobile:build` depends on `^build`).

See [Mobile Architecture](mobile-architecture.md) for the full platform breakdown, navigation structure, storage abstraction design, and known platform deltas.
