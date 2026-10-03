/**
 * Pure Workflow Engine Module (Rule A3: Zero DB, Zero UI Imports)
 * Implements Case Lifecycle, State Machine Matrix, Controlled Rework,
 * Auto-Escalation, and Exception Rules per WORKFLOW.md.
 */

export type CaseStatus =
  | 'DATA_ENTRY'
  | 'VERIFICATION'
  | 'ASSIGNMENT'
  | 'ACCEPTANCE_PENDING'
  | 'FIELD_INVESTIGATION'
  | 'EVIDENCE_GATHERING'
  | 'REPORT_DRAFTING'
  | 'REPORT_REVIEW'
  | 'ESCALATED_REVIEW'
  | 'APPROVED'
  | 'HARDCOPY_TRANSIT'
  | 'CLOSED'
  | 'INVOICED'
  | 'PARTIALLY_PAID'
  | 'PAID_IN_FULL'
  | 'PAYOUT_QUEUED'
  | 'FINANCIALLY_CLOSED'
  | 'WITHDRAWN'
  | 'REJECTED';

export type CaseOutcome =
  | 'PENDING'
  | 'GENUINE'
  | 'FRAUD'
  | 'SUSPICIOUS'
  | 'REPUDIATED'
  | 'UNTRACEABLE';

export type CaseExceptionType = 'WITHDRAWN' | 'REJECTED';

export interface TransitionRule {
  from: CaseStatus;
  to: CaseStatus;
  requiredPermission?: string | null;
  requiresReason: boolean;
  description: string;
}

