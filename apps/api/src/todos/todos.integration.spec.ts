import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';

import { AppModule } from '../app/app.module';
import { DatabaseService } from '../database/database.service';
import { notes, users, workspaces, workspaceMembers } from '../database/schema';

const OWNER_EMAIL = 'todos-owner@example.com';
const VIEWER_EMAIL = 'todos-viewer@example.com';
const PASSWORD = 'password123';
const WORKSPACE_ID = '00000000-0000-4000-a000-000000000500';
const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const MARKDOWN_NOTE_ID = '22222222-2222-4222-8222-222222222222';

describe('Todos API (integration)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ownerToken: string;
  let viewerToken: string;

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

    const ownerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: OWNER_EMAIL, password: PASSWORD })
      .expect(201);
    ownerToken = ownerReg.body.accessToken;

    const viewerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: VIEWER_EMAIL, password: PASSWORD })
      .expect(201);
    viewerToken = viewerReg.body.accessToken;
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table todo_items, todo_lists, notes, workspace_members, workspaces, refresh_tokens, users restart identity cascade`,
    );

    const now = new Date();

    const [owner] = await database.db
      .insert(users)
      .values({
        id: '00000000-0000-4000-8000-000000000050',
        email: OWNER_EMAIL,
        passwordHash: 'hash',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [viewer] = await database.db
      .insert(users)
      .values({
        id: '00000000-0000-4000-8000-000000000051',
        email: VIEWER_EMAIL,
        passwordHash: 'hash',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await database.db.insert(workspaces).values({
      id: WORKSPACE_ID,
      name: 'Todos WS',
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(workspaceMembers).values([
      {
        workspaceId: WORKSPACE_ID,
        userId: owner.id,
        role: 'OWNER',
        createdAt: now,
      },
      {
        workspaceId: WORKSPACE_ID,
        userId: viewer.id,
        role: 'VIEWER',
        createdAt: now,
      },
    ]);

    await database.db.insert(notes).values([
      {
        id: NOTE_ID,
        workspaceId: WORKSPACE_ID,
        title: 'Todo Note',
        content: '',
        templateType: 'TODO_LIST',
        version: 1,
        categoryId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: MARKDOWN_NOTE_ID,
        workspaceId: WORKSPACE_ID,
        title: 'Markdown Note',
        content: '',
        templateType: 'MARKDOWN',
        version: 1,
        categoryId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  function auth(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  describe('POST /notes/:id/todos', () => {
    it('creates a todo item on a TODO_LIST note', async () => {
      const res = await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/todos`)
        .set(auth(ownerToken))
        .send({ text: 'Buy milk' })
        .expect(201);

      expect(res.body.text).toBe('Buy milk');
      expect(res.body.completed).toBe(false);
      expect(res.body.position).toBe(0);
    });

    it('rejects creating items on MARKDOWN notes', async () => {
      await request(app.getHttpServer())
        .post(`/notes/${MARKDOWN_NOTE_ID}/todos`)
        .set(auth(ownerToken))
        .send({ text: 'Should fail' })
        .expect(400);
    });

    it('rejects VIEWER from creating items', async () => {
      await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/todos`)
        .set(auth(viewerToken))
        .send({ text: 'Hack' })
        .expect(403);
    });
  });

  describe('GET /notes/:id/todos', () => {
    it('lists todo items ordered by position', async () => {
      await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/todos`)
        .set(auth(ownerToken))
        .send({ text: 'First' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/todos`)
        .set(auth(ownerToken))
        .send({ text: 'Second' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/notes/${NOTE_ID}/todos`)
        .set(auth(ownerToken))
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].text).toBe('First');
      expect(res.body[1].text).toBe('Second');
    });
  });

  describe('PATCH /notes/:id/todos/:itemId', () => {
    it('updates a todo item text', async () => {
      const created = await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/todos`)
        .set(auth(ownerToken))
        .send({ text: 'Old text' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/notes/${NOTE_ID}/todos/${created.body.id}`)
        .set(auth(ownerToken))
        .send({ text: 'New text' })
        .expect(200);

      expect(res.body.text).toBe('New text');
    });
  });

  describe('PUT /notes/:id/todos/:itemId/toggle', () => {
    it('toggles completion status', async () => {
      const created = await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/todos`)
        .set(auth(ownerToken))
        .send({ text: 'Task' })
        .expect(201);

      expect(created.body.completed).toBe(false);

      const toggled = await request(app.getHttpServer())
        .put(`/notes/${NOTE_ID}/todos/${created.body.id}/toggle`)
        .set(auth(ownerToken))
        .expect(200);

      expect(toggled.body.completed).toBe(true);
    });
  });

  describe('DELETE /notes/:id/todos/:itemId', () => {
    it('deletes a todo item', async () => {
      const created = await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/todos`)
        .set(auth(ownerToken))
        .send({ text: 'Delete me' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/notes/${NOTE_ID}/todos/${created.body.id}`)
        .set(auth(ownerToken))
        .expect(200);

      const list = await request(app.getHttpServer())
        .get(`/notes/${NOTE_ID}/todos`)
        .set(auth(ownerToken))
        .expect(200);

      expect(list.body).toHaveLength(0);
    });
  });
});
