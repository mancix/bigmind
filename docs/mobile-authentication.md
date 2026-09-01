# Mobile Authentication

## Overview

BigMind's mobile app (`apps/mobile`, Expo / React Native) integrates with the
existing authentication architecture instead of re-implementing it: the client
code is shared with the web PWA through `@bigmind/auth` (state machine) and
`@bigmind/contracts` (ts-rest Zod contracts), and only the token **persistence**
layer is platform-specific (**Expo SecureStore**).

This document covers the mobile authentication experience:

- Mobile Authentication — screens, provider, and data flow
- Secure Storage — where and how tokens are persisted
- Offline Authentication — the `offline_authenticated` startup path
- Auth Lifecycle — the shared four-state model applied to mobile

## Mobile Authentication

### Component map

| Piece                                  | File                                                        | Reuse                                            |
| -------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Auth state machine                     | `@bigmind/auth` (`AuthStore`)                               | shared with web PWA                              |
| API contracts + validation             | `@bigmind/contracts` (`auth.contract.ts`, `auth.schemas.ts`) | shared with web PWA                              |
| API client                             | `apps/mobile/src/features/auth/auth-api.ts`                 | calls `/auth/login`, `/auth/register` via contracts |
| Token storage                          | `apps/mobile/src/features/auth/token-storage.ts`            | `SecureStoreTokenStorage` (Expo SecureStore)     |
| Auth store singleton                   | `apps/mobile/src/features/auth/auth-store.ts`               | `createAuthStore()` over the shared `AuthStore`  |
| Auth provider (login/logout/register)  | `apps/mobile/src/features/auth/auth-provider.tsx`           | React context over the shared store              |
| Login screen                           | `apps/mobile/src/screens/LoginScreen.tsx`                   | —                                                |
| Register screen                        | `apps/mobile/src/screens/RegisterScreen.tsx`                | —                                                |
| Signed-out navigation                  | `apps/mobile/src/navigation/AuthNavigator.tsx`              | Login ⇄ Register native stack                    |
| Signed-in navigation / route gate      | `apps/mobile/src/app/App.tsx` (`RootGate`)                  | switches on `isAuthenticated`                    |

### Login

`LoginScreen` collects **email** and **password**, validates client-side with the
**shared** `loginRequestSchema` (from `@bigmind/contracts`), and shows loading
(disabled submit + spinner) and inline error states. On success the provider
stores the returned token pair via the shared `AuthStore` and kicks off
`ensureWorkspaceId()` so the sync layer can attach `X-Workspace-Id`. Once tokens
are stored, `RootGate` swaps the auth stack for the main tabs — no manual
navigation call is required.

### Registration

`RegisterScreen` collects **email**, **password**, and **confirm password**
(mismatch is caught before the network), validates with the shared
`registerRequestSchema`, and calls `/auth/register`. The backend creates the
personal workspace inside the registration transaction and returns a token pair
immediately — registration **signs the user in directly** (the same behavior as
the web app), then `ensureWorkspaceId()` selects the personal workspace.

### Logout

The Settings tab exposes **Log out** (`SettingsScreen` → `useAuth().logout`).
Logout works from any auth state (including `offline_authenticated` /
`auth_required`), clears the SecureStore session, and returns to the login
screen. It never deletes the local database — local data is wiped only by the
explicit "Clear local data" action, mirroring the web app's rule that
authentication failures never trigger data clearing.

## Secure Storage

Tokens are persisted exclusively through **Expo SecureStore** (Keychain on iOS,
encrypted SharedPreferences/Keystore on Android) via
`SecureStoreTokenStorage`, which implements the shared `TokenStorage` contract
(`getItem` / `setItem` / `removeItem`):

| Data                        | Storage                                    |
| --------------------------- | ------------------------------------------ |
| `bigmind_access_token`      | Expo SecureStore (encrypted)               |
| `bigmind_refresh_token`     | Expo SecureStore (encrypted)               |
| `bigmind_user`              | Expo SecureStore (encrypted)               |
| Selected workspace id       | AsyncStorage (non-sensitive preference)    |
| **Auth tokens**             | **NEVER AsyncStorage**                     |

Properties:

