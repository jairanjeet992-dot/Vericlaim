// ============================================================================
// VERICLAIM MULTI-TENANT SAAS
// MODULE: evidence/types.ts
// PHASE 5: Investigation Activities, Evidence Pipeline (R2), Versioning, PWA
// ============================================================================

export type InvestigationActivityType =
  | 'FIELD_VISIT'
  | 'RESIDENCE_VERIFICATION'
  | 'HOSPITAL_VERIFICATION'
  | 'EMPLOYMENT_VERIFICATION'
  | 'DOCUMENT_VERIFICATION'
  | 'CLAIMANT_INTERVIEW'
  | 'WITNESS_INTERVIEW'
  | 'TELEPHONIC_VERIFICATION'
  | 'MEDICAL_RECORDS_CHECK'
  | 'SPOT_INVESTIGATION'
  | 'CUSTOM';

export type ActivityStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type DocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export type EvidenceCategory =
  | 'FIELD_PHOTO'
  | 'HOSPITAL_RECORD'
  | 'CLAIMANT_ID'
  | 'TREATMENT_BILL'
  | 'WITNESS_STATEMENT'
  | 'AUDIO_RECORDING'
  | 'POLICE_REPORT'
  | 'INVESTIGATOR_NOTES'
  | 'OTHER';

export interface InvestigationActivity {
  id: string;
  agency_id: string;
  case_id: string;
  activity_type: InvestigationActivityType;
  custom_type_name?: string | null;
  task_title: string;
  instructions?: string | null;
  assigned_to_id?: string | null;
  due_date?: string | null;
  status: ActivityStatus;
  notes?: string | null;
  completion_notes?: string | null;
  completed_at?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClaimedMetadata {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  captured_at?: string | null;
}

export interface DocumentRecord {
  id: string;
  agency_id: string;
  case_id: string;
  activity_id?: string | null;
  uploaded_by: string;
  storage_key: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  sha256_hash: string;
  status: DocumentStatus;
  evidence_category: EvidenceCategory;
  claimed_latitude?: number | null;
  claimed_longitude?: number | null;
  claimed_accuracy?: number | null;
  claimed_captured_at?: string | null;
  verified_at?: string | null;
  is_sensitive: boolean;
  parent_document_id?: string | null;
  version: number;
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
  created_at: string;
}

export interface InitUploadRequest {
  case_id: string;
  activity_id?: string | null;
  file_name: string;
  file_size: number;
  mime_type: string;
  sha256_hash: string;
  evidence_category?: EvidenceCategory;
  claimed_metadata?: ClaimedMetadata;
  is_sensitive?: boolean;
  parent_document_id?: string | null;
}

export interface InitUploadResponse {
  document_id: string;
  storage_key: string;
  upload_url: string;
  headers: Record<string, string>;
  expires_in_seconds: number;
}

export interface CompleteUploadRequest {
  document_id: string;
  actual_sha256: string;
  actual_size?: number;
}

export interface CompleteUploadResponse {
  document_id: string;
  status: DocumentStatus;
  verified_at: string;
  sha256_hash: string;
  file_name: string;
}

export interface DownloadUrlResponse {
  document_id: string;
  download_url: string;
  expires_in_seconds: number;
  file_name: string;
  mime_type: string;
}

export interface OfflineQueueItem {
  id: string;
  case_id: string;
  activity_id?: string | null;
  file_name: string;
  file_size: number;
  mime_type: string;
  sha256_hash: string;
  evidence_category: EvidenceCategory;
  claimed_metadata?: ClaimedMetadata;
  blob?: Blob | string; // Base64 or Blob
  status: 'QUEUED' | 'UPLOADING' | 'FAILED' | 'COMPLETED';
  progress: number;
  retry_count: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
}
