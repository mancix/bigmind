# Mobile Notes Architecture

## Overview

The primary mobile notes experience lives in `apps/mobile/src/screens/notes/`
and reuses the **shared note repositories, domain rules, contracts, sync engine,
and workspace architecture**. No business logic is duplicated: `NoteRepository`
(`@bigmind/features`) is the single source of truth for persistence and sync;
`createNotePreview` (`@bigmind/domain/notes`) renders plain-text previews;
`noteDataSchema` (`@bigmind/contracts`) validates edits; the shared
`@bigmind/sync` engine reports synchronization status.

Related documents: [Mobile Architecture](mobile-architecture.md),
[Synchronization Architecture](synchronization-architecture.md),
[Mobile Workspace Management](mobile-workspaces.md).

## Navigation Structure

```
Bottom Tab Navigator (RootNavigator)
├── Home          (single screen)
├── Notes  ─────── native stack (NotesNavigator)
│     ├── NotesList   → NoteDetail { noteId }     ← push (native transition)
├── Categories ─── native stack (CategoriesNavigator)
├── Workspaces ─── native stack (WorkspacesNavigator)
├── Reminders     (single screen)
└── Settings      (single screen)
```

- **Native UX** — notes use a `createNativeStackNavigator` with native
  transitions; the list pushes the detail screen.
- **Deep navigation** — the root `NavigationContainer` in `App.tsx` configures
  `bigmind://` deep links: `bigmind://notes/<noteId>` opens the note detail,
  `bigmind://notes` the list, plus categories/reminders/settings routes.
- **State preservation** — React Navigation keeps the stack/screen state; the
  list re-renders the latest data whenever a sync pass lands (via the shared
  `subscribeToDataChanges()` bus) and on `focus` handled implicitly by the
  stack staying mounted.

## Notes List Screen

`NotesListScreen` is the hub of the experience:

| Feature       | Implementation                                                                 |
| ------------- | ------------------------------------------------------------------------------ |
| **Row content** | title, `createNotePreview(content)` plain-text preview, last-updated date, category chip |
| **Loading**    | initial spinner while `noteRepository.list()` loads                            |
| **Empty state**| "No notes yet" (no data) vs "No notes match …" (no search hits)                |
| **Search**     | offline, in-memory title + content search (case-insensitive) — see below       |
| **Sorting**    | `Updated` (recency) ↔ `A–Z` toggle; registry-ready for future modes            |
| **Creation**   | Floating Action Button → `noteRepository.create()` → navigates to the new note |
| **Sync feedback** | `SyncStatusPill` shows the shared engine status (Synced / Syncing / Offline / Login required / Sync error) |
| **Pull to refresh** | refreshes from the local repository (never a blocking network call)       |

### Search

Notes are searchable **completely offline**: the full note set is loaded once
into memory and filtered client-side by the pure helper `searchNotes()` in
`features/notes/note-list.ts` (title + content, case-insensitive — mirroring
the shared repository search semantics). Filtering is instant while typing and
matches the `NoteRepository.list({ search })` behavior used by the web app and
the categories screens.

### Sorting

`NoteSortMode = 'updated' | 'alpha'` drives a pure `sortNotes()` helper. The
registry (`NOTE_SORT_MODES` / `NOTE_SORT_LABELS`) is the extension point for
future modes (created date, title-desc, category…), and the list is built by a
single `buildNoteList()` pass: **filter → sort → paginate**.

### Performance / pagination

The list is a virtualized `FlatList` (`initialNumToRender`, `windowSize`,
`maxToRenderPerBatch`) with an `onEndReached` hook that grows the visible window
by `NOTE_PAGE_SIZE` (50) — pagination-ready and flat-memory even with thousands
of notes.

## Note Detail Screen

`NoteDetailScreen`:

- **Edit** — shared `noteDataSchema` validation before saving through
  `noteRepository.update()` (unchanged behavior).
- **Delete** — confirmation dialog (`Alert.alert`) → `noteRepository.delete()`
  → `goBack()`. Deletion is local-first (outbox), so it works **offline** and
  syncs later.
- **Structure** — category picker (shared `CategoryRepository`), wiki-link
  backlinks/outgoing links (shared `LinkRepository`), TODO-list notes via the
  shared `TodoRepository` + `TodoListView`.
- **Per-note sync state** — `syncStatus` label (`pending` / synced / `conflict`).

## Offline Notes Experience

Everything works with the network down because persistence is local
(StorageAdapter) and search/sort/list are in-memory:

- **Notes visible offline** — the list reads `noteRepository.list()` from the
  local adapter (IndexedDB on web, SQLite on device).
- **Searchable offline** — in-memory filtering; no server round-trip.
- **Creation offline** — `noteRepository.create()` writes locally and queues an
  outbox operation; the FAB works with no connectivity.
- **Deletion offline** — same local-first path with the outbox.
- **Sync resumes automatically** — the shared supervisor (AppState + NetInfo)
  wakes the sync engine when connectivity returns; `SyncStatusPill` reflects
  `idle / syncing / offline / auth_required / error` at all times so the user
  always knows whether local changes have been synced. Workspace data
  remains usable offline via the cached workspace list (see
  [Mobile Workspaces](mobile-workspaces.md)).

## Archive preparation

The archive/trash feature is **not implemented yet**. The architecture is
prepared for it without behavioral change:

- `libs/domain/src/notes/note.ts` — `Note` gained an optional `archivedAt?`
  timestamp (additive; nothing writes it yet).
- `libs/contracts/src/sync.schemas.ts` — `noteDataSchema` accepts optional
  `archivedAt` so the field flows through sync validation when archive ships.
- `features/notes/note-list.ts` — `noteIsArchived()` marks where archived notes
  will be filtered out of the list, and `buildNoteList()` is the single funnel.

## Testing

| Spec                                                        | Covers                                          |
| ----------------------------------------------------------- | ----------------------------------------------- |
| `screens/notes/notes-experience.spec.tsx`                    | loading, search (title+content), sorting toggle, creation + navigation, save, offline deletion via confirm dialog, offline sync pill + offline browsing |
| `features/notes/note-list.spec.ts`                           | pure search/sort/pagination/`buildNoteList`/archive flag |

Shared behavior (outbox, previews, wiki links) is covered by the shared
`@bigmind/features` and `@bigmind/domain` suites.