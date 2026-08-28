import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { AppModule } from '../app/app.module';
import { DatabaseService } from '../database/database.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';

describe('UsersModule', () => {
  let database: DatabaseService;
  let repository: UsersRepository;
  let service: UsersService;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://bigmind:bigmind@localhost:5432/bigmind_test';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(DatabaseService);
    repository = app.get(UsersRepository);
    service = app.get(UsersService);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table workspace_members, workspaces, refresh_tokens, users restart identity cascade`,
    );
  });

  describe('UsersRepository', () => {
    it('creates a user and returns it', async () => {
      const now = new Date();
      const user = await repository.create({
        id: TEST_USER_ID,
        email: 'test@example.com',
        passwordHash: 'hashed_password',
        createdAt: now,
        updatedAt: now,
      });

      expect(user).toMatchObject({
        id: TEST_USER_ID,
        email: 'test@example.com',
        passwordHash: 'hashed_password',
      });
    });

    it('finds a user by id', async () => {
      const now = new Date();
      await repository.create({
        id: TEST_USER_ID,
        email: 'test@example.com',
        passwordHash: 'hashed_password',
        createdAt: now,
        updatedAt: now,
      });

      const found = await repository.findById(TEST_USER_ID);
      expect(found).toBeDefined();
      expect(found!.email).toBe('test@example.com');
    });

    it('returns undefined when finding a non-existent id', async () => {
      const found = await repository.findById('00000000-0000-4000-8000-ffffffffffff');
      expect(found).toBeUndefined();
    });

    it('finds a user by email', async () => {
      const now = new Date();
      await repository.create({
        id: TEST_USER_ID,
        email: 'test@example.com',
        passwordHash: 'hashed_password',
        createdAt: now,
        updatedAt: now,
      });

      const found = await repository.findByEmail('test@example.com');
      expect(found).toBeDefined();
      expect(found!.id).toBe(TEST_USER_ID);
    });

    it('returns undefined when finding a non-existent email', async () => {
      const found = await repository.findByEmail('nonexistent@example.com');
      expect(found).toBeUndefined();
    });

    it('enforces unique email constraint', async () => {
      const now = new Date();
      await repository.create({
        id: TEST_USER_ID,
        email: 'unique@example.com',
        passwordHash: 'hash1',
        createdAt: now,
        updatedAt: now,
      });

      await expect(
        repository.create({
          id: '00000000-0000-4000-8000-000000000002',
          email: 'unique@example.com',
          passwordHash: 'hash2',
          createdAt: now,
          updatedAt: now,
        }),
      ).rejects.toThrow();
    });
  });

  describe('UsersService', () => {
    it('delegates findById to repository', async () => {
      const now = new Date();
      await repository.create({
        id: TEST_USER_ID,
        email: 'service-test@example.com',
        passwordHash: 'hashed_password',
        createdAt: now,
        updatedAt: now,
      });

      const user = await service.findById(TEST_USER_ID);
      expect(user).toBeDefined();
      expect(user!.email).toBe('service-test@example.com');
    });

    it('delegates findByEmail to repository', async () => {
      const now = new Date();
      await repository.create({
        id: TEST_USER_ID,
        email: 'find-by-email@example.com',
        passwordHash: 'hashed_password',
        createdAt: now,
        updatedAt: now,
      });

      const user = await service.findByEmail('find-by-email@example.com');
      expect(user).toBeDefined();
      expect(user!.id).toBe(TEST_USER_ID);
    });

    it('delegates create to repository', async () => {
      const now = new Date();
      const user = await service.create({
        id: TEST_USER_ID,
        email: 'create-test@example.com',
        passwordHash: 'hashed_password',
        createdAt: now,
        updatedAt: now,
      });

      expect(user).toMatchObject({
        id: TEST_USER_ID,
        email: 'create-test@example.com',
      });
    });
  });
});
