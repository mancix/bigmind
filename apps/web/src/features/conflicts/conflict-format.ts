import type { ConflictRecord } from '../../storage/database';

export function describeEntityLabel(
  conflict: Pick<ConflictRecord, 'entityType' | 'entityId'>,
): string {
  return `${conflict.entityType} ${conflict.entityId}`;
}

export function getEntityTitle(conflict: ConflictRecord): string | undefined {
  const local = conflict.localSnapshot.entity as
    | { title?: string; name?: string; targetTitle?: string }
    | undefined;
  const remote = conflict.remoteSnapshot.entity as
    | { title?: string; name?: string; targetTitle?: string }
    | undefined;

  return local?.title ?? remote?.title ?? local?.name ?? remote?.name ?? remote?.targetTitle ?? local?.targetTitle;
}

export function formatConflictType(type: ConflictRecord['conflictType']): string {
  switch (type) {
    case 'content':
      return 'Content conflict';
    case 'rename':
      return 'Rename conflict';
    case 'delete_vs_edit':
      return 'Deleted remotely while edited locally';
    case 'category_move':
      return 'Category move conflict';
    default:
      return 'Synchronization conflict';
  }
}

export function formatEntityType(type: ConflictRecord['entityType']): string {
  switch (type) {
    case 'note':
      return 'Note';
    case 'category':
      return 'Category';
    case 'link':
      return 'Link';
    default:
      return type;
  }
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatConflictDate(timestamp: string): string {
  return dateFormatter.format(new Date(timestamp));
}