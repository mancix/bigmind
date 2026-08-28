import { initContract } from '@ts-rest/core';
import { z } from 'zod';

import {
  authResponseSchema,
  errorResponseSchema,
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
} from './auth.schemas.js';

const logoutResponseSchema = z.object({
  message: z.string(),
});

const contract = initContract();

export const authContract = contract.router(
  {
    register: {
      method: 'POST',
      path: '/auth/register',
      body: registerRequestSchema,
      responses: {
        201: authResponseSchema,
        409: errorResponseSchema,
      },
      summary: 'Register a new user account',
    },
    login: {
      method: 'POST',
      path: '/auth/login',
      body: loginRequestSchema,
      responses: {
        200: authResponseSchema,
        401: errorResponseSchema,
      },
      summary: 'Authenticate with email and password',
    },
    refresh: {
      method: 'POST',
      path: '/auth/refresh',
      body: refreshRequestSchema,
      responses: {
        200: authResponseSchema,
        401: errorResponseSchema,
      },
      summary: 'Issue a new access token using a refresh token',
    },
    logout: {
      method: 'POST',
      path: '/auth/logout',
      body: logoutRequestSchema,
      responses: {
        200: logoutResponseSchema,
        401: errorResponseSchema,
      },
      summary: 'Revoke a refresh token',
    },
  },
  {
    strictStatusCodes: true,
    validateResponseOnClient: true,
  },
);
