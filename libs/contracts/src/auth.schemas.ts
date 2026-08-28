import { z } from 'zod';

export const registerRequestSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string(),
});

export const logoutRequestSchema = z.object({
  refreshToken: z.string(),
});

export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
});

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: authUserSchema,
});

export const errorResponseSchema = z.object({
  message: z.string(),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
