import type { ReminderRecord } from '@bigmind/storage';

/**
 * Pure, platform-independent reminder-helpers: agenda grouping, local search,
 * and pagination for the Reminders tab. Everything is a plain function so the
 * sectioning, ordering, and filtering semantics are unit-testable and identical
 * to the web Agenda page (`apps/web/src/routes/agenda.tsx`).
 *
 * The shared `RemindersRepository` (`@bigmind/features`) stays the single
 * source of truth for persistence (list/create/update/toggle/remove — with
 * outbox coalescing and workspace scoping); these helpers only shape the
 * already loaded records for fast, offline-safe rendering.
 */

export type AgendaSectionKey = 'Today' | 'Tomorrow' | 'Upcoming' | 'Completed';

/** Fixed agenda section order (Today → Tomorrow → Upcoming → Completed). */
export const AGENDA_SECTION_KEYS: readonly AgendaSectionKey[] = [
  'Today',
  'Tomorrow',
  'Upcoming',
  'Completed',
];

export const AGENDA_SECTION_LABELS: Record<AgendaSectionKey, string> = {
  Today: 'Today',
  Tomorrow: 'Tomorrow',
  Upcoming: 'Upcoming',
  Completed: 'Completed',
};

export type GroupedReminders = Record<AgendaSectionKey, ReminderRecord[]>;

/** Default page size for pagination-ready FlatLists/SectionLists. */
export const REMINDER_PAGE_SIZE = 50;

function startOfDay(d: Date): Date {
  const nd = new Date(d);
  nd.setHours(0, 0, 0, 0);
  return nd;
}

function addDays(d: Date, days: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Group reminders into the four agenda sections, sorted by `dueAt` ascending
 * inside every section. Mirrors the web Agenda page exactly:
 *
 * - `Today` — due later today (due times before "now" are treated as overdue
 *   and grouped into `Upcoming`, matching the web behavior of sorting overdue
 *   items into upcoming).
 * - `Tomorrow` — due tomorrow.
 * - `Upcoming` — due later (including overdue items).
 * - `Completed` — finished reminders.
 *
 * `now` is injectable for deterministic tests.
 */
export function groupReminders(
  reminders: ReminderRecord[],
  now: Date = new Date(),
): GroupedReminders {
  const todayStart = startOfDay(now);
  const tomorrowStart = startOfDay(addDays(now, 1));
  const grouped: GroupedReminders = {
    Today: [],
    Tomorrow: [],
    Upcoming: [],
    Completed: [],
  };

  for (const reminder of reminders) {
    if (reminder.completed) {
      grouped.Completed.push(reminder);
      continue;
    }
    const due = new Date(reminder.dueAt);
    if (due < todayStart) {
      // Overdue: the web app sorts overdue items into upcoming.
      grouped.Upcoming.push(reminder);
    } else if (sameDay(due, todayStart)) {
      grouped.Today.push(reminder);
    } else if (sameDay(due, tomorrowStart)) {
      grouped.Tomorrow.push(reminder);
    } else {
      grouped.Upcoming.push(reminder);
    }
  }

  for (const key of AGENDA_SECTION_KEYS) {
    grouped[key].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }
  return grouped;
}

/** True when a pending reminder is due before the reference time. */
export function isOverdue(
  reminder: ReminderRecord,
  now: Date = new Date(),
): boolean {
  if (reminder.completed) return false;
  return new Date(reminder.dueAt).getTime() < now.getTime();
}

/**
 * Case-insensitive local search over title + description (offline-safe, no
 * index required). Mirrors the shared repository `searchReminders` semantics.
 */
export function searchReminders(
  reminders: ReminderRecord[],
  query: string,
): ReminderRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return reminders;
  return reminders.filter(
    (reminder) =>
      reminder.title.toLocaleLowerCase().includes(needle) ||
      reminder.description.toLocaleLowerCase().includes(needle),
  );
}

/** Pagination-ready slicing used by virtualized lists. */
export function paginateReminders<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

/**
 * Build the visible agenda: filter (search) → group (Today/Tomorrow/Upcoming/
 * Completed, each `dueAt`-ascending) in one pass. Sections with no items yield
 * empty arrays so the screens can decide whether to hide them.
 */
export function buildAgendaReminders(
  reminders: ReminderRecord[],
  options: { query: string },
): GroupedReminders {
  return groupReminders(searchReminders(reminders, options.query));
}

/** Human-readable due label, e.g. `Mon 5 Aug · 09:30`. */
export function formatDue(dueAt: string): string {
  const d = new Date(dueAt);
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date} · ${time}`;
}