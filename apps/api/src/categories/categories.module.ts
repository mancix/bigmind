import { Module } from '@nestjs/common';

import { CategoriesRepository } from './categories.repository';
import { CategoriesService } from './categories.service';

@Module({
  providers: [CategoriesRepository, CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
