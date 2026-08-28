import { Injectable } from '@nestjs/common';

import type { SearchResponse } from '@bigmind/contracts';

import { SearchRepository } from './search.repository';

@Injectable()
export class SearchService {
  constructor(private readonly searchRepository: SearchRepository) {}

  async search(
    query: string,
    limit: number,
    offset: number,
    workspaceId: string,
  ): Promise<SearchResponse> {
    return this.searchRepository.search(workspaceId, query, limit, offset);
  }
}