export const WORKFLOW_TRANSITIONS: TransitionRule[] = [
  // Intake & Verification
  { from: 'DATA_ENTRY', to: 'VERIFICATION', requiredPermission: 'cases.create', requiresReason: false, description: 'Submit entry for back-office verification' },
  { from: 'VERIFICATION', to: 'DATA_ENTRY', requiredPermission: 'cases.verify', requiresReason: true, description: 'Send back to data entry with correction notes' },
  { from: 'VERIFICATION', to: 'ASSIGNMENT', requiredPermission: 'cases.verify', requiresReason: false, description: 'Verify case data and route to assignment' },

  // Allocation & Field Acceptance
  { from: 'ASSIGNMENT', to: 'ACCEPTANCE_PENDING', requiredPermission: 'cases.assign', requiresReason: false, description: 'Assign investigator to docket' },
  { from: 'ACCEPTANCE_PENDING', to: 'ASSIGNMENT', requiredPermission: 'cases.accept', requiresReason: true, description: 'Investigator declines assignment' },
  { from: 'ACCEPTANCE_PENDING', to: 'FIELD_INVESTIGATION', requiredPermission: 'cases.accept', requiresReason: false, description: 'Investigator accepts docket' },

  // Investigation & Evidence
  { from: 'FIELD_INVESTIGATION', to: 'EVIDENCE_GATHERING', requiredPermission: 'evidence.upload', requiresReason: false, description: 'Upload geo-evidence and field findings' },
  { from: 'EVIDENCE_GATHERING', to: 'REPORT_DRAFTING', requiredPermission: 'reports.write', requiresReason: false, description: 'Compile findings into report draft' },

  // Review & Controlled Rework
  { from: 'REPORT_DRAFTING', to: 'REPORT_REVIEW', requiredPermission: 'reports.submit', requiresReason: false, description: 'Submit drafted report for review' },
  { from: 'REPORT_REVIEW', to: 'REPORT_DRAFTING', requiredPermission: 'reports.review', requiresReason: true, description: 'Send back report for rework' },
  { from: 'REPORT_REVIEW', to: 'ESCALATED_REVIEW', requiredPermission: null, requiresReason: false, description: 'Auto-escalate on 3+ reworks' },
  { from: 'ESCALATED_REVIEW', to: 'REPORT_DRAFTING', requiredPermission: 'reports.escalate', requiresReason: true, description: 'Senior override authorizing additional rework cycle' },
  { from: 'REPORT_REVIEW', to: 'APPROVED', requiredPermission: 'reports.approve', requiresReason: false, description: 'Approve final report' },
  { from: 'ESCALATED_REVIEW', to: 'APPROVED', requiredPermission: 'reports.approve', requiresReason: true, description: 'Senior executive approval overriding prior reworks' },

  // Physical Dispatch & Digital Closure
  { from: 'APPROVED', to: 'HARDCOPY_TRANSIT', requiredPermission: 'hardcopy.dispatch', requiresReason: false, description: 'Handover hardcopy docket to courier' },
  { from: 'APPROVED', to: 'CLOSED', requiredPermission: 'cases.close', requiresReason: false, description: 'Direct digital closure' },
  { from: 'HARDCOPY_TRANSIT', to: 'CLOSED', requiredPermission: 'hardcopy.receive', requiresReason: false, description: 'Courier POD received and acknowledged' },

  // Invoicing & Finance
  { from: 'CLOSED', to: 'INVOICED', requiredPermission: 'invoices.generate', requiresReason: false, description: 'Generate GST tax invoice' },
  { from: 'INVOICED', to: 'PARTIALLY_PAID', requiredPermission: 'payments.record', requiresReason: false, description: 'Record partial remittance' },
  { from: 'INVOICED', to: 'PAID_IN_FULL', requiredPermission: 'payments.record', requiresReason: false, description: 'Full invoice settlement received' },
  { from: 'PARTIALLY_PAID', to: 'PAID_IN_FULL', requiredPermission: 'payments.record', requiresReason: false, description: 'Final balance payment received' },
  { from: 'PAID_IN_FULL', to: 'PAYOUT_QUEUED', requiredPermission: 'payouts.prepare', requiresReason: false, description: 'Stage investigator fees and expenses' },
  { from: 'PAYOUT_QUEUED', to: 'FINANCIALLY_CLOSED', requiredPermission: 'payouts.disburse', requiresReason: true, description: 'Bank disbursement reference recorded' },

  // Exceptions (WITHDRAWN / REJECTED from active workflow)
  ...(['DATA_ENTRY', 'VERIFICATION', 'ASSIGNMENT', 'ACCEPTANCE_PENDING', 'FIELD_INVESTIGATION', 'EVIDENCE_GATHERING', 'REPORT_DRAFTING', 'REPORT_REVIEW', 'ESCALATED_REVIEW', 'APPROVED'] as CaseStatus[]).map((status) => ({
    from: status,
    to: 'WITHDRAWN' as CaseStatus,
    requiredPermission: 'cases.withdraw',
    requiresReason: true,
    description: 'Case recalled or withdrawn by insurer',
  })),
  ...(['REPORT_REVIEW', 'ESCALATED_REVIEW', 'CLOSED', 'INVOICED'] as CaseStatus[]).map((status) => ({
    from: status,
    to: 'REJECTED' as CaseStatus,
    requiredPermission: 'cases.reject',
    requiresReason: true,
    description: 'Claim or bill repudiated by client for dispute recovery',
  })),
];

/**
 * Checks whether a direct transition from fromStatus to toStatus is permitted.
 */
export function isValidTransition(fromStatus: CaseStatus, toStatus: CaseStatus): boolean {
  return WORKFLOW_TRANSITIONS.some((t) => t.from === fromStatus && t.to === toStatus);
}

/**
 * Retrieves the specific transition rule for a given pair.
 */
export function getTransitionRule(fromStatus: CaseStatus, toStatus: CaseStatus): TransitionRule | null {
  return WORKFLOW_TRANSITIONS.find((t) => t.from === fromStatus && t.to === toStatus) || null;
}

export interface TransitionValidationInput {
  fromStatus: CaseStatus;
  toStatus: CaseStatus;
  reason?: string | null;
  userPermissions: string[];
  currentVersion: number;
  targetVersion?: number;
  currentReworkCount?: number;
}

