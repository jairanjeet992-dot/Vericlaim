import { z } from 'zod';

export const CreateAgencySchema = z.object({
  name: z.string().min(2, 'Agency name is required'),
  code: z
    .string()
    .min(2, 'Agency code must be at least 2 characters')
    .max(16, 'Agency code must be at most 16 characters')
    .regex(/^[A-Z0-9_-]+$/, 'Agency code must be alphanumeric uppercase')
    .transform((v) => v.trim().toUpperCase()),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, 'Slug must be URL-safe lowercase'),
  state_code: z.string().length(2, 'State code must be exactly 2 digits').default('23'),
  gstin: z.string().length(15, 'GSTIN must be 15 characters').optional().nullable(),
  address: z.string().default(''),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  plan_id: z.string().uuid().default('00000000-0000-0000-0000-000000000001'),
});

export type CreateAgencyInput = z.infer<typeof CreateAgencySchema>;

export const CreateFirstOwnerSchema = z.object({
  agency_id: z.string().uuid(),
  username: z.string().min(3).max(64).transform((v) => v.trim().toLowerCase()),
  full_name: z.string().min(2),
  password: z.string().min(8),
  phone: z.string().optional().nullable(),
});

export type CreateFirstOwnerInput = z.infer<typeof CreateFirstOwnerSchema>;

export const SuspendAgencySchema = z.object({
  agency_id: z.string().uuid(),
  is_active: z.boolean(),
  reason: z.string().min(5, 'Reason for status change is mandatory'),
});

export type SuspendAgencyInput = z.infer<typeof SuspendAgencySchema>;

export const ChangePlanSchema = z.object({
  agency_id: z.string().uuid(),
  plan_id: z.string().uuid(),
});

export type ChangePlanInput = z.infer<typeof ChangePlanSchema>;
