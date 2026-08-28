import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { LinksModule } from '../links/links.module';
import { WorkspaceModule } from '../workspaces/workspaces.module';
import { NotesController } from './notes.controller';
import { NotesRepository } from './notes.repository';
import { NotesService } from './notes.service';

@Module({
  imports: [AuthModule, WorkspaceModule, LinksModule],
  controllers: [NotesController],
  providers: [NotesRepository, NotesService],
  exports: [NotesService, NotesRepository],
})
export class NotesModule {}
