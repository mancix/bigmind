import type { EntityId, EntityVersion } from '../shared/entity-id.js';
import type { IsoTimestamp } from '../shared/timestamps.js';

export interface Category {
  id: EntityId;
  name: string;
  description: string;
  icon: string | null;
  parentId: EntityId | null;
  position: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  version: EntityVersion;
  deletedAt: IsoTimestamp | null;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}
