import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { ReminderRecord } from '@bigmind/storage';

/**
 * Local notification scheduling — platform abstraction.
 *
 * BigMind schedules **native** local notifications for reminders directly on
 * the device (no backend, no push token, works fully offline). This module
 * defines the narrow contract the rest of the app depends on, plus two
 * implementations:
 *
 * - {@link ExpoNotificationScheduler} — production scheduler using
 *   `expo-notifications`. On Android it delegates to the OS `AlarmManager`
 *   (via expo-notifications' `NotificationsService`), so scheduled
 *   notifications survive app restarts **and device reboots** (the library
 *   ships `RECEIVE_BOOT_COMPLETED` + reboot receivers). iOS support uses the
 *   exact same cross-platform API — Android is the first validated target.
 * - {@link MemoryNotificationScheduler} — in-memory scheduler used by unit
 *   tests (deterministic, no native module) and as the web fallback.
 *
 * A notification is identified by the reminder id (`reminder:<id>`), so
 * `schedule()` on an existing id **reschedules** (Expo replaces the pending
 * notification with the same identifier) and `cancel()` removes it.
 */
export interface ScheduledReminderNotification {
  /** Reminder id this notification belongs to. */
  reminderId: string;
  /** ISO timestamp of the scheduled fire time. */
  dueAt: string;
  /** Display title (reminder title, for tests/inspection). */
  title: string;
}

export interface NotificationScheduler {
  /**
   * Schedule (or reschedule, by reminder id) the local notification for a
   * reminder's due time.
   */
  schedule(reminder: ReminderRecord): Promise<void>;
  /** Cancel the pending notification for a reminder (no-op when absent). */
  cancel(reminderId: string): Promise<void>;
  /** Cancel every pending reminder notification (e.g. data reset). */
  cancelAll(): Promise<void>;
  /** Snapshot of currently scheduled notifications (for reconciliation). */
  listScheduled(): Promise<ScheduledReminderNotification[]>;
}

/** Stable OS-side identifier for a reminder's scheduled notification. */
export function reminderNotificationId(reminderId: string): string {
  return `reminder:${reminderId}`;
}

/** Extract the reminder id from an OS notification identifier. */
export function reminderIdFromNotificationId(
  identifier: string,
): string | undefined {
  const prefix = 'reminder:';
  return identifier.startsWith(prefix)
    ? identifier.slice(prefix.length)
    : undefined;
}

/**
 * Best-effort read of the fire time (ms) out of an expo-notifications
 * date trigger. `getAllScheduledNotificationsAsync` returns normalized
 * triggers whose shape varies by SDK version (`value` vs `date`).
 */
function triggerFireMs(trigger: unknown): number | undefined {
  const t = trigger as
    | { value?: unknown; date?: unknown }
    | null
    | undefined;
  if (!t) return undefined;
  const raw = (t.value ?? t.date) as number | Date | string | undefined;
  if (raw === undefined) return undefined;
  if (typeof raw === 'number') return raw;
  if (raw instanceof Date) return raw.getTime();
  const ms = Date.parse(String(raw));
  return Number.isNaN(ms) ? undefined : ms;
}

/** Android notification channel used for reminder notifications. */
export const REMINDER_CHANNEL_ID = 'reminders';

/**
 * Native scheduler over `expo-notifications`.
 *
 * Lazy-init (first use): notification handler, Android channel creation, and
 * a one-time permission request (Android 13+ `POST_NOTIFICATIONS`). All calls
 * are best-effort — a denied permission means the OS simply does not display
 * the notification, scheduling itself never throws.
 */
export class ExpoNotificationScheduler implements NotificationScheduler {
  private ready: Promise<void> | null = null;

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.init().catch(() => {
        // Never throw into callers; scheduling degrades to a no-op.
      });
    }
    return this.ready;
  }

  private async init(): Promise<void> {
    // Foreground presentation: show the banner + tray entry without stealing
    // focus. (Android local notifications are governed by the channel below;
    // this handler also prepares the future iOS presentation.)
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const current = await Notifications.getPermissionsAsync();
    if (!current.granted && current.canAskAgain) {
      await Notifications.requestPermissionsAsync();
    }
  }

  async schedule(reminder: ReminderRecord): Promise<void> {
    await this.ensureReady();
    await Notifications.scheduleNotificationAsync({
      identifier: reminderNotificationId(reminder.id),
      content: {
        title: reminder.title,
        body: reminder.description || 'Reminder due',
        data: {
          type: 'reminder_due',
          reminderId: reminder.id,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.dueAt),
        channelId: REMINDER_CHANNEL_ID,
      },
    });
  }

  async cancel(reminderId: string): Promise<void> {
    await this.ensureReady();
    await Notifications.cancelScheduledNotificationAsync(
      reminderNotificationId(reminderId),
    );
  }

  async cancelAll(): Promise<void> {
    await this.ensureReady();
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  async listScheduled(): Promise<ScheduledReminderNotification[]> {
    await this.ensureReady();
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    const scheduled: ScheduledReminderNotification[] = [];
    for (const request of requests) {
      const reminderId = reminderIdFromNotificationId(request.identifier);
      if (!reminderId) continue;
      const fireMs = triggerFireMs(request.trigger);
      if (fireMs === undefined) continue;
      scheduled.push({
        reminderId,
        dueAt: new Date(fireMs).toISOString(),
        title: request.content.title ?? '',
      });
    }
    return scheduled;
  }
}

/**
 * In-memory scheduler: deterministic tests and non-native platforms (web).
 * Mirrors the idempotent upsert-by-reminder-id semantics of the native
 * scheduler.
 */
export class MemoryNotificationScheduler implements NotificationScheduler {
  private readonly scheduled = new Map<string, ScheduledReminderNotification>();

  async schedule(reminder: ReminderRecord): Promise<void> {
    this.scheduled.set(reminder.id, {
      reminderId: reminder.id,
      dueAt: reminder.dueAt,
      title: reminder.title,
    });
  }

  async cancel(reminderId: string): Promise<void> {
    this.scheduled.delete(reminderId);
  }

  async cancelAll(): Promise<void> {
    this.scheduled.clear();
  }

  async listScheduled(): Promise<ScheduledReminderNotification[]> {
    return [...this.scheduled.values()];
  }
}

/**
 * Platform-default scheduler factory.
 *
 * - iOS / Android (native bundles): {@link ExpoNotificationScheduler}
 *   (Android = shipped target; iOS ready via the same API).
 * - web: {@link MemoryNotificationScheduler} (no OS notifications).
 * - In jest the `expo-notifications` module is mocked in `test-setup.ts`;
 *   specs that need deterministic assertions inject
 *   {@link MemoryNotificationScheduler} directly.
 */
export function createNotificationScheduler(): NotificationScheduler {
  if (Platform.OS === 'web') {
    return new MemoryNotificationScheduler();
  }
  return new ExpoNotificationScheduler();
}