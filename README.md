# BigMind

BigMind is a local-first personal knowledge base for capturing, editing, and searching Markdown notes. The web application stores notes in the browser first, remains usable offline, and can synchronize local changes with a PostgreSQL-backed API when the HTTP transport is enabled.

The repository is an Nx monorepo built around a platform-independent domain library, shared runtime-validated API contracts, a React PWA, and a NestJS backend.

## License

BigMind is free software released under the **GNU Affero General Public License v3 (AGPL-3.0-or-later)**. You may redistribute and modify it under the terms of the AGPLv3, which requires that modified versions of the software, when run over a network, make their source code available to users.

See [LICENSE](LICENSE) for the full license text.

## Current features

### Notes

- Create, edit, search, and delete notes.
- Full-text search across all notes using MiniSearch, with case-insensitive matching, partial word (prefix) support, fuzzy search, and relevance scoring.
- Rich Markdown editing powered by Milkdown Crepe.
- Automatic title normalization with an `Untitled note` fallback.
- Plain-text previews generated from Markdown content.
- Debounced autosave with visible local-save state.
- Sidebar ordered by the most recently updated note.
- Command palette for quickly finding an existing note or creating a new one.
- Assign each note to one category or leave it uncategorized.
- Choose a template type when creating a note: **Markdown** (default) or **Todo List** with ordered items, completion toggling, and reordering.

### Categories

- Create, rename, move, reorder, and safely delete hierarchical categories.
- Assign an optional system emoji icon to every category or subcategory.
- Create nested subcategories at any depth and navigate them from the sidebar.
- Filter notes by a directly assigned category or by `Uncategorized`; search remains scoped to the active filter.
- Shareable category filters through the `?category=<categoryId>` URL parameter.
- Category selection in the note editor with offline autosave.
- Deletion guards prevent orphaning active subcategories or assigned notes.

### Wiki links and backlinks

- Connect notes by writing `[[Note title]]` in Markdown; `[[Note title|Label]]` is also recognized by the link parser.
- Fuzzy local note suggestions appear after typing `[[` and support keyboard navigation with the arrow keys, `Enter`, and `Escape`.
- Every note page shows clickable outgoing links and backlinks below the editor.
- Links are rebuilt automatically whenever note content changes and are removed when either side is deleted.
- Links to notes that do not exist yet remain local and unresolved, then resolve automatically after the target note is created.
- Renaming a note records its previous title as a local alias, so existing links and searches continue to resolve without rewriting note content.

### Local-first storage and offline support

- Notes, categories, resolved links, unresolved link names, and local note aliases are persisted in IndexedDB through Dexie (web) or in SQLite through `SqliteStorageAdapter` (mobile) — both behind the **same `StorageAdapter` contract** (`@bigmind/storage`).
- Note changes and outbox operations are written transactionally.
- Storage survives app restarts, device reboots and long offline periods; the SQLite schema is versioned and migrated transactionally.
- The application remains usable without an API connection.
- Installable PWA with a service worker and offline-ready/update notifications.
- Background synchronization after local changes, every 30 seconds while the app is open, when the tab becomes visible, and when the browser comes back online (mobile: AppState + NetInfo).

See [docs/storage-architecture.md](docs/storage-architecture.md) for the adapter contract, database schema, migration strategy, and the encrypted-storage roadmap.

### Synchronization

- Platform-independent sync engine (`@bigmind/sync`) shared by the web PWA and the mobile app; only connectivity, storage, and background-sync triggers are platform-specific.

See [docs/synchronization-architecture.md](docs/synchronization-architecture.md) for the shared sync core, the `Connectivity` / `StorageAdapter` / auth abstractions, connectivity layers (web `navigator.onLine` + events, mobile NetInfo), authentication integration, sync status, and conflict handling.
- Configurable fake or HTTP synchronization transport (HTTP works on the web and on Hermes).
- Local outbox for note, category, and link create/update/delete operations.
- Coalescing of pending operations to avoid unnecessary sync traffic.
- Push/pull synchronization with a server-side sequence cursor.
- Optimistic version checks and conflict detection.
- Retry metadata and exponential backoff for retryable failures.
- Automatic background sync with a manual fallback action and visible `Saved locally`, `Syncing`, `Synced`, `Offline`, `Sync error`, and `Conflict` states. Web triggers: timers, visibility, online events. Mobile triggers: AppState + NetInfo (active on sign-in; the initial pull loads server data into the local adapter). The API's `WorkspaceGuard` requires `X-Workspace-Id`, which the mobile app resolves automatically by selecting the user's first workspace (see `apps/mobile/src/features/workspaces/ensure-workspace.ts`).

### Conflict management

- Conflicts are first-class domain entities kept in a dedicated `conflicts` IndexedDB table with `open`, `resolved`, and `dismissed` statuses.
- The SyncEngine detects conflicts returned by the backend, persists local and remote snapshots, and marks the affected note, category, or link with a `conflict` `syncStatus`. It never overwrites local data or discards local changes when a conflict is detected.
- Conflict types are classified automatically: `content`, `rename`, `delete_vs_edit`, `category_move`, and `generic`.
- A global conflict indicator in the sidebar reports `No conflicts` or `<n> conflicts` and links to `/conflicts`. A conflict counter is shown next to the existing sync status.
- The `/conflicts` route lists open conflicts first and resolved/dismissed conflicts below. Each card shows the entity type, the conflicts title or name, the conflict type, and the creation date.
- The `/conflicts/$conflictId` detail page displays the conflict type, local and remote versions, creation timestamp, the local and remote changes, and the available actions:
  - `Keep Mine` keeps the local snapshot and re-queues a pending update operation with the remote version as the base version.
  - `Keep Remote` overwrites the matching local entity with the remote snapshot and clears the pending outbox operations for that entity.
  - `Merge Manually` opens a simple two-column merge editor for note content conflicts, saves the edited result locally, and queues a pending update operation.
  - `Restore Note` preserves the local content for a `delete_vs_edit` conflict and re-queues a pending update operation.
  - `Delete Mine` accepts the remote deletion, marks the local entity as deleted, and clears pending outbox operations.
- For note rename conflicts, an optional `Custom Title` action lets the user write a new title and resolve through the merge path.
- For category move conflicts, the cycle validation rules remain enforced when applying a remote move.
- Conflicts can be dismissed from the conflict card, the note banner, or the detail page. Dismissed conflicts keep the entity unchanged, disappear from the active conflict count, and remain queryable through the resolved list.
- When opening a note with an open conflict, a non-blocking banner offers `Review conflict` and `Dismiss`. Editing remains available while the banner is visible.
- When a conflict is detected, a small non-blocking toast notification appears with `Review` and dismisses automatically. No modal dialogs are used.
- Conflicts persist enough information to be reconstructed after a browser reload, an application restart, or temporary offline periods.
- A conflict service provides the foundation for future automatic merge and three-way merge support by capturing the base version, local snapshot, and remote snapshot needed by a future merge algorithm.

