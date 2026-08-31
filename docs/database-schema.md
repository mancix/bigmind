# BigMind Database Schema

## Overview

BigMind uses PostgreSQL with the Drizzle ORM and raw SQL migrations. The database is managed via `drizzle-kit` (`migrate` for applying, `push` for dev). Migrations live in `apps/api/drizzle/`.

## Entity relationship diagram

```
┌──────────┐         ┌─────────────────────┐         ┌──────────┐
│  users   │         │  workspace_members    │         │ workspaces│
│──────────│         │──────────────────────│         │──────────│
│ id (PK)  │◄───────│ user_id (FK, PK part) │────────►│ id (PK)  │
│ email    │         │ workspace_id (FK, PK)│         │ name     │
│ password │         │ role (enum)          │         │ description│
│ created  │         │ created_at           │         │ created  │
│ updated  │         └──────────────────────┘         │ updated  │
└──────────┘                                          └────┬─────┘
                                                          │
                    ┌─────────────────────────────────────┤
                    │                                     │
              ┌─────┴────┐  ┌────────────┐  ┌────────────┴┐
              │  notes   │  │ categories │  │ note_links  │
              │──────────│  │────────────│  │─────────────│
              │ id (PK)  │  │ id (PK)    │  │ id (PK)     │
              │ ws_id FK │  │ ws_id FK   │  │ ws_id FK    │
              │ title    │  │ name       │  │ source_note │
              │ content  │  │ icon       │  │ target_note │
              │ cat_id   │─►│ parent_id  │  │ version     │
              │ version  │  │ position   │  │ created     │
              │ created  │  │ version    │  │ deleted     │
              │ updated  │  │ created    │  └─────────────┘
              │ deleted  │  │ updated    │
              └──────────┘  │ deleted    │
                            └────────────┘

┌──────────────────┐    ┌─────────────────┐
│  sync_operations   │    │  change_log      │
│──────────────────│    │─────────────────│
│ operation_id (PK)│    │ sequence (bigserial PK)│
│ workspace_id FK  │    │ workspace_id FK │
│ entity_id        │    │ entity_id       │
│ result_status    │    │ entity_type     │
│ result_payload   │    │ operation_type  │
│ processed_at     │    │ version         │
└──────────────────┘    │ payload (jsonb) │
                        │ changed_at      │
                        └─────────────────┘

┌─────────────────┐
│ refresh_tokens   │
│─────────────────│
│ id (PK)         │
│ user_id (FK)    │
│ token_hash      │
│ expires_at      │
│ revoked_at      │
│ created_at      │
└─────────────────┘
```

## Tables

### users

| Column          | Type        | Constraints              |
|-----------------|-------------|--------------------------|
| `id`            | `uuid`      | Primary key              |
| `email`         | `text`      | Not null, unique index   |
| `password_hash` | `text`      | Not null                 |
| `created_at`    | `timestamptz` | Not null               |
| `updated_at`    | `timestamptz` | Not null               |

### workspaces

| Column        | Type        | Constraints              |
|---------------|-------------|--------------------------|
| `id`          | `uuid`      | Primary key              |
| `name`        | `text`      | Not null                 |
| `description` | `text`      | Nullable                 |
| `created_at`  | `timestamptz` | Not null               |
| `updated_at`  | `timestamptz` | Not null               |

### workspace_members

| Column         | Type            | Constraints                                     |
|----------------|-----------------|-------------------------------------------------|
| `workspace_id` | `uuid`          | FK → `workspaces.id` (cascade), composite PK    |
| `user_id`      | `uuid`          | FK → `users.id` (cascade), composite PK         |
| `role`         | `workspace_role` | Not null (`OWNER`, `EDITOR`, `VIEWER`)       |
| `created_at`   | `timestamptz`   | Not null, default `now()`                       |

**Composite primary key:** `(workspace_id, user_id)`
**Index:** `workspace_members_user_id_idx` on `user_id`

### notes

| Column          | Type        | Constraints                              |
|-----------------|-------------|------------------------------------------|
| `id`            | `uuid`      | Primary key                              |
| `workspace_id`  | `uuid`      | FK → `workspaces.id` (cascade), not null |
| `title`         | `text`      | Not null                                 |
| `content`       | `text`      | Not null                                 |
| `category_id`   | `uuid`      | FK → `categories.id` (set null)          |
| `search_vector` | `tsvector`  | GIN index for full-text search           |
| `version`       | `integer`   | Not null                                 |
| `created_at`    | `timestamptz` | Not null                               |
| `updated_at`    | `timestamptz` | Not null                               |
| `deleted_at`    | `timestamptz` | Nullable                              |

**Indexes:**
- `notes_workspace_updated_idx` — `(workspace_id, updated_at)`
- `notes_search_idx` — GIN on `search_vector`

### categories

| Column         | Type        | Constraints                              |
|----------------|-------------|------------------------------------------|
| `id`           | `uuid`      | Primary key                              |
| `workspace_id` | `uuid`      | FK → `workspaces.id` (cascade), not null |
| `name`         | `text`      | Not null                                 |
| `icon`         | `text`      | Nullable                                 |
| `parent_id`    | `uuid`      | Self FK (restrict delete)               |
| `position`     | `integer`   | Not null                                 |
| `version`      | `integer`   | Not null                                 |
| `created_at`   | `timestamptz` | Not null                               |
| `updated_at`   | `timestamptz` | Not null                               |
| `deleted_at`   | `timestamptz` | Nullable                              |

**Index:** `categories_workspace_parent_position_idx` — `(workspace_id, parent_id, position)`

### note_links

