/**
/**
 * Types & Interfaces for Phase 6: Reports, Review, Rework Engine, and Hardcopy Logistics
 */

export type ReportStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'SENT_BACK'
  | 'CORRECTED'
  | 'RESUBMITTED'
  | 'APPROVED'
  | 'FINAL';

export type CommentTargetType = 'SECTION' | 'EVIDENCE' | 'FIELD';

export type CommentStatus = 'OPEN' | 'RESOLVED' | 'REJECTED';

export type ReworkRecipientType =
  | 'INVESTIGATOR'
  | 'BACK_OFFICE'
  | 'DATA_ENTRY'
  | 'REVIEWER'
  | 'CASE_MANAGER'
  | 'REPORT_AUTHOR'
  | 'PREVIOUS_ASSIGNEE';

export type ReworkPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type ReworkStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'CORRECTED'
  | 'RESUBMITTED'
  | 'ESCALATED'
  | 'WAIVED';

export type HardcopyPacketStatus =
  | 'RECEIVED'
  | 'STORED'
  | 'RETRIEVED'
  | 'PACKED'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'RETURNED';

export type HardcopyMovementType =
  | 'RECEIVED_FROM_INVESTIGATOR'
  | 'STORED_IN_ARCHIVE'
  | 'RETRIEVED_FOR_REVIEW'
  | 'PACKED_FOR_DISPATCH'
  | 'DISPATCHED_TO_CLIENT'
  | 'DELIVERY_ACKNOWLEDGED'
  | 'RETURNED';

export type CourierDeliveryStatus = 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'RETURNED';

export interface ReportSection {
  title: string;
  text: string;
  evidence_ids?: string[];
  verified?: boolean;
  custom_fields?: Record<string, any>;
}

export interface ReportContent {
  summary: string;
  sections: Record<string, ReportSection>;
  outcome?: string;
  fraud_reason?: string;
  investigator_notes?: string;
  recommendations?: string;
}

export interface Report {
  id: string;
  agency_id: string;
  case_id: string;
  title: string;
  status: ReportStatus;
  current_version: number;
  author_id?: string;
  reviewer_id?: string;
  approved_by?: string;
  approved_at?: string;
  approval_notes?: string;
  is_immutable: boolean;
  pdf_r2_key?: string;
  pdf_sha256?: string;
  created_at: string;
  updated_at: string;
}

export interface ReportVersion {
  id: string;
  agency_id: string;
  report_id: string;
  case_id: string;
  version_number: number;
  status: ReportStatus;
  author_id: string;
  summary?: string;
  content: ReportContent;
  change_summary?: string;
  rework_cycle_id?: string;
  pdf_r2_key?: string;
  pdf_sha256?: string;
  is_approved: boolean;
  created_at: string;
}

export interface ReportComment {
  id: string;
  agency_id: string;
  report_id: string;
  case_id: string;
  version_number: number;
  target_type: CommentTargetType;
  target_id: string;
  target_label?: string;
  comment: string;
  author_id: string;
  status: CommentStatus;
  resolution_notes?: string;
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
}

export interface ReworkCycle {
  id: string;
  agency_id: string;
  case_id: string;
  report_id?: string;
  cycle_number: number;
  requested_by: string;
  target_recipient_type: ReworkRecipientType;
  target_user_id?: string;
  reason_category: string;
  instructions: string;
  priority: ReworkPriority;
  deadline?: string;
  target_sections: string[];
  target_field_names: string[];
  target_evidence_ids: string[];
  status: ReworkStatus;
  is_escalated: boolean;
  escalation_reason?: string;
  escalated_to_id?: string;
  correction_notes?: string;
  completed_at?: string;
  created_at: string;
}

export interface HardcopyItemCounts {
  bills: number;
  prescriptions: number;
  reports: number;
  photos: number;
  total_pages: number;
  [key: string]: number;
}

export interface StorageLocation {
  room?: string;
  rack: string;
  shelf: string;
  box: string;
}

export interface HardcopyPacket {
  id: string;
  agency_id: string;
  case_id: string;
  packet_no: string;
  investigator_id?: string;
  received_from_user_id?: string;
  received_by_user_id?: string;
  received_at: string;
  item_counts: HardcopyItemCounts;
  condition_notes?: string;
  storage_location: StorageLocation;
  current_status: HardcopyPacketStatus;
  courier_docket_id?: string;
  created_at: string;
  updated_at: string;
}

export interface HardcopyMovement {
  id: string;
  agency_id: string;
  case_id: string;
  packet_id: string;
  movement_type: HardcopyMovementType;
  from_location: string;
  to_location: string;
  handler_id: string;
  docket_id?: string;
  notes?: string;
  item_counts?: HardcopyItemCounts;
  moved_at: string;
}

export interface CourierDocket {
  id: string;
  agency_id: string;
  docket_number: string;
  client_id: string;
  client_branch_id?: string;
  courier_partner: string;
  awb_number: string;
  dispatched_at: string;
  dispatched_by: string;
  delivery_status: CourierDeliveryStatus;
  delivered_at?: string;
  recipient_name?: string;
  acknowledgement_notes?: string;
  proof_of_delivery_r2_key?: string;
  created_at: string;
}

export interface SectionDiff {
  sectionKey: string;
  sectionTitle: string;
  changeType: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  oldText?: string;
  newText?: string;
  oldEvidenceIds?: string[];
  newEvidenceIds?: string[];
}

export interface ReportDiff {
  fromVersionNumber: number;
  toVersionNumber: number;
  summaryChange: {
    oldSummary?: string;
    newSummary?: string;
    hasChanged: boolean;
  };
  outcomeChange?: {
    oldOutcome?: string;
    newOutcome?: string;
    hasChanged: boolean;
  };
  sectionDiffs: SectionDiff[];
  hasChanges: boolean;
}

export interface PrintableManifestData {
  agencyName: string;
  agencyAddress?: string;
  agencyGstin?: string;
  docketNumber: string;
  courierPartner: string;
  awbNumber: string;
  dispatchedAt: string;
  clientName: string;
  clientBranchName?: string;
  clientGstin?: string;
  totalPackets: number;
  totalDocs: number;
  packets: {
    packetNo: string;
    claimNo: string;
    insuredName: string;
    patientName?: string;
    itemCounts: HardcopyItemCounts;
    conditionNotes?: string;
  }[];
  dispatchedByName: string;
}