### Authentication and authorization

- User registration and login with email/password using Argon2 hashing.
- JWT access tokens (15-minute expiry) and opaque refresh tokens (30-day expiry, stored as SHA-256 hashes in the database with rotation on every refresh).
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, and `POST /auth/logout` endpoints, all validated with Zod schemas via shared ts-rest contracts.
- Every newly registered user automatically receives a **Personal Workspace** named `<email> Personal Workspace` (created transactionally with the user account) where they are the `OWNER`.
- A NestJS `JwtAuthGuard` (Passport JWT strategy) and a `WorkspaceGuard` protect all sync push, sync pull, search, and note endpoints.
- The `WorkspaceGuard` requires the `X-Workspace-Id` header on every workspace-scoped request. Missing header returns `400 Bad Request`. Invalid workspace access returns `403 Forbidden`.
- The guard extracts the authenticated user from the JWT, validates workspace membership, and injects `workspaceId` onto the request so that every query is scoped to that workspace.
- Unauthenticated requests to protected endpoints are rejected with `401 Unauthorized`. Missing `X-Workspace-Id` returns `400 Bad Request`.
- Rate limiting is applied to `/auth/login` (10 req/min), `/auth/register` (5 req/min), and `/auth/refresh` (10 req/min).

#### Offline authentication model

BigMind uses a four-state authentication model to support offline-first usage:

| State                   | Meaning                                           | Sync             | UI Behavior                                                          |
| ----------------------- | ------------------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `authenticated`         | Valid tokens, online                              | Active           | Normal                                                               |
| `offline_authenticated` | Valid stored tokens but offline                   | Paused (offline) | Normal, shows "Offline" sync status                                  |
| `auth_required`         | Tokens expired or revoked, possible to be offline | Paused           | Shows banner: "Authentication required", local data fully accessible |
| `unauthenticated`       | No tokens stored                                  | Inactive         | Redirect to login                                                    |

- Network failures during token refresh preserve all tokens and local data (transition to `offline_authenticated`).
- Authentication failures (expired/revoked refresh token) transition to `auth_required` and preserve local data and outbox.
- Token refresh distinguishes network errors (fetch throws) from authentication errors (HTTP 4xx response).
- Automatic local database clearing is never triggered by authentication failures — only by explicit user logout.
- Logout clears tokens, local database, outbox, and workspace cache.

### Workspaces

Workspaces are the primary ownership model for BigMind. Data is scoped to a workspace, never directly to a user.

**Tables:**

| Table               | Columns                                                 | Purpose                                 |
| ------------------- | ------------------------------------------------------- | --------------------------------------- |
| `workspaces`        | `id`, `name`, `description`, `created_at`, `updated_at` | A shared space for notes and categories |
| `workspace_members` | `workspace_id`, `user_id`, `role`, `created_at`         | Maps users to workspaces with a role    |

**Roles:** `OWNER`, `EDITOR`, `VIEWER` (stored as a PostgreSQL enum `workspace_role`).

**Backend module** (`apps/api/src/workspaces/`):

- `workspaces.module.ts` — NestJS module providing and exporting `WorkspaceRepository` and `WorkspaceService`.
- `workspaces.service.ts` — Business logic layer wrapping the repository, accepts a `DatabaseTransaction` for transactional membership creation.
- `workspaces.repository.ts` — Drizzle ORM access layer with six methods:
  - `createWorkspace(values, tx?)` — creates a workspace row.
  - `addMember(values, tx?)` — adds a user to a workspace with a role.
  - `removeMember(workspaceId, userId, tx?)` — removes a membership (throws `404` if not found).
  - `listUserWorkspaces(userId, tx?)` — returns all workspaces the user belongs to, with their role.
  - `findWorkspaceById(id, tx?)` — fetches a single workspace by ID.
  - `getUserRole(workspaceId, userId, tx?)` — returns the user's role in a workspace (or `undefined`).
- `workspaces.controller.ts` — Exposes `GET /workspaces` (JWT-protected) and invitation endpoints.
- `invitations.repository.ts` — Drizzle ORM access for `workspace_invitations`.
- `invitations.service.ts` — Invitation business logic: create (OWNER only), list, revoke, get by token, accept. Validates email match on accept. Transactional membership creation on accept.

**Workspace invitations:**

| Table                   | Columns                                                                                   | Purpose                                 |
| ----------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| `workspace_invitations` | `id`, `workspace_id`, `email`, `role`, `token`, `expires_at`, `accepted_at`, `created_at` | Tracks pending and accepted invitations |

Invitation endpoints (all JWT-protected except `getInvitation`):

