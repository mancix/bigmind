import type { AuthState } from '@bigmind/auth';
import type {
  ConflictEntityType,
  ConflictType,
} from '@bigmind/domain/conflicts';
import type {
  CategoryRecord,
  ConflictSnapshotRecord,
  NoteLinkRecord,
  NoteRecord,
  NotificationRecord,
  OutboxRecord,
  ReminderRecord,
  StorageAdapter,
  SyncRecord,
  TodoItemRecord,
} from '@bigmind/storage';
import type {
  PushOperationResult,
  RemoteChange,
  SyncError,
  SyncStatus,
} from './sync-types.js';
import type { SyncTransport } from './sync-transport.js';

const MAX_BACKOFF_MS = 60 * 60 * 1000;

type StatusListener = (status: SyncStatus) => void;

/** The outbox operations the engine performs, backed by any StorageAdapter. */
export interface SyncOutbox {
  get(operationId: string): Promise<OutboxRecord | undefined>;
  listPending(now?: Date): Promise<OutboxRecord[]>;
  listForEntity(
    entityId: string,
    entityType?: OutboxRecord['entityType'],
  ): Promise<OutboxRecord[]>;
  add(operation: OutboxRecord): Promise<void>;
  save(operation: OutboxRecord): Promise<void>;
  remove(operationId: string): Promise<void>;
  removeMany(operationIds: string[]): Promise<void>;
  markProcessing(operationIds: string[], startedAt?: Date): Promise<void>;
  markCompleted(operationId: string, remove?: boolean): Promise<void>;
  markFailed(
    operationId: string,
    error: SyncError,
    nextRetryAt?: Date,
  ): Promise<void>;
  incrementRetryCount(operationId: string): Promise<number>;
  resetStaleProcessing(now?: Date, staleAfterMs?: number): Promise<number>;
  countPending(): Promise<number>;
  transactionWithNotes<T>(callback: () => Promise<T>): Promise<T>;
  transactionWithNoteGraph<T>(callback: () => Promise<T>): Promise<T>;
  transactionWithCategories<T>(callback: () => Promise<T>): Promise<T>;
  transactionWithTodos<T>(callback: () => Promise<T>): Promise<T>;
  transactionWithEntities<T>(callback: () => Promise<T>): Promise<T>;
  transactionWithReminders<T>(callback: () => Promise<T>): Promise<T>;
  transactionWithNotesAndSyncState<T>(callback: () => Promise<T>): Promise<T>;
  transactionWithEntitiesAndSyncState<T>(
    callback: () => Promise<T>,
  ): Promise<T>;
}

/** Sync cursor persistence used by the engine. */
export interface SyncStateStore {
  getCursor(): Promise<string | undefined>;
  recordSuccessfulSync(cursor: string, timestamp: string): Promise<void>;
}

export interface ConflictCreateInput {
  entityType: ConflictEntityType;
  entityId: string;
  conflictType: ConflictType;
  localVersion: number;
  remoteVersion: number;
  localSnapshot: ConflictSnapshotRecord;
  remoteSnapshot: ConflictSnapshotRecord;
  baseVersion?: number;
  detectedAt?: string;
}

/** Where detected conflicts are persisted (web: ConflictRepository). */
export interface ConflictSink {
  create(input: ConflictCreateInput): Promise<unknown>;
}

export interface ConflictSnapshotBuilderInput<TEntity> {
  entityType: 'note' | 'category';
  entityId: string;
  localEntity: TEntity;
  remoteChange: RemoteChange;
  baseVersion: number;
}

export interface BuiltConflictSnapshots {
  conflictType: ConflictType;
  localVersion: number;
  remoteVersion: number;
  localSnapshot: ConflictSnapshotRecord;
  remoteSnapshot: ConflictSnapshotRecord;
  baseVersion: number;
}

