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
  /**
   * Archive preparation: reserved for the future archive/trash feature.
   * Nothing writes this field yet; it is additive so repositories and the
   * sync protocol can carry it without a migration when archive ships.
   */
  archivedAt?: IsoTimestamp;
}

export type NoteContentChanges = Partial<
  Pick<Note, 'title' | 'content' | 'categoryId'>
>;
