# Shared Repository Architecture

## Purpose

BigMind runs the same client business logic on the web PWA and the mobile app.
All persistence-related behavior — note/category/reminder/todo management,
wiki-link and backlink maintenance, conflict resolution — lives in **one set of
repository implementations** that both platforms construct with their own
storage engine. There is no per-platform repository code.

## Repository audit (what was shared and why)

Every repository was audited for duplicated business logic, platform-specific
code, and storage-specific code. The result:

| Repository            | Before                                                                                         | After                                              |
| --------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `NoteRepository`      | Shared (`@bigmind/features`)                                                                   | unchanged                                          |
| `CategoryRepository`  | Shared (`@bigmind/features`)                                                                   | unchanged                                          |
| `LinkRepository`      | Shared (`@bigmind/features`) — wiki-link + backlink + alias maintenance                        | unchanged                                          |
| `TodoRepository`      | Shared (`@bigmind/features`)                                                                   | unchanged                                          |
| `RemindersRepository` | Web-only (`apps/web/.../reminders-repository.ts`) — read `localStorage` directly               | shared (`@bigmind/features`), workspace via `WorkspaceContext` |
| `NotificationsRepository` | Web-only (`apps/web/.../notifications-repository.ts`) — read `localStorage` directly       | shared (`@bigmind/features`), workspace via `WorkspaceContext` |
| `ConflictRepository`  | Web-only (`apps/web/.../conflict-repository.ts`, 670+ lines) used `crypto.randomUUID()`        | shared (`@bigmind/features`), id via `generateId()` |
| Mobile conflict sink  | `apps/mobile/src/sync/conflicts.ts` re-implemented conflict `create`                           | deleted — uses the shared `ConflictRepository`      |

Everything a repository does — outbox coalescing, title/name normalization,
cycle and delete guards, conflict resolution strategies, workspace scoping —
was already (or is now) implemented over the two shared abstractions:

- `StorageAdapter` (`@bigmind/storage`) — the only storage contract.
- `SyncOutbox` / `requestBackgroundSync` (`@bigmind/sync`) — the only sync
  contracts.

No repository imports React, React Native, IndexedDB, SQLite, `localStorage`,
`AsyncStorage`, or browser/native APIs.

> **`WorkspaceRepository` note:** workspace *management* (create/switch/members)
> is not a local-data repository — the authoritative source is the NestJS API
> (`apps/api/src/workspaces/workspaces.repository.ts`, Drizzle) and both apps
> talk to it through a thin HTTP client (`apps/web|mobile/…/workspace-client.ts`)
> plus a tiny per-platform store for the *selected* workspace id. That selected
> id is exactly what `WorkspaceContext` injects into the shared repositories.
> There is therefore no client-side workspace repository to share — the shared
> part is the `WorkspaceContext` provider.

## Dependency graph

```text
                    ┌──────────────────────────────┐
                    │      @bigmind/features       │
                    │  (shared repositories)       │
                    │                              │
                    │  NoteRepository              │
                    │  CategoryRepository          │
                    │  LinkRepository              │
                    │  TodoRepository              │
                    │  RemindersRepository         │
                    │  NotificationsRepository     │
                    │  ConflictRepository          │
                    └──────┬───────────────┬───────┘
                           │               │
              depends on   │               │  depends on
                           ▼               ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │   @bigmind/storage   │    │     @bigmind/sync    │
        │   StorageAdapter     │    │   SyncOutbox         │
        │   records            │    │   requestBackground   │
        └──────┬───────────────┘    └──────────┬───────────┘
               │                               │
               ▼                               ▼
   MemoryStorageAdapter            OutboxRepository
   SqliteStorageAdapter            SyncEngine
   DexieStorageAdapter  (web)      SyncStateRepository
```

```text
@bigmind/features
├── notes/note-repository.ts
├── categories/category-repository.ts
├── links/link-repository.ts
├── todos/todo-repository.ts
├── reminders/reminder-repository.ts
├── notifications/notification-repository.ts
├── conflicts/conflict-repository.ts
├── workspace/workspace-context.ts   WorkspaceContext (injectable, platform-agnostic)
├── repository-provider.ts           createRepositoryProvider() — DI entry point
└── id.ts                            generateId() (crypto.randomUUID + fallback)
```

## Dependency injection: repository provider

Repositories receive their dependencies through constructors; the
`createRepositoryProvider(storage, outbox, options)` factory wires the whole
layer at application bootstrap:

