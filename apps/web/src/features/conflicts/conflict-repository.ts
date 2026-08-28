import type {
  ConflictEntityType,
  ConflictSnapshot,
  ConflictType,
} from '@bigmind/domain/conflicts';
import { wouldCreateCategoryCycle } from '@bigmind/domain/categories';

import {
  db,
  type CategoryRecord,
  type ConflictRecord,
  type ConflictSnapshotRecord,
  type NoteLinkRecord,
  type NoteRecord,
} from '../../storage/database';
import {
  OutboxRepository,
  outboxRepository,
} from '../../sync/outbox-repository';
import { requestBackgroundSync } from '../../sync/background-sync';

export type ConflictResolutionStrategy =
  | 'keep_mine'
  | 'keep_remote'
  | 'merge_manually'
  | 'restore'
  | 'delete_mine';

export interface CreateConflictInput {
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

export class ConflictRepositoryError extends Error {
  constructor(
    readonly code:
      | 'CONFLICT_NOT_FOUND'
      | 'ENTITY_NOT_FOUND'
      | 'CATEGORY_CYCLE'
      | 'INVALID_RESOLUTION',
    message: string,
  ) {
    super(message);
    this.name = 'ConflictRepositoryError';
  }
}

type ConflictListener = (conflict: ConflictRecord) => void;

const conflictListeners = new Set<ConflictListener>();

export function subscribeToConflictCreations(
  listener: ConflictListener,
): () => void {
  conflictListeners.add(listener);
  return () => conflictListeners.delete(listener);
}

function notifyConflictCreated(conflict: ConflictRecord): void {
  for (const listener of conflictListeners) listener(conflict);
}

export class ConflictRepository {
  constructor(
    private readonly outbox: OutboxRepository = outboxRepository,
  ) {}

