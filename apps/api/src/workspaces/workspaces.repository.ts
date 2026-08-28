import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';

import { DatabaseService, type DatabaseTransaction } from '../database/database.service';
import {
  type NewWorkspace,
  type NewWorkspaceMember,
  type WorkspaceMemberRow,
  type WorkspaceRow,
  users,
  workspaceMembers,
  workspaces,
} from '../database/schema';

export type WorkspaceRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface WorkspaceWithRole extends WorkspaceRow {
  role: WorkspaceRole;
}

@Injectable()
export class WorkspaceRepository {
  constructor(private readonly database: DatabaseService) {}

  private db(tx?: DatabaseTransaction) {
    return tx ?? this.database.db;
  }

  async createWorkspace(
    values: NewWorkspace,
    tx?: DatabaseTransaction,
  ): Promise<WorkspaceRow> {
    const [workspace] = await this.db(tx)
      .insert(workspaces)
      .values(values)
      .returning();

    return workspace;
  }

  async addMember(
    values: NewWorkspaceMember,
    tx?: DatabaseTransaction,
  ): Promise<WorkspaceMemberRow> {
    const [member] = await this.db(tx)
      .insert(workspaceMembers)
      .values(values)
      .returning();

    return member;
  }

  async removeMember(
    workspaceId: string,
    userId: string,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    const result = await this.db(tx)
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .returning({ id: workspaceMembers.userId });

    if (result.length === 0) {
      throw new NotFoundException('Membership not found');
    }
  }

  async listUserWorkspaces(
    userId: string,
    tx?: DatabaseTransaction,
  ): Promise<WorkspaceWithRole[]> {
    return this.db(tx)
      .select({
        id: workspaces.id,
        name: workspaces.name,
        description: workspaces.description,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId));
  }

  async findWorkspaceById(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<WorkspaceRow | undefined> {
    const [workspace] = await this.db(tx)
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1);

    return workspace;
  }

  async getUserRole(
    workspaceId: string,
    userId: string,
    tx?: DatabaseTransaction,
  ): Promise<WorkspaceRole | undefined> {
    const [member] = await this.db(tx)
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);

    return member?.role;
  }

  async listMembers(
    workspaceId: string,
    tx?: DatabaseTransaction,
  ): Promise<
    Array<{
      userId: string;
      email: string;
      role: WorkspaceRole;
      joinedAt: Date;
    }>
  > {
    return this.db(tx)
      .select({
        userId: workspaceMembers.userId,
        email: users.email,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId));
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    const result = await this.db(tx)
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .returning({ id: workspaceMembers.userId });

    if (result.length === 0) {
      throw new NotFoundException('Member not found');
    }
  }

  async updateWorkspace(
    id: string,
    data: { name?: string; description?: string | null; updatedAt: Date },
    tx?: DatabaseTransaction,
  ): Promise<WorkspaceRow | undefined> {
    const [workspace] = await this.db(tx)
      .update(workspaces)
      .set(data)
      .where(eq(workspaces.id, id))
      .returning();

    return workspace;
  }

  async countMembers(
    workspaceId: string,
    tx?: DatabaseTransaction,
  ): Promise<number> {
    const [result] = await this.db(tx)
      .select({ count: count() })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));

    return result?.count ?? 0;
  }

  async deleteWorkspace(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    await this.db(tx)
      .delete(workspaces)
      .where(eq(workspaces.id, id));
  }

  async countOwners(
    workspaceId: string,
    tx?: DatabaseTransaction,
  ): Promise<number> {
    const [result] = await this.db(tx)
      .select({ count: count() })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.role, 'OWNER'),
        ),
      );

    return result?.count ?? 0;
  }
}