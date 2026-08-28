import type {
  Conflict,
  ConflictEntityType,
  ConflictSnapshot,
  ConflictType,
} from '@bigmind/domain/conflicts';

import type {
  CategoryRecord,
  ConflictSnapshotRecord,
  NoteLinkRecord,
  NoteRecord,
} from '../../storage/database';
import type { RemoteChange } from '../../sync/sync.types';

export interface BuildSnapshotsInput<TEntity> {
  entityType: ConflictEntityType;
  entityId: string;
  localEntity: TEntity;
  remoteChange: RemoteChange;
  baseVersion?: number;
}

export interface BuiltConflictsSnapshots {
  conflictType: ConflictType;
  localVersion: number;
  remoteVersion: number;
  localSnapshot: ConflictSnapshotRecord;
  remoteSnapshot: ConflictSnapshotRecord;
  baseVersion: number;
}

export class ConflictService {
  determineConflictType<TEntity>(
    entityType: ConflictEntityType,
    localEntity: TEntity | undefined,
    remoteChange: RemoteChange,
  ): ConflictType {
    if (remoteChange.operation === 'delete') {
      return 'delete_vs_edit';
    }

    if (entityType === 'note') {
      const local = localEntity as NoteRecord | undefined;
      const remotePayload = remoteChange.payload as Partial<NoteRecord> | undefined;

      if (!local || !remotePayload) return 'generic';

      const titleChanged =
        typeof remotePayload.title === 'string' &&
        remotePayload.title !== local.title;
      const contentChanged =
        typeof remotePayload.content === 'string' &&
        remotePayload.content !== local.content;
      const categoryChanged =
        'categoryId' in remotePayload &&
        remotePayload.categoryId !== local.categoryId;

      if (contentChanged) return 'content';
      if (titleChanged && !contentChanged && !categoryChanged) return 'rename';
      return 'content';
    }

    if (entityType === 'category') {
      const local = localEntity as CategoryRecord | undefined;
      const remotePayload = remoteChange.payload as Partial<CategoryRecord> | undefined;

      if (!local || !remotePayload) return 'generic';

      const parentChanged =
        'parentId' in remotePayload && remotePayload.parentId !== local.parentId;
      const nameChanged =
        typeof remotePayload.name === 'string' &&
        remotePayload.name !== local.name;

      if (parentChanged) return 'category_move';
      if (nameChanged) return 'rename';
      return 'generic';
    }

    return 'generic';
  }

  buildSnapshots<TEntity>({
    entityType,
    entityId,
    localEntity,
    remoteChange,
    baseVersion,
  }: BuildSnapshotsInput<TEntity>): BuiltConflictsSnapshots {
    const localVersion =
      (localEntity as { version?: number } | undefined)?.version ??
      baseVersion ??
      0;
    const conflictType = this.determineConflictType(
      entityType,
      localEntity,
      remoteChange,
    );
    const localSnapshot: ConflictSnapshotRecord = {
      version: localVersion,
      entity: localEntity as unknown,
      operation: 'none',
    };
    const remoteSnapshot: ConflictSnapshotRecord = {
      version: remoteChange.version,
      entity: remoteChange.payload,
      changedAt: remoteChange.changedAt,
      operation: remoteChange.operation,
    };

    return {
      conflictType,
      localVersion,
      remoteVersion: remoteChange.version,
      localSnapshot,
      remoteSnapshot,
      baseVersion: baseVersion ?? localVersion,
    };
  }

  canAutoResolve(conflict: Pick<Conflict, 'conflictType' | 'localSnapshot' | 'remoteSnapshot'>): boolean {
    if (conflict.conflictType === 'generic') return false;
    if (conflict.conflictType === 'delete_vs_edit') return false;
    if (conflict.conflictType === 'category_move') return false;

    const localEntity = (conflict.localSnapshot as ConflictSnapshot).entity as
      | NoteRecord
      | CategoryRecord
      | NoteLinkRecord
      | undefined;
    const remoteEntity = (conflict.remoteSnapshot as ConflictSnapshot).entity as
      | NoteRecord
      | CategoryRecord
      | NoteLinkRecord
      | undefined;

    return deepEqual(localEntity, remoteEntity);
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== 'object' || typeof right !== 'object') {
    return left === right;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }

  const leftKeys = Object.keys(left as object);
  const rightKeys = Object.keys(right as object);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) =>
    deepEqual(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    ),
  );
}

export const conflictService = new ConflictService();