| Method   | Path                                                 | Description                                                                                                                                                                         |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/workspaces/:workspaceId/invitations`               | Create an invitation (OWNER only). Body: `{ email, role }` where role is `EDITOR` or `VIEWER`. Returns the invitation with a unique token.                                          |
| `GET`    | `/workspaces/:workspaceId/invitations`               | List all invitations for a workspace (OWNER only).                                                                                                                                  |
| `DELETE` | `/workspaces/:workspaceId/invitations/:invitationId` | Revoke an invitation (OWNER only).                                                                                                                                                  |
| `GET`    | `/workspace-invitations/:token`                      | Get invitation details by token (anyone, used for invitation preview).                                                                                                              |
| `POST`   | `/workspace-invitations/accept`                      | Accept an invitation. Body: `{ token }`. The authenticated user's email must match the invitation email. Transactionally creates a membership and marks the invitation as accepted. |

**Member management endpoints:**

| Method   | Path                                       | Description                                                                                 |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `GET`    | `/workspaces/:workspaceId/members`         | List all members (any member can view). Returns `userId`, `email`, `role`, `joinedAt`.      |
| `PATCH`  | `/workspaces/:workspaceId/members/:userId` | Change a member's role (OWNER only). Body: `{ role }`. Prevents demoting the last OWNER.    |
| `DELETE` | `/workspaces/:workspaceId/members/:userId` | Remove a member (OWNER only). Prevents removing the last OWNER.                             |
| `PATCH`  | `/workspaces/:workspaceId/rename`          | Rename a workspace (OWNER only). Body: `{ name }`.                                          |
| `DELETE` | `/workspaces/:workspaceId`                 | Delete a workspace (OWNER only, personal WS cannot be deleted, must have no other members). |

**Role permissions:**

| Action                 | OWNER | EDITOR | VIEWER |
| ---------------------- | ----- | ------ | ------ |
| View notes             | ✅    | ✅     | ✅     |
| Create/edit notes      | ✅    | ✅     | ❌     |
| View workspace members | ✅    | ✅     | ✅     |
| Invite users           | ✅    | ❌     | ❌     |
| Change member role     | ✅    | ❌     | ❌     |
| Remove member          | ✅    | ❌     | ❌     |
| Rename workspace       | ✅    | ❌     | ❌     |
| Delete workspace       | ✅    | ❌     | ❌     |
| Revoke invitation      | ✅    | ❌     | ❌     |

Owners cannot remove or demote themselves if they are the last OWNER of the workspace.

Invitations expire after 7 days. Accepting requires the authenticated user's email to match the invitation email.

**Data isolation:** notes, categories, note links, sync operation records, and the change log all carry a `workspace_id` foreign key. Every repository query filters by `workspace_id`, ensuring strict isolation between workspaces.

**Personal Workspace:** created transactionally during user registration within the same Drizzle transaction that creates the user account and the `OWNER` membership. Named `<email> Personal Workspace`.

**Workspace selection:** the frontend sends an `X-Workspace-Id` header on every sync and search request. The `WorkspaceGuard` validates the user's membership and enforces the role. If the header is absent, the guard falls back to the user's first workspace.

**Frontend workspace switcher** (`apps/web/src/features/workspaces/`):

- `workspace-store.ts` — Persists the selected workspace ID in `localStorage`.
- `workspace-client.ts` — Fetches the user's workspaces from `GET /workspaces`.
- `workspace-context.tsx` — React context: provides `workspaces`, `currentWorkspace`, `switchWorkspace`. On switch, clears all IndexedDB data and resets the sync cursor so the engine pulls the new workspace's data from scratch.
- `workspace-switcher.tsx` — Dropdown component at the top of the sidebar. Shows the current workspace name, lists all available workspaces with role badges, and persists selection.
- The `HttpSyncTransport` attaches the `X-Workspace-Id` header to every push/pull request alongside the JWT `Authorization` header.

### Frontend authentication

- Login and register pages at `/login` and `/register` with email/password forms, inline validation, and error display.
- Access and refresh tokens are persisted in `localStorage` via a singleton `AuthStore`.
- The `AuthProvider` subscribes to `AuthStore` state changes and exposes `authState` (`authenticated` | `offline_authenticated` | `auth_required` | `unauthenticated`) and `isAuthenticated` (true for `authenticated` and `offline_authenticated`) through React context.
- `unauthenticated` users are redirected to `/login`; `auth_required` users see an amber banner but can continue working offline.
- `auth_required` state cannot clear the local database or outbox — local modifications are always preserved.
- A logout button in the sidebar footer clears all local data and tokens.
- The `HttpSyncTransport` attaches a `Bearer` JWT to every sync request and, on `401`, transparently refreshes the access token and retries the call once.
- The sync engine checks `authState` before syncing and sets status to `auth_required` if authentication cannot continue.
- IndexedDB is cleared only on explicit user logout, not on login or register. This preserves offline modifications across sessions.
- `VITE_API_URL` is used for all auth API calls and HTTP sync transport alike.

### Backend API

- NestJS API with shared ts-rest contracts and Zod validation.
- PostgreSQL persistence through Drizzle ORM.
- Batched `/sync/push` and cursor-based `/sync/pull` endpoints (JWT-protected).
- Server-side full-text search via PostgreSQL `tsvector` (JWT-protected).
- Server-side note, category, and link versions, ordered change log, and conflict responses.
- Health endpoint at `/health`.
- OpenAPI/Swagger documentation at `/docs` in development.
- Integration tests against a dedicated PostgreSQL test database, with authenticated test helpers.

### Shared domain

The `@bigmind/domain` library contains platform-independent note, category, link, alias, conflict, and sync types and pure rules, including title/name normalization, Markdown previews, wiki-link extraction and resolution, hierarchy construction, sibling ordering, descendant and cycle checks, deletion checks, entity IDs, timestamps, versions, conflict classification helpers (`isConflictResolved`, `isConflictOpen`, `isConflictDismissed`, `isActiveConflict`), and shared sync primitives. It has no dependency on React, NestJS, browser APIs, or persistence libraries.

## How to use BigMind

### Create and edit notes

1. Select the `+` button next to the BigMind logo to create a note.
2. Enter a title and write the note body in the Markdown editor.
3. Optionally select a category from the `Category` menu above the editor.

Changes are saved automatically to IndexedDB after a short delay. `Saved locally` means the note is safe in the browser and may still be waiting for server synchronization. The timestamp shown on the note uses the last update time, or the creation time when the note has never been updated.

Use the sidebar search field to filter the visible notes. Press `Ctrl+K` on Windows/Linux or `Cmd+K` on macOS to open the command palette, search across notes, or create a new note quickly. Search also recognizes previous note titles stored as local aliases.

### Organize notes with categories

1. Select `New category` in the sidebar.
2. Enter the category name and, optionally, choose one system emoji as its icon.
3. Use the `+` action on an existing category to create a subcategory.
4. Use `Rename`, `Move`, and `Delete` to maintain the hierarchy.

Selecting a category filters the note list. `All Notes` removes the filter, while `Uncategorized` shows notes without a category. A category cannot be deleted while it contains active subcategories or assigned notes; move or remove those items first.

### Create wiki links

Type two opening brackets in the note editor and continue with a note title:

```text
[[Rust]]
```

After typing `[[`, BigMind displays fuzzy suggestions from the notes already stored on the device. Continue typing to narrow the list, use `Arrow Up` and `Arrow Down` to move through it, press `Enter` to insert the selected note, or press `Escape` to close the popup.

The parser also understands an optional display label:

```text
[[Rust|Read the Rust note]]
```

BigMind resolves the canonical title (`Rust`) while preserving the complete Markdown text. Links are directed: if `Ownership` contains `[[Rust]]`, `Rust` appears under `Outgoing Links` on the Ownership page and Ownership appears under `Backlinks` on the Rust page. Select either entry to navigate directly to the related note.

### Work with missing or renamed notes

Writing `[[Lifetime]]` does not create a note automatically. The reference remains unresolved locally. If a note titled `Lifetime` is created later, BigMind resolves the link and updates outgoing links and backlinks automatically.

Renaming a note does not rewrite existing Markdown. For example, after renaming `Rust` to `Rust Programming`, existing `[[Rust]]` references continue to work through a local alias and display the current title in link lists. Aliases are currently local to the device and are not synchronized separately.

### Switch workspaces

If you belong to more than one workspace, a workspace switcher dropdown appears at the top of the sidebar.

1. Click the current workspace name to open the dropdown.
2. Select a different workspace from the list. Each entry shows the workspace name and your role (`OWNER`, `EDITOR`, or `VIEWER`).
3. BigMind clears all local data, resets the sync cursor, and pulls the selected workspace's notes, categories, and links from the server.
4. The sidebar updates to show the new workspace's note tree and categories.

Your selection is persisted in `localStorage`, so the same workspace is active on your next visit.

### Manage workspace members

Navigate to `/settings` to manage your workspace.

**About tab:**

- Shows workspace name, description, and your role.
- OWNERs can rename the workspace inline. The workspace ID and all data (notes, categories, links) remain unchanged.
- OWNERs can delete the workspace. A confirmation dialog requires typing `DELETE`. Personal workspaces and workspaces with other members cannot be deleted.

### Move and copy notes across workspaces

Notes can be moved or copied to another workspace from the note detail page:

- **Move**: Removes the note from the source workspace and moves it to the destination. Wiki links are preserved in the content but resolved links (backlinks) in the source workspace are removed.
- **Copy**: Creates a duplicate of the note in the destination workspace. The original note remains unchanged. Categories are not carried over (set to `null`).
- Both operations require the user to be at least `EDITOR` in both source and destination workspaces.
- VIEWERs cannot move or copy notes.

**Members tab:**

- Lists all members with their email, role, and join date.
- Only OWNERS can change a member's role (Owner → Editor → Viewer) or remove a member.
- A confirmation dialog appears when removing a member or demoting an Owner.
- The last Owner of a workspace cannot be removed or demoted.
- Non-owners see the member list but cannot modify it.

**Invitations tab:**

- Only OWNERS can invite new users by email.
- Pending and accepted invitations are displayed separately.
- Pending invitations can be revoked by the Owner.

### Understand synchronization and offline mode

All edits are written locally first, so notes, categories, wiki links, and backlinks remain available without a network connection. With the HTTP transport enabled, BigMind attempts background synchronization:

A local full-text search index (powered by **MiniSearch**) is built and maintained entirely from the local Dexie data:

- Note **title** and **content** are indexed; deleted notes are excluded.
- The index is automatically rebuilt from the persisted notes on application startup.
- Changes are kept in sync through Dexie hooks: created, updated, restored, or deleted notes are re-indexed immediately.
- Search is **case-insensitive**, supports **partial words** (prefix matching), and returns results **ranked by relevance score** (title matches are boosted above content matches).
- Each result includes the note ID, title, score, and a preview snippet centered around the first matching term.
- The index is entirely local, works offline, and requires no server-side component.

All edits are written locally first, so notes, categories, wiki links, and backlinks remain available without a network connection. With the HTTP transport enabled, BigMind attempts background synchronization:

- after a local change;
- every 30 seconds while the application is open;
- when the browser returns online;
- when the tab becomes visible again.

The sidebar reports `Saved locally`, `Syncing`, `Synced`, `Offline`, `Login required`, `Sync error`, or `Conflict`. Use `Sync now` as a manual retry when required. Closing or reloading the page does not discard pending operations because they remain in the local outbox.

**Synchronized entity types:** `note`, `category`, `link`, `todo_item`. Todo items are synchronized independently (not as part of a parent note payload), allowing per-item conflict detection and granular offline editing.

**Authentication-aware sync:**

The sync engine detects authentication failures separately from transport failures:

| Failure Type   | Examples                                         | Engine Behavior                                                                              |
| -------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Transport      | off-line, timeout, DNS failure, 500              | Exponential backoff retry, status: `error` / `offline`                                       |
| Authentication | expired refresh token, revoked token, logged out | Stop sync immediately, status: `auth_required` ("Login required"), preserve outbox, no retry |

- On authentication failure, pending outbox operations are marked as failed (non-retryable) and preserved locally.
- After the user re-authenticates (logs in again), the sync engine automatically resumes and processes pending outbox operations.
- The `offline` and `auth_required` statuses are independent — a user can be authenticated but offline (syncs when connectivity returns) or need re-authentication while online (syncs after login).

Deleting a note removes its outgoing links and backlinks locally and queues the corresponding soft-delete operations for synchronization.

## Technology stack

- **Workspace:** Nx, pnpm, TypeScript
- **Web:** React, Vite, TanStack Router, Tailwind CSS, Milkdown Crepe
- **Mobile:** Expo / React Native, React Navigation (bottom tabs + native stack), Expo SecureStore (tokens), jest-expo
- **Local persistence:** Dexie and IndexedDB behind the shared `StorageAdapter` abstraction (web), `SqliteStorageAdapter` over expo-sqlite (mobile, default) with the in-memory adapter as the jest default
- **PWA:** Vite PWA and Workbox
- **API:** NestJS and ts-rest
- **Database:** PostgreSQL and Drizzle ORM
- **Validation:** Zod
- **Testing:** Vitest, Jest (incl. jest-expo), and Playwright tooling

## Workspace structure

```text
apps/
  web/          React local-first PWA
  mobile/       Expo / React Native app (Android-first)
  api/          NestJS synchronization API
  web-e2e/      Playwright end-to-end project
libs/
  contracts/    Zod schemas and ts-rest API contracts
  domain/       Shared note types and pure business rules
  sync/         Shared sync engine, transports, and platform abstractions
  storage/      StorageAdapter abstraction + Memory/SQLite adapters, records,
               schema & versioned migrations (see docs/storage-architecture.md)
  auth/         Shared AuthStore state machine (token refresh, offline auth)
  features/     Shared repositories (notes, categories, links, todos,
               reminders, notifications, conflicts) + DI provider
               (see docs/shared-repository-architecture.md)
  markdown/     Shared Markdown parsing, HTML rendering, wiki-link
                 extraction/normalization, note preview, formatting helpers
docker/
  postgres/     PostgreSQL development initialization
```

Nx module-boundary rules keep the domain independent from applications and platform-specific infrastructure. The shared libraries (`contracts`, `domain`, `sync`, `storage`, `auth`, `features`, `markdown`) are consumed by both the web app and the mobile app. On the web, all persistence goes through the `StorageAdapter` contract (implemented by `DexieStorageAdapter`); on mobile, the storage provider wires `SqliteStorageAdapter` (expo-sqlite) by default and the in-memory adapter in tests — switching engines never changes repository code.

## Shared repository architecture

All client business logic for persistence lives in **one set of repository implementations** shared by the web and mobile apps (`@bigmind/features`): `NoteRepository`, `CategoryRepository`, `LinkRepository`, `TodoRepository`, `RemindersRepository`, `NotificationsRepository`, and `ConflictRepository`. Repositories depend only on the `StorageAdapter` contract and the shared sync interfaces — they import no React, React Native, IndexedDB, SQLite, or browser/native APIs.

```text
┌────────────────────────────────────┐   ┌──────────────────────────────┐
│        @bigmind/features          │   │      Platform storage        │
│   (shared repositories)           │   │                              │
│   Note · Category · Link · Todo  │──▶│  Web:    DexieStorageAdapter  │
│   Reminder · Notification ·      │   │  Mobile: SqliteStorageAdapter │
│   Conflict                        │   │  Tests:  MemoryStorageAdapter│
└───────┬──────────────────────────┘   └──────────────────────────────┘
        │ depends on
        ▼
   StorageAdapter (@bigmind/storage)
   SyncOutbox / requestBackgroundSync (@bigmind/sync)
```

- **Dependency injection** — `createRepositoryProvider(storage, outbox, { workspace })` builds every repository from a storage adapter once, at bootstrap. Web and mobile wire their own adapter + `WorkspaceContext` (the “current workspace” source: `localStorage` on web, AsyncStorage on mobile); switching storage never touches repository code.
- **No behavior change** — the repositories moved into the shared library are byte-identical to the previous web implementations; the web modules became thin re-exports.
- **Future-proof** — encrypted storage, attachments, multi-workspace caching, and a desktop app slot in behind `StorageAdapter` / `WorkspaceContext` without repository changes.

See [docs/shared-repository-architecture.md](docs/shared-repository-architecture.md) for the audit, dependency graph, storage independence, and the test matrix.

## Development setup

### Prerequisites

- Node.js 24.18.0 (the version is recorded in `.nvmrc`)
- pnpm 11
- Docker with Docker Compose

If you use `nvm`, select the repository version before installing dependencies:

```bash
nvm use
```

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create the local environment file

```bash
cp .env.example .env
```

**Important:** Set `JWT_SECRET` to a secure random string in `.env`. The application will fail to start if `JWT_SECRET` is not set.

For full-stack development, set the web transport to `http` in `.env` and point the web app at the API:

```dotenv
VITE_SYNC_TRANSPORT=http
VITE_API_URL=http://localhost:3000
```

The remaining default values are ready for the Docker PostgreSQL service:

```dotenv
DATABASE_URL=postgresql://bigmind:bigmind@localhost:5432/bigmind
TEST_DATABASE_URL=postgresql://bigmind:bigmind@localhost:5432/bigmind_test
PORT=3000
CORS_ORIGINS=http://localhost:4200
```

### 3. Start PostgreSQL

```bash
pnpm db:start
```

Docker starts PostgreSQL on port `5432` and creates both the development and test databases. Data is retained in the `bigmind-postgres` Docker volume.

### 4. Apply database migrations

```bash
pnpm db:migrate
```

### 5. Start the web application and API

```bash
pnpm dev
```

The development services are available at:

- Web application: <http://localhost:4200>
- API: <http://localhost:3000>
- API health check: <http://localhost:3000/health>
- Swagger documentation: <http://localhost:3000/docs>

You will be automatically redirected to `/login` on first visit. Create an account at `/register` or log in with an existing account. Every registered user gets a Personal Workspace named `<your email> Personal Workspace` automatically.

Stop the Nx development processes with `Ctrl+C`. Stop PostgreSQL separately with:

```bash
pnpm db:stop
```

## Frontend-only development

The fake sync transport runs entirely in the browser and does not require PostgreSQL or the API. Keep the following value in `.env`:

```dotenv
VITE_SYNC_TRANSPORT=fake
```

Then start only the web project:

```bash
pnpm exec nx serve @bigmind/web
```

## Mobile development

Prerequisites: the Android emulator/device or Expo Go, and the shared libraries built (Metro resolves `@bigmind/*` from `dist/`):

```bash
# Build the shared libraries once (or let mobile:build depend on them)
pnpm exec nx run-many -t build -p @bigmind/domain @bigmind/contracts @bigmind/auth @bigmind/sync @bigmind/storage

# Start the Expo dev server
pnpm exec nx serve @bigmind/mobile

# Run on an Android emulator/device
pnpm exec nx run @bigmind/mobile:run-android

# Validate the Android JS bundle without a device (CI-safe build)
pnpm exec nx run @bigmind/mobile:build
```

By default the app targets `http://10.0.2.2:3000` on Android (the host's localhost from the emulator). Override with `EXPO_PUBLIC_API_URL` in the mobile environment. See [Mobile Architecture](docs/mobile-architecture.md) for details.

### Physical phone on the same Wi-Fi

The API already listens on all interfaces (`app.listen(port)` binds `0.0.0.0`), so it is reachable through the PC's LAN IP (e.g. `192.168.4.27`). To point the app at it:

1. Create `apps/mobile/.env` (gitignored) with the PC's LAN IP:
   ```dotenv
   EXPO_PUBLIC_API_URL=http://192.168.4.27:3000
   ```
2. Restart the Expo dev server (Expo inlines `EXPO_PUBLIC_*` at bundle time) and open the app on the phone via Expo Go.
3. Keep the phone on the **same network** as the PC (no client/AP isolation) and make sure the PC firewall allows inbound TCP on port `3000` (macOS firewall off by default).

Smoke-check the endpoint from the PC before opening the app:

```bash
curl -w '%{http_code}\n' http://192.168.4.27:3000/health   # 200
curl -X POST http://192.168.4.27:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"x@y.z","password":"wrong"}' -w '\n%{http_code}\n'             # 401
```

CORS does not apply to the native app (browser-only); add the LAN origin to `CORS_ORIGINS` only if you also serve the web app from the phone's browser.

## Design System

The BigMind UI follows the **Mindful Utility** design system (blue variant), defined in `apps/web/src/styles.css` via Tailwind v4 `@theme` tokens.

### Principles

- **Modern Corporate Minimalism** — expansive white space, structured hierarchy, minimal distraction.
- **Content is the hero** — the canvas is a light neutral (`#f7f9fb`), content surfaces are white.
- **Blue as a single accent** — used exclusively for primary actions, active states, and navigation highlights.

### Colors

| Token       | Value     | Usage                       |
| ----------- | --------- | --------------------------- |
| `blue-600`  | `#2563eb` | Primary actions, active nav |
| `blue-700`  | `#004ac6` | Primary hover               |
| `slate-50`  | `#f7f9fb` | App canvas / sidebar        |
| `slate-700` | `#191c1e` | Primary text (on-surface)   |
| `slate-400` | `#737686` | Muted text / icons          |

### Typography

**Inter** is the sole typeface, loaded via Google Fonts. Hierarchy uses weight control:

- Displays/headlines: `700`–`800`
- Body: `400` with generous line height
- Labels/metadata: `600` with letter-spacing (uppercase section headers in the sidebar)

### Shape & Spacing

- Corner radius: `4px` standard elements, up to `8px` for cards/modals.
- 8px linear spacing scale.
- Sidebar fixed at `280px`; mobile collapses to a drawer.

### Elevation

Depth is created with tonal layers and 1px low-contrast outlines (`slate-200`) rather than shadows. Hover states use a subtle grey fill. Modals use a soft diffused shadow.

## PWA / Mobile

- **Offline first**: All data stored in IndexedDB. Works without internet.
- **Service worker**: Static assets precached via Workbox. Fast reloads.
- **Update flow**: Toast notification when a new version is available. User chooses to update.
- **Safe areas**: Android notch/status bar support via `env(safe-area-inset-*)` CSS.
- **Rich install prompt**: Manifest includes `screenshots`, `categories`, and multi-density icons.

To generate missing PWA icons from a source image:

```bash
node -e "
const s = [48,72,96,144,168,192,512];
const sharp = require('sharp');
for (const size of s) sharp('apps/web/public/source-icon.png').resize(size,size).toFile('apps/web/public/pwa-'+size+'x'+size+'.png');
"
```

Screenshots for the install dialog go in `apps/web/public/screenshots/` (1080x1920 PNG).

### Mobile app (Expo / React Native)

An Android-first React Native app lives in `apps/mobile` (Expo SDK 55, iOS-compatible). It reuses the same shared libraries as the web PWA: domain models (`@bigmind/domain`), zod-validated contracts (`@bigmind/contracts`), the sync protocol (`@bigmind/sync`), the storage abstraction (`@bigmind/storage`), and the auth state machine (`@bigmind/auth`).

#### Mobile authentication (login / register)

While signed out the app shows a native-stack `AuthNavigator` with **Login** and **Register** screens; once authenticated the `RootGate` swaps to the main bottom tabs (`apps/mobile/src/app/App.tsx`). See [docs/mobile-authentication.md](docs/mobile-authentication.md) for the full mobile auth experience: SecureStore token persistence, the offline `offline_authenticated` startup path, the `auth_required` behavior, and the auth lifecycle.

#### Mobile workspaces

The mobile app includes a **Workspaces** tab with the same workspace experience as the web sidebar switcher + settings: workspace list (name, role, personal/shared type), switching, creation, members, and invitations — all reusing the shared contracts (`@bigmind/contracts`), the shared repositories (`@bigmind/features`), and the mobile workspace provider (`apps/mobile/src/features/workspaces/`). Owner-only actions (invite, roles, remove, delete) are gated in the UI and enforced by the API (`403`/`409`); the workspace list and current workspace stay available offline via a cached list, and sync resumes automatically when connectivity returns. See [docs/mobile-workspaces.md](docs/mobile-workspaces.md) for workspace management, roles, switching, and offline behavior.

- Both screens reuse the **shared ts-rest zod contracts** for validation and response handling (`loginRequestSchema`, `registerRequestSchema`, `authResponseSchema`, `errorResponseSchema` — see `apps/mobile/src/features/auth/auth-api.ts`). Request and response shapes are validated on-device before any token is stored.
- Tokens (access, refresh, user) are persisted in **Expo SecureStore** (Keychain on iOS, encrypted storage on Android) through the shared `AuthStore` — **AsyncStorage is never used for tokens** (it remains only for non-sensitive preferences such as the selected workspace).
- The four-state offline auth model, periodic token refresh, and 401-retry behavior are the exact same logic the web app uses (`@bigmind/auth`).
- Registration signs the user in immediately (the API returns a token pair). Logout (Settings → Log out) clears SecureStore tokens and returns to the login screen.
- Point the app at a running API with `EXPO_PUBLIC_API_URL` (defaults to `http://10.0.2.2:3000` on the Android emulator).

#### Notes & Categories (mobile)

The Notes and Categories tabs are native stacks (`apps/mobile/src/navigation/NotesNavigator.tsx`, `CategoriesNavigator.tsx`): a list screen pushing a detail screen with native transitions. See [docs/mobile-notes.md](docs/mobile-notes.md) for the mobile notes architecture: navigation structure (with `bigmind://` deep links), offline title+content search, Updated/A–Z sorting, pagination-ready `FlatList`, sync status pill, and the archive/trash preparation.

- **Notes** — `NotesListScreen` (recent-first list with plain-text previews and category chips) → `NoteDetailScreen`, the **read-mode-first central screen**: rendered Markdown via the shared `@bigmind/markdown` tokenizer (headings, bold/italic, code, lists, checklists, blockquotes, links, wiki links), tappable **wiki links** (target-note navigation, missing notes clearly indicated), **backlinks** with previews, **related reminders** (navigate + create pre-linked), category path + created/updated dates, shared `SyncStatusPill`, and a **conflict-awareness banner** (resolution stays on the future conflict screen). An **Edit note** action keeps the shipped native editor (see below). See [docs/mobile-note-detail.md](docs/mobile-note-detail.md) for the full mobile note-detail architecture, wiki-link/backlink behavior, reminder integration, and offline guarantees.
- **Markdown editing (Option B, shipped)** — the detail screen embeds `MarkdownEditView` (`apps/mobile/src/components/`): raw multiline `TextInput`, formatting toolbar (bold/italic/code/heading/link as pure string transforms), `[[` wiki-link suggestions from the shared ranking helper, and an edit ⇄ **preview** toggle rendered by the shared `@bigmind/markdown` tokenizer (`MarkdownText`). `TODO_LIST` notes switch to a native `TodoListView` over the shared `TodoRepository`. See the [Mobile Editor Evaluation](docs/mobile-editor.md) — Fases 1–2 shipped.
- **Categories** — `CategoriesListScreen` (tree view built with `buildCategoryTree` from the shared domain; lazy-expandable rows, note counts, hierarchy-aware offline search) → `CategoryDetailScreen` (rename, move, edit Markdown description with shared preview, add subcategories, parent breadcrumb, children navigation, delete with the shared guards, and the list of notes in the category — tapping one jumps to the note detail). See [docs/mobile-categories.md](docs/mobile-categories.md) for the mobile category architecture, hierarchy navigation, and offline management.
- **Reminders** — the Reminders tab is a native stack (`RemindersNavigator`): `RemindersListScreen` renders the **Agenda** (Today / Tomorrow / Upcoming / Completed via the pure `buildAgendaReminders` helpers, offline title + description search, loading/empty/offline states, row completion toggling, linked-note chips, confirmed deletion) → `ReminderDetailScreen` (title, description, due date, status, linked note navigation, edit/delete) → `ReminderFormScreen` (create/edit: title, description, due date via the native date+time picker, optional linked note picker, and completion status in edit mode). All mutations go through the **shared `RemindersRepository`** — offline-first with outbox coalescing and workspace scoping, identical to the web Agenda page. See [docs/mobile-reminders.md](docs/mobile-reminders.md) for the full mobile reminder architecture, agenda rules, sync behavior, and the future notification integration plan.
- All editing goes through the **shared repositories** (`@bigmind/features`): `NoteRepository`, `CategoryRepository`, `LinkRepository`, `TodoRepository`, plus `RemindersRepository`, `NotificationsRepository`, and `ConflictRepository` for the sync-managed entities — the exact same classes the web app uses, backed by the mobile `StorageAdapter` (SQLite via the storage provider; memory in tests). Outbox coalescing, title/category normalization, cycle and delete guards, workspace scoping, and wiki-link maintenance are therefore shared — nothing is reimplemented on mobile.
- Shared contracts are reused on-device too: the note editor validates the assembled record with `noteDataSchema` before saving; todo items sync through `todoItemDataSchema`.

## Reminders & Agenda

Reminders are a first-class domain feature for tracking tasks with due dates. They work completely offline and synchronize through the existing sync engine.

### Reminder model

| Field          | Description                    |
| -------------- | ------------------------------ |
| `id`           | UUID                           |
| `workspaceId`  | Workspace scope                |
| `title`        | Required, max 200 characters   |
| `description`  | Optional Markdown text         |
| `dueAt`        | ISO datetime                   |
| `completed`    | Boolean toggle                 |
| `createdBy`    | User ID                        |
| `linkedNoteId` | Optional linked note           |
| `version`      | Optimistic concurrency version |

### Agenda view (`/agenda`)

The Agenda page groups reminders into four sections:

- **Today** — due today (and overdue items sorted into upcoming)
- **Tomorrow** — due tomorrow
- **Upcoming** — due later
- **Completed** — finished reminders

Each section is sorted by `dueAt` ascending. From the agenda you can:

- **Complete** a reminder (toggle)
- **Edit** title and due date inline
- **Delete** a reminder
- **Open** the linked note if present

Navigation: the **Agenda** link appears in the sidebar footer.

### Offline & sync

Reminders follow the same offline-first pattern as notes:

- Created, edited, completed, and deleted locally first (IndexedDB).
- Changes are queued in the outbox and synchronized when connectivity returns.
- Conflicts use the existing optimistic concurrency (version) model.
- All operations are workspace-scoped with the existing role permissions.

### API

| Method   | Path             | Description                       |
| -------- | ---------------- | --------------------------------- |
| `GET`    | `/reminders`     | List reminders (workspace-scoped) |
| `POST`   | `/reminders`     | Create a reminder                 |
| `PATCH`  | `/reminders/:id` | Update a reminder                 |
| `DELETE` | `/reminders/:id` | Delete a reminder                 |

## Notifications

BigMind has a notification infrastructure ready for future push delivery. Notifications work fully offline and sync through the existing engine.

### Notification model

| Field         | Description                                             |
| ------------- | ------------------------------------------------------- |
| `id`          | UUID                                                    |
| `workspaceId` | Workspace scope                                         |
| `type`        | `reminder_due`, `note_modified`, `workspace_invitation` |
| `title`       | Required, max 200 characters                            |
| `body`        | Optional text                                           |
| `read`        | Read/unread flag                                        |
| `createdAt`   | ISO timestamp                                           |

### Notification Center

A bell icon in the sidebar footer shows a badge with the unread count. Opening it lists notifications with:

- Type-specific icons (⏰ reminder, 📝 note, 📨 invitation)
- **Mark all read** action
- Individual mark-as-read and delete actions

### Offline & sync

- Notifications are created and stored locally first (IndexedDB).
- Read-state changes and deletions queue in the outbox and sync when online.
- No Web Push is implemented yet — the domain model is future-proof for adding it without schema changes.

### API

| Method   | Path                      | Description                           |
| -------- | ------------------------- | ------------------------------------- |
| `GET`    | `/notifications`          | List notifications (workspace-scoped) |
| `POST`   | `/notifications`          | Create a notification                 |
| `POST`   | `/notifications/read-all` | Mark all as read                      |
| `POST`   | `/notifications/:id/read` | Mark one as read                      |
| `DELETE` | `/notifications/:id`      | Delete a notification                 |

## Performance

BigMind uses lazy loading and route-level code splitting to minimize initial load time:

| Component                                                       | Strategy                            | Initial Load Impact                              |
| --------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| **MarkdownEditor** (Milkdown Crepe)                             | `React.lazy` + `Suspense`           | ~1.1 MB deferred until a Markdown note is opened |
| **TodoEditor**                                                  | `React.lazy` + `Suspense`           | Deferred until a Todo List note is opened        |
| **Routes** (`/notes`, `/settings`, `/conflicts`, `/categories`) | TanStack Router `autoCodeSplitting` | Each route is a separate chunk                   |

**Bundle breakdown** (production build):

| Asset                  | Size (gzipped) | Content                                         |
| ---------------------- | -------------- | ----------------------------------------------- |
| `index-*.js`           | 132 KB         | App shell: auth, sidebar, routing, home page    |
| `markdown-editor-*.js` | 357 KB         | Milkdown Crepe editor (lazy loaded)             |
| Other chunks           | ~150 KB        | Shared code, database, sync engine, todo editor |

- **Initial JS**: ~132 KB gzipped (vs ~639 KB before optimizations — 79% reduction)
- **Subsequent loads**: All assets served from Workbox cache (instant)
- **Future opportunities**: Replace Milkdown with a lighter editor (~200 KB), further route splitting for settings/conflicts.

## Documentation

For detailed guides and reference documentation, see:

- [Permissions & Role Matrix](docs/permissions.md): Access control rules, role definitions (OWNER, EDITOR, VIEWER), and last-owner protection rules.
- [Workspace Management Guide](docs/workspace-management.md): Guide for workspace settings, member management, role assignments, and removals.
- [Architecture Overview](docs/architecture.md): Technical architecture of BigMind.
- [Mobile Architecture](docs/mobile-architecture.md): React Native app structure, shared-layer breakdown, storage abstraction, and platform deltas.
- [Mobile Notes](docs/mobile-notes.md): The mobile notes experience — list, read-mode note detail, search, offline behavior, and the archive preparation.
- [Mobile Note Detail](docs/mobile-note-detail.md): The central note-detail screen — read-mode Markdown rendering, wiki links, backlinks, related reminders, sync status, conflict awareness, offline behavior, and performance.
- [Mobile Reminders](docs/mobile-reminders.md): Reminder/Agenda architecture on mobile — screens, agenda grouping, reminder synchronization, workspace integration, performance, and the future notification integration plan.
- [Mobile Editor Evaluation](docs/mobile-editor.md): Technical evaluation of mobile note-editing options and the recommended architecture (Markdown editor + shared renderer).
- [Database Schema](docs/database-schema.md): Database schema and Drizzle ORM layout.
- [Template System](docs/template-system.md): Note template types, how they work, and how to add new templates.
- [Deploy on Debian](docs/deploy-debian.md): Production deployment on a modest home server (PostgreSQL native + systemd + Caddy), with tuning for low-power hardware.

### Template System

Notes support two template types:

- **MARKDOWN** — Full Markdown editing with Milkdown Crepe (default for all notes).
- **TODO_LIST** — Task list with ordered items, completion toggling, drag-and-drop reordering, a "Show Completed" toggle (persisted in localStorage), and keyboard shortcuts (Enter to create below, Backspace on empty to delete). Counters (Remaining/Completed) always reflect the full list.
- Todo items are synchronized as independent entities through the outbox-based sync engine, with offline creation, editing, deletion, and conflict detection at the individual item level.

When creating a note, a template selector popup appears next to the + button. The `templateType` field is:

- Stored in the `template_type` PostgreSQL column and the IndexedDB `NoteRecord`.
- Included in all sync payloads as `templateType` with a default of `MARKDOWN` for backward compatibility.
- Validated through the `TEMPLATE_TYPES` constant array in `@bigmind/domain/notes`.
- Automatically set to `MARKDOWN` for all existing notes via the Dexie v7 migration and the PostgreSQL default column value.

### Todo List API

Notes with `templateType: TODO_LIST` expose the following endpoints for managing todo items:

| Method   | Path                                   | Description                               | Auth       |
| -------- | -------------------------------------- | ----------------------------------------- | ---------- |
| `GET`    | `/notes/:noteId/todos`                 | List all todo items (ordered by position) | Any member |
| `POST`   | `/notes/:noteId/todos`                 | Create a new todo item                    | EDITOR+    |
| `PATCH`  | `/notes/:noteId/todos/:itemId`         | Update item text                          | EDITOR+    |
| `PUT`    | `/notes/:noteId/todos/:itemId/toggle`  | Toggle completion                         | EDITOR+    |
| `DELETE` | `/notes/:noteId/todos/:itemId`         | Delete an item                            | EDITOR+    |
| `PUT`    | `/notes/:noteId/todos/:itemId/reorder` | Reorder item (`body: { position }`)       | EDITOR+    |

**Domain model:**

- `TodoList` — belongs to a Note (one per TODO_LIST note), created automatically on first item.
- `TodoItem` — belongs to a TodoList, has `text`, `completed` (boolean), `position` (integer).
- Items are always returned ordered by position.
- Only notes with `templateType: TODO_LIST` accept todo operations (400 otherwise).
- VIEWERs can list items but cannot create, update, toggle, delete, or reorder.

**Keyboard shortcuts:**

- `Enter` while editing an item: saves and moves focus to the next item (or the "Add" input if at the end).
- `Backspace` on an empty editing input: deletes the item and focuses the previous item.
- `Escape`: cancels editing.
- `Space` or `Enter` on item text: starts editing.

**Drag and drop:** Grab the `⋮⋮` handle or any part of the item to reorder. Changes are persisted locally and synchronized through the outbox.

## Useful commands

```bash
# Run unit tests across the workspace
pnpm test

# Run API integration tests (PostgreSQL must be running)
pnpm test:integration

# Run lint checks
pnpm lint

# Run TypeScript checks
pnpm exec nx run-many -t typecheck

# Build all current applications and libraries
pnpm exec nx run-many -t build

# Export the Android JS bundle (Metro) for the mobile app
pnpm exec nx run @bigmind/mobile:build

# Build only projects affected by the current changes
pnpm build:affected

# Inspect the Nx project graph
pnpm exec nx graph
```

## Current scope

BigMind currently focuses on notes, hierarchical categories, wiki links/backlinks, full-text search, local-first synchronization, a user-facing conflict resolution workflow, JWT authentication with workspace-based data isolation, workspace member management (roles, members list, demotion/removal guards), and automatic token refresh. Sharing, end-to-end encryption, drag-and-drop category ordering, descendant-inclusive filters, graph visualization, alias synchronization between devices, fully automatic merge, three-way merge, and multi-workspace switching are not implemented yet.

The **mobile app** currently provides the application shell (React Navigation tabs: Home, Notes, Categories, Reminders, Settings), a full **login/register auth flow** (shared zod-validated contracts, tokens in Expo SecureStore), the **notes and categories experience** (lists and detail screens driven by the shared `@bigmind/features` repositories), the **reminders experience** (agenda grouped Today/Tomorrow/Upcoming/Completed, local search, detail, create/edit form with due date + linked note, completion toggling, confirmed deletion — all offline-first over the shared `RemindersRepository`, see [docs/mobile-reminders.md](docs/mobile-reminders.md)), shared-library wiring (domain rules, zod contracts, auth state machine, SQLite/`SqliteStorageAdapter` storage), the **native Markdown editor** (Option B: `MarkdownEditView` + shared `@bigmind/markdown` preview — see [docs/mobile-editor.md](docs/mobile-editor.md)), the **workspace experience** (see [docs/mobile-workspaces.md](docs/mobile-workspaces.md)), and the **shared sync engine active on sign-in** (`SyncActivator`: initial pull + AppState/NetInfo background sync, see `apps/mobile/src/sync/`), plus a CI-safe Android bundle build. Local notifications on Android are the next milestone.
