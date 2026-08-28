import {
  Controller,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { workspaceContract } from '@bigmind/contracts';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';

import { WorkspaceRepository } from './workspaces.repository';
import { WorkspaceService } from './workspaces.service';
import { InvitationsService } from './invitations.service';

@UseGuards(AuthGuard('jwt'))
@Controller()
export class WorkspacesController {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly invitationsService: InvitationsService,
  ) {}

  @TsRestHandler(workspaceContract.create)
  create(@Req() req: any) {
    return tsRestHandler(workspaceContract.create, async ({ body }) => {
      const workspace = await this.workspaceService.createWorkspaceWithOwner(
        req.user.userId,
        {
          name: body.name,
          description: body.description ?? null,
        },
      );
      return {
        status: 201 as const,
        body: workspace,
      };
    });
  }

  @TsRestHandler(workspaceContract.list)
  list(@Req() req: any) {
    return tsRestHandler(workspaceContract.list, async () => {
      const workspaces = await this.workspaceRepository.listUserWorkspaces(
        req.user.userId,
      );
      return {
        status: 200 as const,
        body: workspaces.map((ws) => ({
          id: ws.id,
          name: ws.name,
          description: ws.description,
          role: ws.role,
        })),
      };
    });
  }

  @TsRestHandler(workspaceContract.delete)
  delete(@Req() req: any) {
    return tsRestHandler(
      workspaceContract.delete,
      async ({ params }) => {
        await this.workspaceService.deleteWorkspace(
          params.workspaceId,
          req.user.userId,
        );
        return {
          status: 200 as const,
          body: { message: 'Workspace deleted' },
        };
      },
    );
  }

  @TsRestHandler(workspaceContract.listMembers)
  listMembers(@Req() req: any) {
    return tsRestHandler(
      workspaceContract.listMembers,
      async ({ params }) => {
        const members = await this.workspaceService.listMembers(
          params.workspaceId,
          req.user.userId,
        );
        return {
          status: 200 as const,
          body: members.map((m) => ({
            userId: m.userId,
            email: m.email,
            role: m.role,
            joinedAt: m.joinedAt.toISOString(),
          })),
        };
      },
    );
  }

  @TsRestHandler(workspaceContract.rename)
  rename(@Req() req: any) {
    return tsRestHandler(
      workspaceContract.rename,
      async ({ params, body }) => {
        const workspace = await this.workspaceService.renameWorkspace(
          params.workspaceId,
          body.name,
          req.user.userId,
        );
        return {
          status: 200 as const,
          body: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            role: workspace.role,
          },
        };
      },
    );
  }

  @TsRestHandler(workspaceContract.changeMemberRole)
  changeMemberRole(@Req() req: any) {
    return tsRestHandler(
      workspaceContract.changeMemberRole,
      async ({ params, body }) => {
        await this.workspaceService.changeMemberRole(
          params.workspaceId,
          params.userId,
          body.role,
          req.user.userId,
        );
        const members = await this.workspaceService.listMembers(
          params.workspaceId,
          req.user.userId,
        );
        const updated = members.find((m) => m.userId === params.userId)!;
        return {
          status: 200 as const,
          body: {
            userId: updated.userId,
            email: updated.email,
            role: updated.role,
            joinedAt: updated.joinedAt.toISOString(),
          },
        };
      },
    );
  }

  @TsRestHandler(workspaceContract.removeMember)
  removeMember(@Req() req: any) {
    return tsRestHandler(
      workspaceContract.removeMember,
      async ({ params }) => {
        await this.workspaceService.removeMemberManaged(
          params.workspaceId,
          params.userId,
          req.user.userId,
        );
        return {
          status: 200 as const,
          body: { message: 'Member removed' },
        };
      },
    );
  }

  @TsRestHandler(workspaceContract.listInvitations)
  listInvitations(@Req() req: any) {
    return tsRestHandler(
      workspaceContract.listInvitations,
      async ({ params }) => {
        const invitations = await this.invitationsService.listInvitations(
          params.workspaceId,
          req.user.userId,
        );
        return {
          status: 200 as const,
          body: invitations,
        };
      },
    );
  }

  @TsRestHandler(workspaceContract.createInvitation)
  createInvitation(@Req() req: any) {
    return tsRestHandler(
      workspaceContract.createInvitation,
      async ({ params, body }) => {
        const invitation = await this.invitationsService.createInvitation(
          params.workspaceId,
          req.user.userId,
          body.email,
          body.role,
        );
        return {
          status: 201 as const,
          body: invitation,
        };
      },
    );
  }

  @TsRestHandler(workspaceContract.revokeInvitation)
  revokeInvitation(@Req() req: any) {
    return tsRestHandler(
      workspaceContract.revokeInvitation,
      async ({ params }) => {
        await this.invitationsService.revokeInvitation(
          params.workspaceId,
          params.invitationId,
          req.user.userId,
        );
        return {
          status: 200 as const,
          body: { message: 'Invitation revoked' },
        };
      },
    );
  }

  @TsRestHandler(workspaceContract.acceptInvitation)
  acceptInvitation(@Req() req: any) {
    return tsRestHandler(
      workspaceContract.acceptInvitation,
      async ({ body }) => {
        const invitation = await this.invitationsService.acceptInvitation(
          body.token,
          req.user.userId,
        );
        return {
          status: 200 as const,
          body: invitation,
        };
      },
    );
  }

  @TsRestHandler(workspaceContract.getInvitation)
  getInvitation() {
    return tsRestHandler(
      workspaceContract.getInvitation,
      async ({ params }) => {
        const invitation = await this.invitationsService.getInvitationByToken(
          params.token,
        );
        return {
          status: 200 as const,
          body: invitation,
        };
      },
    );
  }
}