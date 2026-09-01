# Mobile Workspace Management

## Overview

The mobile app provides the **same workspace experience as the web PWA**
(sidebar switcher + workspace settings), reusing the existing backend APIs,
the shared contracts (`@bigmind/contracts`), the shared repositories and
`WorkspaceContext` (`@bigmind/features`), and the shared sync engine
(`@bigmind/sync`). No workspace business logic is duplicated — the mobile app
wires the same endpoints with the same validation schemas as the web app.

Related documents: [Workspace Management Guide](workspace-management.md) (web
user guide), [Workspace Permissions & Role Matrix](permissions.md) (RBAC model).

## Workspace Management (mobile)

| Piece                          | File                                                          | Reuse                                        |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------------- |
| Workspace provider             | `apps/mobile/src/features/workspaces/workspace-context.tsx`   | mirrors web `workspace-context.tsx`          |
| API client                     | `apps/mobile/src/features/workspaces/workspace-client.ts`     | shared zod contracts + 401-refresh (AuthStore) |
| Workspace store (id + cache)   | `apps/mobile/src/features/workspaces/workspace-store.ts`      | AsyncStorage (non-sensitive), sync cache     |
| Roles / type helpers           | `apps/mobile/src/features/workspaces/workspace-roles.ts`      | pure functions, mirrors `permissions.md`     |
| Workspaces tab                 | `apps/mobile/src/navigation/WorkspacesNavigator.tsx`          | native stack                                 |
| List / create / members / invite screens | `apps/mobile/src/screens/workspaces/*.tsx`            | —                                            |

The mobile `WorkspaceProvider` mirrors the web one:

- **Loading & refresh** — fetches `/workspaces` (validated with
  `listWorkspacesResponseSchema`), caches the list, and selects the active
  workspace (stored id, falling back to the first workspace).
- **Switch** — resets local data (`storage.clearAll()`), persists the new id,
  and requests a background sync so the new workspace's data is pulled from
  the server (identical to the web switcher).
- **Create** — `POST /workspaces` with `createWorkspaceRequestSchema`
  validation (name 3–100 chars, optional description) and automatically
  switches to the new workspace.
- **Delete** — `DELETE /workspaces/:id`, OWNER only (the API rejects personal
  workspaces and workspaces with other members with `409`).

## Workspace Roles

The Role-Based Access Control model is defined once in
[docs/permissions.md](permissions.md) and enforced by the API
(`WorkspaceGuard` + `workspaces.service.ts`). Mobile mirrors it with the pure
helpers in `workspace-roles.ts` and hides owner-only actions in the UI:

| Capability                          | OWNER | EDITOR | VIEWER | Mobile UI                                        |
| ----------------------------------- | :---: | :----: | :----: | ------------------------------------------------ |
| View workspace list & switch        | ✅    | ✅     | ✅     | Workspaces tab                                   |
| Create / edit content               | ✅    | ✅     | ❌     | enforced by shared repositories + API            |
| View members                        | ✅    | ✅     | ✅     | Members screen (read-only)                       |
| **Invite users**                    | ✅    | ❌     | ❌     | Invitations screen (owner only)                  |
| **Change member roles**             | ✅    | ❌     | ❌     | Members screen role buttons (owner only)         |
| **Remove members**                  | ✅    | ❌     | ❌     | Members screen Remove (owner only)               |
| **Delete workspace**                | ✅    | ❌     | ❌     | (API-enforced 403 / 409)                         |

The same rules are enforced **server-side** (`403 Forbidden` for editors and
viewers, `409 Conflict` for last-owner / personal-workspace / non-empty
workspace protections), so the UI gating is an experience improvement, not a
security boundary.

## Workspace Switching

Switching workspaces (`WorkspacesListScreen` → tap a workspace) runs the same
sequence as the web sidebar switcher:

1. **Clear local data** — `storage.clearAll()` wipes notes, categories, links,
   outbox, and sync state so data from different workspaces never mixes
   (matching the web behavior).
2. **Persist the selection** — `setStoredWorkspaceId()` updates the
   synchronous cache (`getCachedWorkspaceId()` feeds the HTTP sync transport's
   `X-Workspace-Id` header immediately) and AsyncStorage.
3. **Request synchronization** — `requestBackgroundSync()` wakes the shared
   `SyncScheduler`; the engine pulls the new workspace's data and the shared
   repositories re-scope to the new workspace id via `WorkspaceContext`
   (`getWorkspaceId()`).

Note, category, reminder, and sync repositories already scope by workspace
(`@bigmind/features`), and the sync cursor is reset with the local data so the
next pull starts fresh — behavior is identical to the web app.

## Offline Workspace Behavior

BigMind is offline-first, and workspace management respects that:

- **Workspace list stays available offline** — every successful fetch is
  cached (`cacheWorkspaces` in AsyncStorage, non-sensitive metadata). When a
  refresh fails (server unreachable) the provider falls back to the cached
  list, so the user can still see and switch between their workspaces.
- **Current workspace stays usable offline** — the selected id is always
  readable from the synchronous cache, so the sync transport keeps sending
  `X-Workspace-Id`, local data remains loadable, and the `offline_authenticated`
  auth state keeps the app running.
- **Sync resumes automatically** — the shared supervisor (AppState + NetInfo)
  requests a sync when connectivity returns; workspace metadata refreshes the
  same way. A "Refresh list" action on the Workspaces screen retries manually.

## Testing

Mobile specs in `apps/mobile/src/features/workspaces/`:

| Spec                         | Covers                                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| `workspace-context.spec.tsx` | loading, stored-workspace selection, switching (clear + sync request), creation (auto-switch), offline fallback to cached list |
| `workspace-client.spec.ts`   | schema-validated list/create/invite calls, invitation email+role rules, 401 → token refresh → retry |
| `workspace-roles.spec.ts`    | personal/shared detection, owner-only management, editor content rules, read-only viewers |