import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';

import { AppModule } from '../app/app.module';
import { DatabaseService } from '../database/database.service';
import {
  users,
  workspaces,
  workspaceMembers,
} from '../database/schema';

const AUTH_EMAIL = 'search-test-user@example.com';
const AUTH_PASSWORD = 'password123';
const WORKSPACE_ID = '00000000-0000-4000-a000-000000000000';

const FIRST_NOTE_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_NOTE_ID = '00000000-0000-4000-8000-000000000002';
const THIRD_NOTE_ID = '00000000-0000-4000-8000-000000000003';
const OTHER_USER_NOTE_ID = '00000000-0000-4000-8000-000000000004';

describe('search API (integration)', () => {
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

  it('returns matching notes with snippets and scores', async () => {
    await push([
      createOperation(1, FIRST_NOTE_ID, {
        title: 'Meeting Notes',
        content: 'We discussed the quarterly meeting agenda and action items.',
      }),
      createOperation(2, SECOND_NOTE_ID, {
        title: 'Shopping List',
        content: 'Milk, eggs, bread, and vegetables.',
      }),
    ]).expect(200);

    const response = await request(app.getHttpServer())
      .get('/search?query=meeting')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      id: FIRST_NOTE_ID,
      title: 'Meeting Notes',
    });
    expect(response.body.items[0].score).toBeGreaterThan(0);
    expect(response.body.items[0].snippet).toBeTruthy();
  });

  it('searches across both title and content', async () => {
    await push([
      createOperation(1, FIRST_NOTE_ID, {
        title: 'Project Alpha',
        content: 'Technical documentation for the new feature.',
      }),
      createOperation(2, SECOND_NOTE_ID, {
        title: 'Random Thoughts',
        content: 'Some thoughts about project alpha implementation.',
      }),
    ]).expect(200);

    const response = await request(app.getHttpServer())
      .get('/search?query=alpha')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items.map((i: { id: string }) => i.id).sort()).toEqual(
      [FIRST_NOTE_ID, SECOND_NOTE_ID].sort(),
    );
  });

  it('respects pagination', async () => {
    await push([
      createOperation(1, FIRST_NOTE_ID, {
        title: 'Alpha Plan',
        content: 'First plan about alpha.',
      }),
      createOperation(2, SECOND_NOTE_ID, {
        title: 'Alpha Review',
        content: 'Review of alpha project.',
      }),
      createOperation(3, THIRD_NOTE_ID, {
        title: 'Alpha Retro',
        content: 'Retrospective on alpha.',
      }),
    ]).expect(200);

    const page1 = await request(app.getHttpServer())
      .get('/search?query=alpha&limit=2&offset=0')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.total).toBe(3);

    const page2 = await request(app.getHttpServer())
      .get('/search?query=alpha&limit=2&offset=2')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.total).toBe(3);
  });

  it('excludes notes from other workspaces', async () => {
    await push([
      createOperation(1, FIRST_NOTE_ID, {
        title: 'My secret meeting',
        content: 'Confidential discussion.',
      }),
    ]).expect(200);

    const now = new Date();
    await database.db.insert(workspaces).values({
      id: '00000000-0000-4000-a000-ffffffffffff',
      name: 'Other Workspace',
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    await database.db.execute(sql`
      INSERT INTO notes (id, workspace_id, title, content, version, created_at, updated_at)
      VALUES (${OTHER_USER_NOTE_ID}, '00000000-0000-4000-a000-ffffffffffff', 'Their meeting', 'Their meeting notes.', 1, now(), now())
    `);

    const response = await request(app.getHttpServer())
      .get('/search?query=meeting')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0].id).toBe(FIRST_NOTE_ID);
  });

  it('returns empty results for a non-matching query', async () => {
    await push([
      createOperation(1, FIRST_NOTE_ID, {
        title: 'Cooking',
        content: 'Recipes and kitchen tips.',
      }),
    ]).expect(200);

    const response = await request(app.getHttpServer())
      .get('/search?query=astrophysics')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.items).toEqual([]);
    expect(response.body.total).toBe(0);
  });

  it('reject an empty query string', async () => {
    await request(app.getHttpServer())
      .get('/search?query=')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });

  function push(operations: unknown[]) {
    return request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ operations });
  }
});

function createOperation(
  sequence: number,
  entityId: string,
  overrides: { title?: string; content?: string } = {},
) {
  const timestamp = `2026-01-01T00:0${sequence}:00.000Z`;

  return {
    operationId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, '0')}`,
    entityId,
    entityType: 'note',
    operationType: 'create',
    baseVersion: 0,
    payload: {
      id: entityId,
      title: overrides.title ?? `Note ${sequence}`,
      content: overrides.content ?? '',
      categoryId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: timestamp,
      version: 0,
    },
    createdAt: timestamp,
  };
}