```ts
const repos = createRepositoryProvider(storage, outbox, {
  workspace: webWorkspaceContext, // or mobileWorkspaceContext, or a test context
});

await repos.notes.create({ title: 'Hello' });
await repos.reminders.create({ title: 'Remind me', dueAt: '…' });
```

- **Web** (`apps/web/src/features/notes/note-repository.ts` and siblings):
  thin re-export modules that construct the singletons with
  `DexieStorageAdapter` + `OutboxRepository` and a `localStorage`-backed
  `WorkspaceContext` (`webWorkspaceContext` in `workspace-store.ts`).
- **Mobile** (`apps/mobile/src/features/data/repositories.ts`): the same
  classes over the mobile storage provider (`SqliteStorageAdapter` by
  default, memory in tests) + an `AsyncStorage`-backed `WorkspaceContext`.

Switching storage engines — or adding a desktop/embedded platform — changes
**only the provider call**, never the repository implementations.

## Storage independence

Repositories query and write exclusively through `StorageAdapter`:

- Web: `DexieStorageAdapter` wraps IndexedDB via Dexie.
- Mobile: `SqliteStorageAdapter` (shared, `libs/storage`) runs on any
  `SqliteDriver` — expo-sqlite on device, `node:sqlite` in CI.
- Tests: `MemoryStorageAdapter` (default) and real SQLite.

The same business assertions run against every adapter
(`libs/features/src/repositories.spec.ts` + `repositories-sqlite.spec.ts`),
and `libs/storage/src/adapter-parity.spec.ts` proves the adapter contracts are
byte-identical.

## Workspace scoping (`WorkspaceContext`)

`RemindersRepository` and `NotificationsRepository` classify records by
`workspaceId`. The current workspace id is injected as a tiny provider instead
of being read from a platform store, so the repositories stay platform-free:

| Platform | Provider                                                        |
| -------- | --------------------------------------------------------------- |
| Web      | `webWorkspaceContext` (`localStorage` `bigmind_workspace_id`)   |
| Mobile   | `mobileWorkspaceContext` (AsyncStorage-hydrated in-memory cache)|
| Tests    | `StaticWorkspaceContext(id \| null)` / default `null`            |

Records created without a workspace fall back to `''`, preserving the legacy
web behavior exactly.

The mobile Reminders tab consumes this exact repository + scoping (see
[Mobile Reminders](mobile-reminders.md)): `RemindersRepository.list()` feeds
an agenda grouped by due date, `findById` powers the detail screen, and
`create`/`update`/`toggle`/`remove` drive the create/edit form, completion
toggling, and confirmed deletion — all offline-first over the outbox, with the
same coalescing and workspace isolation as the web app. The note-detail screen
adds `listForNote(noteId)` (workspace-scoped reminder queries for the
“Related reminders” section, see [Mobile Note Detail](mobile-note-detail.md))
and `LinkRepository.listAllAliases()` (wiki-title resolution on a screen).

## Future compatibility

The layering is deliberately future-proof:

- **Encrypted storage / attachments / new tables** — new capabilities are
  added behind `StorageAdapter` tables; repositories stay unchanged.
- **Multi-workspace caching** — workspace isolation is already a repository
  invariant via `WorkspaceContext`; a future cache layer can swap the context
  provider with a multi-workspace implementation.
- **Desktop app** — a desktop embedder supplies its own `StorageAdapter` and
  `WorkspaceContext`; it reuses every shared repository as-is.
- **ID generation / clocks** — `generateId()` keeps the server
  `z.string().uuid()` contract on Hermes without `crypto.randomUUID()`;
  providers can inject clocks for deterministic tests.

## Testing

`libs/features` runs two suites over the same assertions:

- `repositories.spec.ts` — `MemoryStorageAdapter`.
- `repositories-sqlite.spec.ts` — real SQLite (`node:sqlite`), including a
  close/reopen "restart" persistence check.

Coverage: note lifecycle, category lifecycle, todo lifecycle, reminder
lifecycle (create/update/toggle/remove + outbox coalescing), notification
lifecycle (create/read/mark-all/remove), conflict lifecycle (create, merge
re-detections, keep_mine / keep_remote resolutions, dismiss, guards),
workspace isolation, and the DI provider wiring.

Platform suites additionally verify the wiring: the web suite runs the same
repositories against `DexieStorageAdapter` (159 tests), and the mobile suite
runs them against the mobile storage provider (26 tests).