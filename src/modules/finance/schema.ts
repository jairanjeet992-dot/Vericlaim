/**
 * Zod Schemas for Invoicing, GST, and Credit/Debit Notes (Phase 7A)
 */

import { z } from 'zod';

export const InvoiceItemInputSchema = z.object({
  case_id: z.string().uuid().optional(),
  item_type: z
    .enum([
      'PROFESSIONAL_FEE',
      'TRAVEL_CONVEYANCE',
      'STATIONERY_PRINTING',
      'MEDICAL_RECORD_FEES',
      'OTHER',
    ])
    .optional()
    .default('PROFESSIONAL_FEE'),
  description: z.string().min(2, 'Item description is required'),
  sac_code: z.string().min(4, 'Valid SAC code is required').optional().default('998311'),
  quantity: z.number().positive().optional().default(1),
  unit_rate: z.number().min(0).optional(),
  amount: z.number().min(0, 'Item amount must be non-negative'),
  tax_rate: z.number().min(0).max(100).optional().default(18.0),
});

export const CreateDraftInvoiceSchema = z.object({
  client_id: z.string().uuid('Valid client ID is required'),
  client_branch_id: z.string().uuid('Valid client branch ID is required'),
  calculation_mode: z.enum(['FORWARD', 'TOTAL_INCLUSIVE']).optional().default('FORWARD'),
  is_reverse_charge: z.boolean().optional().default(false),
  is_sez: z.boolean().optional().default(false),
  issue_date: z.string().optional(),
  due_date: z.string().optional(),
  discount_amount: z.number().min(0).optional().default(0),
  notes: z.string().optional(),
  terms_and_conditions: z.string().optional(),
  items: z.array(InvoiceItemInputSchema).min(1, 'Invoice must contain at least one item'),
});

export const BulkCaseInvoiceSchema = z.object({
  client_id: z.string().uuid('Valid client ID is required'),
  client_branch_id: z.string().uuid('Valid client branch ID is required'),
  case_ids: z.array(z.string().uuid()).min(1, 'At least one case must be selected for bulk billing'),
  fee_per_case: z.number().positive().optional(),
  include_travel_allowance: z.boolean().optional().default(true),
  notes: z.string().optional(),
  terms_and_conditions: z.string().optional(),
  calculation_mode: z.enum(['FORWARD', 'TOTAL_INCLUSIVE']).optional().default('FORWARD'),
});

export const IssueInvoiceSchema = z.object({
  invoice_id: z.string().uuid('Valid invoice ID is required'),
});

export const CancelInvoiceSchema = z.object({
  invoice_id: z.string().uuid('Valid invoice ID is required'),
  cancellation_reason: z
    .string()
    .min(5, 'Mandatory cancellation explanation is required (e.g. Billed to incorrect branch)'),
});

export const CreateCreditNoteSchema = z.object({
  original_invoice_id: z.string().uuid('Valid invoice ID is required'),
  note_type: z.enum(['CREDIT_NOTE', 'DEBIT_NOTE']).optional().default('CREDIT_NOTE'),
  reason: z.string().min(5, 'Specific reason for credit/debit adjustment is required'),
  taxable_amount: z.number().positive('Adjustment taxable amount must be greater than zero'),
  tax_rate: z.number().min(0).max(100).optional().default(18.0),
});

export type CreateDraftInvoiceInput = z.input<typeof CreateDraftInvoiceSchema>;
export type BulkCaseInvoiceInput = z.input<typeof BulkCaseInvoiceSchema>;
export type IssueInvoiceInput = z.input<typeof IssueInvoiceSchema>;
export type CancelInvoiceInput = z.input<typeof CancelInvoiceSchema>;
export type CreateCreditNoteInput = z.input<typeof CreateCreditNoteSchema>;
