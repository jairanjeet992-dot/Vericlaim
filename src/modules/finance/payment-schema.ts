/**
 * Vericlaim Multi-Tenant SaaS: Payment & TDS Input Validation Schemas (Phase 7B)
 * Rule A7: Strict Zod validation on all server inputs
 */

import { z } from 'zod';

export const PaymentModeSchema = z.enum([
  'NEFT',
  'RTGS',
  'IMPS',
  'CHEQUE',
  'UPI',
  'BANK_TRANSFER',
  'CASH',
]);

export const TdsSectionSchema = z.enum([
  '194J',
  '194C',
  '194H',
  '194Q',
  'OTHER',
]);

// Decimal currency string validator (e.g. "12500.50")
export const PositiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid positive currency amount with up to 2 decimal places')
  .refine((val) => parseFloat(val) > 0, 'Amount must be greater than 0');

export const RecordPaymentInputSchema = z.object({
  client_id: z.string().uuid('Invalid Client ID'),
  client_branch_id: z.string().uuid('Invalid Client Branch ID').optional().nullable(),
  payment_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD')
    .optional(),
  amount: PositiveDecimalString,
  payment_mode: PaymentModeSchema.optional().default('NEFT'),
  utr_number: z.string().trim().max(128).optional().nullable(),
  bank_name: z.string().trim().max(128).optional().nullable(),
  reference_note: z.string().trim().max(1000).optional().nullable(),
  is_advance: z.boolean().optional().default(false),
  idempotency_key: z.string().trim().max(128).optional().nullable(),
});

export type RecordPaymentInput = z.input<typeof RecordPaymentInputSchema>;

export const AllocatePaymentInputSchema = z.object({
  payment_id: z.string().uuid('Invalid Payment ID'),
  invoice_id: z.string().uuid('Invalid Invoice ID'),
  allocated_amount: PositiveDecimalString,
  case_id: z.string().uuid('Invalid Case ID').optional().nullable(),
});

export type AllocatePaymentInput = z.input<typeof AllocatePaymentInputSchema>;

export const BulkAllocateItemSchema = z.object({
  invoice_id: z.string().uuid('Invalid Invoice ID'),
  allocated_amount: PositiveDecimalString,
  case_id: z.string().uuid('Invalid Case ID').optional().nullable(),
});

export const BulkAllocatePaymentInputSchema = z.object({
  payment_id: z.string().uuid('Invalid Payment ID'),
  allocations: z.array(BulkAllocateItemSchema).min(1, 'At least one allocation item is required'),
});

export type BulkAllocatePaymentInput = z.input<typeof BulkAllocatePaymentInputSchema>;

export const RecordTdsInputSchema = z.object({
  client_id: z.string().uuid('Invalid Client ID'),
  invoice_id: z.string().uuid('Invalid Invoice ID'),
  payment_id: z.string().uuid('Invalid Payment ID').optional().nullable(),
  section: TdsSectionSchema.optional().default('194J'),
  rate: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Rate must be a valid percentage')
    .optional()
    .default('10.00'),
  amount: PositiveDecimalString,
  is_valid: z.boolean().optional().default(true),
  certificate_number: z.string().trim().max(128).optional().nullable(),
});

export type RecordTdsInput = z.input<typeof RecordTdsInputSchema>;

export const Form26ASRecordItemSchema = z.object({
  section: z.string().trim().default('194J'),
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  amount_paid: z.string().trim().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  tds_deducted: PositiveDecimalString,
});

export const Import26ASInputSchema = z.object({
  financial_year: z.string().trim().regex(/^\d{4}-\d{2}$/, 'Financial Year must be formatted as YYYY-YY (e.g. 2026-27)'),
  deductor_tan: z.string().trim().regex(/^[A-Z]{4}\d{5}[A-Z]$/, 'Invalid Indian TAN format (e.g. DELD12345A)'),
  deductor_name: z.string().trim().max(255).optional().nullable(),
  records: z.array(Form26ASRecordItemSchema).min(1, 'At least one 26AS record is required'),
});

export type Import26ASInput = z.input<typeof Import26ASInputSchema>;
