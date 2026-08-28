import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { DatabaseService } from '../database/database.service';
import { WorkspaceRepository } from './workspaces.repository';
import { InvitationsRepository } from './invitations.repository';
import { UsersRepository } from '../users/users.repository';

const INVITATION_EXPIRY_DAYS = 7;

export interface InvitationResult {
  id: string;
  workspaceId: string;
  email: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitationsRepository: InvitationsRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly usersRepository: UsersRepository,
    private readonly database: DatabaseService,
  ) {}

  async createInvitation(
    workspaceId: string,
    inviterUserId: string,
    email: string,
    role: 'EDITOR' | 'VIEWER',
  ): Promise<InvitationResult> {
    await this.assertOwner(workspaceId, inviterUserId);

    const existing = await this.invitationsRepository.findPending(workspaceId, email);
    if (existing) {
      throw new ConflictException('Pending invitation already exists for this email');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const token = randomUUID() + randomUUID();

    const invitation = await this.invitationsRepository.create({
      id: randomUUID(),
      workspaceId,
      email,
      role,
      token,
      expiresAt,
      createdAt: now,
      acceptedAt: null,
    });

    return this.toResult(invitation);
  }

  async listInvitations(
    workspaceId: string,
    requesterUserId: string,
  ): Promise<InvitationResult[]> {
    await this.assertOwner(workspaceId, requesterUserId);
    const invitations = await this.invitationsRepository.findByWorkspace(workspaceId);
    return invitations.map((inv) => this.toResult(inv));
  }

  async revokeInvitation(
    workspaceId: string,
    invitationId: string,
    requesterUserId: string,
  ): Promise<void> {
    await this.assertOwner(workspaceId, requesterUserId);
    await this.invitationsRepository.delete(invitationId);
  }

  async getInvitationByToken(token: string): Promise<InvitationResult> {
    const invitation = await this.invitationsRepository.findByToken(token);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.acceptedAt) {
      throw new ConflictException('Invitation has already been accepted');
    }
    if (invitation.expiresAt < new Date()) {
      throw new NotFoundException('Invitation has expired');
    }
    return this.toResult(invitation);
  }

  async acceptInvitation(
    token: string,
    userId: string,
  ): Promise<InvitationResult> {
    const invitation = await this.invitationsRepository.findByToken(token);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.acceptedAt) {
      throw new ConflictException('Invitation has already been accepted');
    }
    if (invitation.expiresAt < new Date()) {
      throw new NotFoundException('Invitation has expired');
    }

    const user = await this.usersRepository.findById(userId);
    if (!user || user.email !== invitation.email) {
      throw new ForbiddenException('This invitation is for a different email address');
    }

    await this.database.db.transaction(async (tx) => {
      await this.workspaceRepository.addMember(
        {
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: invitation.role,
          createdAt: new Date(),
        },
        tx,
      );
      await this.invitationsRepository.markAccepted(invitation.id, new Date(), tx);
    });

    const updated = await this.invitationsRepository.findByToken(token);
    return this.toResult(updated!);
  }

  private async assertOwner(workspaceId: string, userId: string): Promise<void> {
    const role = await this.workspaceRepository.getUserRole(workspaceId, userId);
    if (role !== 'OWNER') {
      throw new ForbiddenException('Only workspace owners can manage invitations');
    }
  }

  private toResult(row: {
    id: string;
    workspaceId: string;
    email: string;
    role: 'OWNER' | 'EDITOR' | 'VIEWER';
    token: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    createdAt: Date;
  }): InvitationResult {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      email: row.email,
      role: row.role,
      token: row.token,
      expiresAt: row.expiresAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}