- **Restart survival** — `SecureStore.getItem` is synchronous, so the `AuthStore`
  hydrates its state during construction; a cold start with a stored session
  boots directly into `authenticated` (covered by the `createAuthStore()` spec).
- **Deterministic reads during deletion** — SecureStore's async
  `deleteItemAsync` is fenced behind a tombstone set so a concurrent read never
  returns a half-deleted token.
- **Test double** — jest replaces `expo-secure-store` with an in-memory table
  (`globalThis.__secureStoreTable` in `apps/mobile/src/test-setup.ts`), so specs
  can seed/assert persisted sessions without a native module.

## Offline Authentication

BigMind is offline-first: a valid local session must keep the app usable when the
server is unreachable. The mobile startup path:

```
App opens with stored tokens (SecureStore)
  → AuthStore hydrates → 'authenticated'
  → AuthProvider startup effect calls refreshAccessToken()
      ├─ fetch succeeds      → new token pair persisted, stays 'authenticated'
      ├─ fetch throws        → 'offline_authenticated'  (still authenticated)
      └─ server rejects (401)→ 'auth_required'          (login required)
```

- **`offline_authenticated`**: the network failed during refresh. All tokens and
  the local database stay intact, `isAuthenticated()` remains **true**, the
  `RootGate` keeps the main tabs mounted, and local data (notes, categories,
  outbox) are fully available. Sync is paused by the connectivity layer and
  resumes automatically when the network returns.
- Behavior matches the web app: the same `AuthStore` transition is used by both
  platforms; only the token storage backend differs.

## Auth Lifecycle

The shared `AuthStore` (`@bigmind/auth`) defines the four-state model:

```
                    setTokens()                 refresh: network error
  unauthenticated ──────────────► authenticated ────────────────────► offline_authenticated
        ▲                            │  ▲                                  │
        │ clear()                    │  │ refresh: OK (new pair)           │ refresh: network error
        │                            │  └──────────────────────────────────┘
        │                            │
        │                            └─► refresh: 401 (invalid/expired) ──► auth_required
        └─────── login again ◄────────┘
```

| State                   | Mobile behavior                                                              |
| ----------------------- | ---------------------------------------------------------------------------- |
| `authenticated`         | Main tabs; sync active; periodic refresh keeps the access token fresh.        |
| `offline_authenticated` | Main tabs; sync paused (offline); local data available; `isAuthenticated()` = true. |
| `auth_required`         | Login screen (`RootGate` → `AuthNavigator`); sync paused; **local data preserved**. |
| `unauthenticated`       | Login screen; no sync.                                                        |

Key lifecycle guarantees (identical to web):

- **Startup restore** — a valid stored session restores `authenticated` before the
  first frame; no loading flash, no re-login.
- **Refresh on 401** — the sync transport retries once with a fresh token; only a
  real `auth_error` escalates to `auth_required`.
- **Periodic refresh** — the provider starts `AuthStore.startPeriodicRefresh()`
  after boot; failures degrade to `offline_authenticated` (network) or
  `auth_required` (server rejection) without wiping anything.
- **Never destroy local data** — neither `offline_authenticated` nor
  `auth_required` clears the local database or the sync outbox.

## Navigation integration

```
RootGate (App.tsx)
  ├─ isAuthenticated() = true  → RootNavigator (protected: Home · Notes · Categories · Reminders · Settings)
  └─ isAuthenticated() = false → AuthNavigator (public: Login ⇄ Register)
```

`isAuthenticated()` is true for `authenticated` **and** `offline_authenticated`,
so offline users keep the protected experience; `auth_required` and
`unauthenticated` redirect to the login screen, where the user can sign in again
without losing locally stored data.

## Testing

Mobile-level specs (`apps/mobile/src/features/auth/`):

| Spec                        | Covers                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| `auth-flow.spec.tsx`        | login, login validation + API errors, register + confirm-password validation, navigation, logout, startup restore, `offline_authenticated` startup, `auth_required` startup, refresh success |
| `token-storage.spec.ts`     | SecureStore round-trip, missing keys, deterministic delete               |

Shared specs (`libs/auth/src/auth-store.spec.ts`) cover the state machine itself:
hydration, token persistence, refresh success/network-error/auth-error
transitions, listener notifications.