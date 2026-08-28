// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../storage/database';
import { notificationsRepository } from './notifications-repository';

describe('NotificationsRepository', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    localStorage.setItem('bigmind_workspace_id', 'ws-1');
  });

  afterEach(async () => {
    await db.delete();
  });

  it('creates a notification locally', async () => {
    const id = await notificationsRepository.createLocal({
      type: 'reminder_due',
      title: 'Task due',
      body: 'Your task is due now',
    });
    const n = await db.notifications.get(id);
    expect(n).toBeDefined();
    expect(n!.title).toBe('Task due');
    expect(n!.read).toBe(false);
  });

  it('counts unread notifications', async () => {
    await notificationsRepository.createLocal({ type: 'note_modified', title: 'Note changed' });
    await notificationsRepository.createLocal({ type: 'workspace_invitation', title: 'Invite' });
    const unread = await notificationsRepository.countUnread();
    expect(unread).toBe(2);
  });

  it('marks a notification as read', async () => {
    const id = await notificationsRepository.createLocal({ type: 'reminder_due', title: 'Read me' });
    await notificationsRepository.markRead(id);
    const n = await db.notifications.get(id);
    expect(n!.read).toBe(true);
    expect(await notificationsRepository.countUnread()).toBe(0);
  });

  it('removes a notification', async () => {
    const id = await notificationsRepository.createLocal({ type: 'note_modified', title: 'Delete me' });
    await notificationsRepository.remove(id);
    const n = await db.notifications.get(id);
    expect(n).toBeUndefined();
  });
});
