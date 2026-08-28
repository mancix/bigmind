import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';

import { AppModule } from '../app/app.module';
import { DatabaseService } from '../database/database.service';

const TEST_EMAIL = 'create-ws-user@example.com';
const TEST_PASSWORD = 'password123';

describe('Workspace creation (integration)', () => {
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

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(201);
    authToken = reg.body.accessToken;
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table workspace_invitations, workspace_members, workspaces, change_log, sync_operations, note_links, notes, categories, refresh_tokens, users restart identity cascade`,
    );

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(201);
    authToken = reg.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  function auth(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  describe('POST /workspaces', () => {
    it('creates a workspace and assigns the creator as OWNER', async () => {
      const response = await request(app.getHttpServer())
        .post('/workspaces')
        .set(auth(authToken))
        .send({
          name: '  New Product Workspace  ',
          description: '  Workspace for new products  ',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'New Product Workspace',
        description: 'Workspace for new products',
        role: 'OWNER',
      });
      expect(response.body.id).toBeTruthy();

      const membersResponse = await request(app.getHttpServer())
        .get(`/workspaces/${response.body.id}/members`)
        .set(auth(authToken))
        .expect(200);

      expect(membersResponse.body).toHaveLength(1);
      expect(membersResponse.body[0]).toMatchObject({
        email: TEST_EMAIL,
        role: 'OWNER',
      });
    });

    it('rejects names shorter than 3 characters (400)', async () => {
      await request(app.getHttpServer())
        .post('/workspaces')
        .set(auth(authToken))
        .send({
          name: ' AB ',
          description: 'Too short name',
        })
        .expect(400);
    });

    it('rejects names longer than 100 characters (400)', async () => {
      const longName = 'A'.repeat(101);
      await request(app.getHttpServer())
        .post('/workspaces')
        .set(auth(authToken))
        .send({
          name: longName,
        })
        .expect(400);
    });

    it('rejects unauthenticated requests (401)', async () => {
      await request(app.getHttpServer())
        .post('/workspaces')
        .send({
          name: 'Unauthorized Workspace',
        })
        .expect(401);
    });
  });
});
