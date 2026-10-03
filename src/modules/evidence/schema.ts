// ============================================================================
// VERICLAIM MULTI-TENANT SAAS
// MODULE: evidence/schema.ts
// PHASE 5: Investigation Activities, Evidence Pipeline (R2), Versioning, PWA
// ============================================================================

import { z } from 'zod';

export const ALLOWED_MIME_TYPES = [
  // Images (Max 20MB)
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  // Videos (Max 100MB)
  'video/mp4',
  'video/webm',
  'video/quicktime',
  // PDFs (Max 25MB)
  'application/pdf',
  // Audio (Max 50MB)
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
] as const;

export const MAX_FILE_SIZE_MAP: Record<string, number> = {
  'image/jpeg': 20 * 1024 * 1024,
  'image/png': 20 * 1024 * 1024,
  'image/webp': 20 * 1024 * 1024,
  'image/heic': 20 * 1024 * 1024,
  'video/mp4': 100 * 1024 * 1024,
  'video/webm': 100 * 1024 * 1024,
  'video/quicktime': 100 * 1024 * 1024,
  'application/pdf': 25 * 1024 * 1024,
  'audio/mpeg': 50 * 1024 * 1024,
  'audio/wav': 50 * 1024 * 1024,
  'audio/ogg': 50 * 1024 * 1024,
  'audio/mp4': 50 * 1024 * 1024,
  'audio/aac': 50 * 1024 * 1024,
  'audio/x-m4a': 50 * 1024 * 1024,
};

export const InvestigationActivityTypeSchema = z.enum([
  'FIELD_VISIT',
  'RESIDENCE_VERIFICATION',
  'HOSPITAL_VERIFICATION',
  'EMPLOYMENT_VERIFICATION',
  'DOCUMENT_VERIFICATION',
  'CLAIMANT_INTERVIEW',
  'WITNESS_INTERVIEW',
  'TELEPHONIC_VERIFICATION',
  'MEDICAL_RECORDS_CHECK',
  'SPOT_INVESTIGATION',
  'CUSTOM',
]);

export const ActivityStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);

export const EvidenceCategorySchema = z.enum([
  'FIELD_PHOTO',
  'HOSPITAL_RECORD',
  'CLAIMANT_ID',
  'TREATMENT_BILL',
  'WITNESS_STATEMENT',
  'AUDIO_RECORDING',
  'POLICE_REPORT',
  'INVESTIGATOR_NOTES',
  'OTHER',
]);

export const ClaimedMetadataSchema = z.object({
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracy: z.number().positive().nullable().optional(),
  captured_at: z.string().datetime().nullable().optional(),
});

export const CreateActivitySchema = z.object({
  case_id: z.string().uuid(),
  activity_type: InvestigationActivityTypeSchema,
  custom_type_name: z.string().max(100).nullable().optional(),
  task_title: z.string().min(2, 'Task title is required').max(200),
  instructions: z.string().max(2000).nullable().optional(),
  assigned_to_id: z.string().uuid().nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const UpdateActivitySchema = z.object({
  task_title: z.string().min(2).max(200).optional(),
  instructions: z.string().max(2000).nullable().optional(),
  assigned_to_id: z.string().uuid().nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  status: ActivityStatusSchema.optional(),
  notes: z.string().max(4000).nullable().optional(),
  completion_notes: z.string().max(4000).nullable().optional(),
});

export const CompleteActivitySchema = z.object({
  completion_notes: z.string().min(2, 'Completion notes are required').max(4000),
  completed_at: z.string().datetime().optional(),
});

export const InitUploadSchema = z.object({
  case_id: z.string().uuid(),
  activity_id: z.string().uuid().nullable().optional(),
  file_name: z.string().min(1, 'File name is required').max(255),
  file_size: z.number().int().positive('File size must be positive'),
  mime_type: z.string().refine((val) => ALLOWED_MIME_TYPES.includes(val as any), {
    message: 'Unsupported MIME type. Allowed formats: JPEG, PNG, WebP, HEIC, MP4, WebM, QuickTime, PDF, MP3, WAV, AAC',
  }),
  sha256_hash: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Must be a 64-character hexadecimal SHA-256 hash'),
  evidence_category: EvidenceCategorySchema.default('OTHER'),
  claimed_metadata: ClaimedMetadataSchema.optional(),
  is_sensitive: z.boolean().default(false),
  parent_document_id: z.string().uuid().nullable().optional(),
}).refine((data) => {
  const maxSize = MAX_FILE_SIZE_MAP[data.mime_type] || 25 * 1024 * 1024;
  return data.file_size <= maxSize;
}, {
  message: 'File size exceeds maximum allowed threshold for this MIME type',
  path: ['file_size'],
});

export const CompleteUploadSchema = z.object({
  document_id: z.string().uuid(),
  actual_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Must be a 64-character hexadecimal SHA-256 hash'),
  actual_size: z.number().int().positive().optional(),
});

export const SoftDeleteDocumentSchema = z.object({
  delete_reason: z.string().min(3, 'A clear reason for deleting evidence is required').max(500),
});