export interface TransitionValidationResult {
  allowed: boolean;
  resolvedNextStatus: CaseStatus;
  nextReworkCount: number;
  isEscalated: boolean;
  error?: string;
}

/**
 * Validates a proposed state transition against the pure state machine,
 * optimistic locking version, required permissions, and rework escalation rules.
 */
export function validateTransition(input: TransitionValidationInput): TransitionValidationResult {
  const {
    fromStatus,
    toStatus,
    reason,
    userPermissions,
    currentVersion,
    targetVersion,
    currentReworkCount = 0,
  } = input;

  // 1. Optimistic Locking Check
  if (targetVersion !== undefined && targetVersion !== currentVersion) {
    return {
      allowed: false,
      resolvedNextStatus: fromStatus,
      nextReworkCount: currentReworkCount,
      isEscalated: false,
      error: `Concurrent modification collision: Expected version ${currentVersion}, received ${targetVersion}. Please refresh the record.`,
    };
  }

  // 2. Transition Rule Lookup
  const rule = getTransitionRule(fromStatus, toStatus);
  if (!rule) {
    return {
      allowed: false,
      resolvedNextStatus: fromStatus,
      nextReworkCount: currentReworkCount,
      isEscalated: false,
      error: `Illegal status transition from '${fromStatus}' to '${toStatus}'.`,
    };
  }

  // 3. Permission Check
  if (rule.requiredPermission && !userPermissions.includes(rule.requiredPermission)) {
    return {
      allowed: false,
      resolvedNextStatus: fromStatus,
      nextReworkCount: currentReworkCount,
      isEscalated: false,
      error: `Missing required permission '${rule.requiredPermission}' for transition to '${toStatus}'.`,
    };
  }

  // 4. Mandatory Reason Check
  if (rule.requiresReason && (!reason || reason.trim().length === 0)) {
    return {
      allowed: false,
      resolvedNextStatus: fromStatus,
      nextReworkCount: currentReworkCount,
      isEscalated: false,
      error: `Reason is required for status transition to '${toStatus}'.`,
    };
  }

  // 5. Rework Count & Escalation Rule ($N >= 3)
  let resolvedNextStatus = toStatus;
  let nextReworkCount = currentReworkCount;
  let isEscalated = false;

  if (fromStatus === 'REPORT_REVIEW' && toStatus === 'REPORT_DRAFTING') {
    nextReworkCount = currentReworkCount + 1;
    if (nextReworkCount >= 3) {
      resolvedNextStatus = 'ESCALATED_REVIEW';
      isEscalated = true;
    }
  }

  return {
    allowed: true,
    resolvedNextStatus,
    nextReworkCount,
    isEscalated,
  };
}

/**
 * Validates that an outcome conclusion is substantively valid.
 * If outcome is FRAUD, fraud_reason is mandatory.
 */
export function validateOutcome(outcome: CaseOutcome, fraudReason?: string | null): { isValid: boolean; error?: string } {
  if (outcome === 'FRAUD') {
    if (!fraudReason || fraudReason.trim().length === 0) {
      return {
        isValid: false,
        error: "Fraud reason category/narrative is mandatory when setting outcome to 'FRAUD'.",
      };
    }
  }
  return { isValid: true };
}

/**
 * Resolves financial rules for case exceptions (Withdrawn / Rejected).
 * Conforms to Golden Test TEST-05.
 */
export function resolveExceptionFinancialRule(exceptionType: CaseExceptionType) {
  if (exceptionType === 'WITHDRAWN') {
    return {
      exception_type: 'WITHDRAWN',
      investigator_payable_percent: 0,
      client_billable: false,
      zero_fee_enforced: true,
      ta_reimbursement_permitted: true,
      requires_credit_note_if_invoiced: true,
    };
  }

  if (exceptionType === 'REJECTED') {
    return {
      exception_type: 'REJECTED',
      investigator_payable_percent: 0,
      client_billable: true,
      dispute_recovery_hub: true,
      payout_on_legal_hold: true,
    };
  }

  return null;
}
