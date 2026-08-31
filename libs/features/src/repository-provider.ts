import type { StorageAdapter } from '@bigmind/storage';
import type { SyncOutbox } from '@bigmind/sync';

import { CategoryRepository } from './categories/category-repository.js';
import { ConflictRepository } from './conflicts/conflict-repository.js';
import { LinkRepository } from './links/link-repository.js';
import { NoteRepository } from './notes/note-repository.js';
import { NotificationsRepository } from './notifications/notification-repository.js';
import { RemindersRepository } from './reminders/reminder-repository.js';
import { TodoRepository } from './todos/todo-repository.js';
import {
  nullWorkspaceContext,
  type WorkspaceContext,
} from './workspace/workspace-context.js';

/**
 * All repositories exposed by `@bigmind/features`, pre-wired with the
 * injected {@link StorageAdapter} + {@link SyncOutbox}.
 */
export interface RepositoryProvider {
  notes: NoteRepository;
  categories: CategoryRepository;
  links: LinkRepository;
  todos: TodoRepository;
  reminders: RemindersRepository;
  notifications: NotificationsRepository;
  conflicts: ConflictRepository;
}

export interface CreateRepositoryProviderOptions {
  /**
   * Source of the currently selected workspace id (web: localStorage,
   * mobile: AsyncStorage-backed cache). Defaults to "no workspace" —
   * records are created/queried with an empty workspace id.
   */
  workspace?: WorkspaceContext;
}

/**
 * Dependency-injection entry point: build every repository from a storage
 * adapter and an outbox once, at application bootstrap.
 *
 * Platforms wire their own adapter:
 * - Web: `DexieStorageAdapter` (apps/web/src/storage/dexie-storage-adapter.ts)
 * - Mobile: `SqliteStorageAdapter` (libs/storage, expo-sqlite driver)
 * - Tests: `MemoryStorageAdapter` / SQLite via `node:sqlite`.
 *
 * Switching storage implementations (or adding a desktop/embedded platform)
 * requires changing ONLY this call — the repository implementations stay
 * untouched.
 */
export function createRepositoryProvider(
  storage: StorageAdapter,
  outbox: SyncOutbox,
  options: CreateRepositoryProviderOptions = {},
): RepositoryProvider {
  const workspace = options.workspace ?? nullWorkspaceContext;
  const links = new LinkRepository(storage, outbox);

  return {
    notes: new NoteRepository(storage, outbox, links),
    categories: new CategoryRepository(storage, outbox),
    links,
    todos: new TodoRepository(storage, outbox),
    reminders: new RemindersRepository(storage, outbox, workspace),
    notifications: new NotificationsRepository(storage, outbox, workspace),
    conflicts: new ConflictRepository(storage, outbox),
  };
}