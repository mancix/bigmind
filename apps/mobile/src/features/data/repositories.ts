import {
  CategoryRepository,
  LinkRepository,
  NoteRepository,
  TodoRepository,
} from '@bigmind/features';
import { OutboxRepository, SyncStateRepository } from '@bigmind/sync';

import { storage } from '../../storage';

/**
 * Mobile data wiring: the SHARED repositories (from `@bigmind/features`) and
 * the shared outbox/sync-state repositories, all backed by the mobile storage
 * adapter (in-memory placeholder; SQLite next). Sync engine, notes,
 * categories, links, and todos all operate on these singletons so the outbox
 * stays consistent.
 */
export const mobileOutbox = new OutboxRepository(storage);
export const mobileSyncState = new SyncStateRepository(storage);
export const noteRepository = new NoteRepository(storage, mobileOutbox);
export const categoryRepository = new CategoryRepository(storage, mobileOutbox);
export const linkRepository = new LinkRepository(storage, mobileOutbox);
export const todoRepository = new TodoRepository(storage, mobileOutbox);

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