  async listOpen(): Promise<ConflictRecord[]> {
    const conflicts = await db.conflicts
      .where('status')
      .equals('open')
      .toArray();
    return conflicts.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  async listResolved(): Promise<ConflictRecord[]> {
    const conflicts = await db.conflicts
      .where('status')
      .anyOf('resolved', 'dismissed')
      .toArray();
    return conflicts.sort((left, right) =>
      right.resolvedAt?.localeCompare(left.resolvedAt ?? '') ?? 0,
    );
  }

  async listDismissed(): Promise<ConflictRecord[]> {
    return db.conflicts.where('status').equals('dismissed').toArray();
  }

  async find(id: string): Promise<ConflictRecord | undefined> {
    return db.conflicts.get(id);
  }

  async countOpen(): Promise<number> {
    return db.conflicts.where('status').equals('open').count();
  }

  async create(input: CreateConflictInput): Promise<string> {
    const existing = await this.findOpenForEntity(
      input.entityType,
      input.entityId,
    );

    if (existing) {
      const merged: ConflictRecord = {
        ...existing,
        conflictType: input.conflictType,
        localVersion: input.localVersion,
        remoteVersion: input.remoteVersion,
        localSnapshot: input.localSnapshot,
        remoteSnapshot: input.remoteSnapshot,
        baseVersion: input.baseVersion ?? existing.baseVersion,
        status: 'open',
        resolvedAt: undefined,
      };
      await db.conflicts.put(merged);
      notifyConflictCreated(merged);
      return merged.id;
    }

    const id = crypto.randomUUID();
    const createdAt = input.detectedAt ?? new Date().toISOString();
    const conflict: ConflictRecord = {
      id,
      entityType: input.entityType,
      entityId: input.entityId,
      conflictType: input.conflictType,
      localVersion: input.localVersion,
      remoteVersion: input.remoteVersion,
      localSnapshot: input.localSnapshot,
      remoteSnapshot: input.remoteSnapshot,
      baseVersion: input.baseVersion,
      createdAt,
      status: 'open',
    };

    await db.conflicts.add(conflict);
    notifyConflictCreated(conflict);
    return id;
  }

  async dismiss(id: string): Promise<void> {
    const resolvedAt = new Date().toISOString();
    await db.conflicts.update(id, {
      status: 'dismissed',
      resolvedAt,
      resolution: 'dismiss',
    });
    await this.clearEntityConflictFlag(id);
  }

  async resolve(
    id: string,
    strategy: ConflictResolutionStrategy,
    mergedEntity?: unknown,
  ): Promise<void> {
    switch (strategy) {
      case 'keep_mine':
        await this.resolveKeepMine(id);
        return;
      case 'keep_remote':
        await this.resolveKeepRemote(id);
        return;
      case 'merge_manually':
        await this.resolveMergeManually(id, mergedEntity);
        return;
      case 'restore':
        await this.resolveRestore(id);
        return;
      case 'delete_mine':
        await this.resolveDeleteMine(id);
        return;
      default:
        throw new ConflictRepositoryError(
          'INVALID_RESOLUTION',
          `Unsupported resolution strategy "${String(strategy)}".`,
        );
    }
  }

  async resolveKeepMine(id: string): Promise<void> {
    const conflict = await this.requireConflict(id);

    if (conflict.entityType === 'link') {
      await this.requeueLinkOperation(conflict, 'keep_mine');
      await this.markResolved(id, 'keep_mine');
      return;
    }

    await this.requeueEntityAsPendingUpdate(
      conflict.entityType,
      conflict.entityId,
      conflict.remoteVersion,
    );
    await this.clearEntityConflictFlag(id);
    await this.markResolved(id, 'keep_mine');
    requestBackgroundSync();
  }

  async resolveKeepRemote(id: string): Promise<void> {
    const conflict = await this.requireConflict(id);

    if (conflict.entityType === 'note') {
      await this.applyRemoteNoteSnapshot(conflict);
    } else if (conflict.entityType === 'category') {
      await this.applyRemoteCategorySnapshot(conflict);
    } else {
      await this.applyRemoteLinkSnapshot(conflict);
    }

    await this.clearEntityConflictFlag(id);
    await this.markResolved(id, 'keep_remote');
    requestBackgroundSync();
  }

  async resolveMergeManually(id: string, mergedEntity: unknown): Promise<void> {
    const conflict = await this.requireConflict(id);

    if (conflict.entityType !== 'note') {
      throw new ConflictRepositoryError(
        'INVALID_RESOLUTION',
        'Manual merge is only supported for note conflicts.',
      );
    }

    const existing = await db.notes.get(conflict.entityId);
    if (!existing || existing.deletedAt) {
      throw new ConflictRepositoryError(
        'ENTITY_NOT_FOUND',
        'The conflicted note is no longer available locally.',
      );
    }

    const merged =
      typeof mergedEntity === 'object' && mergedEntity !== null
        ? (mergedEntity as Partial<NoteRecord>)
        : {};

    const updatedAt = new Date().toISOString();
    const mergedNote: NoteRecord = {
      ...existing,
      ...merged,
      id: existing.id,
      createdAt: existing.createdAt,
      version: conflict.remoteVersion,
      updatedAt,
      syncStatus: 'pending',
      conflict: undefined,
    };

    await db.notes.put(mergedNote);
    await this.requeueOperationForEntity(
      'note',
      conflict.entityId,
      conflict.remoteVersion,
      mergedNote,
    );
    await this.clearEntityConflictFlag(id);
    await this.markResolved(id, 'merge_manually', mergedEntity);
    requestBackgroundSync();
  }

  async resolveRestore(id: string): Promise<void> {
    const conflict = await this.requireConflict(id);

    if (conflict.entityType !== 'note') {
      throw new ConflictRepositoryError(
        'INVALID_RESOLUTION',
        'Restore is only available for notes with a delete-vs-edit conflict.',
      );
    }

    const existing = await db.notes.get(conflict.entityId);
    if (!existing) {
      throw new ConflictRepositoryError(
        'ENTITY_NOT_FOUND',
        'The conflicted note is no longer available locally.',
      );
    }

    const restored: NoteRecord = {
      ...existing,
      deletedAt: undefined,
      version: conflict.localVersion,
      syncStatus: 'pending',
      conflict: undefined,
    };

    await db.notes.put(restored);
    await this.requeueOperationForEntity(
      'note',
      conflict.entityId,
      conflict.remoteVersion,
      restored,
    );
    await this.clearEntityConflictFlag(id);
    await this.markResolved(id, 'restore');
    requestBackgroundSync();
  }

  async resolveDeleteMine(id: string): Promise<void> {
    const conflict = await this.requireConflict(id);

    if (conflict.entityType === 'note') {
      await this.acceptRemoteNoteDeletion(conflict);
    } else if (conflict.entityType === 'category') {
      await this.acceptRemoteCategoryDeletion(conflict);
    } else {
      await db.noteLinks.delete(conflict.entityId);
      await this.outbox.removeMany(
        (await this.outbox.listForEntity(conflict.entityId, 'link')).map(
          (operation) => operation.id,
        ),
      );
    }

    await this.clearEntityConflictFlag(id);
    await this.markResolved(id, 'delete_mine');
    requestBackgroundSync();
  }

  private async requireConflict(id: string): Promise<ConflictRecord> {
    const conflict = await db.conflicts.get(id);

    if (!conflict) {
      throw new ConflictRepositoryError(
        'CONFLICT_NOT_FOUND',
        'The conflict does not exist.',
      );
    }

    return conflict;
  }

  private async findOpenForEntity(
    entityType: ConflictEntityType,
    entityId: string,
  ): Promise<ConflictRecord | undefined> {
    return db.conflicts
      .where('entityId')
      .equals(entityId)
      .filter(
        (conflict) =>
          conflict.entityType === entityType && conflict.status === 'open',
      )
      .first();
  }

  private async markResolved(
    id: string,
    resolution: ConflictResolutionStrategy,
    mergedEntity?: unknown,
  ): Promise<void> {
    const conflict = await db.conflicts.get(id);
    if (!conflict) return;

    const resolvedAt = new Date().toISOString();
    const mergedSnapshot =
      mergedEntity !== undefined
        ? {
            version: conflict.localVersion,
            entity: mergedEntity as unknown,
          }
        : undefined;

    await db.conflicts.put({
      ...conflict,
      status: 'resolved',
      resolvedAt,
      resolution,
      ...(mergedSnapshot
        ? {
            localSnapshot: mergedSnapshot,
          }
        : {}),
    });
  }

  private async clearEntityConflictFlag(conflictId: string): Promise<void> {
    const conflict = await db.conflicts.get(conflictId);
    if (!conflict) return;

    if (conflict.entityType === 'note') {
      const note = await db.notes.get(conflict.entityId);
      if (note && note.syncStatus === 'conflict') {
        await db.notes.update(conflict.entityId, { conflict: undefined });
      }
    } else if (conflict.entityType === 'category') {
      const category = await db.categories.get(conflict.entityId);
      if (category && category.syncStatus === 'conflict') {
        await db.categories.update(conflict.entityId, { conflict: undefined });
      }
    }
  }

  private async requeueEntityAsPendingUpdate(
    entityType: ConflictEntityType,
    entityId: string,
    baseVersion: number,
  ): Promise<void> {
    if (entityType !== 'note' && entityType !== 'category') return;

    const record =
      entityType === 'note'
        ? await db.notes.get(entityId)
        : await db.categories.get(entityId);

    if (!record) return;

    const pendingRecord = {
      ...record,
      syncStatus: 'pending' as const,
      conflict: undefined,
    };
    await (entityType === 'note'
      ? db.notes.put(pendingRecord as NoteRecord)
      : db.categories.put(pendingRecord as CategoryRecord));
    await this.requeueOperationForEntity(
      entityType,
      entityId,
      baseVersion,
      pendingRecord,
    );
  }

  private async requeueOperationForEntity(
    entityType: 'note' | 'category',
    entityId: string,
    baseVersion: number,
    payload: NoteRecord | CategoryRecord,
  ): Promise<void> {
    const operations = (await this.outbox.listForEntity(entityId, entityType))
      .filter(
        (operation) =>
          operation.status === 'pending' ||
          operation.status === 'failed' ||
          operation.status === 'processing',
      )
      .filter(
        (operation) =>
          operation.operation === 'update' ||
          operation.operation === 'create' ||
          operation.operation === 'delete',
      );

    const existing = operations[0];

    if (existing) {
      await this.outbox.save({
        ...existing,
        operation: existing.operation === 'delete' ? 'update' : existing.operation,
        payload,
        baseVersion,
        retryCount: 0,
        status: 'pending',
        lastError: undefined,
        nextRetryAt: undefined,
        processingStartedAt: undefined,
      });
      await this.outbox.removeMany(
        operations.slice(1).map((operation) => operation.id),
      );
      return;
    }

    const timestamp = new Date().toISOString();
    await this.outbox.add({
      id: crypto.randomUUID(),
      entityId,
      entityType,
      operation: 'update',
      baseVersion,
      payload,
      createdAt: timestamp,
      retryCount: 0,
      status: 'pending',
    });
  }

  private async requeueLinkOperation(
    conflict: ConflictRecord,
    _strategy: ConflictResolutionStrategy,
  ): Promise<void> {
    const link = await db.noteLinks.get(conflict.entityId);
    if (!link) return;

    const operations = await this.outbox.listForEntity(conflict.entityId, 'link');
    const reusable = operations.find(
      (operation) => operation.operation === 'create',
    );

    if (reusable) {
      await this.outbox.save({
        ...reusable,
        payload: link,
        baseVersion: conflict.remoteVersion,
        retryCount: 0,
        status: 'pending',
        lastError: undefined,
        nextRetryAt: undefined,
        processingStartedAt: undefined,
      });
    } else {
      await this.outbox.add({
        id: crypto.randomUUID(),
        entityId: link.id,
        entityType: 'link',
        operation: 'create',
        baseVersion: conflict.remoteVersion,
        payload: link,
        createdAt: new Date().toISOString(),
        retryCount: 0,
        status: 'pending',
      });
    }

    requestBackgroundSync();
  }

  private async applyRemoteNoteSnapshot(conflict: ConflictRecord): Promise<void> {
    const remote = conflict.remoteSnapshot.entity as NoteRecord | undefined;
    if (!remote) return;

    const existing = await db.notes.get(conflict.entityId);
    const remoteRecord: NoteRecord = {
      ...(remote as NoteRecord),
      id: conflict.entityId,
      version: conflict.remoteVersion,
      syncStatus: 'synced',
      conflict: undefined,
    };

    if (existing?.deletedAt && !remoteRecord.deletedAt) {
      return;
    }

    await db.notes.put(remoteRecord);
    await this.outbox.removeMany(
      (await this.outbox.listForEntity(conflict.entityId, 'note')).map(
        (operation) => operation.id,
      ),
    );
  }

  private async applyRemoteCategorySnapshot(
    conflict: ConflictRecord,
  ): Promise<void> {
    const remote = conflict.remoteSnapshot.entity as CategoryRecord | undefined;
    if (!remote) return;

    const remoteRecord: CategoryRecord = {
      ...(remote as CategoryRecord),
      id: conflict.entityId,
      version: conflict.remoteVersion,
      syncStatus: 'synced',
      conflict: undefined,
    };

    if (remoteRecord.parentId) {
      const categories = (await db.categories.toArray()).filter(
        (category) => category.id !== conflict.entityId,
      );
      if (wouldCreateCategoryCycle(categories, conflict.entityId, remoteRecord.parentId)) {
        throw new ConflictRepositoryError(
          'CATEGORY_CYCLE',
          'Accepting the remote category move would create a cycle.',
        );
      }
    }

    await db.categories.put(remoteRecord);
    await this.outbox.removeMany(
      (await this.outbox.listForEntity(conflict.entityId, 'category')).map(
        (operation) => operation.id,
      ),
    );
  }

  private async applyRemoteLinkSnapshot(conflict: ConflictRecord): Promise<void> {
    const remote = conflict.remoteSnapshot.entity as NoteLinkRecord | undefined;
    if (!remote) return;

    const remoteRecord: NoteLinkRecord = {
      ...(remote as NoteLinkRecord),
      id: conflict.entityId,
      version: conflict.remoteVersion,
      syncStatus: 'synced',
    };

    await db.noteLinks.put(remoteRecord);
    await this.outbox.removeMany(
      (await this.outbox.listForEntity(conflict.entityId, 'link')).map(
        (operation) => operation.id,
      ),
    );
  }

  private async acceptRemoteNoteDeletion(conflict: ConflictRecord): Promise<void> {
    const existing = await db.notes.get(conflict.entityId);
    const remoteChangedAt =
      conflict.remoteSnapshot.changedAt ?? new Date().toISOString();

    if (existing) {
      const deleted: NoteRecord = {
        ...existing,
        deletedAt: remoteChangedAt,
        updatedAt: remoteChangedAt,
        version: conflict.remoteVersion,
        syncStatus: 'synced',
        conflict: undefined,
      };
      await db.notes.put(deleted);
    }

    await this.outbox.removeMany(
      (await this.outbox.listForEntity(conflict.entityId, 'note')).map(
        (operation) => operation.id,
      ),
    );
  }

  private async acceptRemoteCategoryDeletion(
    conflict: ConflictRecord,
  ): Promise<void> {
    const existing = await db.categories.get(conflict.entityId);
    const remoteChangedAt =
      conflict.remoteSnapshot.changedAt ?? new Date().toISOString();

    if (existing) {
      const deleted: CategoryRecord = {
        ...existing,
        deletedAt: remoteChangedAt,
        updatedAt: remoteChangedAt,
        version: conflict.remoteVersion,
        syncStatus: 'synced',
        conflict: undefined,
      };
      await db.categories.put(deleted);
    }

    await this.outbox.removeMany(
      (await this.outbox.listForEntity(conflict.entityId, 'category')).map(
        (operation) => operation.id,
      ),
    );
  }
}

export const conflictRepository = new ConflictRepository();

// Re-export for callers that want to build snapshots with the shared type.
export type { ConflictSnapshot, ConflictSnapshotRecord } ;