import { z } from 'zod';
import {
  SYNC_ENTITY_TYPES,
  SYNC_OPERATION_TYPES,
} from '@bigmind/domain/sync';
import { TEMPLATE_TYPES } from '@bigmind/domain/notes';
import { isCategoryIcon } from '@bigmind/domain/categories';
import { NOTIFICATION_TYPES } from '@bigmind/domain/notifications';

const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

const templateTypeSchema = z.enum(TEMPLATE_TYPES);

export const syncEntityTypeSchema = z.enum(SYNC_ENTITY_TYPES);
export const syncOperationTypeSchema = z.enum(SYNC_OPERATION_TYPES);

export const noteDataSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  categoryId: z.string().uuid().nullable(),
  templateType: templateTypeSchema.default('MARKDOWN'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().optional(),
  // Archive preparation: reserved optional field (nothing sets it yet).
  archivedAt: z.string().datetime().optional(),
  version: z.number().int().nonnegative(),
});

export const categoryDataSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().max(10000).default(''),
  icon: z.string()
    .max(32)
    .refine(isCategoryIcon, 'Category icon must be a single emoji.')
    .nullable()
    .default(null),
  parentId: z.string().uuid().nullable(),
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().nonnegative(),
  deletedAt: z.string().datetime().nullable(),
});

export const todoItemDataSchema = z.object({
  id: z.string().uuid(),
  todoListId: z.string().uuid(),
  text: z.string(),
  completed: z.boolean(),
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().optional(),
  version: z.number().int().nonnegative(),
});

export const reminderDataSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().default(''),
  dueAt: z.string().datetime(),
  completed: z.boolean().default(false),
  createdBy: z.string().uuid(),
  linkedNoteId: z.string().uuid().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().nonnegative(),
});

export const notificationDataSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  type: notificationTypeSchema,
  title: z.string().min(1).max(200),
  body: z.string().default(''),
  read: z.boolean().default(false),
  createdAt: z.string().datetime(),
  version: z.number().int().nonnegative().default(0),
});

