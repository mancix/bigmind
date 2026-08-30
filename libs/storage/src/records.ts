import type { Category } from '@bigmind/domain/categories';
import type {
  ConflictEntityType,
  ConflictStatus,
  ConflictType,
} from '@bigmind/domain/conflicts';
import type { Note } from '@bigmind/domain/notes';
import type {
  RemoteChange,
  SyncEntityType,
  SyncError,
  SyncOperationType,
} from '@bigmind/domain/sync';

/**
 * Local storage records.
 *
 * Every entity persisted by the client (IndexedDB on web, SQLite on mobile)
 * is represented by a `Record` type that extends the shared domain model with
 * client-only metadata such as `syncStatus`, `version`, and `conflict`.
 *
 * These types were extracted from `apps/web/src/storage/database.ts` so that
 * the web (Dexie), mobile (SQLite), and any future platform share a single
 * source of truth for what is stored locally.
 */

export type SyncStatus = 'local' | 'synced' | 'pending' | 'conflict';

export interface NoteConflict {
  operationId?: string;
  baseVersion: number;
  localPayload: NoteRecord;
  remoteChange?: RemoteChange;
  detectedAt: string;
}

export interface NoteRecord extends Note {
  syncStatus: 'synced' | 'pending' | 'conflict';
  conflict?: NoteConflict;
}

export interface CategoryConflict {
  operationId?: string;
  baseVersion: number;
  localPayload: CategoryRecord;
  remoteChange?: RemoteChange;
  detectedAt: string;
}

export interface CategoryRecord extends Category {
  syncStatus: 'synced' | 'pending' | 'conflict';
  conflict?: CategoryConflict;
}

export interface NoteLinkRecord {
  id: string;
  sourceNoteId: string;
  targetNoteId: string | null;
  targetTitle: string;
  createdAt: string;
  deletedAt: string | null;
  version: number;
  syncStatus: 'local' | 'synced' | 'pending' | 'conflict';
}

export interface NoteAliasRecord {
  id: string;
  noteId: string;
  alias: string;
  normalizedAlias: string;
  createdAt: string;
}

export interface TodoItemRecord {
  id: string;
  todoListId: string;
  text: string;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface ReminderRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  dueAt: string;
  completed: boolean;
  createdBy: string;
  linkedNoteId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface NotificationRecord {
  id: string;
  workspaceId: string;
  type: 'reminder_due' | 'note_modified' | 'workspace_invitation';
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  version: number;
  syncStatus: 'synced' | 'pending' | 'conflict';
}

export type SyncRecord =
  | NoteRecord
  | CategoryRecord
  | NoteLinkRecord
  | TodoItemRecord
  | ReminderRecord
  | NotificationRecord;

export interface OutboxRecord {
  id: string;
  entityId: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  baseVersion: number;
  payload: SyncRecord;
  createdAt: string;
  retryCount: number;
  status: 'pending' | 'processing' | 'failed' | 'completed';
  lastError?: SyncError;
  nextRetryAt?: string;
  processingStartedAt?: string;
}

export interface SyncStateRecord {
  key: string;
  value: string;
}

export interface ConflictSnapshotRecord<TEntity = unknown> {
  version: number;
  entity: TEntity;
  changedAt?: string;
  operation?: 'create' | 'update' | 'delete' | 'none';
}

export interface ConflictRecord {
  id: string;
  entityType: ConflictEntityType;
  entityId: string;
  conflictType: ConflictType;
  localVersion: number;
  remoteVersion: number;
  localSnapshot: ConflictSnapshotRecord;
  remoteSnapshot: ConflictSnapshotRecord;
  baseVersion?: number;
  createdAt: string;
  resolvedAt?: string;
  status: ConflictStatus;
  resolution?:
    | 'keep_mine'
    | 'keep_remote'
    | 'merge_manually'
    | 'restore'
    | 'delete_mine'
    | 'dismiss';
}
