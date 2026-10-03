import { z } from 'zod';

export const ReportSectionSchema = z.object({
  title: z.string().min(1, 'Section title is required'),
  text: z.string().optional().default(''),
  evidence_ids: z.array(z.string().uuid()).optional().default([]),
  verified: z.boolean().optional().default(false),
  custom_fields: z.record(z.any()).optional(),
});

export const ReportContentSchema = z.object({
  summary: z.string().min(1, 'Executive summary is required'),
  sections: z.record(ReportSectionSchema).optional().default({}),
  outcome: z.enum(['PENDING', 'GENUINE', 'FRAUD', 'SUSPICIOUS', 'REPUDIATED', 'UNTRACEABLE']).optional(),
  fraud_reason: z.string().optional(),
  investigator_notes: z.string().optional(),
  recommendations: z.string().optional(),
});

export const CreateReportSchema = z.object({
  case_id: z.string().uuid('Valid case ID is required'),
  title: z.string().min(2, 'Report title must be at least 2 characters').optional().default('Investigation Report'),
  summary: z.string().optional().default(''),
  initial_sections: z.record(ReportSectionSchema).optional(),
});

export const SaveDraftReportSchema = z.object({
  report_id: z.string().uuid('Valid report ID is required'),
  summary: z.string().optional(),
  content: ReportContentSchema,
});

export const SubmitReportSchema = z.object({
  report_id: z.string().uuid('Valid report ID is required'),
  change_summary: z.string().optional(),
  outcome: z.enum(['GENUINE', 'FRAUD', 'SUSPICIOUS', 'REPUDIATED', 'UNTRACEABLE']),
  fraud_reason: z.string().optional(),
}).refine(
  (data) => {
    if (data.outcome === 'FRAUD') {
      return !!data.fraud_reason && data.fraud_reason.trim().length > 0;
    }
    return true;
  },
  {
    message: "Fraud reason category/narrative is mandatory when outcome is 'FRAUD'",
    path: ['fraud_reason'],
  }
);

export const AddReportCommentSchema = z.object({
  report_id: z.string().uuid('Valid report ID is required'),
  version_number: z.number().int().min(1),
  target_type: z.enum(['SECTION', 'EVIDENCE', 'FIELD']),
  target_id: z.string().min(1, 'Target ID/key is required'),
  target_label: z.string().optional(),
  comment: z.string().min(2, 'Comment must be at least 2 characters'),
});

export const ResolveReportCommentSchema = z.object({
  comment_id: z.string().uuid('Valid comment ID is required'),
  resolution_notes: z.string().min(2, 'Resolution notes are required'),
  status: z.enum(['RESOLVED', 'REJECTED']).optional().default('RESOLVED'),
});

export const InitiateReworkSchema = z.object({
  case_id: z.string().uuid('Valid case ID is required'),
  report_id: z.string().uuid('Valid report ID is required').optional(),
  target_recipient_type: z.enum([
    'INVESTIGATOR',
    'BACK_OFFICE',
    'DATA_ENTRY',
    'REVIEWER',
    'CASE_MANAGER',
    'REPORT_AUTHOR',
    'PREVIOUS_ASSIGNEE',
  ]),
  target_user_id: z.string().uuid().optional(),
  reason_category: z.string().min(2, 'Reason category is required'),
  instructions: z.string().min(5, 'Actionable instructions are required'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional().default('MEDIUM'),
  deadline: z.string().datetime().optional(),
  target_sections: z.array(z.string()).optional().default([]),
  target_field_names: z.array(z.string()).optional().default([]),
  target_evidence_ids: z.array(z.string().uuid()).optional().default([]),
});

export const SubmitReworkCorrectionSchema = z.object({
  rework_cycle_id: z.string().uuid('Valid rework cycle ID is required'),
  report_id: z.string().uuid('Valid report ID is required'),
  content: ReportContentSchema,
  change_summary: z.string().min(3, 'Change summary explaining corrections is required'),
  correction_notes: z.string().min(3, 'Correction explanation notes are required'),
});

export const ApproveReportSchema = z.object({
  report_id: z.string().uuid('Valid report ID is required'),
  approval_notes: z.string().min(2, 'Approval signoff remarks are required'),
  signoff_declaration: z.boolean().refine((val) => val === true, {
    message: 'Must formally certify that the report has been thoroughly scrutinized and verified.',
  }),
});

export const HardcopyItemCountsSchema = z.object({
  bills: z.number().int().min(0).optional().default(0),
  prescriptions: z.number().int().min(0).optional().default(0),
  reports: z.number().int().min(0).optional().default(0),
  photos: z.number().int().min(0).optional().default(0),
  total_pages: z.number().int().min(0).optional().default(0),
});

export const StorageLocationSchema = z.object({
  room: z.string().optional().default('Main Archive'),
  rack: z.string().min(1, 'Rack is required'),
  shelf: z.string().min(1, 'Shelf is required'),
  box: z.string().min(1, 'Box is required'),
});

export const InwardHardcopySchema = z.object({
  case_id: z.string().uuid('Valid case ID is required'),
  packet_no: z.string().min(2, 'Packet number is required'),
  investigator_id: z.string().uuid().optional(),
  received_from_user_id: z.string().uuid().optional(),
  item_counts: HardcopyItemCountsSchema,
  condition_notes: z.string().optional(),
  storage_location: StorageLocationSchema,
});

export const UpdatePacketLocationSchema = z.object({
  packet_id: z.string().uuid('Valid packet ID is required'),
  storage_location: StorageLocationSchema,
  movement_type: z.enum(['STORED_IN_ARCHIVE', 'RETRIEVED_FOR_REVIEW', 'PACKED_FOR_DISPATCH']),
  notes: z.string().optional(),
});

export const DispatchHardcopySchema = z.object({
  client_id: z.string().uuid('Valid client ID is required'),
  client_branch_id: z.string().uuid().optional(),
  courier_partner: z.string().min(2, 'Courier partner is required (e.g. Blue Dart, DTDC)'),
  awb_number: z.string().min(3, 'Valid AWB tracking number is required'),
  packet_ids: z.array(z.string().uuid()).min(1, 'At least one packet must be included in docket'),
  dispatched_at: z.string().datetime().optional(),
});

export const AcknowledgeHardcopyDeliverySchema = z.object({
  docket_id: z.string().uuid('Valid docket ID is required'),
  recipient_name: z.string().min(2, 'Recipient name is required'),
  acknowledgement_notes: z.string().optional(),
  proof_of_delivery_r2_key: z.string().optional(),
  delivered_at: z.string().datetime().optional(),
});

export type CreateReportInput = z.input<typeof CreateReportSchema>;
export type SaveDraftReportInput = z.input<typeof SaveDraftReportSchema>;
export type SubmitReportInput = z.input<typeof SubmitReportSchema>;
export type AddReportCommentInput = z.input<typeof AddReportCommentSchema>;
export type ResolveReportCommentInput = z.input<typeof ResolveReportCommentSchema>;
export type InitiateReworkInput = z.input<typeof InitiateReworkSchema>;
export type SubmitReworkCorrectionInput = z.input<typeof SubmitReworkCorrectionSchema>;
export type ApproveReportInput = z.input<typeof ApproveReportSchema>;
export type InwardHardcopyInput = z.input<typeof InwardHardcopySchema>;
export type UpdatePacketLocationInput = z.input<typeof UpdatePacketLocationSchema>;
export type DispatchHardcopyInput = z.input<typeof DispatchHardcopySchema>;
export type AcknowledgeHardcopyDeliveryInput = z.input<typeof AcknowledgeHardcopyDeliverySchema>;