/** All platform-dependent inputs of the engine, injected at construction. */
export interface SyncEngineDependencies {
  transport: SyncTransport;
  /** Entity tables + transactions (IndexedDB on web, SQLite on mobile). */
  storage: StorageAdapter;
  outbox: SyncOutbox;
  syncState: SyncStateStore;
  conflicts: ConflictSink;
  buildConflictSnapshots: (
    input: ConflictSnapshotBuilderInput<SyncRecord>,
  ) => BuiltConflictSnapshots;
  /** Current auth state (web/mobile AuthStore). */
  getAuthState: () => AuthState;
}

export interface SyncEngineOptions {
  now?: () => Date;
  isOnline?: () => boolean;
  backoffBaseMs?: number;
}

/**
 * Local-first push/pull synchronization engine.
 *
 * Platform independent: it depends only on {@link SyncEngineDependencies}
 * (transport, {@link StorageAdapter storage}, repositories, auth state) and
 * never touches `navigator`, `localStorage`, IndexedDB, or any mobile API.
 * Web and mobile wire the same engine with their own adapters.
 */
export class SyncEngine {
  private status: SyncStatus = 'idle';
  private activeSync?: Promise<void>;
  private readonly listeners = new Set<StatusListener>();
  private readonly now: () => Date;
  private readonly isOnline: () => boolean;
  private readonly backoffBaseMs: number;

