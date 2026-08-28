import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';

import { db, type ReminderRecord } from '../storage/database';
import { remindersRepository } from '../features/reminders/reminders-repository';
import { Icon } from '../components/icon';

export const Route = createFileRoute('/agenda')({
  component: AgendaPage,
});

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
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

interface GroupedReminders {
  Today: ReminderRecord[];
  Tomorrow: ReminderRecord[];
  Upcoming: ReminderRecord[];
  Completed: ReminderRecord[];
}

function groupReminders(reminders: ReminderRecord[]): GroupedReminders {
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = startOfDay(addDays(now, 1));
  const grouped: GroupedReminders = { Today: [], Tomorrow: [], Upcoming: [], Completed: [] };

  for (const r of reminders) {
    if (r.completed) {
      grouped.Completed.push(r);
    } else {
      const due = new Date(r.dueAt);
      if (due < todayStart) grouped.Upcoming.push(r); // overdue shown in upcoming
      else if (sameDay(due, todayStart)) grouped.Today.push(r);
      else if (sameDay(due, tomorrowStart)) grouped.Tomorrow.push(r);
      else grouped.Upcoming.push(r);
    }
  }

  for (const key of Object.keys(grouped) as (keyof GroupedReminders)[]) {
    grouped[key].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }
  return grouped;
}

