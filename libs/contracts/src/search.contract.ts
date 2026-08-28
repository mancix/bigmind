import { initContract } from '@ts-rest/core';

import {
  searchQuerySchema,
  searchResponseSchema,
} from './search.schemas.js';

const contract = initContract();

export const searchContract = contract.router(
  {
    search: {
      method: 'GET',
      path: '/search',
      query: searchQuerySchema,
      responses: {
        200: searchResponseSchema,
      },
      summary: 'Full-text search across user notes',
    },
  },
  {
    strictStatusCodes: true,
    validateResponseOnClient: true,
  },
);
