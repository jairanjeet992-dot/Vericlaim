import { z } from 'zod';

export const ConsentRecordInputSchema = z.object({
  case_id: z.string().uuid().optional(),
  data_principal_name: z.string().min(1, 'Data principal name is required'),
  data_principal_phone: z.string().optional(),
  consent_purpose: z.string().min(1, 'Consent purpose is required'),
  consent_type: z.enum(['DIGITAL', 'PHYSICAL_FORM', 'AUDIO_RECORDING', 'POLICY_TERMS']).default('DIGITAL'),
  evidence_document_id: z.string().uuid().optional(),
});

export const DataRetentionPolicyInputSchema = z.object({
  entity_category: z.enum(['TAX_INVOICES', 'PAYMENT_RECEIPTS', 'CASE_EVIDENCE', 'AUDIT_LOGS']),
  retention_period_months: z.number().int().min(12, 'Minimum retention period is 12 months'),
  statutory_basis: z.string().min(1, 'Statutory legal basis is required'),
  auto_archive_enabled: z.boolean().default(true),
  auto_delete_enabled: z.boolean().default(false),
});

export const DataDeletionRequestInputSchema = z.object({
  data_principal_name: z.string().min(1, 'Data principal name is required'),
  data_principal_identifier: z.string().min(1, 'Data principal identifier is required'),
  request_type: z.enum(['ERASURE', 'ANONYMIZATION', 'DATA_PORTABILITY', 'RECTIFICATION']),
});

export const EvaluateDeletionRequestSchema = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(['APPROVE', 'REJECT_LEGAL_OVERRIDE']),
  rejection_legal_basis: z.string().optional(),
  audit_notes: z.string().optional(),
});

export const BreachLogInputSchema = z.object({
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  affected_principals_count: z.number().int().min(0),
  nature_of_breach: z.string().min(5, 'Detailed description of breach is required'),
  compromised_data_categories: z.array(z.string()).default([]),
  detected_at: z.string().datetime().optional(),
  reported_to_dpb: z.boolean().default(false),
  reported_to_cert_in: z.boolean().default(false),
  remediation_actions: z.string().optional(),
});
