import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotesModule } from '../notes/notes.module';
import { CategoriesModule } from '../categories/categories.module';
import { LinksModule } from '../links/links.module';
import { WorkspaceModule } from '../workspaces/workspaces.module';
import { SyncController } from './sync.controller';
import { SyncRepository } from './sync.repository';
import { SyncService } from './sync.service';

@Module({
  imports: [AuthModule, NotesModule, CategoriesModule, LinksModule, WorkspaceModule],
  controllers: [SyncController],
  providers: [SyncRepository, SyncService],
})
export class SyncModule {}
