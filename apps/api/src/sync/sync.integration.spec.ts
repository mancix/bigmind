import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';

import { AppModule } from '../app/app.module';
import { DatabaseService } from '../database/database.service';
import {
  categories,
  changeLog,
  users,
  workspaces,
  workspaceMembers,
} from '../database/schema';

const AUTH_EMAIL = 'sync-test-user@example.com';
const AUTH_PASSWORD = 'password123';
const WORKSPACE_ID = '00000000-0000-4000-a000-000000000000';

const FIRST_NOTE_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_NOTE_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_NOTE_ID = '33333333-3333-4333-8333-333333333333';
const PARENT_CATEGORY_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_CATEGORY_ID = '55555555-5555-4555-8555-555555555555';

describe('sync API (integration)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let authToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://bigmind:bigmind@localhost:5432/bigmind_test';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(DatabaseService);
    await migrate(database.db, { migrationsFolder: 'drizzle' });

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: AUTH_EMAIL, password: AUTH_PASSWORD })
      .expect(201);
    authToken = res.body.accessToken;
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table change_log, sync_operations, note_links, notes, categories, workspace_members, workspaces restart identity cascade`,
    );
    const now = new Date();
    await database.db.insert(workspaces).values({
      id: WORKSPACE_ID,
      name: 'Default',
      createdAt: now,
      updatedAt: now,
    });
    const [user] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, AUTH_EMAIL))
      .limit(1);
    await database.db.insert(workspaceMembers).values({
      workspaceId: WORKSPACE_ID,
      userId: user!.id,
      role: 'OWNER',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a create and returns the same result for duplicate delivery', async () => {
    const operation = createOperation(1, FIRST_NOTE_ID);

    const first = await push([operation]).expect(200);
    const duplicate = await push([operation]).expect(200);
    const pull = await pullRequest('', 200);

    expect(first.body.results).toEqual([
      expect.objectContaining({
        status: 'accepted',
        operationId: operation.operationId,
        entityId: FIRST_NOTE_ID,
        serverVersion: 1,
        serverSequence: 1,
      }),
    ]);
    expect(duplicate.body).toEqual(first.body);
    expect(pull.body.changes).toHaveLength(1);
  });

  it('applies an update with the current base version', async () => {
    await push([createOperation(1, FIRST_NOTE_ID)]).expect(200);

    const response = await push([
      createOperation(2, FIRST_NOTE_ID, {
        operationType: 'update',
        baseVersion: 1,
        title: 'Updated title',
      }),
    ]).expect(200);

    expect(response.body.results).toEqual([
      expect.objectContaining({
        status: 'accepted',
        entityId: FIRST_NOTE_ID,
        serverVersion: 2,
        serverSequence: 2,
      }),
    ]);
  });

  it('returns the current server note for a stale update', async () => {
    await push([createOperation(1, FIRST_NOTE_ID)]).expect(200);
    await push([
      createOperation(2, FIRST_NOTE_ID, {
        operationType: 'update',
        baseVersion: 1,
        title: 'Server title',
      }),
    ]).expect(200);

    const response = await push([
      createOperation(3, FIRST_NOTE_ID, {
        operationType: 'update',
        baseVersion: 1,
        title: 'Stale title',
      }),
    ]).expect(200);

    expect(response.body.results).toEqual([
      expect.objectContaining({
        status: 'conflict',
        entityId: FIRST_NOTE_ID,
        clientBaseVersion: 1,
        currentServerVersion: 2,
        currentServerData: expect.objectContaining({
          title: 'Server title',
          version: 2,
        }),
      }),
    ]);
  });

  it('soft-deletes a note and exposes the tombstone through pull', async () => {
    await push([createOperation(1, FIRST_NOTE_ID)]).expect(200);

    const deletedAt = '2026-01-01T00:02:00.000Z';
    const response = await push([
      createOperation(2, FIRST_NOTE_ID, {
        operationType: 'delete',
        baseVersion: 1,
        deletedAt,
      }),
    ]).expect(200);
    const pull = await pullRequest('cursor=1');

    expect(response.body.results[0]).toMatchObject({
      status: 'accepted',
      serverVersion: 2,
    });
    expect(pull.body).toMatchObject({
      nextCursor: 2,
      hasMore: false,
      changes: [
        {
          operationType: 'delete',
          version: 2,
          payload: { deletedAt, version: 2 },
        },
      ],
    });
  });

  it('pushes, pulls, deduplicates, and deletes note links', async () => {
    await push([
      createOperation(1, FIRST_NOTE_ID),
      createOperation(2, SECOND_NOTE_ID),
    ]).expect(200);
    const createLink = createLinkOperation('create');

    const created = await push([createLink]).expect(200);
    const duplicate = await push([createLink]).expect(200);
    expect(created.body).toEqual(duplicate.body);
    expect(created.body.results[0]).toMatchObject({
      status: 'accepted',
      entityType: 'link',
      serverVersion: 1,
    });

    const pulled = await pullRequest('cursor=2');
    expect(pulled.body.changes).toMatchObject([{
      entityType: 'link',
      operationType: 'create',
      payload: {
        sourceNoteId: FIRST_NOTE_ID,
        targetNoteId: SECOND_NOTE_ID,
      },
    }]);

    const deleted = await push([createLinkOperation('delete')]).expect(200);
    expect(deleted.body.results[0]).toMatchObject({
      status: 'accepted',
      entityType: 'link',
      serverVersion: 2,
    });
  });

  it('soft-deletes connected links when a note is deleted', async () => {
    await push([
      createOperation(1, FIRST_NOTE_ID),
      createOperation(2, SECOND_NOTE_ID),
    ]).expect(200);
    await push([createLinkOperation('create')]).expect(200);

    await push([createOperation(3, SECOND_NOTE_ID, {
      operationType: 'delete',
      baseVersion: 1,
      deletedAt: '2026-01-01T00:03:00.000Z',
    })]).expect(200);

    const pulled = await pullRequest('cursor=3');
    expect(pulled.body.changes.map(
      ({ entityType, operationType }: { entityType: string; operationType: string }) =>
        ({ entityType, operationType }),
    )).toEqual([
      { entityType: 'note', operationType: 'delete' },
      { entityType: 'link', operationType: 'delete' },
    ]);
  });

  it('returns ordered cursor pages without skipping changes', async () => {
    await push([
      createOperation(1, FIRST_NOTE_ID),
      createOperation(2, SECOND_NOTE_ID),
      createOperation(3, THIRD_NOTE_ID),
    ]).expect(200);

    const firstPage = await pullRequest('cursor=0&limit=2');
    const secondPage = await pullRequest(`cursor=${firstPage.body.nextCursor}&limit=2`);

    expect(firstPage.body).toMatchObject({ nextCursor: 2, hasMore: true });
    expect(firstPage.body.changes.map(changeSequence)).toEqual([1, 2]);
    expect(secondPage.body).toMatchObject({ nextCursor: 3, hasMore: false });
    expect(secondPage.body.changes.map(changeSequence)).toEqual([3]);
  });

  it('normalizes legacy note change payloads without categoryId', async () => {
    await database.db.insert(changeLog).values({
      workspaceId: WORKSPACE_ID,
      entityId: FIRST_NOTE_ID,
      entityType: 'note',
      operationType: 'create',
      version: 1,
      payload: {
        id: FIRST_NOTE_ID,
        title: 'Legacy note',
        content: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
      } as never,
      changedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const response = await pullRequest();
    expect(response.body.changes[0].payload).toMatchObject({
      title: 'Legacy note',
      categoryId: null,
    });
  });

  it('normalizes legacy category change payloads without an icon', async () => {
    await database.db.insert(changeLog).values({
      workspaceId: WORKSPACE_ID,
      entityId: PARENT_CATEGORY_ID,
      entityType: 'category',
      operationType: 'create',
      version: 1,
      payload: {
        id: PARENT_CATEGORY_ID,
        name: 'Legacy category',
        parentId: null,
        position: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deletedAt: null,
      } as never,
      changedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const response = await pullRequest();
    expect(response.body.changes[0].payload).toMatchObject({
      name: 'Legacy category',
      icon: null,
    });
  });

  it('rejects a malformed operation before it reaches the service', async () => {
    await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ operations: [{ operationId: 'not-a-uuid' }] })
      .expect(400);
  });

  it('syncs hierarchical categories before notes that reference them', async () => {
    const response = await push([
      createOperation(3, FIRST_NOTE_ID, { categoryId: CHILD_CATEGORY_ID }),
      createCategoryOperation(1, PARENT_CATEGORY_ID, { icon: '💼' }),
      createCategoryOperation(2, CHILD_CATEGORY_ID, {
        parentId: PARENT_CATEGORY_ID,
      }),
    ]).expect(200);
    const pull = await pullRequest();

    expect(response.body.results).toHaveLength(3);
    expect(response.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'accepted', entityType: 'category' }),
        expect.objectContaining({ status: 'accepted', entityType: 'note' }),
      ]),
    );
    expect(pull.body.changes.map((change: { entityType: string }) => change.entityType))
      .toEqual(['category', 'category', 'note']);
    expect(pull.body.changes[0].payload).toMatchObject({ icon: '💼' });
  });

  it('rejects category cycles with a stable error code', async () => {
    await push([
      createCategoryOperation(1, PARENT_CATEGORY_ID),
      createCategoryOperation(2, CHILD_CATEGORY_ID, { parentId: PARENT_CATEGORY_ID }),
    ]).expect(200);

    const response = await push([
      createCategoryOperation(3, PARENT_CATEGORY_ID, {
        operationType: 'update',
        baseVersion: 1,
        parentId: CHILD_CATEGORY_ID,
      }),
    ]).expect(200);

    expect(response.body.results[0]).toMatchObject({
      status: 'rejected',
      errorCode: 'CATEGORY_CYCLE',
    });
  });

  it('rejects missing and cross-user category parents', async () => {
    const missing = await push([
      createCategoryOperation(1, CHILD_CATEGORY_ID, { parentId: PARENT_CATEGORY_ID }),
    ]).expect(200);
    expect(missing.body.results[0]).toMatchObject({
      status: 'rejected',
      errorCode: 'CATEGORY_PARENT_NOT_FOUND',
    });

    const now = new Date();
    await database.db.insert(workspaces).values({
      id: '00000000-0000-4000-a000-ffffffffffff',
      name: 'Other Workspace',
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    await database.db.insert(categories).values({
      id: PARENT_CATEGORY_ID,
      workspaceId: '00000000-0000-4000-a000-ffffffffffff',
      name: 'Private',
      parentId: null,
      position: 0,
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
    });
    const crossUser = await push([
      createCategoryOperation(2, CHILD_CATEGORY_ID, { parentId: PARENT_CATEGORY_ID }),
    ]).expect(200);
    expect(crossUser.body.results[0]).toMatchObject({
      status: 'rejected',
      errorCode: 'CATEGORY_PARENT_NOT_FOUND',
    });
  });

  it('accepts a category move and returns a conflict for a stale update', async () => {
    await push([
      createCategoryOperation(1, PARENT_CATEGORY_ID),
      createCategoryOperation(2, CHILD_CATEGORY_ID),
    ]).expect(200);
    const moved = await push([
      createCategoryOperation(3, CHILD_CATEGORY_ID, {
        operationType: 'update',
        baseVersion: 1,
        parentId: PARENT_CATEGORY_ID,
      }),
    ]).expect(200);
    const stale = await push([
      createCategoryOperation(4, CHILD_CATEGORY_ID, {
        operationType: 'update',
        baseVersion: 1,
      }),
    ]).expect(200);

    expect(moved.body.results[0]).toMatchObject({ status: 'accepted', serverVersion: 2 });
    expect(stale.body.results[0]).toMatchObject({ status: 'conflict', currentServerVersion: 2 });
  });

  it('blocks deleting categories that contain children or notes', async () => {
    await push([
      createCategoryOperation(1, PARENT_CATEGORY_ID),
      createCategoryOperation(2, CHILD_CATEGORY_ID, { parentId: PARENT_CATEGORY_ID }),
    ]).expect(200);
    const withChild = await push([
      createCategoryOperation(3, PARENT_CATEGORY_ID, {
        operationType: 'delete',
        baseVersion: 1,
      }),
    ]).expect(200);
    expect(withChild.body.results[0]).toMatchObject({
      status: 'rejected',
      errorCode: 'CATEGORY_NOT_EMPTY',
    });

    await push([
      createOperation(4, SECOND_NOTE_ID, { categoryId: CHILD_CATEGORY_ID }),
    ]).expect(200);
    const withNote = await push([
      createCategoryOperation(5, CHILD_CATEGORY_ID, {
        operationType: 'delete',
        baseVersion: 1,
      }),
    ]).expect(200);
    expect(withNote.body.results[0]).toMatchObject({
      status: 'rejected',
      errorCode: 'CATEGORY_HAS_NOTES',
    });
  });

  function push(operations: unknown[]) {
    return request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ operations });
  }

  function pullRequest(query = '', expectedStatus = 200) {
    return request(app.getHttpServer())
      .get(`/sync/pull${query ? `?${query}` : ''}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(expectedStatus);
  }
});

