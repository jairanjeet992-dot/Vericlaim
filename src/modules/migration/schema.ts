import { z } from 'zod';

export const EntityTypeSchema = z.enum(['CLIENT', 'INVESTIGATOR', 'HOSPITAL', 'CASE_TYPE']);

export const LegacyCaseRowSchema = z.object({
  id: z.string().optional(),
  doc_code: z.string().min(1, 'Doc Code is required'),
  date: z.string().optional(),
  received_date: z.string().optional(),
  company: z.string().min(1, 'Company is required'),
  case_type: z.string().optional(),
  claim_no: z.string().min(1, 'Claim No is required'),
  policy_no: z.string().optional(),
  insured_name: z.string().min(1, 'Insured Name is required'),
  hospital: z.string().optional(),
  location: z.string().optional(),
  inv1: z.string().optional(),
  fee1: z.union([z.number(), z.string()]).optional(),
  ta1: z.union([z.number(), z.string()]).optional(),
  inv1_status: z.string().optional(),
  inv2: z.string().optional(),
  fee2: z.union([z.number(), z.string()]).optional(),
  ta2: z.union([z.number(), z.string()]).optional(),
  inv2_status: z.string().optional(),
  total_payable: z.union([z.number(), z.string()]).optional(),
  invoice_no: z.string().optional(),
  invoice_amount: z.union([z.number(), z.string()]).optional(),
  received: z.union([z.number(), z.string()]).optional(),
  tds_deducted: z.union([z.number(), z.string()]).optional(),
  profit: z.union([z.number(), z.string()]).optional(),
  outcome: z.string().optional(),
  sla_hours: z.union([z.number(), z.string()]).optional(),
  due_date: z.string().optional(),
  completed_at: z.string().optional(),
  risk_level: z.string().optional(),
  exception_type: z.string().optional(),
  exception_reason: z.string().optional(),
  custom_data: z.record(z.any()).optional(),
});

export const EntityApprovalDecisionSchema = z.object({
  raw_text: z.string().min(1),
  entity_type: EntityTypeSchema,
  action: z.enum(['MAP_TO_EXISTING', 'CREATE_NEW', 'IGNORE']),
  target_id: z.string().uuid().optional(),
  new_entity_name: z.string().optional(),
});

export const CommitImportBatchSchema = z.object({
  batch_id: z.string().uuid(),
  resolutions: z.array(EntityApprovalDecisionSchema).default([]),
});

export const RollbackBatchSchema = z.object({
  batch_id: z.string().uuid(),
  reason: z.string().min(5, 'Mandatory rollback reason (minimum 5 characters) required'),
});

export const SmartPasteInputSchema = z.object({
  raw_tsv_text: z.string().min(1, 'Pasted text must not be empty'),
  delimiter: z.enum(['\t', ',', ';']).default('\t'),
  has_headers: z.boolean().default(true),
});
