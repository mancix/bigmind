import { Module } from '@nestjs/common';
import { TsRestModule } from '@ts-rest/nest';

import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { SearchModule } from '../search/search.module';
import { SyncModule } from '../sync/sync.module';
import { TodosModule } from '../todos/todos.module';
import { RemindersModule } from '../reminders/reminders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkspaceModule } from '../workspaces/workspaces.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    SearchModule,
    SyncModule,
    TodosModule,
    RemindersModule,
    NotificationsModule,
    WorkspaceModule,
    TsRestModule.register({
      isGlobal: true,
      validateRequestBody: true,
      validateRequestQuery: true,
      validateResponses: true,
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
