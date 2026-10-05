export type ConsentType = 'DIGITAL' | 'PHYSICAL_FORM' | 'AUDIO_RECORDING' | 'POLICY_TERMS';
export type ConsentStatus = 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED';

export interface ConsentRecord {
  id: string;
  agency_id: string;
  case_id?: string;
  data_principal_name: string;
  data_principal_phone_blind_index?: string;
  consent_purpose: string;
  consent_type: ConsentType;
  status: ConsentStatus;
  obtained_at: string;
  withdrawn_at?: string;
  evidence_document_id?: string;
  created_by: string;
  created_at: string;
}

export type EntityRetentionCategory =
  | 'TAX_INVOICES'
  | 'PAYMENT_RECEIPTS'
  | 'CASE_EVIDENCE'
  | 'AUDIT_LOGS';

export interface DataRetentionPolicy {
  id: string;
  agency_id: string;
  entity_category: EntityRetentionCategory;
  retention_period_months: number;
  statutory_basis: string;
  auto_archive_enabled: boolean;
  auto_delete_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type DeletionRequestType = 'ERASURE' | 'ANONYMIZATION' | 'DATA_PORTABILITY' | 'RECTIFICATION';
export type DeletionRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED_LEGAL_OVERRIDE' | 'COMPLETED';

export interface DataDeletionRequest {
  id: string;
  agency_id: string;
  request_number: string;
  data_principal_name: string;
  data_principal_identifier: string;
  request_type: DeletionRequestType;
  status: DeletionRequestStatus;
  rejection_legal_basis?: string;
  processed_at?: string;
  processed_by?: string;
  audit_notes?: string;
  created_at: string;
}

export type BreachSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type BreachStatus = 'OPEN' | 'INVESTIGATING' | 'CONTAINED' | 'RESOLVED';

export interface BreachLog {
  id: string;
  agency_id: string;
  incident_number: string;
  severity: BreachSeverity;
  affected_principals_count: number;
  nature_of_breach: string;
  compromised_data_categories: string[];
  detected_at: string;
  reported_to_dpb: boolean;
  dpb_reported_at?: string;
  reported_to_cert_in: boolean;
  cert_in_reported_at?: string;
  remediation_actions?: string;
  status: BreachStatus;
  created_by: string;
  created_at: string;
}
