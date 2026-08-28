import { z } from 'zod';

export const searchQuerySchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const searchResultItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
});

export const searchResponseSchema = z.object({
  items: z.array(searchResultItemSchema),
  total: z.number().int().nonnegative(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SearchResultItem = z.infer<typeof searchResultItemSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
