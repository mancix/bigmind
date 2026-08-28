import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { AppModule } from '../app/app.module';
import { DatabaseService } from '../database/database.service';
import { users, type UserRow } from '../database/schema';
import { WorkspaceRepository } from './workspaces.repository';

const TEST_USER_ID = '00000000-0000-4000-8000-000000000020';
const TEST_WORKSPACE_ID = '00000000-0000-4000-8000-000000000021';

describe('WorkspaceModule', () => {
  let database: DatabaseService;
  let repository: WorkspaceRepository;

  let user: UserRow;

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
    repository = app.get(WorkspaceRepository);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table workspace_members, workspaces, refresh_tokens, users restart identity cascade`,
    );

    const now = new Date();
    [user] = await database.db
      .insert(users)
      .values({
        id: TEST_USER_ID,
        email: 'workspace-test@example.com',
        passwordHash: 'hashed_password',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  });

  describe('createWorkspace', () => {
    it('creates and returns a workspace', async () => {
      const now = new Date();
      const workspace = await repository.createWorkspace({
        id: TEST_WORKSPACE_ID,
        name: 'Test Workspace',
        description: 'A test workspace',
        createdAt: now,
        updatedAt: now,
      });

      expect(workspace).toMatchObject({
        id: TEST_WORKSPACE_ID,
        name: 'Test Workspace',
        description: 'A test workspace',
      });
    });
  });

  describe('addMember', () => {
    it('adds a member to a workspace', async () => {
      const now = new Date();
      const workspace = await repository.createWorkspace({
        id: TEST_WORKSPACE_ID,
        name: 'Test Workspace',
        createdAt: now,
        updatedAt: now,
      });

      const member = await repository.addMember({
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
        createdAt: now,
      });

      expect(member).toMatchObject({
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        role: 'OWNER',
      });
    });
  });

  describe('countMembers', () => {
    it('returns the member count for a workspace', async () => {
      const now = new Date();
      const workspace = await repository.createWorkspace({
        id: '00000000-0000-4000-8000-000000000022',
        name: 'Count Test',
        createdAt: now,
        updatedAt: now,
      });
      await repository.addMember({
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
        createdAt: now,
      });

      const count = await repository.countMembers(workspace.id);
      expect(count).toBe(1);
    });
  });

  describe('deleteWorkspace', () => {
    it('deletes a workspace and cascades members', async () => {
      const now = new Date();
      const workspace = await repository.createWorkspace({
        id: '00000000-0000-4000-8000-000000000023',
        name: 'To Delete',
        createdAt: now,
        updatedAt: now,
      });
      await repository.addMember({
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
        createdAt: now,
      });

      await repository.deleteWorkspace(workspace.id);

      const found = await repository.findWorkspaceById(workspace.id);
      expect(found).toBeUndefined();
    });
  });

  describe('removeMember', () => {
    it('removes a member from a workspace', async () => {
      const now = new Date();
      const workspace = await repository.createWorkspace({
        id: TEST_WORKSPACE_ID,
        name: 'Test Workspace',
        createdAt: now,
        updatedAt: now,
      });
      await repository.addMember({
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
        createdAt: now,
      });

      await repository.removeMember(workspace.id, user.id);

      const list = await repository.listUserWorkspaces(user.id);
      expect(list).toEqual([]);
    });

    it('throws when membership does not exist', async () => {
      await expect(
        repository.removeMember(TEST_WORKSPACE_ID, TEST_USER_ID),
      ).rejects.toThrow();
    });
  });

  describe('listUserWorkspaces', () => {
    it('returns workspaces for a user', async () => {
      const now = new Date();
      const workspace = await repository.createWorkspace({
        id: TEST_WORKSPACE_ID,
        name: 'My Workspace',
        description: 'desc',
        createdAt: now,
        updatedAt: now,
      });

      await repository.addMember({
        workspaceId: workspace.id,
        userId: user.id,
        role: 'EDITOR',
        createdAt: now,
      });

      const list = await repository.listUserWorkspaces(user.id);

      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: TEST_WORKSPACE_ID,
        name: 'My Workspace',
        description: 'desc',
        role: 'EDITOR',
      });
    });

    it('returns empty array when user has no workspaces', async () => {
      const list = await repository.listUserWorkspaces(
        '00000000-0000-4000-8000-ffffffffffff',
      );
      expect(list).toEqual([]);
    });
  });

  describe('findWorkspaceById', () => {
    it('finds a workspace by id', async () => {
      const now = new Date();
      await repository.createWorkspace({
        id: TEST_WORKSPACE_ID,
        name: 'Findable',
        createdAt: now,
        updatedAt: now,
      });

      const found = await repository.findWorkspaceById(TEST_WORKSPACE_ID);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Findable');
    });

    it('returns undefined for a non-existent id', async () => {
      const found = await repository.findWorkspaceById(
        '00000000-0000-4000-8000-ffffffffffff',
      );
      expect(found).toBeUndefined();
    });
  });

  describe('updateWorkspace', () => {
    it('updates the workspace name', async () => {
      const now = new Date();
      const workspace = await repository.createWorkspace({
        id: TEST_WORKSPACE_ID,
        name: 'Original Name',
        createdAt: now,
        updatedAt: now,
      });

      const updated = await repository.updateWorkspace(workspace.id, {
        name: 'Renamed Workspace',
        updatedAt: new Date(),
      });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Renamed Workspace');
    });

    it('returns undefined for non-existent workspace', async () => {
      const result = await repository.updateWorkspace(
        '00000000-0000-4000-8000-ffffffffffff',
        { name: 'Anything', updatedAt: new Date() },
      );
      expect(result).toBeUndefined();
    });
  });

  describe('getUserRole', () => {
    it('returns the role for a workspace member', async () => {
      const now = new Date();
      const workspace = await repository.createWorkspace({
        id: TEST_WORKSPACE_ID,
        name: 'Test Workspace',
        createdAt: now,
        updatedAt: now,
      });
      await repository.addMember({
        workspaceId: workspace.id,
        userId: user.id,
        role: 'VIEWER',
        createdAt: now,
      });

      const role = await repository.getUserRole(workspace.id, user.id);
      expect(role).toBe('VIEWER');
    });

    it('returns undefined when the user is not a member', async () => {
      const now = new Date();
      const workspace = await repository.createWorkspace({
        id: TEST_WORKSPACE_ID,
        name: 'Test Workspace',
        createdAt: now,
        updatedAt: now,
      });

      const role = await repository.getUserRole(workspace.id, TEST_USER_ID);
      expect(role).toBeUndefined();
    });
  });
});