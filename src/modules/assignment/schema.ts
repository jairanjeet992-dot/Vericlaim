import { z } from 'zod';

export const AssignmentScopeSchema = z.enum([
  'PRIMARY',
  'SECONDARY',
  'HOSPITAL_CHECK',
  'INSURED_MEET',
  'SPOT',
]);
export type AssignmentScope = z.infer<typeof AssignmentScopeSchema>;

export const PayoutStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'QUEUED',
  'PAID',
  'EXCLUDED',
]);
export type PayoutStatus = z.infer<typeof PayoutStatusSchema>;

export const HardcopyStatusSchema = z.enum([
  'PENDING',
  'COLLECTED',
  'SUBMITTED',
  'VERIFIED',
  'WAIVED',
]);
export type HardcopyStatus = z.infer<typeof HardcopyStatusSchema>;

export const AssignInvestigatorSchema = z.object({
  investigator_id: z.string().uuid(),
  assignment_scope: AssignmentScopeSchema.default('PRIMARY'),
  agreed_fee: z.number().nonnegative().optional(),
  travel_allowance: z.number().nonnegative().default(0),
  override_reason: z.string().optional().nullable(),
});

export type AssignInvestigatorInput = z.input<typeof AssignInvestigatorSchema>;
export type AssignInvestigatorOutput = z.infer<typeof AssignInvestigatorSchema>;

export const AcceptAssignmentSchema = z.object({
  case_investigator_id: z.string().uuid(),
});
export type AcceptAssignmentInput = z.input<typeof AcceptAssignmentSchema>;

export const RejectAssignmentSchema = z.object({
  case_investigator_id: z.string().uuid(),
  reason: z.string().min(3, 'Rejection reason is mandatory'),
});
export type RejectAssignmentInput = z.input<typeof RejectAssignmentSchema>;

export const ReassignInvestigatorSchema = z.object({
  current_case_investigator_id: z.string().uuid(),
  new_investigator_id: z.string().uuid(),
  reassignment_reason: z.string().min(3, 'Reassignment reason is mandatory'),
  assignment_scope: AssignmentScopeSchema.optional(),
  agreed_fee: z.number().nonnegative().optional(),
  travel_allowance: z.number().nonnegative().optional(),
  override_reason: z.string().optional().nullable(),
});
export type ReassignInvestigatorInput = z.input<typeof ReassignInvestigatorSchema>;

export const UpdateHardcopyStatusSchema = z.object({
  case_investigator_id: z.string().uuid(),
  hardcopy_status: HardcopyStatusSchema,
});
export type UpdateHardcopyStatusInput = z.input<typeof UpdateHardcopyStatusSchema>;