type OperationOverrides = {
  operationType?: 'create' | 'update' | 'delete';
  baseVersion?: number;
  title?: string;
  deletedAt?: string;
  categoryId?: string | null;
};

function createOperation(
  sequence: number,
  entityId: string,
  overrides: OperationOverrides = {},
) {
  const timestamp = `2026-01-01T00:0${sequence}:00.000Z`;

  return {
    operationId: operationId(sequence),
    entityId,
    entityType: 'note',
    operationType: overrides.operationType ?? 'create',
    baseVersion: overrides.baseVersion ?? 0,
    payload: {
      id: entityId,
      title: overrides.title ?? `Note ${sequence}`,
      content: '',
      categoryId: overrides.categoryId ?? null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: timestamp,
      ...(overrides.deletedAt ? { deletedAt: overrides.deletedAt } : {}),
      version: overrides.baseVersion ?? 0,
    },
    createdAt: timestamp,
  };
}

type CategoryOperationOverrides = {
  operationType?: 'create' | 'update' | 'delete';
  baseVersion?: number;
  parentId?: string | null;
  icon?: string | null;
};

function createCategoryOperation(
  sequence: number,
  entityId: string,
  overrides: CategoryOperationOverrides = {},
) {
  const timestamp = `2026-01-01T00:0${sequence}:00.000Z`;
  return {
    operationId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(sequence).padStart(12, '0')}`,
    entityId,
    entityType: 'category',
    operationType: overrides.operationType ?? 'create',
    baseVersion: overrides.baseVersion ?? 0,
    payload: {
      id: entityId,
      name: `Category ${sequence}`,
      icon: overrides.icon ?? null,
      parentId: overrides.parentId ?? null,
      position: sequence,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: timestamp,
      version: overrides.baseVersion ?? 0,
      deletedAt: null,
    },
    createdAt: timestamp,
  };
}

function createLinkOperation(operationType: 'create' | 'delete') {
  const deletedAt = operationType === 'delete'
    ? '2026-01-01T00:04:00.000Z'
    : null;
  return {
    operationId: operationType === 'create'
      ? 'cccccccc-cccc-4ccc-8ccc-000000000001'
      : 'cccccccc-cccc-4ccc-8ccc-000000000002',
    entityId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
    entityType: 'link',
    operationType,
    baseVersion: operationType === 'create' ? 0 : 1,
    payload: {
      id: 'dddddddd-dddd-4ddd-8ddd-000000000001',
      sourceNoteId: FIRST_NOTE_ID,
      targetNoteId: SECOND_NOTE_ID,
      createdAt: '2026-01-01T00:02:30.000Z',
      deletedAt,
      version: operationType === 'create' ? 0 : 1,
    },
    createdAt: deletedAt ?? '2026-01-01T00:02:30.000Z',
  };
}

function operationId(sequence: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, '0')}`;
}

function changeSequence(change: { sequence: number }): number {
  return change.sequence;
}
