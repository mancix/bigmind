import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';

import { eq } from 'drizzle-orm';

import { AppModule } from '../app/app.module';
import { DatabaseService } from '../database/database.service';
import { users, workspaces, workspaceMembers } from '../database/schema';

describe('auth API (integration)', () => {
  let app: INestApplication;
  let database: DatabaseService;

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
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table workspace_members, workspaces, refresh_tokens, users restart identity cascade`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('registers a new user, returns tokens, and creates a personal workspace', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'newuser@example.com', password: 'password123' })
        .expect(201);

      expect(response.body).toMatchObject({
        user: { email: 'newuser@example.com' },
      });
      expect(response.body.accessToken).toBeTruthy();
      expect(response.body.refreshToken).toBeTruthy();
      expect(response.body.user.id).toBeTruthy();

      const [user] = await database.db
        .select()
        .from(users)
        .where(eq(users.email, 'newuser@example.com'))
        .limit(1);

      expect(user).toBeDefined();

      const userWorkspaces = await database.db
        .select()
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(eq(workspaceMembers.userId, user!.id));

      expect(userWorkspaces).toHaveLength(1);
      expect(userWorkspaces[0].workspaces.name).toBe('Personal');
      expect(userWorkspaces[0].workspace_members.role).toBe('OWNER');
    });

    it('rejects a duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'dupe@example.com', password: 'password123' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'dupe@example.com', password: 'password123' })
        .expect(409);
    });

    it('rejects an invalid email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'password123' })
        .expect(400);
    });

    it('rejects a short password', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'short' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'login-test@example.com', password: 'thepassword' })
        .expect(201);
    });

    it('authenticates with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'login-test@example.com', password: 'thepassword' })
        .expect(200);

      expect(response.body).toMatchObject({
        user: { email: 'login-test@example.com' },
      });
      expect(response.body.accessToken).toBeTruthy();
      expect(response.body.refreshToken).toBeTruthy();
    });

    it('rejects an incorrect password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'login-test@example.com', password: 'wrongpassword' })
        .expect(401);
    });

    it('rejects a non-existent email', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'thepassword' })
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'refresh-test@example.com', password: 'password123' })
        .expect(201);

      refreshToken = response.body.refreshToken;
    });

    it('issues a new token pair with a valid refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toMatchObject({
        user: { email: 'refresh-test@example.com' },
      });
      expect(response.body.accessToken).toBeTruthy();
      expect(response.body.refreshToken).toBeTruthy();
    });

    it('rejects a revoked refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('rejects a garbage refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'garbage-token' })
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes a refresh token', async () => {
      const reg = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'logout-test@example.com', password: 'password123' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: reg.body.refreshToken })
        .expect(200);
    });

    it('accepts a garbage refresh token without error', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: 'garbage-token' })
        .expect(200);
    });
  });
});
