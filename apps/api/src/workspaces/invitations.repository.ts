import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DatabaseService, type DatabaseTransaction } from '../database/database.service';
import type {
  NewWorkspaceInvitation,
  WorkspaceInvitationRow,
} from '../database/schema';
import { workspaceInvitations } from '../database/schema';

@Injectable()
export class InvitationsRepository {
  constructor(private readonly database: DatabaseService) {}

  private db(tx?: DatabaseTransaction) {
    return tx ?? this.database.db;
  }

  async create(
    values: NewWorkspaceInvitation,
    tx?: DatabaseTransaction,
  ): Promise<WorkspaceInvitationRow> {
    const [invitation] = await this.db(tx)
      .insert(workspaceInvitations)
      .values(values)
      .returning();
    return invitation;
  }

  async findByToken(
    token: string,
    tx?: DatabaseTransaction,
  ): Promise<WorkspaceInvitationRow | undefined> {
    const [invitation] = await this.db(tx)
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.token, token))
      .limit(1);
    return invitation;
  }

  async findByWorkspace(
    workspaceId: string,
    tx?: DatabaseTransaction,
  ): Promise<WorkspaceInvitationRow[]> {
    return this.db(tx)
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, workspaceId));
  }

  async findPending(
    workspaceId: string,
    email: string,
    tx?: DatabaseTransaction,
  ): Promise<WorkspaceInvitationRow | undefined> {
    const [invitation] = await this.db(tx)
      .select()
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.email, email),
          isNull(workspaceInvitations.acceptedAt),
        ),
      )
      .limit(1);
    return invitation;
  }

  async markAccepted(
    id: string,
    acceptedAt: Date,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    await this.db(tx)
      .update(workspaceInvitations)
      .set({ acceptedAt })
      .where(eq(workspaceInvitations.id, id));
  }

  async delete(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    const result = await this.db(tx)
      .delete(workspaceInvitations)
      .where(eq(workspaceInvitations.id, id))
      .returning({ id: workspaceInvitations.id });

    if (result.length === 0) {
      throw new NotFoundException('Invitation not found');
    }
  }
}