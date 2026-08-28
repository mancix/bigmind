import { Controller, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { searchContract } from '@bigmind/contracts';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';

import { WorkspaceGuard } from '../auth/jwt-auth.guard';
import { SearchService } from './search.service';

@UseGuards(AuthGuard('jwt'), WorkspaceGuard)
@Controller()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @TsRestHandler(searchContract.search)
  search(@Req() req: any) {
    return tsRestHandler(searchContract.search, async ({ query }) => ({
      status: 200,
      body: await this.searchService.search(
        query.query,
        query.limit,
        query.offset,
        req.workspaceId,
      ),
    }));
  }
}
