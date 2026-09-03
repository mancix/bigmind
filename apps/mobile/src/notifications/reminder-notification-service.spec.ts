import {
  RemindersRepository,
  StaticWorkspaceContext,
} from '@bigmind/features';
import {
  createInMemoryStorage,
  type ReminderRecord,
} from '@bigmind/storage';
import { OutboxRepository } from '@bigmind/sync';

import {
  buildReconcilePlan,
  ReminderNotificationService,
  shouldScheduleReminderNotification,
} from './reminder-notification-service';
import {
  MemoryNotificationScheduler,
  type ScheduledReminderNotification,
} from './notification-scheduler';

/**
 * Offline local notification tests for the reminder → notification pipeline:
 *
 *   RemindersRepository (shared) → ReminderNotificationService (policy)
 *     → MemoryNotificationScheduler (platform abstraction double)
 *
 * The scheduler is the in-memory double of the native expo-notifications
 * scheduler, so the four required behaviors are deterministic — schedule
 * (create), reschedule (update), cancel (delete), completion — plus
 * sync-pull reconciliation. Everything runs against the local in-memory
 * storage: zero network, proving the offline-first guarantee.
 */

function futureDue(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function pastDue(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function createHarness(workspaceId = 'ws-1') {
  const storage = createInMemoryStorage();
  const outbox = new OutboxRepository(storage);
  const workspace = new StaticWorkspaceContext(workspaceId);
  const scheduler = new MemoryNotificationScheduler();
  const service = new ReminderNotificationService(scheduler);
  const repository = new RemindersRepository(
    storage,
    outbox,
    workspace,
    service,
  );
  return { storage, outbox, scheduler, service, repository };
}

async function scheduledFor(
  scheduler: MemoryNotificationScheduler,
  reminderId: string,
): Promise<ScheduledReminderNotification | undefined> {
  const scheduled = await scheduler.listScheduled();
  return scheduled.find((entry) => entry.reminderId === reminderId);
}

/** Minimal record for directly seeding the scheduler / storage. */
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 0,
    syncStatus: 'pending',
    ...overrides,
  };
}

