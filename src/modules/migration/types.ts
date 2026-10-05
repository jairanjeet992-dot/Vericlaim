export interface LegacyCaseRow {
  id?: string;
  doc_code: string;
  date?: string;
  received_date?: string;
  company: string;
  case_type?: string;
  claim_no: string;
  policy_no?: string;
  insured_name: string;
  hospital?: string;
  location?: string;
  inv1?: string;
  fee1?: number | string;
  ta1?: number | string;
  inv1_status?: string;
  inv2?: string;
  fee2?: number | string;
  ta2?: number | string;
  inv2_status?: string;
  total_payable?: number | string;
  invoice_no?: string;
  invoice_amount?: number | string;
  received?: number | string;
  tds_deducted?: number | string;
  profit?: number | string;
  outcome?: string;
  sla_hours?: number | string;
  due_date?: string;
  completed_at?: string;
  risk_level?: string;
  exception_type?: string;
  exception_reason?: string;
  custom_data?: Record<string, any>;
  [key: string]: any;
}

export type EntityType = 'CLIENT' | 'INVESTIGATOR' | 'HOSPITAL' | 'CASE_TYPE';

export interface EntityResolutionCandidate {
  raw_text: string;
  normalized_text: string;
  entity_type: EntityType;
  resolved_id: string | null;
  canonical_name: string | null;
  similarity_score: number;
  resolution_status: 'EXACT_MATCH' | 'ALIAS_MATCH' | 'PENDING_APPROVAL' | 'UNRESOLVED' | 'NEW_ENTITY_REQUIRED';
  occurrences: number;
  affected_doc_codes: string[];
}

export interface UnresolvedEntityReport {
  agency_id: string;
  batch_id: string;
  generated_at: string;
  summary: {
    total_cases_analyzed: number;
    company_names_matched_exact: number;
    company_names_fuzzy_flagged: number;
    company_names_unresolved: number;
    investigator_names_matched_exact: number;
    investigator_names_fuzzy_flagged: number;
    investigator_names_unresolved: number;
  };
  exceptions: Array<{
    exception_id: string;
    entity_type: string;
    legacy_field: string;
    raw_text: string;
    occurrences: number;
    suggested_match: {
      entity_id: string | null;
      canonical_name: string | null;
      similarity_score: number;
    };
    affected_doc_codes: string[];
    resolution_status: 'pending_admin_action' | 'unresolved_new_entity_required' | 'resolved';
  }>;
}

export interface EntityApprovalDecision {
  raw_text: string;
  entity_type: EntityType;
  action: 'MAP_TO_EXISTING' | 'CREATE_NEW' | 'IGNORE';
  target_id?: string;
  new_entity_name?: string;
}

export interface DryRunValidationError {
  row_index: number;
  doc_code: string;
  claim_no: string;
  field: string;
  value: any;
  error_type: 'INVALID_AMOUNT' | 'DUPLICATE_CLAIM' | 'BAD_GSTIN' | 'OUTCOME_TYPO' | 'MISSING_FIELD' | 'UNRESOLVED_ENTITY';
  message: string;
  suggested_fix?: string;
}

export interface DryRunValidationResult {
  is_valid: boolean;
  total_rows: number;
  valid_rows_count: number;
  error_count: number;
  warning_count: number;
  errors: DryRunValidationError[];
  normalized_sample: Record<string, any>[];
  unresolved_report: UnresolvedEntityReport;
}

export interface SmartPasteDiffRow {
  row_index: number;
  doc_code: string;
  claim_no: string;
  insured_name: string;
  client_name: string;
  investigator_names: string[];
  total_payable: number;
  is_new_case: boolean;
  status: 'VALID' | 'WARNING' | 'ERROR';
  messages: string[];
  diff_fields: Record<string, { old_val: any; new_val: any }>;
}

export interface SmartPasteDiffPreview {
  total_pasted: number;
  new_cases_count: number;
  update_cases_count: number;
  error_count: number;
  rows: SmartPasteDiffRow[];
}

export interface ParityReconciliationReport {
  batch_id: string;
  generated_at: string;
  is_parity_achieved: boolean;
  metrics: {
    total_cases: { legacy: number; target: number; difference: number; is_match: boolean };
    total_invoice_amount: { legacy: number; target: number; difference: number; is_match: boolean };
    total_received_amount: { legacy: number; target: number; difference: number; is_match: boolean };
    total_tds_deducted: { legacy: number; target: number; difference: number; is_match: boolean };
    total_investigator_payable: { legacy: number; target: number; difference: number; is_match: boolean };
  };
  monthly_case_counts: Array<{
    month: string; // YYYY-MM
    legacy_count: number;
    target_count: number;
    difference: number;
    is_match: boolean;
  }>;
  investigator_monthly_payables: Array<{
    investigator_name: string;
    month: string;
    legacy_payable: number;
    target_payable: number;
    difference: number;
    is_match: boolean;
  }>;
  company_outstanding: Array<{
    company_name: string;
    legacy_outstanding: number;
    target_outstanding: number;
    difference: number;
    is_match: boolean;
  }>;
  line_item_discrepancies: Array<{
    doc_code: string;
    field: string;
    legacy_value: any;
    target_value: any;
    explanation: string;
  }>;
  golden_tests_results: Array<{
    test_id: string;
    scenario: string;
    passed: boolean;
    details: string;
  }>;
}

export interface ImportBatchRecord {
  id: string;
  agency_id: string;
  batch_number: string;
  source_type: 'DNA_LEGACY_CSV' | 'DNA_LEGACY_JSON' | 'SMART_PASTE';
  status: 'DRY_RUN' | 'VALIDATED' | 'COMMITTED' | 'ROLLED_BACK' | 'FAILED';
  total_rows: number;
  imported_cases_count: number;
  imported_invoices_count: number;
  imported_payments_count: number;
  imported_investigators_count: number;
  unresolved_entities_count: number;
  error_count: number;
  dry_run_summary: Record<string, any>;
  unresolved_report: UnresolvedEntityReport;
  reconciliation_report?: ParityReconciliationReport;
  is_approved: boolean;
  approved_by?: string;
  approved_at?: string;
  committed_at?: string;
  created_by: string;
  created_at: string;
}
