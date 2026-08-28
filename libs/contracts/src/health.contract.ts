import { initContract } from '@ts-rest/core';
import { z } from 'zod';

import { authContract } from './auth.contract.js';
import { searchContract } from './search.contract.js';
import { syncContract } from './sync.contract.js';
import { workspaceContract } from './workspace.contract.js';

const contract = initContract();

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export const healthContract = contract.router(
  {
    check: {
      method: 'GET',
      path: '/health',
      responses: {
        200: healthResponseSchema,
      },
      summary: 'Check API availability',
    },
  },
  {
    strictStatusCodes: true,
    validateResponseOnClient: true,
  },
);

export const apiContract = contract.router({
  health: healthContract,
  sync: syncContract,
  search: searchContract,
  auth: authContract,
  workspaces: workspaceContract,
});
