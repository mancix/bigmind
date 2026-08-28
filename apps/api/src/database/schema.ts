import type {
  SyncPayload,
  PushOperationResult,
} from '@bigmind/contracts';
import {
  SYNC_ENTITY_TYPES,
  SYNC_OPERATION_TYPES,
} from '@bigmind/domain/sync';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const syncResultStatus = pgEnum('sync_result_status', [
  'accepted',
  'rejected',
  'conflict',
]);
export const syncEntityType = pgEnum('sync_entity_type', SYNC_ENTITY_TYPES);
export const syncOperationType = pgEnum(
  'sync_operation_type',
  SYNC_OPERATION_TYPES,
);

export const noteTemplateType = pgEnum('note_template_type', ['MARKDOWN', 'TODO_LIST']);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon'),
    parentId: uuid('parent_id').references(
      (): AnyPgColumn => categories.id,
      { onDelete: 'restrict' },
    ),
    position: integer('position').notNull(),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('categories_workspace_parent_position_idx').on(
      table.workspaceId,
      table.parentId,
      table.position,
    ),
  ],
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    templateType: noteTemplateType('template_type').notNull().default('MARKDOWN'),
    searchVector: text('search_vector'),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('notes_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
    index('notes_search_idx').using('gin', table.searchVector),
  ],
);

export const noteLinks = pgTable(
  'note_links',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sourceNoteId: uuid('source_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'restrict' }),
    targetNoteId: uuid('target_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('note_links_source_target_unique').on(
      table.sourceNoteId,
      table.targetNoteId,
    ),
    index('note_links_workspace_source_idx').on(table.workspaceId, table.sourceNoteId),
    index('note_links_workspace_target_idx').on(table.workspaceId, table.targetNoteId),
  ],
);

export const syncOperations = pgTable(
  'sync_operations',
  {
    operationId: uuid('operation_id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id').notNull(),
    resultStatus: syncResultStatus('result_status').notNull(),
    resultPayload: jsonb('result_payload').$type<PushOperationResult>().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('sync_operations_workspace_idx').on(table.workspaceId)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('refresh_tokens_user_id_idx').on(table.userId),
    uniqueIndex('refresh_tokens_token_hash_idx').on(table.tokenHash),
  ],
);

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

export const workspaceRole = pgEnum('workspace_role', ['OWNER', 'EDITOR', 'VIEWER']);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_id_idx').on(table.userId),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;

export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: workspaceRole('role').notNull(),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('workspace_invitations_workspace_id_idx').on(table.workspaceId),
    uniqueIndex('workspace_invitations_token_idx').on(table.token),
  ],
);

export type WorkspaceInvitationRow = typeof workspaceInvitations.$inferSelect;
export type NewWorkspaceInvitation = typeof workspaceInvitations.$inferInsert;

export const todoLists = pgTable('todo_lists', {
  id: uuid('id').primaryKey(),
  noteId: uuid('note_id')
    .notNull()
    .references(() => notes.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const todoItems = pgTable('todo_items', {
  id: uuid('id').primaryKey(),
  todoListId: uuid('todo_list_id')
    .notNull()
    .references(() => todoLists.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  completed: boolean('completed').notNull().default(false),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export type TodoListRow = typeof todoLists.$inferSelect;
export type NewTodoList = typeof todoLists.$inferInsert;
export type TodoItemRow = typeof todoItems.$inferSelect;
export type NewTodoItem = typeof todoItems.$inferInsert;

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    completed: boolean('completed').notNull().default(false),
    createdBy: uuid('created_by').notNull(),
    linkedNoteId: uuid('linked_note_id').references(() => notes.id, {
      onDelete: 'set null',
    }),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('reminders_workspace_due_idx').on(table.workspaceId, table.dueAt),
    index('reminders_workspace_completed_idx').on(table.workspaceId, table.completed),
  ],
);

export type ReminderRow = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;

export const notificationType = pgEnum('notification_type', ['reminder_due', 'note_modified', 'workspace_invitation']);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    read: boolean('read').notNull().default(false),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('notifications_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('notifications_workspace_read_idx').on(table.workspaceId, table.read),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export const changeLog = pgTable(
  'change_log',
  {
    sequence: bigserial('sequence', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id').notNull(),
    entityType: syncEntityType('entity_type').notNull(),
    operationType: syncOperationType('operation_type').notNull(),
    version: integer('version').notNull(),
    payload: jsonb('payload').$type<SyncPayload>().notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('change_log_workspace_sequence_idx').on(table.workspaceId, table.sequence),
  ],
);
