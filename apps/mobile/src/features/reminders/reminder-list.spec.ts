import type { ReminderRecord } from '@bigmind/storage';

import {
  AGENDA_SECTION_KEYS,
  buildAgendaReminders,
  formatDue,
  groupReminders,
  isOverdue,
  searchReminders,
} from './reminder-list';

/** Deterministic reference time: 2025-06-05 12:00 local. */
const NOW = new Date(2025, 5, 5, 12, 0, 0);

function makeReminder(
  overrides: Partial<ReminderRecord> & { id: string; dueAt: string },
): ReminderRecord {
  return {
    workspaceId: 'ws-1',
    title: 'Reminder',
    description: '',
    completed: false,
    createdBy: '',
    linkedNoteId: null,
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    version: 0,
    syncStatus: 'synced',
    ...overrides,
  };
}

describe('reminder agenda grouping (mobile, mirrors web agenda)', () => {
  it('groups due today / tomorrow / upcoming / completed with dueAt ascending order', () => {
    const todayLate = makeReminder({
      id: 'today-late',
      title: 'Today late',
      dueAt: new Date(2025, 5, 5, 18, 0).toISOString(),
    });
    const todayEarly = makeReminder({
      id: 'today-early',
      title: 'Today early',
      dueAt: new Date(2025, 5, 5, 9, 0).toISOString(),
    });
    const tomorrow = makeReminder({
      id: 'tomorrow',
      title: 'Tomorrow',
      dueAt: new Date(2025, 5, 6, 10, 0).toISOString(),
    });
    const upcoming = makeReminder({
      id: 'upcoming',
      title: 'Upcoming',
      dueAt: new Date(2025, 5, 20, 8, 0).toISOString(),
    });
    const completed = makeReminder({
      id: 'completed',
      title: 'Completed',
      dueAt: new Date(2025, 0, 1, 8, 0).toISOString(),
      completed: true,
    });

    const grouped = groupReminders(
      [upcoming, completed, todayLate, tomorrow, todayEarly],
      NOW,
    );

    expect(grouped.Today.map((r) => r.id)).toEqual(['today-early', 'today-late']);
    expect(grouped.Tomorrow.map((r) => r.id)).toEqual(['tomorrow']);
    expect(grouped.Upcoming.map((r) => r.id)).toEqual(['upcoming']);
    expect(grouped.Completed.map((r) => r.id)).toEqual(['completed']);
  });

  it('sorts every section by dueAt ascending regardless of input order', () => {
    const a = makeReminder({
      id: 'a',
      dueAt: new Date(2025, 5, 5, 15, 0).toISOString(),
    });
    const b = makeReminder({
      id: 'b',
      dueAt: new Date(2025, 5, 5, 10, 0).toISOString(),
    });
    const c = makeReminder({
      id: 'c',
      dueAt: new Date(2025, 5, 5, 12, 0).toISOString(),
    });

    const grouped = groupReminders([a, c, b], NOW);
    expect(grouped.Today.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts overdue items into Upcoming (web parity), not Today', () => {
    const overdueYesterday = makeReminder({
      id: 'yesterday',
      dueAt: new Date(2025, 5, 4, 8, 0).toISOString(),
    });
    // Web parity: a same-day item due earlier today stays in Today — only
    // items due before today's start move to Upcoming.
    const earlierToday = makeReminder({
      id: 'this-morning',
      dueAt: new Date(2025, 5, 5, 8, 0).toISOString(),
    });
    const laterToday = makeReminder({
      id: 'later',
      dueAt: new Date(2025, 5, 5, 15, 0).toISOString(),
    });

    const grouped = groupReminders(
      [earlierToday, laterToday, overdueYesterday],
      NOW,
    );

    expect(grouped.Today.map((r) => r.id)).toEqual([
      'this-morning',
      'later',
    ]);
    expect(grouped.Upcoming.map((r) => r.id)).toEqual(['yesterday']);
  });

  it('returns empty sections for an empty list, in fixed order', () => {
    const grouped = groupReminders([], NOW);
    for (const key of AGENDA_SECTION_KEYS) {
      expect(grouped[key]).toEqual([]);
    }
  });

  it('isOverdue reports only pending reminders past their due time', () => {
    const overdue = makeReminder({
      id: 'overdue',
      dueAt: new Date(2025, 5, 5, 11, 0).toISOString(),
    });
    const notYet = makeReminder({
      id: 'not-yet',
      dueAt: new Date(2025, 5, 5, 13, 0).toISOString(),
    });
    const completedOverdue = makeReminder({
      id: 'completed',
      dueAt: new Date(2025, 5, 4, 8, 0).toISOString(),
      completed: true,
    });

    expect(isOverdue(overdue, NOW)).toBe(true);
    expect(isOverdue(notYet, NOW)).toBe(false);
    expect(isOverdue(completedOverdue, NOW)).toBe(false);
  });
});

describe('reminder local search', () => {
  const reminders = [
    makeReminder({ id: 'title', title: 'Buy Milk', dueAt: '2025-06-05T10:00:00.000Z' }),
    makeReminder({
      id: 'desc',
      title: 'Stand-up',
      description: 'prepare the sprint demo',
      dueAt: '2025-06-05T10:00:00.000Z',
    }),
    makeReminder({ id: 'other', title: 'Call dentist', dueAt: '2025-06-06T10:00:00.000Z' }),
  ];

  it('matches title case-insensitively', () => {
    expect(searchReminders(reminders, 'milk').map((r) => r.id)).toEqual(['title']);
    expect(searchReminders(reminders, 'MILK').map((r) => r.id)).toEqual(['title']);
  });

  it('matches description', () => {
    expect(searchReminders(reminders, 'sprint').map((r) => r.id)).toEqual(['desc']);
    expect(searchReminders(reminders, 'demo').map((r) => r.id)).toEqual(['desc']);
  });

  it('returns everything for an empty query and nothing for a miss', () => {
    expect(searchReminders(reminders, '')).toHaveLength(3);
    expect(searchReminders(reminders, '   ')).toHaveLength(3);
    expect(searchReminders(reminders, 'zzz-no-match')).toHaveLength(0);
  });
});

describe('buildAgendaReminders', () => {
  it('searches first, then groups', () => {
    const keep = makeReminder({
      id: 'keep',
      title: 'Ship review',
      dueAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    });
    const drop = makeReminder({
      id: 'drop',
      title: 'Mow lawn',
      dueAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
    });

    const grouped = buildAgendaReminders([keep, drop], { query: 'review' });

    const allIds = [
      ...grouped.Today,
      ...grouped.Tomorrow,
      ...grouped.Upcoming,
      ...grouped.Completed,
    ].map((r) => r.id);
    expect(allIds).toEqual(['keep']);
  });
});

describe('formatDue', () => {
  it('renders a readable date + time label', () => {
    // Hermes/Node both implement toLocaleDateString/toLocaleTimeString;
    // assert on the stable pieces only.
    const label = formatDue(new Date(2025, 5, 5, 9, 30).toISOString());
    expect(label).toContain('·');
    expect(label.length).toBeGreaterThan(10);
  });
});