  constructor(
    private readonly deps: SyncEngineDependencies,
    options: SyncEngineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.isOnline = options.isOnline ?? (() => true);
    this.backoffBaseMs = options.backoffBaseMs ?? 1_000;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setOnline(online: boolean): void {
    if (!online) {
      this.setStatus('offline');
    } else if (this.status === 'offline') {
      this.setStatus('idle');
    }
  }

  sync(): Promise<void> {
    if (this.activeSync) {
      return this.activeSync;
    }

    const sync = this.execute().finally(() => {
      this.activeSync = undefined;
    });
    this.activeSync = sync;
    return sync;
  }

  private async execute(): Promise<void> {
    if (!this.isOnline()) {
      this.setStatus('offline');
      return;
    }

    const authState = this.deps.getAuthState();
    if (authState === 'auth_required') {
      this.setStatus('auth_required');
      return;
    }

    this.setStatus('syncing');
    let processing: OutboxRecord[] = [];

    try {
      await this.deps.outbox.resetStaleProcessing(this.now());
      processing = await this.deps.outbox.listPending(this.now());

      if (processing.length > 0) {
        await this.deps.outbox.markProcessing(
          processing.map((operation) => operation.id),
          this.now(),
        );
        const results = await this.deps.transport.push(processing);
        await this.processPushResults(processing, results);
      }

      const cursor = await this.deps.syncState.getCursor();
      const pullResult = await this.deps.transport.pull(cursor);

      await this.applyPullResult(pullResult.changes, pullResult.cursor);
      this.setStatus('idle');
    } catch (error) {
      if (this.deps.getAuthState() === 'auth_required') {
        await this.failAuthOperations(processing);
        this.setStatus('auth_required');
        return;
      }
      await this.failStillProcessing(processing, error);
      this.setStatus(this.isOnline() ? 'error' : 'offline');
    }
  }

  private async processPushResults(
    operations: OutboxRecord[],
    results: PushOperationResult[],
  ): Promise<void> {
    const resultsById = new Map(
      results.map((result) => [result.operationId, result]),
    );

    for (const operation of operations) {
      const result = resultsById.get(operation.id);

      if (!result) {
        await this.failOperation(operation.id, {
          code: 'missing_push_result',
          message: 'The transport did not return a result for this operation.',
          retryable: true,
        });
      } else if (result.status === 'accepted') {
        await this.acceptOperation(operation, result.version);
      } else if (result.status === 'conflict') {
        await this.markConflict(operation, result);
      } else {
        await this.rejectOperation(operation, result.error);
      }
    }
  }

  private async acceptOperation(
    operation: OutboxRecord,
    version: number,
  ): Promise<void> {
    await this.deps.outbox.transactionWithEntities(async () => {
      const currentOperation = await this.deps.outbox.get(operation.id);

      if (!currentOperation) {
        return;
      }

      const table = this.tableFor(operation.entityType);
      const record = (await table.get(operation.entityId)) as
        SyncRecord | undefined;
      const otherOperations = (
        await this.deps.outbox.listForEntity(
          operation.entityId,
          operation.entityType,
        )
      )
        .filter((candidate) => candidate.id !== operation.id)
        .filter((candidate) => candidate.status !== 'completed');

      if (operation.operation === 'delete' && otherOperations.length === 0) {
        await table.delete(operation.entityId);
      } else if (record) {
        await table.put({
          ...record,
          version,
          syncStatus: otherOperations.length > 0 ? 'pending' : 'synced',
          conflict: undefined,
        } as never);

        for (const pendingOperation of otherOperations) {
          await this.deps.outbox.save({
            ...pendingOperation,
            baseVersion: version,
            payload: {
              ...pendingOperation.payload,
              version,
            },
          });
        }
      }

      await this.deps.outbox.markCompleted(operation.id);
    });
  }

  private async markConflict(
    operation: OutboxRecord,
    result: Extract<PushOperationResult, { status: 'conflict' }>,
  ): Promise<void> {
    if (
      operation.entityType === 'link' ||
      operation.entityType === 'todo_item' ||
      operation.entityType === 'reminder' ||
      operation.entityType === 'notification'
    ) {
      await this.deps.outbox.markFailed(operation.id, result.error);
      return;
    }

    if (!result.remoteChange) {
      await this.deps.outbox.markFailed(operation.id, result.error);
      return;
    }

    const entityType: 'note' | 'category' =
      operation.entityType === 'note' ? 'note' : 'category';
    const remoteChange = result.remoteChange;
    const entityId = operation.entityId;
    const baseVersion = operation.baseVersion;
    const markFailed = () =>
      this.deps.outbox.markFailed(operation.id, result.error);

    await this.deps.outbox.transactionWithEntities(async () => {
      const table =
        entityType === 'note'
          ? this.deps.storage.notes
          : this.deps.storage.categories;
      const record = (await table.get(entityId)) as SyncRecord | undefined;

      if (!record) {
        await markFailed();
        return;
      }

      await this.persistConflict(
        entityType,
        entityId,
        record,
        remoteChange,
        baseVersion,
      );

      await table.put({
        ...record,
        syncStatus: 'conflict' as const,
        conflict: undefined,
      } as never);
      await markFailed();
    });
  }

  private async rejectOperation(
    operation: OutboxRecord,
    error: SyncError,
  ): Promise<void> {
    await this.failOperation(operation.id, error);
  }

  private async failOperation(
    operationId: string,
    error: SyncError,
  ): Promise<void> {
    const retryCount = await this.deps.outbox.incrementRetryCount(operationId);
    const nextRetryAt = error.retryable
      ? new Date(
          this.now().getTime() +
            Math.min(
              this.backoffBaseMs * 2 ** Math.max(0, retryCount - 1),
              MAX_BACKOFF_MS,
            ),
        )
      : undefined;

    await this.deps.outbox.markFailed(operationId, error, nextRetryAt);
  }

  private async failStillProcessing(
    operations: OutboxRecord[],
    cause: unknown,
  ): Promise<void> {
    const error: SyncError = {
      code: 'transport_error',
      message:
        cause instanceof Error ? cause.message : 'Synchronization failed.',
      retryable: true,
    };

    for (const operation of operations) {
      if ((await this.deps.outbox.get(operation.id))?.status === 'processing') {
        await this.failOperation(operation.id, error);
      }
    }
  }

  private async failAuthOperations(operations: OutboxRecord[]): Promise<void> {
    const error: SyncError = {
      code: 'auth_required',
      message: 'Authentication required. Sync paused until re-login.',
      retryable: false,
    };

    for (const operation of operations) {
      if ((await this.deps.outbox.get(operation.id))?.status === 'processing') {
        await this.deps.outbox.markFailed(operation.id, error, undefined);
      }
    }
  }

  private async applyPullResult(
    changes: RemoteChange[],
    cursor: string,
  ): Promise<void> {
    await this.deps.outbox.transactionWithEntitiesAndSyncState(async () => {
      const order: Record<string, number> = {
        category: 0,
        note: 1,
        link: 2,
        todo_item: 3,
        reminder: 4,
        notification: 5,
      };
      const orderedChanges = [...changes].sort(
        (left, right) => order[left.entityType] - order[right.entityType],
      );
      for (const change of orderedChanges) {
        await this.applyRemoteChange(change);
      }

      await this.deps.syncState.recordSuccessfulSync(
        cursor,
        this.now().toISOString(),
      );
    });
  }

  private async applyRemoteChange(change: RemoteChange): Promise<void> {
    const table = this.tableFor(change.entityType);
    const existing = (await table.get(change.entityId)) as
      SyncRecord | undefined;
    const localOperations = (
      await this.deps.outbox.listForEntity(change.entityId, change.entityType)
    ).filter((operation) => operation.status !== 'completed');

    if (
      existing &&
      localOperations.length > 0 &&
      existing.syncStatus !== 'conflict' &&
      change.version <= existing.version
    ) {
      return;
    }

    if (
      change.entityType !== 'link' &&
      change.entityType !== 'todo_item' &&
      change.entityType !== 'reminder' &&
      change.entityType !== 'notification' &&
      existing &&
      (existing.syncStatus === 'conflict' || localOperations.length > 0)
    ) {
      await this.persistConflict(
        change.entityType,
        change.entityId,
        existing,
        change,
        existing.version,
      );
      await table.put({
        ...existing,
        syncStatus: 'conflict' as const,
        conflict: undefined,
      } as never);
      return;
    }

    if (change.operation === 'delete') {
      if (change.entityType === 'link') {
        await this.deps.storage.noteLinks.delete(change.entityId);
        return;
      }
      if (change.entityType === 'todo_item') {
        await this.deps.storage.todoItems.delete(change.entityId);
        return;
      }
      if (change.entityType === 'reminder') {
        await this.deps.storage.reminders.delete(change.entityId);
        return;
      }
      if (change.entityType === 'notification') {
        await this.deps.storage.notifications.delete(change.entityId);
        return;
      }
      if (existing && change.version >= existing.version) {
        await table.put({
          ...existing,
          deletedAt: change.changedAt,
          updatedAt: change.changedAt,
          version: change.version,
          syncStatus: 'synced',
          conflict: undefined,
        } as never);
      }
      return;
    }

    if (!isSyncRecord(change.entityType, change.payload)) {
      throw new Error(
        `Invalid remote ${change.entityType} payload for "${change.entityId}".`,
      );
    }

    if (!existing || change.version >= existing.version) {
      if (change.entityType === 'link') {
        const payload = change.payload as NoteLinkRecord;
        const target = await this.deps.storage.notes.get(
          payload.targetNoteId ?? '',
        );
        await this.deps.storage.noteLinks.put({
          ...payload,
          targetTitle:
            existing && 'targetTitle' in existing
              ? existing.targetTitle
              : (target?.title ?? ''),
          targetNoteId: payload.targetNoteId,
          version: change.version,
          syncStatus: 'synced',
        });
        return;
      }

      await table.put({
        ...change.payload,
        id: change.entityId,
        version: change.version,
        syncStatus: 'synced',
        conflict: undefined,
      } as never);
    }
  }

  private tableFor(entityType: OutboxRecord['entityType']) {
    return entityType === 'note'
      ? this.deps.storage.notes
      : entityType === 'category'
        ? this.deps.storage.categories
        : entityType === 'todo_item'
          ? this.deps.storage.todoItems
          : entityType === 'reminder'
            ? this.deps.storage.reminders
            : entityType === 'notification'
              ? this.deps.storage.notifications
              : this.deps.storage.noteLinks;
  }

  private async persistConflict(
    entityType: 'note' | 'category',
    entityId: string,
    localEntity: SyncRecord,
    remoteChange: RemoteChange,
    baseVersion: number,
  ): Promise<void> {
    const snapshots = this.deps.buildConflictSnapshots({
      entityType,
      entityId,
      localEntity,
      remoteChange,
      baseVersion,
    });

    await this.deps.conflicts.create({
      entityType,
      entityId,
      conflictType: snapshots.conflictType,
      localVersion: snapshots.localVersion,
      remoteVersion: snapshots.remoteVersion,
      localSnapshot: snapshots.localSnapshot,
      remoteSnapshot: snapshots.remoteSnapshot,
      baseVersion: snapshots.baseVersion,
      detectedAt: this.now().toISOString(),
    });
  }

  private setStatus(status: SyncStatus): void {
    if (this.status === status) {
      return;
    }

    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }
}

function isNoteRecord(value: unknown): value is NoteRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const note = value as Partial<NoteRecord>;
  return (
    typeof note.id === 'string' &&
    typeof note.title === 'string' &&
    typeof note.content === 'string' &&
    (note.categoryId === null || typeof note.categoryId === 'string') &&
    typeof note.createdAt === 'string' &&
    typeof note.updatedAt === 'string' &&
    typeof note.version === 'number'
  );
}

