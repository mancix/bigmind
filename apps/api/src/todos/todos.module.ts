import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotesModule } from '../notes/notes.module';
import { WorkspaceModule } from '../workspaces/workspaces.module';
import { TodosController } from './todos.controller';
import { TodosRepository } from './todos.repository';
import { TodosService } from './todos.service';

@Module({
  imports: [AuthModule, WorkspaceModule, NotesModule],
  controllers: [TodosController],
  providers: [TodosRepository, TodosService],
})
export class TodosModule {}
