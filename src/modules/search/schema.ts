import { z } from 'zod';

export const SearchEntityTypeSchema = z.enum(['CASE', 'INVOICE', 'PAYMENT', 'COURIER_DOCKET', 'INVESTIGATOR']);

export const GlobalSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Search query must not be empty').max(100, 'Search query too long'),
  entity_types: z.array(SearchEntityTypeSchema).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  client_id: z.string().uuid().optional(),
});

export type GlobalSearchQueryParams = z.infer<typeof GlobalSearchQuerySchema>;
