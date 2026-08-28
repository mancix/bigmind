import type { EntityId, EntityVersion } from '../shared/entity-id.js';
import type { IsoTimestamp } from '../shared/timestamps.js';

export interface Reminder {
  id: EntityId;
  workspaceId: string;
  title: string;
  description: string;
  dueAt: IsoTimestamp;
  completed: boolean;
  createdBy: string;
  linkedNoteId: EntityId | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  version: EntityVersion;
}
