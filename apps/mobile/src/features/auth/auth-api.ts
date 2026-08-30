import {
  authResponseSchema,
  errorResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
  type LoginRequest,
  type RegisterRequest,
} from '@bigmind/contracts';

import { getApiUrl } from './api-url';

/**
 * Auth API client. Reuses the shared ts-rest zod contracts for request
 * validation (client-side) and response validation, on both web and mobile.
 */
export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const body = loginRequestSchema.parse({
    email,
    password,
  } satisfies LoginRequest);
  return request('/auth/login', body);
}

export async function register(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const body = registerRequestSchema.parse({
    email,
    password,
  } satisfies RegisterRequest);
  return request('/auth/register', body);
}

async function request(
  path: string,
  body: { email: string; password: string },
): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      'Network unavailable. Check your connection and try again.',
    );
  }

  const data: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const parsedError = errorResponseSchema.safeParse(data);
    throw new Error(
      parsedError.success
        ? parsedError.data.message
        : 'Authentication failed. Try again.',
    );
  }

  const parsed = authResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Unexpected server response. Please try again.');
  }
  return parsed.data;
}