function formatDue(dueAt: string): string {
  const d = new Date(dueAt);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatSectionDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function AgendaPage() {
  const reminders = useLiveQuery(() => remindersRepository.list(), []) ?? [];
  const noteTitles = useLiveQuery(async () => {
    const notes = await db.notes.toArray();
    return new Map<string, string>(notes.filter((n: { deletedAt?: string | null }) => !n.deletedAt).map((n) => [n.id, n.title]));
  }, []) ?? new Map<string, string>();

  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState(() => new Date(Date.now() + 3600_000).toISOString().slice(0, 16));
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDueAt, setEditDueAt] = useState('');

  const grouped = useMemo(() => groupReminders(reminders), [reminders]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await remindersRepository.create({ title, dueAt: new Date(dueAt).toISOString() });
    setTitle('');
    setShowCreate(false);
  }

  async function handleToggle(id: string) {
    await remindersRepository.toggle(id);
  }

  async function handleDelete(id: string) {
    await remindersRepository.remove(id);
  }

  function startEdit(r: ReminderRecord) {
    setEditingId(r.id);
    setEditTitle(r.title);
    setEditDueAt(r.dueAt.slice(0, 16));
  }

  async function saveEdit(r: ReminderRecord) {
    await remindersRepository.update(r.id, {
      title: editTitle,
      dueAt: new Date(editDueAt).toISOString(),
    });
    setEditingId(null);
  }

  const sections: { key: keyof GroupedReminders; label: string }[] = [
    { key: 'Today', label: 'Today' },
    { key: 'Tomorrow', label: 'Tomorrow' },
    { key: 'Upcoming', label: 'Upcoming' },
    { key: 'Completed', label: 'Completed' },
  ];

  return (
    <section className="mx-auto w-full max-w-4xl py-6">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-bold leading-10 tracking-[-0.02em] text-on-surface">Agenda</h1>
          <p className="mt-1 text-sm leading-5 text-on-surface-variant">
            Organize your priorities and keep track of your thinking milestones.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary transition-all hover:opacity-90 active:scale-95"
        >
          <Icon name="add" className="text-[18px]" />
          New reminder
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-8 space-y-3 rounded-xl border border-outline-variant bg-surface-lowest p-4 shadow-sm">
          <div>
            <label className="block text-xs font-medium text-on-surface-variant">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Reminder title"
              autoFocus
              className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-lowest px-3 py-2 text-sm text-on-surface outline-none transition focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-on-surface-variant">Due date</label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-lowest px-3 py-2 text-sm text-on-surface outline-none transition focus:border-primary"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg px-3 py-2 text-sm text-on-surface-variant transition hover:bg-surface-high">Cancel</button>
            <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:opacity-90">Create</button>
          </div>
        </form>
      )}

      {reminders.length === 0 && (
        <p className="mt-16 text-center text-sm text-outline">No reminders yet.</p>
      )}

      <div className="space-y-10">
        {sections.map(({ key, label }) => {
          const items = grouped[key];
          if (items.length === 0) return null;
          return (
            <section key={key}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-2xl font-semibold leading-8 tracking-[-0.01em] text-on-surface">
                  {label}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      key === 'Today'
                        ? 'bg-primary-container/10 text-primary-container'
                        : 'bg-surface-highest text-on-surface-variant'
                    }`}
                  >
                    {items.length}
                  </span>
                </h2>
                {key === 'Today' && (
                  <span className="text-xs font-medium text-on-surface-variant">
                    {formatSectionDate(new Date())}
                  </span>
                )}
              </div>
              <ul className="grid grid-cols-1 gap-3">
                {items.map((r) => (
                  <li
                    key={r.id}
                    className="group flex items-start justify-between gap-3 rounded-xl border border-outline-variant bg-surface-lowest p-4 transition-all duration-300 hover:border-primary"
                  >
                    <div className="flex min-w-0 items-start gap-4">
                      <button
                        type="button"
                        onClick={() => void handleToggle(r.id)}
                        aria-label={r.completed ? 'Mark incomplete' : 'Mark complete'}
                        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2 transition ${
                          r.completed
                            ? 'border-primary bg-primary text-on-primary'
                            : 'border-outline-variant hover:border-primary'
                        }`}
                      >
                        {r.completed && (
                          <svg viewBox="0 0 20 20" fill="currentColor" className="size-3" aria-hidden="true">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </button>

                      <div className="min-w-0">
                        {editingId === r.id ? (
                          <div className="flex flex-wrap gap-2">
                            <input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="min-w-0 flex-1 rounded border border-outline-variant bg-surface-lowest px-2 py-1 text-sm outline-none focus:border-primary"
                            />
                            <input
                              type="datetime-local"
                              value={editDueAt}
                              onChange={(e) => setEditDueAt(e.target.value)}
                              className="rounded border border-outline-variant bg-surface-lowest px-2 py-1 text-sm outline-none focus:border-primary"
                            />
                            <button onClick={() => void saveEdit(r)} className="rounded bg-primary px-2 py-1 text-xs text-on-primary">Save</button>
                            <button onClick={() => setEditingId(null)} className="rounded px-2 py-1 text-xs text-on-surface-variant">
                              <Icon name="close" className="text-[14px]" />
                            </button>
                          </div>
                        ) : (
                          <div>
                            <p
                              className={`text-base font-semibold leading-6 transition-colors ${
                                r.completed
                                  ? 'text-on-surface-variant line-through opacity-40'
                                  : 'text-on-surface group-hover:text-primary'
                              }`}
                            >
                              {r.title}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
                              <span className="flex items-center gap-1">
                                <Icon name="schedule" className="text-[14px]" />
                                {formatDue(r.dueAt)}
                              </span>
                              {r.linkedNoteId && noteTitles.has(r.linkedNoteId) && (
                                <Link
                                  to="/notes/$noteId"
                                  params={{ noteId: r.linkedNoteId }}
                                  className="flex items-center gap-1 hover:text-primary hover:underline"
                                >
                                  <Icon name="link" className="text-[14px]" />
                                  {noteTitles.get(r.linkedNoteId)}
                                </Link>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        aria-label="Edit reminder"
                        className="flex size-8 items-center justify-center rounded-lg text-outline transition hover:bg-surface-high hover:text-primary"
                      >
                        <Icon name="edit" className="text-[18px]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(r.id)}
                        aria-label="Delete reminder"
                        className="flex size-8 items-center justify-center rounded-lg text-outline transition hover:bg-surface-high hover:text-error"
                      >
                        <Icon name="delete" className="text-[18px]" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
