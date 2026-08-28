import type { EntityId, EntityVersion } from '../shared/entity-id.js';
import type { IsoTimestamp } from '../shared/timestamps.js';

export const CONFLICT_ENTITY_TYPES = [
  'note',
  'category',
  'link',
] as const;

export const CONFLICT_TYPES = [
  'content',
  'rename',
  'delete_vs_edit',
  'category_move',
  'generic',
] as const;

export const CONFLICT_STATUSES = ['open', 'resolved', 'dismissed'] as const;

export type ConflictEntityType = (typeof CONFLICT_ENTITY_TYPES)[number];
export type ConflictType = (typeof CONFLICT_TYPES)[number];
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export interface ConflictSnapshot<TEntity = unknown> {
  version: EntityVersion;
  entity: TEntity;
  changedAt?: IsoTimestamp;
  operation?: 'create' | 'update' | 'delete' | 'none';
}

export interface Conflict<TEntity = unknown> {
  id: EntityId;
  entityType: ConflictEntityType;
  entityId: EntityId;
  conflictType: ConflictType;
  localVersion: EntityVersion;
  remoteVersion: EntityVersion;
  localSnapshot: ConflictSnapshot<TEntity>;
  remoteSnapshot: ConflictSnapshot<TEntity>;
  createdAt: IsoTimestamp;
  resolvedAt?: IsoTimestamp;
  status: ConflictStatus;
  baseVersion?: EntityVersion;
}

export interface ConflictResolution {
  strategy: 'keep_mine' | 'keep_remote' | 'merge_manually' | 'restore' | 'delete_mine' | 'dismiss';
  resolvedAt: IsoTimestamp;
  mergedEntity?: unknown;
}