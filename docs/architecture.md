# BigMind Architecture

## Overview

BigMind is a local-first personal knowledge base built as an Nx monorepo with a React PWA frontend, a NestJS API backend, and a PostgreSQL database. The primary ownership model is **workspace-based**: all user data (notes, categories, links, sync operations) belongs to a workspace, not directly to a user.

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

| Column        | Type        | Notes                     |
|---------------|-------------|---------------------------|
| `id`          | `uuid` PK   |                           |
| `name`        | `text`      | Not null                  |
| `description` | `text`      | Nullable                  |
| `created_at`  | `timestamptz` | Not null                |
| `updated_at`  | `timestamptz` | Not null                |

**`workspace_members`**

| Column         | Type            | Notes                           |
|----------------|-----------------|---------------------------------|
| `workspace_id` | `uuid` FK → `workspaces.id` | Part of composite PK, cascade delete |
| `user_id`      | `uuid` FK → `users.id`       | Part of composite PK, cascade delete |
| `role`         | `workspace_role` enum         | `OWNER`, `EDITOR`, `VIEWER`     |
| `created_at`   | `timestamptz`   | Not null, defaults to `now()`   |

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

| Method                  | Returns                     | Description                          |
|-------------------------|-----------------------------|--------------------------------------|
| `createWorkspace`       | `WorkspaceRow`              | Inserts a new workspace              |
| `addMember`             | `WorkspaceMemberRow`        | Inserts a membership (role + user)  |
| `removeMember`          | `void`                      | Deletes a membership (404 if absent)|
| `listUserWorkspaces`    | `WorkspaceWithRole[]`      | All workspaces for a user + role    |
| `findWorkspaceById`     | `WorkspaceRow \| undefined` | Single workspace lookup             |
| `getUserRole`           | `WorkspaceRole \| undefined`| User's role in a workspace          |

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