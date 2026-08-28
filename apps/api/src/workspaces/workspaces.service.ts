import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DatabaseService, type DatabaseTransaction } from '../database/database.service';
import {
  WorkspaceRepository,
  type WorkspaceRole,
  type WorkspaceWithRole,
} from './workspaces.repository';

export interface CreateWorkspaceOptions {
  name: string;
  description?: string | null;
}

export interface AddMemberOptions {
  workspaceId: string;
  userId: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  createdAt?: Date;
}

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly databaseService: DatabaseService,
  ) {}

  async createWorkspaceWithOwner(
    userId: string,
    options: CreateWorkspaceOptions,
  ): Promise<WorkspaceWithRole> {
    return this.databaseService.db.transaction(async (tx) => {
      const now = new Date();
      const workspaceId = crypto.randomUUID();
      const workspace = await this.workspaceRepository.createWorkspace(
        {
          id: workspaceId,
          name: options.name,
          description: options.description ?? null,
          createdAt: now,
          updatedAt: now,
        },
        tx,
      );

      await this.workspaceRepository.addMember(
        {
          workspaceId: workspace.id,
          userId,
          role: 'OWNER',
          createdAt: now,
        },
        tx,
      );

      return {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        role: 'OWNER',
      };
    });
  }

  async createWorkspace(
    transaction: DatabaseTransaction,
    options: CreateWorkspaceOptions,
  ): Promise<{ id: string; name: string }> {
    const now = new Date();
    const workspace = await this.workspaceRepository.createWorkspace(
      {
        id: crypto.randomUUID(),
        name: options.name,
        description: options.description ?? null,
        createdAt: now,
        updatedAt: now,
      },
      transaction,
    );

    return { id: workspace.id, name: workspace.name };
  }

  async addMember(
    transaction: DatabaseTransaction,
    options: AddMemberOptions,
  ): Promise<void> {
    await this.workspaceRepository.addMember(
      {
        workspaceId: options.workspaceId,
        userId: options.userId,
        role: options.role,
        createdAt: options.createdAt ?? new Date(),
      },
      transaction,
    );
  }

  async removeMember(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    await this.workspaceRepository.removeMember(workspaceId, userId);
  }

  listUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]> {
    return this.workspaceRepository.listUserWorkspaces(userId);
  }

  findWorkspaceById(id: string) {
    return this.workspaceRepository.findWorkspaceById(id);
  }

  getUserRole(workspaceId: string, userId: string) {
    return this.workspaceRepository.getUserRole(workspaceId, userId);
  }

  async listMembers(
    workspaceId: string,
    requesterUserId: string,
  ): Promise<
    Array<{
      userId: string;
      email: string;
      role: WorkspaceRole;
      joinedAt: Date;
    }>
  > {
    const role = await this.workspaceRepository.getUserRole(
      workspaceId,
      requesterUserId,
    );
    if (!role) {
      throw new ForbiddenException('Access denied to this workspace');
    }
    return this.workspaceRepository.listMembers(workspaceId);
  }

  async changeMemberRole(
    workspaceId: string,
    targetUserId: string,
    newRole: WorkspaceRole,
    requesterUserId: string,
  ): Promise<void> {
    const requesterRole = await this.workspaceRepository.getUserRole(
      workspaceId,
      requesterUserId,
    );
    if (requesterRole !== 'OWNER') {
      throw new ForbiddenException('Only workspace owners can manage members');
    }

    const targetRole = await this.workspaceRepository.getUserRole(
      workspaceId,
      targetUserId,
    );
    if (!targetRole) {
      throw new NotFoundException('Member not found');
    }

    if (targetRole === 'OWNER' && newRole !== 'OWNER') {
      const ownerCount = await this.workspaceRepository.countOwners(workspaceId);
      if (ownerCount <= 1) {
        throw new ConflictException(
          'Cannot demote the last owner of the workspace',
        );
      }
    }

    await this.workspaceRepository.updateMemberRole(
      workspaceId,
      targetUserId,
      newRole,
    );
  }

  async renameWorkspace(
    workspaceId: string,
    name: string,
    requesterUserId: string,
  ): Promise<WorkspaceWithRole> {
    const requesterRole = await this.workspaceRepository.getUserRole(
      workspaceId,
      requesterUserId,
    );
    if (requesterRole !== 'OWNER') {
      throw new ForbiddenException('Only workspace owners can rename the workspace');
    }

    const workspace = await this.workspaceRepository.updateWorkspace(workspaceId, {
      name,
      updatedAt: new Date(),
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      role: requesterRole,
    };
  }

  async deleteWorkspace(
    workspaceId: string,
    requesterUserId: string,
  ): Promise<void> {
    const requesterRole = await this.workspaceRepository.getUserRole(
      workspaceId,
      requesterUserId,
    );
    if (requesterRole !== 'OWNER') {
      throw new ForbiddenException('Only workspace owners can delete the workspace');
    }

    const workspace = await this.workspaceRepository.findWorkspaceById(workspaceId);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    if (workspace.name.toLowerCase().includes('personal workspace')) {
      throw new ConflictException('Personal workspaces cannot be deleted');
    }

    const memberCount = await this.workspaceRepository.countMembers(workspaceId);
    if (memberCount > 1) {
      throw new ConflictException(
        'Workspace with other members cannot be deleted. Remove all members first.',
      );
    }

    await this.workspaceRepository.deleteWorkspace(workspaceId);
  }

  async removeMemberManaged(
    workspaceId: string,
    targetUserId: string,
    requesterUserId: string,
  ): Promise<void> {
    const requesterRole = await this.workspaceRepository.getUserRole(
      workspaceId,
      requesterUserId,
    );
    if (requesterRole !== 'OWNER') {
      throw new ForbiddenException('Only workspace owners can remove members');
    }

    const targetRole = await this.workspaceRepository.getUserRole(
      workspaceId,
      targetUserId,
    );
    if (!targetRole) {
      throw new NotFoundException('Member not found');
    }

    if (targetRole === 'OWNER') {
      const ownerCount = await this.workspaceRepository.countOwners(workspaceId);
      if (ownerCount <= 1) {
        throw new ConflictException(
          'Cannot remove the last owner of the workspace',
        );
      }
    }

    await this.workspaceRepository.removeMember(workspaceId, targetUserId);
  }
}