| Column          | Type        | Constraints                              |
|-----------------|-------------|------------------------------------------|
| `id`            | `uuid`      | Primary key                              |
| `workspace_id`  | `uuid`      | FK → `workspaces.id` (cascade), not null |
| `source_note_id`| `uuid`      | FK → `notes.id` (restrict), not null    |
| `target_note_id`| `uuid`      | FK → `notes.id` (restrict), not null    |
| `version`       | `integer`   | Not null                                 |
| `created_at`    | `timestamptz` | Not null                               |
| `deleted_at`    | `timestamptz` | Nullable                              |

**Unique:** `(source_note_id, target_note_id)`
**Indexes:** `note_links_workspace_source_idx`, `note_links_workspace_target_idx`

### sync_operations

| Column           | Type        | Constraints                              |
|------------------|-------------|------------------------------------------|
| `operation_id`   | `uuid`      | Primary key                              |
| `workspace_id`   | `uuid`      | FK → `workspaces.id` (cascade), not null |
| `entity_id`      | `uuid`      | Not null                                 |
| `result_status`  | `enum`      | `accepted`, `rejected`, `conflict`       |
| `result_payload` | `jsonb`     | Not null                                 |
| `processed_at`   | `timestamptz` | Not null, default `now()`              |

**Index:** `sync_operations_workspace_idx` — `(workspace_id)`

### change_log

| Column           | Type        | Constraints                              |
|------------------|-------------|------------------------------------------|
| `sequence`       | `bigserial` | Primary key                              |
| `workspace_id`   | `uuid`      | FK → `workspaces.id` (cascade), not null |
| `entity_id`      | `uuid`      | Not null                                 |
| `entity_type`    | `enum`      | `note`, `category`, `link`              |
| `operation_type` | `enum`      | `create`, `update`, `delete`             |
| `version`        | `integer`   | Not null                                 |
| `payload`        | `jsonb`     | Not null                                 |
| `changed_at`     | `timestamptz` | Not null, default `now()`             |

**Index:** `change_log_workspace_sequence_idx` — `(workspace_id, sequence)`

### refresh_tokens

| Column        | Type        | Constraints                              |
|---------------|-------------|------------------------------------------|
| `id`          | `uuid`      | Primary key                              |
| `user_id`     | `uuid`      | FK → `users.id` (cascade), not null     |
| `token_hash`  | `text`      | Not null, unique index                   |
| `expires_at`  | `timestamptz` | Not null                               |
| `revoked_at`  | `timestamptz` | Nullable                              |
| `created_at`  | `timestamptz` | Not null                               |

## Roles enum

```sql
CREATE TYPE workspace_role AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
```

## Migrations

Migrations are numbered sequentially (0000–0009) and stored in `apps/api/drizzle/`. Each migration is a raw SQL file with `--> statement-breakpoint` separators. The journal is tracked in `drizzle/meta/_journal.json`.

| # | Tag                          | Description                                        |
|---|------------------------------|----------------------------------------------------|
| 0 | `0000_initial_sync`          | Initial schema (notes, categories, links, sync)   |
| 4 | `0004_full_text_search`      | tsvector column + GIN index + trigger              |
| 5 | `0005_add_users`             | Users table                                        |
| 6 | `0006_add_refresh_tokens`    | Refresh tokens table                               |
| 7 | `0007_add_workspaces`        | Workspaces + workspace_members tables              |
| 8 | `0008_add_workspace_id`      | Replace owner_id with workspace_id on owned tables |
| 9 | `0009_add_workspace_description` | Add description to workspaces, created_at to members |
| 10 | `0010_change_log_workspace_id` | Replace text owner_id with uuid workspace_id FK on change_log |
| 11 | `0011_workspace_invitations` | workspace_invitations table for workspace collaboration |
## Client-side storage (on-device)

The **server** schema above is synchronized with by clients; the **client-side**
schema lives entirely on the device and is separate. Both web (IndexedDB) and
mobile (SQLite) persist local records through the shared `StorageAdapter`
contract from `@bigmind/storage`.

| Table (SQLite)     | Key  | Content                                   |
| ------------------- | ---- | ----------------------------------------- |
| `notes`             | `id` | Note record + index columns (`title`, `category_id`, `template_type`, `updated_at`, `deleted_at`, `sync_status`) |
| `categories`        | `id` | Category record (`parent_id`, `position`, `updated_at`, `deleted_at`, `sync_status`) |
| `note_links`        | `id` | Resolved wiki links (`source_note_id`, `target_note_id`, `sync_status`) + compound `[source_note_id+target_note_id]` |
| `note_aliases`      | `id` | Rename aliases (`note_id`, `normalized_alias`) + compound `[note_id+normalized_alias]` |
| `todo_items`        | `id` | Todo items (`todo_list_id`, `sync_status`) |
| `reminders`         | `id` | Reminders (`workspace_id`, `due_at`, `completed`, `sync_status`) |
| `notifications`     | `id` | Notifications (`workspace_id`, `type`, `read`, `created_at`, `sync_status`) |
| `outbox`            | `id` | Pending sync operations (`entity_id`, `entity_type`, `created_at`, `status`, `next_retry_at`) + compound `[entity_id+status]` |
| `conflicts`         | `id` | Conflict records + snapshots (`entity_id`, `entity_type`, `status`, `created_at`) |
| `sync_state`        | `key`| Key-value sync metadata (cursor, last sync timestamp) |
| `schema_meta`       | `id` | Applied schema version (migration bookkeeping) |

Each record is stored as JSON in the `data` column (single source of truth)
with duplicated, index-backed columns for the query surface — adding a field
never requires a migration unless it is queried. Migrations are versioned and
applied transactionally. See [Storage Architecture](storage-architecture.md)
for the full design, parity guarantees, and the encrypted-storage roadmap.
