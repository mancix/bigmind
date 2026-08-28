import type { EntityId, EntityVersion } from '../shared/entity-id.js';
import type { IsoTimestamp } from '../shared/timestamps.js';

export const TEMPLATE_TYPES = ['MARKDOWN', 'TODO_LIST'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export interface Note {
  id: EntityId;
  title: string;
  content: string;
  categoryId: EntityId | null;
  templateType: TemplateType;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  version: EntityVersion;
  deletedAt?: IsoTimestamp;
}

export type NoteContentChanges = Partial<
  Pick<Note, 'title' | 'content' | 'categoryId'>
>;