describe('reminder local notifications (offline)', () => {
  it('schedules a local notification when a reminder is created', async () => {
    const { repository, scheduler } = createHarness();
    const dueAt = futureDue(2);
    const id = await repository.create({
      title: 'Standup',
      description: 'Bring the sprint board',
      dueAt,
    });

    const scheduled = await scheduledFor(scheduler, id);
    expect(scheduled).toMatchObject({
      reminderId: id,
      dueAt,
      title: 'Standup',
    });
    expect(await scheduler.listScheduled()).toHaveLength(1);
  });

  it('skips scheduling for past-due or already-completed reminders', () => {
    expect(
      shouldScheduleReminderNotification(makeReminder({ id: 'r1', dueAt: pastDue(1) })),
    ).toBe(false);
    expect(
      shouldScheduleReminderNotification(
        makeReminder({ id: 'r2', dueAt: futureDue(1), completed: true }),
      ),
    ).toBe(false);
    expect(
      shouldScheduleReminderNotification(
        makeReminder({ id: 'r3', dueAt: futureDue(1) }),
      ),
    ).toBe(true);
  });

  it('reschedules the notification when the due time changes (no duplicates)', async () => {
    const { repository, scheduler } = createHarness();
    const initialDue = futureDue(24);
    const id = await repository.create({
      title: 'Pay rent',
      dueAt: initialDue,
    });
    expect((await scheduledFor(scheduler, id))?.dueAt).toBe(initialDue);

    const movedDue = futureDue(48);
    await repository.update(id, { dueAt: movedDue });

    // Same reminder id → the native scheduler replaces the pending
    // notification in place: exactly one entry with the new fire time.
    const scheduled = await scheduler.listScheduled();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({ reminderId: id, dueAt: movedDue });
  });

  it('keeps the notification when editing fields that do not change the due time', async () => {
    const { repository, scheduler } = createHarness();
    const dueAt = futureDue(3);
    const id = await repository.create({ title: 'Draft report', dueAt });
    await repository.update(id, {
      title: 'Final report',
      description: 'v2',
    });

    const scheduled = await scheduler.listScheduled();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({ reminderId: id, dueAt });
  });

  it('cancels the notification when the reminder is completed', async () => {
    const { repository, scheduler } = createHarness();
    const id = await repository.create({
      title: 'Call dentist',
      dueAt: futureDue(5),
    });
    expect(await scheduledFor(scheduler, id)).toBeTruthy();

    await repository.toggle(id); // completed: true (shared repository)

    expect(await scheduledFor(scheduler, id)).toBeUndefined();
    expect(await scheduler.listScheduled()).toHaveLength(0);
  });

  it('reschedules the notification when a completed reminder is reopened', async () => {
    const { repository, scheduler } = createHarness();
    const dueAt = futureDue(6);
    const id = await repository.create({ title: 'Review PR', dueAt });

    await repository.toggle(id); // complete → cancel
    expect(await scheduledFor(scheduler, id)).toBeUndefined();

    await repository.toggle(id); // reopen → schedule again
    expect(await scheduledFor(scheduler, id)).toMatchObject({ dueAt });
  });

  it('cancels the notification when the reminder is deleted', async () => {
    const { repository, scheduler } = createHarness();
    const id = await repository.create({ title: 'Disposable', dueAt: futureDue(1) });
    expect(await scheduledFor(scheduler, id)).toBeTruthy();

    await repository.remove(id);

    expect(await scheduledFor(scheduler, id)).toBeUndefined();
    expect(await scheduler.listScheduled()).toHaveLength(0);
  });

  it('cancels the notification when a just-created reminder is deleted (coalesced delete)', async () => {
    const { storage, outbox, scheduler, repository } = createHarness();
    const id = await repository.create({ title: 'Oops', dueAt: futureDue(2) });
    expect(await scheduledFor(scheduler, id)).toBeTruthy();

    await repository.remove(id);

    // The create is still pending in the outbox, so the delete coalesces it
    // away — the notification must be canceled regardless of that path.
    expect(await storage.reminders.get(id)).toBeUndefined();
    expect(await outbox.listForEntity(id, 'reminder')).toHaveLength(0);
    expect(await scheduledFor(scheduler, id)).toBeUndefined();
  });

  it('reconciles after a sync pull: reschedules changed due times and cancels stale/absent reminders', async () => {
    const { storage, scheduler, repository, service } = createHarness();

    // An unchanged reminder: already scheduled, reconcile leaves it alone.
    const keepDue = futureDue(4);
    const keep = await repository.create({ title: 'Keep', dueAt: keepDue });

    // A reminder whose due time changed on another device: the sync engine
    // writes directly to storage (no repository hooks), so the OS entry still
    // carries the OLD fire time → reconcile must reschedule it.
    const changedId = await repository.create({
      title: 'Moved remotely',
      dueAt: futureDue(12),
    });
    const changed = (await repository.findById(changedId))!;
    const changedDue = futureDue(3);
    await storage.reminders.put({ ...changed, dueAt: changedDue });

    // A stale OS notification for a reminder deleted on another device.
    await scheduler.schedule(
      makeReminder({ id: 'remote-deleted', dueAt: futureDue(2) }),
    );

    // A reminder completed on another device (pulled with completed=true).
    const remoteDone = makeReminder({ id: 'remote-done', dueAt: futureDue(9), completed: true });
    await storage.reminders.put(remoteDone);
    await scheduler.schedule({ ...remoteDone, completed: false });

    await service.reconcile(await repository.list());

    const scheduled = await scheduler.listScheduled();
    expect(scheduled).toEqual([
      expect.objectContaining({ reminderId: keep, dueAt: keepDue }),
      expect.objectContaining({ reminderId: changedId, dueAt: changedDue }),
    ]);
    expect(scheduled).toHaveLength(2);
    expect(await scheduledFor(scheduler, 'remote-deleted')).toBeUndefined();
    expect(await scheduledFor(scheduler, 'remote-done')).toBeUndefined();
  });

  it('is idempotent: reconciling an already-correct state changes nothing', async () => {
    const { repository, scheduler, service } = createHarness();
    const id = await repository.create({ title: 'Stable', dueAt: futureDue(8) });
    const before = await scheduler.listScheduled();

    await service.reconcile(await repository.list());

    expect(await scheduler.listScheduled()).toEqual(before);
    expect(await scheduledFor(scheduler, id)).toBeTruthy();
  });

  it('keeps everything local: repository mutations never hit the network', async () => {
    const { repository, scheduler, storage } = createHarness();
    const id = await repository.create({ title: 'Bus reminder', dueAt: futureDue(1) });
    await repository.update(id, { title: 'Bus reminder v2' });
    await repository.toggle(id);

    // Data + scheduled-notification state live entirely on-device.
    expect(await storage.reminders.get(id)).toMatchObject({
      title: 'Bus reminder v2',
      completed: true,
    });
    expect(await scheduler.listScheduled()).toHaveLength(0);
  });
});

describe('reminder notification policy helpers', () => {
  it('builds an idempotent reconcile plan (no duplicate schedules)', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const later = '2026-01-02T12:00:00.000Z';
    const reminder = makeReminder({ id: 'a', title: 'A', dueAt: later });
    const scheduled: ScheduledReminderNotification[] = [
      { reminderId: 'a', dueAt: later, title: 'A' },
    ];

    const plan = buildReconcilePlan([reminder], scheduled, now);
    expect(plan.toSchedule).toEqual([]);
    expect(plan.toCancel).toEqual([]);

    // Changed due time → reschedule only that one.
    const changed = buildReconcilePlan(
      [{ ...reminder, dueAt: '2026-01-03T12:00:00.000Z' }],
      scheduled,
      now,
    );
    expect(changed.toSchedule.map((r) => r.id)).toEqual(['a']);
    expect(changed.toCancel).toEqual([]);

    // Completed/deleted/no-longer-desired → cancel.
    const stale = buildReconcilePlan(
      [],
      [{ reminderId: 'ghost', dueAt: later, title: 'Ghost' }],
      now,
    );
    expect(stale.toCancel).toEqual(['ghost']);
  });
});