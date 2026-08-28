import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';

import { AppModule } from '../app/app.module';
import { DatabaseService } from '../database/database.service';
import { notes, users, workspaces, workspaceMembers } from '../database/schema';

const OWNER_EMAIL = 'notes-owner@example.com';
const EDITOR_EMAIL = 'notes-editor@example.com';
const VIEWER_EMAIL = 'notes-viewer@example.com';
const PASSWORD = 'password123';

const SOURCE_WS = '00000000-0000-4000-a000-000000000400';
const DEST_WS = '00000000-0000-4000-a000-000000000401';
const NO_ACCESS_WS = '00000000-0000-4000-a000-000000000402';
const NOTE_ID = '11111111-1111-4111-8111-111111111111';

describe('Notes move/copy (integration)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ownerToken: string;
  let editorToken: string;
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

    const editorReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: EDITOR_EMAIL, password: PASSWORD })
      .expect(201);
    editorToken = editorReg.body.accessToken;

    const viewerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: VIEWER_EMAIL, password: PASSWORD })
      .expect(201);
    viewerToken = viewerReg.body.accessToken;
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table note_links, notes, workspace_members, workspaces, refresh_tokens, users restart identity cascade`,
    );

    const now = new Date();

    const [owner] = await database.db
      .insert(users)
      .values({ id: '00000000-0000-4000-8000-000000000010', email: OWNER_EMAIL, passwordHash: 'hash', createdAt: now, updatedAt: now })
      .returning();

    const [editor] = await database.db
      .insert(users)
      .values({ id: '00000000-0000-4000-8000-000000000011', email: EDITOR_EMAIL, passwordHash: 'hash', createdAt: now, updatedAt: now })
      .returning();

    const [viewer] = await database.db
      .insert(users)
      .values({ id: '00000000-0000-4000-8000-000000000012', email: VIEWER_EMAIL, passwordHash: 'hash', createdAt: now, updatedAt: now })
      .returning();

    await database.db.insert(workspaces).values([
      { id: SOURCE_WS, name: 'Source Workspace', createdAt: now, updatedAt: now },
      { id: DEST_WS, name: 'Destination Workspace', createdAt: now, updatedAt: now },
      { id: NO_ACCESS_WS, name: 'No Access Workspace', createdAt: now, updatedAt: now },
    ]);

    await database.db.insert(workspaceMembers).values([
      { workspaceId: SOURCE_WS, userId: owner.id, role: 'OWNER', createdAt: now },
      { workspaceId: SOURCE_WS, userId: editor.id, role: 'EDITOR', createdAt: now },
      { workspaceId: SOURCE_WS, userId: viewer.id, role: 'VIEWER', createdAt: now },
      { workspaceId: DEST_WS, userId: owner.id, role: 'OWNER', createdAt: now },
      { workspaceId: DEST_WS, userId: editor.id, role: 'EDITOR', createdAt: now },
      { workspaceId: DEST_WS, userId: viewer.id, role: 'VIEWER', createdAt: now },
    ]);

    await database.db.insert(notes).values({
      id: NOTE_ID,
      workspaceId: SOURCE_WS,
      title: 'Test Note',
      content: 'Hello world',
      categoryId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  function auth(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  describe('POST /notes/:id/move', () => {
    it('allows OWNER to move a note to another workspace', async () => {
      const res = await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/move`)
        .set(auth(ownerToken))
        .send({ destinationWorkspaceId: DEST_WS })
        .expect(201);

      expect(res.body.workspaceId).toBe(DEST_WS);
      expect(res.body.title).toBe('Test Note');
    });

    it('allows EDITOR to move a note to another workspace', async () => {
      const res = await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/move`)
        .set(auth(editorToken))
        .send({ destinationWorkspaceId: DEST_WS })
        .expect(201);

      expect(res.body.workspaceId).toBe(DEST_WS);
    });

    it('rejects VIEWER from moving a note (403)', async () => {
      await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/move`)
        .set(auth(viewerToken))
        .send({ destinationWorkspaceId: DEST_WS })
        .expect(403);
    });

    it('rejects moving to a workspace where the user has no access (403)', async () => {
      await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/move`)
        .set(auth(ownerToken))
        .send({ destinationWorkspaceId: NO_ACCESS_WS })
        .expect(403);
    });

    it('rejects moving to the same workspace (409)', async () => {
      await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/move`)
        .set(auth(ownerToken))
        .send({ destinationWorkspaceId: SOURCE_WS })
        .expect(409);
    });

    it('returns 404 for non-existent note', async () => {
      await request(app.getHttpServer())
        .post(`/notes/00000000-0000-4000-8000-ffffffffffff/move`)
        .set(auth(ownerToken))
        .send({ destinationWorkspaceId: DEST_WS })
        .expect(404);
    });
  });

  describe('POST /notes/:id/copy', () => {
    it('allows OWNER to copy a note to another workspace', async () => {
      const res = await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/copy`)
        .set(auth(ownerToken))
        .send({ destinationWorkspaceId: DEST_WS })
        .expect(201);

      expect(res.body.workspaceId).toBe(DEST_WS);
      expect(res.body.title).toBe('Test Note');
      expect(res.body.content).toBe('Hello world');
      expect(res.body.id).not.toBe(NOTE_ID);
    });

    it('allows EDITOR to copy a note to another workspace', async () => {
      const res = await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/copy`)
        .set(auth(editorToken))
        .send({ destinationWorkspaceId: DEST_WS })
        .expect(201);

      expect(res.body.workspaceId).toBe(DEST_WS);
    });

    it('rejects VIEWER from copying a note (403)', async () => {
      await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/copy`)
        .set(auth(viewerToken))
        .send({ destinationWorkspaceId: DEST_WS })
        .expect(403);
    });

    it('preserves source note after copy', async () => {
      const res = await request(app.getHttpServer())
        .post(`/notes/${NOTE_ID}/copy`)
        .set(auth(ownerToken))
        .send({ destinationWorkspaceId: DEST_WS })
        .expect(201);

      expect(res.body.id).not.toBe(NOTE_ID);

      const [source] = await database.db
        .select()
        .from(notes)
        .where(eq(notes.id, NOTE_ID))
        .limit(1);

      expect(source).toBeDefined();
      expect(source!.workspaceId).toBe(SOURCE_WS);
    });

    it('returns 404 for non-existent note', async () => {
      await request(app.getHttpServer())
        .post(`/notes/00000000-0000-4000-8000-ffffffffffff/copy`)
        .set(auth(ownerToken))
        .send({ destinationWorkspaceId: DEST_WS })
        .expect(404);
    });
  });
});
