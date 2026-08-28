import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { WorkspaceRepository } from '../workspaces/workspaces.repository';

export const JwtAuthGuard = AuthGuard('jwt');

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user.userId;

    const headerWorkspaceId = request.headers['x-workspace-id'] as
      | string
      | undefined;

    if (!headerWorkspaceId) {
      throw new BadRequestException('X-Workspace-Id header is required');
    }

    const role = await this.workspaceRepository.getUserRole(
      headerWorkspaceId,
      userId,
    );
    if (!role) {
      throw new ForbiddenException('Access denied to this workspace');
    }

    request.workspaceId = headerWorkspaceId;
    return true;
  }
}