import { initContract } from '@ts-rest/core';

import {
  pullQuerySchema,
  pullResponseSchema,
  pushRequestSchema,
  pushResponseSchema,
} from './sync.schemas.js';

const contract = initContract();

export const syncContract = contract.router(
  {
    push: {
      method: 'POST',
      path: '/sync/push',
      body: pushRequestSchema,
      responses: {
        200: pushResponseSchema,
      },
      summary: 'Push an ordered batch of offline entity operations',
    },
    pull: {
      method: 'GET',
      path: '/sync/pull',
      query: pullQuerySchema,
      responses: {
        200: pullResponseSchema,
      },
      summary: 'Pull entity changes after a server sequence cursor',
    },
  },
  {
    strictStatusCodes: true,
    validateResponseOnClient: true,
  },
);
