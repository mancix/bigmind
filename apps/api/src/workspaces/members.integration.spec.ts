import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';

import { AppModule } from '../app/app.module';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { users, workspaces, workspaceMembers } from '../database/schema';

const OWNER_EMAIL = 'ws-owner-members@example.com';
const EDITOR_EMAIL = 'ws-editor-members@example.com';
const VIEWER_EMAIL = 'ws-viewer-members@example.com';
const USER_PASSWORD = 'password123';
const WORKSPACE_ID = '00000000-0000-4000-a000-000000000200';

describe('Workspace member management (integration)', () => {
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
      .send({ email: OWNER_EMAIL, password: USER_PASSWORD })
      .expect(201);
    ownerToken = ownerReg.body.accessToken;

    const editorReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: EDITOR_EMAIL, password: USER_PASSWORD })
      .expect(201);
    editorToken = editorReg.body.accessToken;

    const viewerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: VIEWER_EMAIL, password: USER_PASSWORD })
      .expect(201);
    viewerToken = viewerReg.body.accessToken;
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table workspace_invitations, workspace_members, workspaces, change_log, sync_operations, note_links, notes, categories, refresh_tokens, users restart identity cascade`,
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  async function setupTestData() {
    const now = new Date();
    const [owner] = await database.db
      .insert(users)
      .values({
        id: '00000000-0000-4000-8000-000000000010',
        email: OWNER_EMAIL,
        passwordHash: 'hash',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [editor] = await database.db
      .insert(users)
      .values({
        id: '00000000-0000-4000-8000-000000000011',
        email: EDITOR_EMAIL,
        passwordHash: 'hash',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [viewer] = await database.db
      .insert(users)
      .values({
        id: '00000000-0000-4000-8000-000000000012',
        email: VIEWER_EMAIL,
        passwordHash: 'hash',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await database.db.insert(workspaces).values({
      id: WORKSPACE_ID,
      name: 'Members Test Workspace',
      description: 'Workspace for member tests',
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(workspaceMembers).values([
      { workspaceId: WORKSPACE_ID, userId: owner.id, role: 'OWNER', createdAt: now },
      { workspaceId: WORKSPACE_ID, userId: editor.id, role: 'EDITOR', createdAt: now },
      { workspaceId: WORKSPACE_ID, userId: viewer.id, role: 'VIEWER', createdAt: now },
    ]);

    return { owner, editor, viewer };
  }

  function auth(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  describe('GET /workspaces/:id/members', () => {
    it('allows members to list all workspace members with email, role, and joinedAt', async () => {
      await setupTestData();

      const response = await request(app.getHttpServer())
        .get(`/workspaces/${WORKSPACE_ID}/members`)
        .set(auth(ownerToken))
        .expect(200);

      expect(response.body).toHaveLength(3);
      expect(response.body[0]).toHaveProperty('email');
      expect(response.body[0]).toHaveProperty('role');
      expect(response.body[0]).toHaveProperty('joinedAt');
    });
  });

  describe('PATCH /workspaces/:id/members/:userId (Change Role)', () => {
    it('allows OWNER to change member role', async () => {
      const { editor } = await setupTestData();

      await request(app.getHttpServer())
        .patch(`/workspaces/${WORKSPACE_ID}/members/${editor.id}`)
        .set(auth(ownerToken))
        .send({ role: 'VIEWER' })
        .expect(200);
    });

    it('rejects EDITOR from changing member role (403 Forbidden)', async () => {
      const { viewer } = await setupTestData();

      await request(app.getHttpServer())
        .patch(`/workspaces/${WORKSPACE_ID}/members/${viewer.id}`)
        .set(auth(editorToken))
        .send({ role: 'EDITOR' })
        .expect(403);
    });

    it('rejects VIEWER from changing member role (403 Forbidden)', async () => {
      const { editor } = await setupTestData();

      await request(app.getHttpServer())
        .patch(`/workspaces/${WORKSPACE_ID}/members/${editor.id}`)
        .set(auth(viewerToken))
        .send({ role: 'VIEWER' })
        .expect(403);
    });

    it('prevents demoting the sole OWNER (409 Conflict)', async () => {
      const { owner } = await setupTestData();

      await request(app.getHttpServer())
        .patch(`/workspaces/${WORKSPACE_ID}/members/${owner.id}`)
        .set(auth(ownerToken))
        .send({ role: 'EDITOR' })
        .expect(409);
    });
  });

  describe('DELETE /workspaces/:id/members/:userId (Remove Member)', () => {
    it('allows OWNER to remove a member', async () => {
      const { editor } = await setupTestData();

      await request(app.getHttpServer())
        .delete(`/workspaces/${WORKSPACE_ID}/members/${editor.id}`)
        .set(auth(ownerToken))
        .expect(204);
    });

    it('rejects EDITOR from removing a member (403 Forbidden)', async () => {
      const { viewer } = await setupTestData();

      await request(app.getHttpServer())
        .delete(`/workspaces/${WORKSPACE_ID}/members/${viewer.id}`)
        .set(auth(editorToken))
        .expect(403);
    });

    it('rejects VIEWER from removing a member (403 Forbidden)', async () => {
      const { editor } = await setupTestData();

      await request(app.getHttpServer())
        .delete(`/workspaces/${WORKSPACE_ID}/members/${editor.id}`)
        .set(auth(viewerToken))
        .expect(403);
    });

    it('prevents removing the sole OWNER (409 Conflict)', async () => {
      const { owner } = await setupTestData();

      await request(app.getHttpServer())
        .delete(`/workspaces/${WORKSPACE_ID}/members/${owner.id}`)
        .set(auth(ownerToken))
        .expect(409);
    });
  });

  describe('PATCH /workspaces/:id/rename (Rename Workspace)', () => {
    it('allows OWNER to rename the workspace', async () => {
      await setupTestData();

      const response = await request(app.getHttpServer())
        .patch(`/workspaces/${WORKSPACE_ID}/rename`)
        .set(auth(ownerToken))
        .send({ name: 'Renamed Workspace' })
        .expect(200);

      expect(response.body.name).toBe('Renamed Workspace');
      expect(response.body.id).toBe(WORKSPACE_ID);
    });

    it('rejects EDITOR from renaming (403 Forbidden)', async () => {
      await setupTestData();

      await request(app.getHttpServer())
        .patch(`/workspaces/${WORKSPACE_ID}/rename`)
        .set(auth(editorToken))
        .send({ name: 'Hacked Name' })
        .expect(403);
    });

    it('rejects VIEWER from renaming (403 Forbidden)', async () => {
      await setupTestData();

      await request(app.getHttpServer())
        .patch(`/workspaces/${WORKSPACE_ID}/rename`)
        .set(auth(viewerToken))
        .send({ name: 'Hacked Name' })
        .expect(403);
    });

    it('rejects name shorter than 3 characters (400 Bad Request)', async () => {
      await setupTestData();

      await request(app.getHttpServer())
        .patch(`/workspaces/${WORKSPACE_ID}/rename`)
        .set(auth(ownerToken))
        .send({ name: 'ab' })
        .expect(400);
    });

    it('preserves workspace id after rename', async () => {
      await setupTestData();

      const response = await request(app.getHttpServer())
        .patch(`/workspaces/${WORKSPACE_ID}/rename`)
        .set(auth(ownerToken))
        .send({ name: 'Still Same Id' })
        .expect(200);

      expect(response.body.id).toBe(WORKSPACE_ID);
    });
  });

  describe('DELETE /workspaces/:id (Delete Workspace)', () => {
    const DELETE_WS_ID = '00000000-0000-4000-a000-000000000300';
    const PERSONAL_WS_ID = '00000000-0000-4000-a000-000000000301';
    const MULTI_MEMBER_WS_ID = '00000000-0000-4000-a000-000000000302';
    const NO_OWNER_WS_ID = '00000000-0000-4000-a000-000000000303';

    async function setupDeleteData() {
      const now = new Date();
      const [owner] = await database.db
        .insert(users)
        .values({
          id: '00000000-0000-4000-8000-000000000010',
          email: OWNER_EMAIL,
          passwordHash: 'hash',
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const [editor] = await database.db
        .insert(users)
        .values({
          id: '00000000-0000-4000-8000-000000000011',
          email: EDITOR_EMAIL,
          passwordHash: 'hash',
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return { owner, editor };
    }

    it('allows OWNER to delete a workspace with no other members', async () => {
      const { owner } = await setupDeleteData();
      const now = new Date();

      await database.db.insert(workspaces).values({
        id: DELETE_WS_ID,
        name: 'Delete Test Workspace',
        description: null,
        createdAt: now,
        updatedAt: now,
      });

      await database.db.insert(workspaceMembers).values({
        workspaceId: DELETE_WS_ID,
        userId: owner.id,
        role: 'OWNER',
        createdAt: now,
      });

      await request(app.getHttpServer())
        .delete(`/workspaces/${DELETE_WS_ID}`)
        .set(auth(ownerToken))
        .expect(200);

      const members = await database.db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, DELETE_WS_ID));

      expect(members).toHaveLength(0);
    });

    it('rejects EDITOR from deleting a workspace (403 Forbidden)', async () => {
      const { editor } = await setupDeleteData();
      const now = new Date();

      await database.db.insert(workspaces).values({
        id: NO_OWNER_WS_ID,
        name: 'No Owner Access',
        createdAt: now,
        updatedAt: now,
      });

      await database.db.insert(workspaceMembers).values({
        workspaceId: NO_OWNER_WS_ID,
        userId: editor.id,
        role: 'EDITOR',
        createdAt: now,
      });

      await request(app.getHttpServer())
        .delete(`/workspaces/${NO_OWNER_WS_ID}`)
        .set(auth(editorToken))
        .expect(403);
    });

    it('rejects VIEWER from deleting a workspace (403 Forbidden)', async () => {
      await request(app.getHttpServer())
        .delete(`/workspaces/${DELETE_WS_ID}`)
        .set(auth(viewerToken))
        .expect(403);
    });

    it('rejects deleting Personal Workspace (409 Conflict)', async () => {
      const { owner } = await setupDeleteData();
      const now = new Date();

      await database.db.insert(workspaces).values({
        id: PERSONAL_WS_ID,
        name: `${OWNER_EMAIL} Personal Workspace`,
        createdAt: now,
        updatedAt: now,
      });

      await database.db.insert(workspaceMembers).values({
        workspaceId: PERSONAL_WS_ID,
        userId: owner.id,
        role: 'OWNER',
        createdAt: now,
      });

      await request(app.getHttpServer())
        .delete(`/workspaces/${PERSONAL_WS_ID}`)
        .set(auth(ownerToken))
        .expect(409);
    });

    it('rejects deleting workspace with other members (409 Conflict)', async () => {
      const { owner, editor } = await setupDeleteData();
      const now = new Date();

      await database.db.insert(workspaces).values({
        id: MULTI_MEMBER_WS_ID,
        name: 'Multi Member WS',
        createdAt: now,
        updatedAt: now,
      });

      await database.db.insert(workspaceMembers).values([
        { workspaceId: MULTI_MEMBER_WS_ID, userId: owner.id, role: 'OWNER', createdAt: now },
        { workspaceId: MULTI_MEMBER_WS_ID, userId: editor.id, role: 'EDITOR', createdAt: now },
      ]);

      await request(app.getHttpServer())
        .delete(`/workspaces/${MULTI_MEMBER_WS_ID}`)
        .set(auth(ownerToken))
        .expect(409);
    });

    it('returns 404 for non-existent workspace', async () => {
      await request(app.getHttpServer())
        .delete(`/workspaces/00000000-0000-4000-a000-ffffffffffff`)
        .set(auth(ownerToken))
        .expect(404);
    });
  });
});
