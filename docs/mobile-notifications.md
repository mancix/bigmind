# Mobile Notifications Architecture

BigMind's mobile app schedules **native local notifications for reminders
directly on the device**. There is no push infrastructure, no APNs/FCM token,
and no backend involvement: scheduling, rescheduling, and cancellation are all
local operations that keep working when the device is offline, the backend is
unreachable, or synchronization is paused.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                apps/mobile/src/notifications/                             │
│                                                                            │
│  NotificationScheduler (platform abstraction)                              │
│  ├── ExpoNotificationScheduler   native scheduling (expo-notifications)    │
│  │     └── Android: AlarmManager via the OS — survives app restarts,       │
│  │         device reboots (RECEIVE_BOOT_COMPLETED + reboot receivers)      │
│  ├── MemoryNotificationScheduler  deterministic in-memory double (tests,   │
│  │                                web fallback)                            │
│  └── createNotificationScheduler()   platform factory                      │
│                                                                            │
│  ReminderNotificationService (policy + coordinator)                        │
│  ├── implements ReminderNotificationHooks (shared @bigmind/features)       │
│  └── reconcile() — converge OS-scheduled notifications with local store    │
└───────────────┬────────────────────────────────────────────────────────────┘
                │
        ┌───────▼────────────────────────────────────────────────────────────┐
        │  RemindersRepository (shared, libs/features)                       │
        │  · create → onReminderCreated  → schedule                          │
        │  · update → onReminderUpdated  → reschedule / cancel (completed)   │
        │  · remove → onReminderDeleted  → cancel                            │
        └────────────────────────────────────────────────────────────────────┘
