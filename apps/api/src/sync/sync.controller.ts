import { Controller, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { syncContract } from '@bigmind/contracts';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';

import { WorkspaceGuard } from '../auth/jwt-auth.guard';
import { SyncService } from './sync.service';

@UseGuards(AuthGuard('jwt'), WorkspaceGuard)
@Controller()
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @TsRestHandler(syncContract.push)
  push(@Req() req: any) {
    return tsRestHandler(syncContract.push, async ({ body }) => ({
      status: 200,
      body: {
        results: await this.syncService.push(body.operations, req.workspaceId),
      },
    }));
  }

  @TsRestHandler(syncContract.pull)
  pull(@Req() req: any) {
    return tsRestHandler(syncContract.pull, async ({ query }) => ({
      status: 200,
      body: await this.syncService.pull(query.cursor, query.limit, req.workspaceId),
    }));
  }
}
