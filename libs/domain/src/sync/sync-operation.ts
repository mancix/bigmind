export const SYNC_ENTITY_TYPES = ['note', 'category', 'link', 'todo_item', 'reminder', 'notification'] as const;
export const SYNC_OPERATION_TYPES = ['create', 'update', 'delete'] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];
export type SyncOperationType = (typeof SYNC_OPERATION_TYPES)[number];