export const noteLinkDataSchema = z.object({
  id: z.string().uuid(),
  sourceNoteId: z.string().uuid(),
  targetNoteId: z.string().uuid(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  version: z.number().int().nonnegative(),
});

const operationFields = {
  operationId: z.string().uuid(),
  entityId: z.string().uuid(),
  operationType: syncOperationTypeSchema,
  baseVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
};

export const noteSyncOperationSchema = z.object({
  ...operationFields,
  entityType: z.literal('note'),
  payload: noteDataSchema,
});

export const categorySyncOperationSchema = z.object({
  ...operationFields,
  entityType: z.literal('category'),
  payload: categoryDataSchema,
});

export const noteLinkSyncOperationSchema = z.object({
  ...operationFields,
  entityType: z.literal('link'),
  operationType: z.enum(['create', 'delete']),
  payload: noteLinkDataSchema,
});

export const todoItemSyncOperationSchema = z.object({
  ...operationFields,
  entityType: z.literal('todo_item'),
  payload: todoItemDataSchema,
});

export const reminderSyncOperationSchema = z.object({
  ...operationFields,
  entityType: z.literal('reminder'),
  payload: reminderDataSchema,
});

export const notificationSyncOperationSchema = z.object({
  ...operationFields,
  entityType: z.literal('notification'),
  payload: notificationDataSchema,
});

export const syncOperationSchema = z.discriminatedUnion('entityType', [
  noteSyncOperationSchema,
  categorySyncOperationSchema,
  noteLinkSyncOperationSchema,
  todoItemSyncOperationSchema,
  reminderSyncOperationSchema,
  notificationSyncOperationSchema,
]);

export const acceptedPushResultSchema = z.object({
  status: z.literal('accepted'),
  operationId: z.string().uuid(),
  entityId: z.string().uuid(),
  entityType: syncEntityTypeSchema,
  serverVersion: z.number().int().positive(),
  serverSequence: z.number().int().positive(),
});

export const rejectedPushResultSchema = z.object({
  status: z.literal('rejected'),
  operationId: z.string().uuid(),
  errorCode: z.string(),
  message: z.string(),
});

const conflictFields = {
  status: z.literal('conflict'),
  operationId: z.string().uuid(),
  entityId: z.string().uuid(),
  clientBaseVersion: z.number().int().nonnegative(),
  currentServerVersion: z.number().int().positive(),
};

export const noteConflictPushResultSchema = z.object({
  ...conflictFields,
  entityType: z.literal('note'),
  currentServerData: noteDataSchema,
});

export const categoryConflictPushResultSchema = z.object({
  ...conflictFields,
  entityType: z.literal('category'),
  currentServerData: categoryDataSchema,
});

export const conflictPushResultSchema = z.discriminatedUnion('entityType', [
  noteConflictPushResultSchema,
  categoryConflictPushResultSchema,
]);

export const pushOperationResultSchema = z.union([
  acceptedPushResultSchema,
  rejectedPushResultSchema,
  conflictPushResultSchema,
]);

export const pushRequestSchema = z.object({
  operations: z.array(syncOperationSchema).max(100),
});

export const pushResponseSchema = z.object({
  results: z.array(pushOperationResultSchema),
});

export const pullQuerySchema = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const remoteChangeFields = {
  sequence: z.number().int().positive(),
  entityId: z.string().uuid(),
  operationType: syncOperationTypeSchema,
  version: z.number().int().positive(),
  changedAt: z.string().datetime(),
};

export const noteRemoteChangeSchema = z.object({
  ...remoteChangeFields,
  entityType: z.literal('note'),
  payload: noteDataSchema,
});

export const categoryRemoteChangeSchema = z.object({
  ...remoteChangeFields,
  entityType: z.literal('category'),
  payload: categoryDataSchema,
});

export const noteLinkRemoteChangeSchema = z.object({
  ...remoteChangeFields,
  entityType: z.literal('link'),
  operationType: z.enum(['create', 'delete']),
  payload: noteLinkDataSchema,
});

export const todoItemRemoteChangeSchema = z.object({
  ...remoteChangeFields,
  entityType: z.literal('todo_item'),
  payload: todoItemDataSchema,
});

export const reminderRemoteChangeSchema = z.object({
  ...remoteChangeFields,
  entityType: z.literal('reminder'),
  payload: reminderDataSchema,
});

export const notificationRemoteChangeSchema = z.object({
  ...remoteChangeFields,
  entityType: z.literal('notification'),
  payload: notificationDataSchema,
});

export const remoteChangeSchema = z.discriminatedUnion('entityType', [
  noteRemoteChangeSchema,
  categoryRemoteChangeSchema,
  noteLinkRemoteChangeSchema,
  todoItemRemoteChangeSchema,
  reminderRemoteChangeSchema,
  notificationRemoteChangeSchema,
]);

export const pullResponseSchema = z.object({
  changes: z.array(remoteChangeSchema),
  nextCursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export type NoteData = z.infer<typeof noteDataSchema>;
export type CategoryData = z.infer<typeof categoryDataSchema>;
export type NoteLinkData = z.infer<typeof noteLinkDataSchema>;
export type TodoItemData = z.infer<typeof todoItemDataSchema>;
export type ReminderData = z.infer<typeof reminderDataSchema>;
export type NotificationData = z.infer<typeof notificationDataSchema>;
export type SyncPayload = NoteData | CategoryData | NoteLinkData | TodoItemData | ReminderData | NotificationData;
export type TodoItemSyncOperation = z.infer<typeof todoItemSyncOperationSchema>;
export type ReminderSyncOperation = z.infer<typeof reminderSyncOperationSchema>;
export type NotificationSyncOperation = z.infer<typeof notificationSyncOperationSchema>;
export type NoteSyncOperation = z.infer<typeof noteSyncOperationSchema>;
export type CategorySyncOperation = z.infer<
  typeof categorySyncOperationSchema
>;
export type NoteLinkSyncOperation = z.infer<
  typeof noteLinkSyncOperationSchema
>;
export type SyncOperation = z.infer<typeof syncOperationSchema>;
export type PushOperationResult = z.infer<typeof pushOperationResultSchema>;
export type PushRequest = z.infer<typeof pushRequestSchema>;
export type PushResponse = z.infer<typeof pushResponseSchema>;
export type PullQuery = z.infer<typeof pullQuerySchema>;
export type NoteRemoteChange = z.infer<typeof noteRemoteChangeSchema>;
export type CategoryRemoteChange = z.infer<typeof categoryRemoteChangeSchema>;
export type NoteLinkRemoteChange = z.infer<typeof noteLinkRemoteChangeSchema>;
export type TodoItemRemoteChange = z.infer<typeof todoItemRemoteChangeSchema>;
export type ReminderRemoteChange = z.infer<typeof reminderRemoteChangeSchema>;
export type NotificationRemoteChange = z.infer<typeof notificationRemoteChangeSchema>;
export type RemoteChange = z.infer<typeof remoteChangeSchema>;
export type PullResponse = z.infer<typeof pullResponseSchema>;
