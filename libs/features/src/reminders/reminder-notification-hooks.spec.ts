import { describe, expect, it, vi } from 'vitest';
import { createInMemoryStorage, type ReminderRecord } from '@bigmind/storage';
import { OutboxRepository } from '@bigmind/sync';

import {
  RemindersRepository,
  type ReminderNotificationHooks,
} from './reminder-repository.js';
import { StaticWorkspaceContext } from '../workspace/workspace-context.js';

/**
 * Repository → notification-hook integration tests.
 *
 * The mobile app passes a {@link ReminderNotificationHooks} implementation
 * (its local notification coordinator) as the 4th constructor argument; the
 * web app passes nothing and is unaffected. These tests pin down the contract:
 * every mutation emits exactly the right hook AFTER the local write succeeds,
 * and persistence never depends on the hooks (a throwing hook is swallowed).
 */

function makeHooksHarness() {
  const storage = createInMemoryStorage();
  const outbox = new OutboxRepository(storage);
  const workspace = new StaticWorkspaceContext('ws-1');
  const hooks: ReminderNotificationHooks & {
    created: ReminderRecord[];
    updated: ReminderRecord[];
    deleted: ReminderRecord[];
  } = {
    created: [],
    updated: [],
    deleted: [],
    onReminderCreated: vi.fn(async (reminder: ReminderRecord) => {
      hooks.created.push(reminder);
    }),
    onReminderUpdated: vi.fn(async (reminder: ReminderRecord) => {
      hooks.updated.push(reminder);
    }),
    onReminderDeleted: vi.fn(async (reminder: ReminderRecord) => {
      hooks.deleted.push(reminder);
    }),
  };
  const repository = new RemindersRepository(storage, outbox, workspace, hooks);
  return { storage, outbox, hooks, repository };
}

function futureDue(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

describe('RemindersRepository notification hooks', () => {
  it('emits onReminderCreated after create persists', async () => {
    const { hooks, repository, storage } = makeHooksHarness();
    const dueAt = futureDue(2);

    const id = await repository.create({ title: 'Buy milk', dueAt });

    expect(hooks.created).toHaveLength(1);
    expect(hooks.created[0]).toMatchObject({ id, title: 'Buy milk', dueAt });
    // Persisted first: the hook receives the stored record.
    expect(await storage.reminders.get(id)).toEqual(hooks.created[0]);
    expect(hooks.updated).toHaveLength(0);
    expect(hooks.deleted).toHaveLength(0);
  });

  it('emits onReminderUpdated on edit (and on toggle, incl. completion)', async () => {
    const { hooks, repository } = makeHooksHarness();
    const id = await repository.create({ title: 'Before', dueAt: futureDue(2) });

    await repository.update(id, { title: 'After', dueAt: futureDue(4) });
    expect(hooks.updated).toHaveLength(1);
    expect(hooks.updated[0]).toMatchObject({ id, title: 'After' });

    await repository.toggle(id);
    expect(hooks.updated).toHaveLength(2);
    expect(hooks.updated[1]).toMatchObject({ id, completed: true });
  });

  it('emits onReminderDeleted on remove (tombstone path)', async () => {
    const { storage, outbox, hooks, repository } = makeHooksHarness();
    // Seed a synced reminder (create already pushed) so remove() takes the
    // tombstone path instead of coalescing the pending create away.
    const id = 'synced-reminder-1';
    const dueAt = futureDue(1);
    await storage.reminders.add({
      id,
      workspaceId: 'ws-1',
      title: 'Ghost',
      description: '',
      dueAt,
      completed: false,
      createdBy: '',
      linkedNoteId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      syncStatus: 'synced',
    });

    await repository.remove(id);

    expect(hooks.deleted).toHaveLength(1);
    expect(hooks.deleted[0]).toMatchObject({ id, title: 'Ghost' });
    // Tombstone path: the record still exists locally (pending delete op).
    expect(await storage.reminders.get(id)).toMatchObject({
      id,
      syncStatus: 'pending',
    });
    expect(await outbox.listForEntity(id, 'reminder')).toHaveLength(1);
  });

  it('emits onReminderDeleted when the delete coalesces a pending create', async () => {
    const { hooks, repository, storage } = makeHooksHarness();
    const id = await repository.create({ title: 'Oops', dueAt: futureDue(1) });

    await repository.remove(id);

    // Coalesced path: the record is gone entirely…
    expect(await storage.reminders.get(id)).toBeUndefined();
    // …but the delete hook still fires with the pre-delete record.
    expect(hooks.deleted).toHaveLength(1);
    expect(hooks.deleted[0]).toMatchObject({ id, title: 'Oops' });
  });

  it('never breaks persistence when a hook throws', async () => {
    const storage = createInMemoryStorage();
    const outbox = new OutboxRepository(storage);
    const workspace = new StaticWorkspaceContext('ws-1');
    const hooks: ReminderNotificationHooks = {
      onReminderCreated: vi.fn(async () => {
        throw new Error('native scheduler exploded');
      }),
    };
    const repository = new RemindersRepository(storage, outbox, workspace, hooks);

    const id = await repository.create({ title: 'Still saved', dueAt: futureDue(2) });

    expect(await storage.reminders.get(id)).toMatchObject({ title: 'Still saved' });
  });
});