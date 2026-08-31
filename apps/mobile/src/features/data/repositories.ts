import {
  CategoryRepository,
  ConflictRepository,
  LinkRepository,
  NoteRepository,
  NotificationsRepository,
  RemindersRepository,
  TodoRepository,
  type WorkspaceContext,
} from '@bigmind/features';
import { OutboxRepository, SyncStateRepository } from '@bigmind/sync';

import { storage } from '../../storage';
import { getCachedWorkspaceId } from '../workspaces/workspace-store';

/**
 * Mobile workspace context: the "current workspace" id comes from the
 * in-memory cache hydrated from AsyncStorage (see `ensure-workspace.ts`).
 * The shared repositories never touch AsyncStorage themselves.
 */
const mobileWorkspaceContext: WorkspaceContext = {
  getWorkspaceId: getCachedWorkspaceId,
};

/**
 * Mobile data wiring: the SHARED repositories (from `@bigmind/features`) and
 * the shared outbox/sync-state repositories, all backed by the mobile storage
 * adapter (SQLite via the storage provider; memory in tests). Sync engine,
 * notes, categories, links, todos, reminders, notifications, and conflicts all
 * operate on these singletons so the outbox stays consistent.
 */
export const mobileOutbox = new OutboxRepository(storage);
export const mobileSyncState = new SyncStateRepository(storage);
export const noteRepository = new NoteRepository(storage, mobileOutbox);
export const categoryRepository = new CategoryRepository(storage, mobileOutbox);
export const linkRepository = new LinkRepository(storage, mobileOutbox);
export const todoRepository = new TodoRepository(storage, mobileOutbox);
export const remindersRepository = new RemindersRepository(
  storage,
  mobileOutbox,
  mobileWorkspaceContext,
);
export const notificationsRepository = new NotificationsRepository(
  storage,
  mobileOutbox,
  mobileWorkspaceContext,
);
export const conflictRepository = new ConflictRepository(
  storage,
  mobileOutbox,
);

/**
 * Tiny change bus: screens subscribe so they refresh after a sync pass pulls
 * server changes into the local storage (see SyncActivator).
 */
const dataChangeListeners = new Set<() => void>();

export function subscribeToDataChanges(listener: () => void): () => void {
  dataChangeListeners.add(listener);
  return () => dataChangeListeners.delete(listener);
}

export function notifyDataChanged(): void {
  for (const listener of dataChangeListeners) {
    listener();
  }
}