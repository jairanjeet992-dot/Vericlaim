import { z } from 'zod';
import { CaseStatus, CaseOutcome, CaseExceptionType } from '../workflow/engine';

export const RiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const CreateCaseSchema = z.object({
  client_id: z.string().uuid(),
  client_branch_id: z.string().uuid().optional().nullable(),
  case_type_id: z.string().uuid(),
  claim_no: z.string().min(1).transform((v) => v.trim()),
  policy_no: z.string().min(1).transform((v) => v.trim()),
  insured_name: z.string().min(1).transform((v) => v.trim()),
  patient_name: z.string().optional().nullable(),
  claimant_name: z.string().optional().nullable(),
  hospital_name: z.string().optional().nullable(),
  hospital_city: z.string().optional().nullable(),
  hospital_state: z.string().optional().nullable(),
  hospital_pincode: z.string().optional().nullable(),
  loss_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  admission_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  discharge_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  claim_amount: z.number().nonnegative().default(0),
  location_city: z.string().optional().nullable(),
  location_district: z.string().optional().nullable(),
  location_state: z.string().optional().nullable(),
  location_pincode: z.string().optional().nullable(),
  risk_level: RiskLevelSchema.default('LOW'),
  custom_fields: z.record(z.any()).default({}),
  owner_manager_id: z.string().uuid().optional().nullable(),
});

export type CreateCaseInput = z.input<typeof CreateCaseSchema>;
export type CreateCaseOutput = z.infer<typeof CreateCaseSchema>;

export const UpdateCaseSchema = z.object({
  version: z.number().int().positive(),
  claim_no: z.string().min(1).optional(),
  policy_no: z.string().min(1).optional(),
  insured_name: z.string().min(1).optional(),
  patient_name: z.string().optional().nullable(),
  claimant_name: z.string().optional().nullable(),
  hospital_name: z.string().optional().nullable(),
  hospital_city: z.string().optional().nullable(),
  hospital_state: z.string().optional().nullable(),
  hospital_pincode: z.string().optional().nullable(),
  loss_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  admission_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  discharge_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  claim_amount: z.number().nonnegative().optional(),
  location_city: z.string().optional().nullable(),
  location_district: z.string().optional().nullable(),
  location_state: z.string().optional().nullable(),
  location_pincode: z.string().optional().nullable(),
  risk_level: RiskLevelSchema.optional(),
  custom_fields: z.record(z.any()).optional(),
  owner_manager_id: z.string().uuid().optional().nullable(),
});

export type UpdateCaseInput = z.input<typeof UpdateCaseSchema>;
export type UpdateCaseOutput = z.infer<typeof UpdateCaseSchema>;

export const TransitionCaseSchema = z.object({
  target_status: z.string() as z.ZodType<CaseStatus>,
  current_version: z.number().int().positive(),
  reason: z.string().optional().nullable(),
  outcome: (z.enum(['PENDING', 'GENUINE', 'FRAUD', 'SUSPICIOUS', 'REPUDIATED', 'UNTRACEABLE']) as z.ZodType<CaseOutcome>).optional(),
  fraud_reason: z.string().optional().nullable(),
  exception_type: (z.enum(['WITHDRAWN', 'REJECTED']) as z.ZodType<CaseExceptionType>).optional().nullable(),
  metadata: z.record(z.any()).default({}),
});

export type TransitionCaseInput = z.input<typeof TransitionCaseSchema>;
export type TransitionCaseOutput = z.infer<typeof TransitionCaseSchema>;

export const AddCaseNoteSchema = z.object({
  content: z.string().min(1),
  note_type: z.enum(['INTERNAL', 'CLIENT', 'INVESTIGATOR', 'SEND_BACK']).default('INTERNAL'),
});

export type AddCaseNoteInput = z.input<typeof AddCaseNoteSchema>;
export type AddCaseNoteOutput = z.infer<typeof AddCaseNoteSchema>;

export const CreateCaseTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
});

export type CreateCaseTaskInput = z.input<typeof CreateCaseTaskSchema>;
export type CreateCaseTaskOutput = z.infer<typeof CreateCaseTaskSchema>;
