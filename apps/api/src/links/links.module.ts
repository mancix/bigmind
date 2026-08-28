import { Module } from '@nestjs/common';

import { LinksRepository } from './links.repository';
import { LinksService } from './links.service';

@Module({
  providers: [LinksRepository, LinksService],
  exports: [LinksService],
})
export class LinksModule {}
