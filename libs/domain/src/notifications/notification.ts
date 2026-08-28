import type { EntityId } from '../shared/entity-id.js';
import type { IsoTimestamp } from '../shared/timestamps.js';

export const NOTIFICATION_TYPES = [
  'reminder_due',
  'note_modified',
  'workspace_invitation',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: EntityId;
  workspaceId: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: IsoTimestamp;
}
