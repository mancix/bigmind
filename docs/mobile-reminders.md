# Mobile Reminder Architecture

BigMind reminders are a **workspace-scoped, offline-first** entity class shared
by the web PWA and the mobile app. The mobile Reminders tab (`apps/mobile/…/
screens/reminders/`) delivers the same reminder experience as the web Agenda
page (`apps/web/src/routes/agenda.tsx`) without duplicating any business logic:

- **Persistence** — the shared `RemindersRepository` (`@bigmind/features`),
  backed by the mobile `StorageAdapter` (SQLite on device, memory in tests).
- **Domain rules** — `validateReminderTitle` (`@bigmind/domain/reminders`).
- **Synchronization** — the same outbox-based push/pull path used by the web
  app (`RemindersRepository` queues `reminder` outbox operations which the
  shared `SyncEngine` pushes; remote deletes/updates pull in identically).
- **Workspace scoping** — `workspaceId` is injected through the shared
  `WorkspaceContext` (`apps/mobile/src/features/data/repositories.ts` reads
  the AsyncStorage-hydrated workspace id), so switching or sharing workspaces
  behaves exactly like the web app.

## Screens

The Reminders tab is a native stack (`apps/mobile/src/navigation/
RemindersNavigator.tsx`) with three screens:

```
Reminders tab (native stack)
├── RemindersList (agenda)          → grouped Today / Tomorrow / Upcoming / Completed
│     ├── row toggle      → mark complete / incomplete (shared repository)
│     ├── row chevron     → ReminderDetail { reminderId }
│     ├── linked-note chip → Notes tab → NoteDetail { noteId }
│     └── ＋ New reminder  → ReminderForm (create)
├── ReminderDetail { reminderId }   → title, description, due date, status,
│                                    linked note; toggle, edit, delete (confirm)
│     └── Edit            → ReminderForm { reminderId } (edit mode)
└── ReminderForm           → title · description · due date (DateTimePicker,
                            date then time) · optional linked note · (edit:
                            completion status)
```

Deep links (`apps/mobile/src/app/App.tsx`): `bigmind://reminders`,
`bigmind://reminders/:reminderId`, `bigmind://reminders/new`.

## Agenda View

Grouping rules are pure functions in
`apps/mobile/src/features/reminders/reminder-list.ts` — byte-for-byte the web
Agenda algorithm (`apps/web/src/routes/agenda.tsx`) — so both apps always
bucket reminders the same way:

| Section     | Rule (web parity)                                                            |
| ----------- | ---------------------------------------------------------------------------- |
| Today       | due today (from today's start onwards)                                        |
| Tomorrow    | due tomorrow                                                                  |
| Upcoming    | due later **and overdue items** (due before today's start)                    |
| Completed   | `completed: true` (any due date)                                              |

Every section is sorted by `dueAt` ascending (`localeCompare` on ISO strings,
matching the web). The same module also provides:

- `searchReminders` — case-insensitive local search over **title + description**
  (offline, no index required; the screen stays usable in airplane mode).
- `isOverdue` — pending reminders whose due time has passed (rendered as an
  "Overdue" label).
- `AGENDA_SECTION_KEYS` / `AGENDA_SECTION_LABELS` — stable section order.

The list screen renders with a **`SectionList`** (the `FlatList`/`VirtualizedList`
primitive) with `stickySectionHeadersEnabled`, tuned
`initialNumToRender`/`windowSize`/`maxToRenderPerBatch`, keyed rows, and
pull-to-refresh that wakes `requestBackgroundSync()`. Empty sections are hidden
(web parity); filtering re-groups in one `useMemo` pass. This architecture
stays flat even with thousands of reminders.

### Agenda states

- **Loading** — initial `ActivityIndicator`.
- **Empty** — "No reminders yet — tap ＋ New reminder to create one."
- **Search miss** — "No reminders match `<query>`."
- **Offline** — a banner ("You're offline — reminders are saved locally…") plus
  the shared `SyncStatusPill`; rows and search keep working, and mutations
  queue outbox operations for later sync.

## Reminder Synchronization

Reminders use the exact sync path of the web app — there is no mobile-specific
sync code:

1. Every mutation (`create`, `update`, `toggle`, `remove`) goes through the
   shared `RemindersRepository`, which writes the local record **and** an
   outbox operation **transactionally**, then calls `requestBackgroundSync()`.
2. Consecutive edits/toggles coalesce into the pending operation
   (`upsertOperation` reuses a pending `create`/`update`), so toggle spam does
   not flood the outbox.
3. The shared `SyncEngine` (mobile wiring: `apps/mobile/src/sync/sync-service.ts`)
   pushes `reminder` operations and applies remote changes. Reminders are
   derived records: a push version conflict is recorded as a failed operation
   (not a full entity conflict) — identical to link/todo/notification behavior.
4. Remote deletes pull in as local deletes; remote updates apply when the
   remote version is newer.

Offline verification (covered by `apps/mobile/src/screens/reminders/
reminders-experience.spec.tsx` with `mobileSyncEngine.setOnline(false)`):
create, edit, complete, and delete all remain local-first and queue pending
outbox operations, exactly like the web PWA.

## Workspace Integration

- Reminders carry `workspaceId`; the shared repository queries
  `where('workspaceId').equals(wsId)` — no cross-workspace leakage.
- Shared-workspace reminders: the API scopes sync by `X-Workspace-Id`
  (`WorkspaceGuard`); the mobile app resolves the workspace id automatically
  (`apps/mobile/src/features/workspaces/ensure-workspace.ts`), so a reminder
  created/edited on another device in the same workspace pulls in on the next
  sync pass and render (screens subscribe via `subscribeToDataChanges`).
- Permissions: read/write is enforced server-side per workspace role; the
  mobile UI does not bypass the guard. Workspace switching clears local data
  and re-pulls, so reminders re-scope correctly.

## Performance

- `SectionList` virtualization (windowed rows, `initialNumToRender`,
  `maxToRenderPerBatch`, `updateCellsBatchingPeriod`) — thousands of reminders
  render with bounded work per frame.
- Filtering is a single in-memory `filter → group` pass over the already-loaded
  list (`buildAgendaReminders`), never a repository round-trip per keystroke.
- Rows are stateless presentational components keyed by `id`; linked note
  titles are resolved once per refresh into a `Record<noteId, title>`.

## Local Notifications (implemented)

Every reminder mutation schedules, reschedules, or cancels a **native local
notification** on the device — fully offline, no push infrastructure:

- **Create** → schedule a notification for `dueAt`.
- **Edit** → reschedule in place (same `reminder:<id>` identifier).
- **Complete** → cancel the pending notification; **reopen** → schedule again.
- **Delete** (both the tombstone and coalesced-create paths) → cancel.
- **Sync pulls** → `reconcile()` converges OS-scheduled notifications with the
  local store after every sync pass and on app start.

The notification core is untouched: the shared `RemindersRepository` exposes
optional `ReminderNotificationHooks` (4th constructor arg — the web app passes
nothing), and `apps/mobile/src/notifications/` provides the
`NotificationScheduler` platform abstraction (`ExpoNotificationScheduler` on
Android — OS `AlarmManager`, survives app restarts and device reboots;
`MemoryNotificationScheduler` in tests) plus the `ReminderNotificationService`
coordinator and `reconcile()` policy. See
[Mobile Notifications](mobile-notifications.md) for the full architecture,
requirements (offline, persistence, iOS future), and test matrix.