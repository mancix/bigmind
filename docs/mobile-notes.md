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
├── Reminders  ─── native stack (RemindersNavigator)
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

`NoteDetailScreen` is the **central screen** of the mobile app and is
read-mode-first. The full architecture — wiki links, backlinks, related
reminders, category path, sync status, conflict awareness, offline behavior,
and performance — is documented in [Mobile Note Detail Architecture](mobile-note-detail.md).

In short:

- **Read mode (default)** — title + shared `SyncStatusPill`, category path chip
  (→ Categories tab), created/updated dates, and the stored Markdown rendered
  through the shared `@bigmind/markdown` tokenizer via `MarkdownText`
  (headings, bold, italic, code, lists, checklists, blockquotes, links, wiki
  links).
- **Wiki links** — `[[Title]]` tokens are tappable; they resolve through the
  shared `resolveWikiLinkTarget` + `LinkRepository` aliases, push the target
  note, and missing notes are clearly indicated (styled + alert on tap).
- **Backlinks** — `LinkRepository.getBacklinks()` with title + preview,
  virtualized, pushes the source note.
- **Related reminders** — `RemindersRepository.listForNote()` (workspace
  scoped), tap → ReminderDetail, ＋ Add reminder → pre-linked ReminderForm.
- **Conflict awareness** — banner when `syncStatus === 'conflict'` or an open
  `ConflictRecord` exists for the note (indicator only; resolution is a future
  screen).
- **Edit mode** — the shipped editor is preserved: shared `noteDataSchema`
  validation before saving through `noteRepository.update()`, category picker
  (shared `CategoryRepository`), `MarkdownEditView`/`TodoListView`, cancel and
  confirm-delete via `Alert` (local-first outbox deletion, offline-safe).

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
| `screens/notes/notes-experience.spec.tsx`                    | list: loading, search (title+content), sorting toggle, creation + navigation, offline sync pill + offline browsing; **detail (read mode)**: loading, markdown rendering, wiki-link navigation + missing-link indication, backlinks + preview + navigation, related reminders + navigation + create, category path + navigation, conflict indicator, offline readability; edit: save via shared repository, offline delete via confirm dialog |
| `features/notes/note-list.spec.ts`                           | pure search/sort/pagination/`buildNoteList`/archive flag |

Shared behavior (outbox, previews, wiki links) is covered by the shared
`@bigmind/features` and `@bigmind/domain` suites.