```

## Requirements

1. **Created / updated reminders** schedule (or reschedule) a local
   notification at `dueAt` automatically.
2. **Persistence** — scheduled notifications are held by the **native Android
   scheduler** (`AlarmManager` via expo-notifications' `NotificationsService`),
   so they survive app restarts **and device reboots**; the library manifest
   declares `RECEIVE_BOOT_COMPLETED` and registers reboot receivers that
   re-arm pending alarms.
3. **Deleted reminders** cancel their pending notification; **completed
   reminders** cancel it too (a completed item must never fire).
4. **Works fully offline** — every operation reads/writes the device-local
   reminder store (SQLite via `StorageAdapter`) and the OS scheduler. The
   backend is never consulted, so notifications work in airplane mode, with a
   dead API, and while sync is paused.
5. **Future iOS support** — the scheduler contract is platform-agnostic and
   expo-notifications is cross-platform, so iOS uses the same API. Android is
   the first validated target (the CI-safe `expo export --platform android`
   build); iOS hardening (permissions UX, sound, foreground presentation) is
   future work behind the same `NotificationScheduler` seam.

## Platform scheduler abstraction

`apps/mobile/src/notifications/notification-scheduler.ts`

| Interface member | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `schedule(r)`    | Schedule (or **reschedule**, by reminder id) for `dueAt`       |
| `cancel(id)`     | Cancel the pending notification for a reminder                 |
| `cancelAll()`    | Cancel every pending reminder notification (data reset)        |
| `listScheduled()`| Snapshot of OS-scheduled notifications (reconciliation input)  |

A notification is keyed by `reminder:<id>` in the OS. Because
`scheduleNotificationAsync` **replaces** an existing notification with the same
identifier, "reschedule" is just `schedule()` again — no duplicate, atomic
replacement of the fire time.

- **`ExpoNotificationScheduler`** — production implementation. Lazy
  initialization on first use: sets the notification handler, creates the
  `reminders` Android channel (`AndroidImportance.HIGH`), and requests
  `POST_NOTIFICATIONS` once (Android 13+). All calls are best-effort: a denied
  permission simply means the OS does not display the notification.
- **`MemoryNotificationScheduler`** — deterministic in-memory double used by
  unit tests and by the web platform (no OS notifications).
- **`createNotificationScheduler()`** — platform factory (web → memory,
  iOS/Android → expo).

## Reminder → notification policy

`apps/mobile/src/notifications/reminder-notification-service.ts`

Pure, unit-tested policy:

- `shouldScheduleReminderNotification(r)` — only **pending** (not completed)
  reminders with a **future** `dueAt` get a notification. Overdue reminders are
  intentionally not scheduled (the agenda shows them as "Overdue"; a
  past-due trigger would fire immediately).
- `buildReconcilePlan(reminders, scheduled, now)` — minimal diff between the
  OS-scheduled set and the local reminder store:
  - due time changed (or not yet scheduled) → `toSchedule`
  - completed / deleted / no longer due → `toCancel`

## Repository integration

The shared `RemindersRepository` (`libs/features`) accepts an **optional**
`ReminderNotificationHooks` as its 4th constructor argument — `onReminderCreated`,
`onReminderUpdated`, `onReminderDeleted`. Mobile passes the
`ReminderNotificationService`; the web app passes nothing and is unaffected.

- Hooks fire **after** the local write + outbox operation succeed.
- They are **best-effort**: a throwing hook is swallowed — a notification
  failure can never break a reminder save.
- `toggle` funnels through `update`, so completion and reopening are covered by
  `onReminderUpdated`.

| Mutation                | Hook                    | Effect                          |
| ----------------------- | ----------------------- | ------------------------------- |
| create                  | `onReminderCreated`     | `schedule(dueAt)`               |
| update (due time)       | `onReminderUpdated`     | `schedule(newDueAt)` (in place) |
| update (title/desc)     | `onReminderUpdated`     | untouched (idempotent)          |
| complete                | `onReminderUpdated`     | `cancel()`                      |
| reopen (incomplete)     | `onReminderUpdated`     | `schedule(dueAt)`               |
| delete (both paths)     | `onReminderDeleted`     | `cancel()`                      |

## Sync-pull reconciliation

Reminders changed on *other devices* arrive through the sync engine, which
writes directly to storage (no repository hooks). `ReminderNotificationService
.reconcile()` closes that gap: called

1. **after every sync pass** (the `SyncActivator` status subscription fires on
   `idle`), and
2. **on app start** after the initial pull — including when that pull is
   offline (`sync()` short-circuits without an `idle` transition, so the
   explicit reconcile in `SyncActivator` is what converges the notifications
   with the locally stored reminders; requirement 4/6).

Reconcile is **idempotent**: an already-correct state changes nothing (no
redundant OS calls), which also makes it a safe no-op after a device reboot
when the OS has re-armed the alarms itself.

## Wiring

- `apps/mobile/src/features/data/repositories.ts` — constructs the scheduler
  via the platform factory and the `ReminderNotificationService`; passes it
  into the shared `RemindersRepository`.
- `apps/mobile/src/app/SyncActivator.tsx` — triggers `reconcile()` after sync
  passes and on startup.
- `apps/mobile/app.json` — registers the `expo-notifications` config plugin
  (Android manifest: notifications permission + reboot receivers).
- Tests: `apps/mobile/src/notifications/reminder-notification-service.spec.ts`
  (schedule / update / cancel / completion / reconcile / offline, over the
  in-memory scheduler) and `libs/features/src/reminders/
  reminder-notification-hooks.spec.ts` (shared-repository hook contract).

## Testing

| Behavior            | Test                                                        |
| ------------------- | ----------------------------------------------------------- |
| schedule (create)   | `reminder-notification-service.spec.ts` — "schedules a local notification when a reminder is created" |
| update (reschedule) | "reschedules the notification when the due time changes (no duplicates)" / "keeps the notification when editing fields that do not change the due time" |
| cancel (delete)     | "cancels the notification when the reminder is deleted" + coalesced-delete path |
| completion          | "cancels the notification when the reminder is completed" + reopen case |
| sync reconciliation | "reconciles after a sync pull…" + idempotency test          |
| offline             | "keeps everything local: repository mutations never hit the network" |
| repo hooks contract | `reminder-notification-hooks.spec.ts` (create/update/delete + throwing-hook safety) |