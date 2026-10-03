import { z } from 'zod';

export const AuditLogEntrySchema = z.object({
  id: z.string().uuid().optional(),
  agency_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  platform_admin_id: z.string().uuid().nullable().optional(),
  action: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: z.string().uuid(),
  old_values: z.record(z.unknown()).nullable().optional(),
  new_values: z.record(z.unknown()).nullable().optional(),
  ip_address: z.string().nullable().optional(),
  user_agent: z.string().nullable().optional(),
  created_at: z.string().datetime().optional(),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
