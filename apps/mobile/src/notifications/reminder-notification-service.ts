import type { ReminderNotificationHooks } from '@bigmind/features';
import type { ReminderRecord } from '@bigmind/storage';

import type {
  NotificationScheduler,
  ScheduledReminderNotification,
} from './notification-scheduler';

/**
 * Reminder → local notification policy + coordinator.
 *
 * Implements the shared {@link ReminderNotificationHooks} (wired into the
 * shared `RemindersRepository` by `apps/mobile/src/features/data/
 * repositories.ts`), so every reminder mutation — create, edit, complete,
 * delete — automatically schedules, reschedules, or cancels the native local
 * notification. It also exposes `reconcile()` used after sync pulls and on
 * app start to converge the OS-scheduled notifications with the local
 * reminder store.
 *
 * Completely offline: everything reads/writes the device-local reminder
 * database and the native scheduler; the backend is never involved.
 */

/** True when a reminder deserves a scheduled local notification. */
export function shouldScheduleReminderNotification(
  reminder: ReminderRecord,
  now: Date = new Date(),
): boolean {
  return (
    !reminder.completed &&
    new Date(reminder.dueAt).getTime() > now.getTime()
  );
}

export interface ReconcilePlan {
  /** Reminders needing a (re)schedule — missing or with a changed due time. */
  toSchedule: ReminderRecord[];
  /** Notification ids to cancel — completed, deleted, or no longer due. */
  toCancel: string[];
}

/**
 * Pure reconciliation: diff the OS-scheduled notifications against the local
 * reminders and produce the minimal set of schedule/cancel operations.
 * `schedule()` upserts by reminder id, so a changed `dueAt` reschedules in
 * place.
 */
export function buildReconcilePlan(
  reminders: ReminderRecord[],
  scheduled: ScheduledReminderNotification[],
  now: Date = new Date(),
): ReconcilePlan {
  const desired = new Map<string, ReminderRecord>();
  for (const reminder of reminders) {
    if (shouldScheduleReminderNotification(reminder, now)) {
      desired.set(reminder.id, reminder);
    }
  }

  const scheduledById = new Map<string, ScheduledReminderNotification>();
  for (const entry of scheduled) {
    scheduledById.set(entry.reminderId, entry);
  }

  const toSchedule: ReminderRecord[] = [];
  for (const reminder of desired.values()) {
    if (scheduledById.get(reminder.id)?.dueAt !== reminder.dueAt) {
      toSchedule.push(reminder);
    }
  }

  const toCancel = scheduled
    .filter((entry) => !desired.has(entry.reminderId))
    .map((entry) => entry.reminderId);

  return { toSchedule, toCancel };
}

/**
 * Coordinates reminder mutations onto the platform {@link NotificationScheduler}.
 *
 * - created  → schedule at due time (skipped for immediately-past due times)
 * - updated  → reschedule at the new due time; cancel when completed
 * - deleted  → cancel
 * - reconcile → converge OS-scheduled notifications with local reminders
 *   (covers reminders created/edited/completed/deleted on other devices and
 *   pulled in by the sync engine, and idempotent app-start/reboot recovery)
 */
export class ReminderNotificationService implements ReminderNotificationHooks {
  constructor(private readonly scheduler: NotificationScheduler) {}

  async onReminderCreated(reminder: ReminderRecord): Promise<void> {
    if (!shouldScheduleReminderNotification(reminder)) return;
    await this.scheduler.schedule(reminder);
  }

  async onReminderUpdated(reminder: ReminderRecord): Promise<void> {
    if (!shouldScheduleReminderNotification(reminder)) {
      // Completed (or due time already passed): no pending notification.
      await this.scheduler.cancel(reminder.id);
      return;
    }
    // schedule() upserts by reminder id → reschedules with the new dueAt.
    await this.scheduler.schedule(reminder);
  }

  async onReminderDeleted(reminder: ReminderRecord): Promise<void> {
    await this.scheduler.cancel(reminder.id);
  }

  async reconcile(
    reminders: ReminderRecord[],
    now: Date = new Date(),
  ): Promise<void> {
    const plan = buildReconcilePlan(
      reminders,
      await this.scheduler.listScheduled(),
      now,
    );
    for (const reminderId of plan.toCancel) {
      await this.scheduler.cancel(reminderId);
    }
    for (const reminder of plan.toSchedule) {
      await this.scheduler.schedule(reminder);
    }
  }
}