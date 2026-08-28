import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { WorkspacesController } from './workspaces.controller';
import { WorkspaceRepository } from './workspaces.repository';
import { WorkspaceService } from './workspaces.service';
import { InvitationsRepository } from './invitations.repository';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [UsersModule],
  controllers: [WorkspacesController],
  providers: [
    WorkspaceRepository,
    WorkspaceService,
    InvitationsRepository,
    InvitationsService,
  ],
  exports: [WorkspaceRepository, WorkspaceService, InvitationsRepository, InvitationsService],
})
export class WorkspaceModule {}