function isCategoryRecord(value: unknown): value is CategoryRecord {
  if (!value || typeof value !== 'object') return false;
  const category = value as Partial<CategoryRecord>;
  return (
    typeof category.id === 'string' &&
    typeof category.name === 'string' &&
    (category.icon === null || typeof category.icon === 'string') &&
    (category.parentId === null || typeof category.parentId === 'string') &&
    typeof category.position === 'number' &&
    typeof category.createdAt === 'string' &&
    typeof category.updatedAt === 'string' &&
    typeof category.version === 'number'
  );
}

function isTodoItemRecord(value: unknown): value is TodoItemRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TodoItemRecord>;
  return (
    typeof item.id === 'string' &&
    typeof item.todoListId === 'string' &&
    typeof item.text === 'string' &&
    typeof item.completed === 'boolean' &&
    typeof item.position === 'number' &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string' &&
    typeof item.version === 'number'
  );
}

function isReminderRecord(value: unknown): value is ReminderRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ReminderRecord>;
  return (
    typeof r.id === 'string' &&
    typeof r.title === 'string' &&
    typeof r.dueAt === 'string' &&
    typeof r.completed === 'boolean' &&
    typeof r.workspaceId === 'string' &&
    typeof r.createdAt === 'string' &&
    typeof r.updatedAt === 'string' &&
    typeof r.version === 'number'
  );
}

function isNotificationRecord(value: unknown): value is NotificationRecord {
  if (!value || typeof value !== 'object') return false;
  const n = value as Partial<NotificationRecord>;
  return (
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.type === 'string' &&
    typeof n.workspaceId === 'string' &&
    typeof n.read === 'boolean' &&
    typeof n.createdAt === 'string'
  );
}

function isNoteLinkRecord(value: unknown): value is NoteLinkRecord {
  if (!value || typeof value !== 'object') return false;
  const link = value as Partial<NoteLinkRecord>;
  return (
    typeof link.id === 'string' &&
    typeof link.sourceNoteId === 'string' &&
    typeof link.targetNoteId === 'string' &&
    typeof link.createdAt === 'string' &&
    typeof link.version === 'number'
  );
}

function isSyncRecord(
  entityType: RemoteChange['entityType'],
  value: unknown,
): value is SyncRecord {
  if (entityType === 'note') return isNoteRecord(value);
  if (entityType === 'category') return isCategoryRecord(value);
  if (entityType === 'todo_item') return isTodoItemRecord(value);
  if (entityType === 'reminder') return isReminderRecord(value);
  if (entityType === 'notification') return isNotificationRecord(value);
  return isNoteLinkRecord(value);
}
