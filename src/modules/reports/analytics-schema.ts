import { z } from 'zod';

export const AnalyticsDateRangeSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  client_id: z.string().uuid().optional(),
  investigator_id: z.string().uuid().optional(),
  case_type_id: z.string().uuid().optional(),
  location_city: z.string().optional(),
  location_state: z.string().optional(),
  period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).default('MONTHLY'),
});

export type AnalyticsDateRangeParams = z.infer<typeof AnalyticsDateRangeSchema>;

export const ExportRequestSchema = z.object({
  export_type: z.enum(['OPERATIONS', 'FINANCIAL', 'LOGISTICS', 'CASES_LIST', 'INVOICES_LIST', 'PAYMENTS_LIST']),
  format: z.enum(['CSV', 'EXCEL', 'PDF']),
  filter_params: z.record(z.any()).default({}),
});

export type ExportRequestInput = z.infer<typeof ExportRequestSchema>;
