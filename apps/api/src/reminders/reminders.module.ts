import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotesModule } from '../notes/notes.module';
import { WorkspaceModule } from '../workspaces/workspaces.module';
import { RemindersController } from './reminders.controller';
import { RemindersRepository } from './reminders.repository';
import { RemindersService } from './reminders.service';

@Module({
  imports: [AuthModule, WorkspaceModule, NotesModule],
  controllers: [RemindersController],
  providers: [RemindersRepository, RemindersService],
})
export class RemindersModule {}
