import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';

import { AppModule } from '../app/app.module';
import { DatabaseService } from '../database/database.service';
import { users, workspaces, workspaceMembers } from '../database/schema';

const OWNER_EMAIL = 'ws-owner@example.com';
const OWNER_PASSWORD = 'password123';
const WORKSPACE_ID = '00000000-0000-4000-a000-000000000100';
const EDITOR_EMAIL = 'editor@example.com';
const INVITEE_EMAIL = 'invitee@example.com';
const INVITEE_PASSWORD = 'password123';

describe('Workspace invitations (integration)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ownerToken: string;
  let editorToken: string;

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

    // Register the owner (creates personal workspace, but we'll use a separate test workspace)
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
      .expect(201);
    ownerToken = reg.body.accessToken;

    const editorReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: EDITOR_EMAIL, password: OWNER_PASSWORD })
      .expect(201);
    editorToken = editorReg.body.accessToken;
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
    const [owner] = await database.db.insert(users).values({
      id: '00000000-0000-4000-8000-000000000001',
      email: OWNER_EMAIL,
      passwordHash: 'hash',
      createdAt: now,
      updatedAt: now,
    }).returning();
    const [editor] = await database.db.insert(users).values({
      id: '00000000-0000-4000-8000-000000000002',
      email: EDITOR_EMAIL,
      passwordHash: 'hash',
      createdAt: now,
      updatedAt: now,
    }).returning();
    await database.db.insert(workspaces).values({
      id: WORKSPACE_ID,
      name: 'Test Workspace',
      description: 'A test workspace',
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(workspaceMembers).values([
      { workspaceId: WORKSPACE_ID, userId: owner.id, role: 'OWNER', createdAt: now },
      { workspaceId: WORKSPACE_ID, userId: editor.id, role: 'EDITOR', createdAt: now },
    ]);
    return { owner, editor };
  }

  function auth(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  describe('POST /workspaces/:id/invitations', () => {
    it('allows OWNER to create an invitation', async () => {
      await setupTestData();

      const response = await request(app.getHttpServer())
        .post(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(ownerToken))
        .send({ email: INVITEE_EMAIL, role: 'EDITOR' })
        .expect(201);

      expect(response.body).toMatchObject({
        workspaceId: WORKSPACE_ID,
        email: INVITEE_EMAIL,
        role: 'EDITOR',
        acceptedAt: null,
      });
      expect(response.body.token).toBeTruthy();
    });

    it('rejects non-OWNER from inviting (403)', async () => {
      await setupTestData();

      await request(app.getHttpServer())
        .post(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(editorToken))
        .send({ email: INVITEE_EMAIL, role: 'EDITOR' })
        .expect(403);
    });

    it('rejects duplicate pending invitations (409)', async () => {
      await setupTestData();

      await request(app.getHttpServer())
        .post(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(ownerToken))
        .send({ email: INVITEE_EMAIL, role: 'EDITOR' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(ownerToken))
        .send({ email: INVITEE_EMAIL, role: 'VIEWER' })
        .expect(409);
    });
  });

  describe('GET /workspaces/:id/invitations', () => {
    it('lists invitations for OWNER', async () => {
      await setupTestData();

      await request(app.getHttpServer())
        .post(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(ownerToken))
        .send({ email: INVITEE_EMAIL, role: 'EDITOR' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(ownerToken))
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        email: INVITEE_EMAIL,
        role: 'EDITOR',
      });
    });

    it('rejects non-OWNER from listing (403)', async () => {
      await setupTestData();

      await request(app.getHttpServer())
        .get(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(editorToken))
        .expect(403);
    });
  });

  describe('GET /workspace-invitations/:token', () => {
    it('returns invitation details by token', async () => {
      await setupTestData();

      const createRes = await request(app.getHttpServer())
        .post(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(ownerToken))
        .send({ email: INVITEE_EMAIL, role: 'EDITOR' })
        .expect(201);

      const token = createRes.body.token;
      const response = await request(app.getHttpServer())
        .get(`/workspace-invitations/${token}`)
        .set(auth(ownerToken))
        .expect(200);

      expect(response.body).toMatchObject({
        email: INVITEE_EMAIL,
        role: 'EDITOR',
        workspaceId: WORKSPACE_ID,
      });
    });
  });

  describe('POST /workspace-invitations/accept', () => {
    it('accepts a valid invitation and adds membership', async () => {
      await setupTestData();

      // Create invitation
      const createRes = await request(app.getHttpServer())
        .post(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(ownerToken))
        .send({ email: INVITEE_EMAIL, role: 'EDITOR' })
        .expect(201);

      // Register invitee
      const inviteeReg = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: INVITEE_EMAIL, password: INVITEE_PASSWORD })
        .expect(201);
      const inviteeToken = inviteeReg.body.accessToken;

      // Accept invitation
      const response = await request(app.getHttpServer())
        .post('/workspace-invitations/accept')
        .set(auth(inviteeToken))
        .send({ token: createRes.body.token })
        .expect(200);

      expect(response.body.acceptedAt).toBeTruthy();
    });
  });

  describe('DELETE /workspaces/:wsId/invitations/:invId', () => {
    it('allows OWNER to revoke an invitation', async () => {
      await setupTestData();

      const createRes = await request(app.getHttpServer())
        .post(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(ownerToken))
        .send({ email: INVITEE_EMAIL, role: 'EDITOR' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/workspaces/${WORKSPACE_ID}/invitations/${createRes.body.id}`)
        .set(auth(ownerToken))
        .expect(200);

      const listRes = await request(app.getHttpServer())
        .get(`/workspaces/${WORKSPACE_ID}/invitations`)
        .set(auth(ownerToken))
        .expect(200);

      expect(listRes.body).toHaveLength(0);
    });
  });
});