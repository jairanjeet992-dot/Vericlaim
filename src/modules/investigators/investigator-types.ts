import { z } from 'zod';

export type PaymentType = 'PER_CASE' | 'SALARY';
export type ExpenseType = 
  | 'TRAVEL_ALLOWANCE' 
  | 'FUEL' 
  | 'HOTEL' 
  | 'PRINTING_STATIONERY' 
  | 'HOSPITAL_RECORD_FEE' 
  | 'INFORMANT_FEE' 
  | 'BONUS' 
  | 'ADVANCE' 
  | 'DEDUCTION' 
  | 'OTHER';

export type ExpenseStatus = 
  | 'SUBMITTED' 
  | 'REVIEW' 
  | 'APPROVED' 
  | 'REJECTED' 
  | 'IN_PAYOUT' 
  | 'PAID';

export type PayoutBatchStatus = 'DRAFT' | 'FINALIZED' | 'PAID' | 'CANCELLED';
export type InvestigatorPayoutStatus = 'OPEN' | 'FINALIZED' | 'PAID';
export type TdsSection = '194J' | '194C' | '194H' | 'OTHER';
export type SlaStatus = 'NORMAL' | 'APPROACHING' | 'URGENT' | 'BREACHED';
export type ScorecardTier = 'ELITE' | 'PROFICIENT' | 'AVERAGE' | 'NEEDS_IMPROVEMENT';
export type HospitalRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface InvestigatorPaymentTerm {
  id?: string;
  agency_id: string;
  investigator_id: string;
  payment_type: PaymentType;
  base_fee_or_salary: number; // In rupees
  effective_from: string; // ISO date YYYY-MM-DD
  effective_to?: string | null;
}

export interface InvestigatorFeeRule {
  id?: string;
  agency_id: string;
  case_type_id?: string | null;
  client_id?: string | null;
  state: string;
  city: string;
  base_fee: number;
  default_ta: number;
  special_allowance: number;
  is_active: boolean;
}

export interface CaseOutcomeRule {
  code: string;
  investigator_payable_percent: number; // 0 for WITHDRAWN, 100 for GENUINE/FRAUD
}

export interface ExpenseClaimInput {
  agency_id: string;
  investigator_id: string;
  case_id?: string | null;
  expense_type: ExpenseType;
  amount: number;
  receipt_r2_key?: string | null;
  receipt_sha256?: string | null;
  requires_receipt?: boolean;
  claim_notes?: string | null;
}

export interface PayoutCompilationItem {
  item_type: 'CASE_FEE' | 'EXPENSE' | 'BONUS' | 'ADVANCE_DEDUCTION' | 'OTHER_DEDUCTION' | 'SALARY_BASE' | 'SUPPLEMENTAL_ADJUSTMENT';
  case_id?: string | null;
  case_investigator_id?: string | null;
  expense_id?: string | null;
  description: string;
  amount: number;
  is_deduction: boolean;
}

export interface PayoutCompilationInvestigator {
  investigator_id: string;
  investigator_name: string;
  payment_type: PaymentType;
  pan_number?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  ifsc_code?: string | null;
  base_salary_or_fee: number;
  custom_tds_section?: TdsSection;
  custom_tds_rate?: number;
  items: PayoutCompilationItem[];
}

export interface CompiledInvestigatorPayout {
  investigator_id: string;
  investigator_name: string;
  payment_type: PaymentType;
  payout_month: string;
  base_salary_or_fee: number;
  total_case_fees: number;
  total_expenses: number;
  total_bonuses: number;
  total_advances_deducted: number;
  total_deductions: number;
  gross_payable: number;
  tds_section: TdsSection;
  tds_rate: number;
  tds_amount: number;
  net_payable: number;
  bank_name?: string;
  account_number?: string;
  ifsc_code?: string;
  pan_number?: string;
  items: PayoutCompilationItem[];
}

export interface CompiledPayoutBatch {
  payout_month: string;
  batch_number: string;
  total_investigators: number;
  total_gross: number;
  total_tds: number;
  total_advances_deducted: number;
  total_net_disbursable: number;
  payouts: CompiledInvestigatorPayout[];
}

// Zod validation schemas
export const ExpenseClaimSchema = z.object({
  agency_id: z.string().uuid(),
  investigator_id: z.string().uuid(),
  case_id: z.string().uuid().optional().nullable(),
  expense_type: z.enum([
    'TRAVEL_ALLOWANCE', 'FUEL', 'HOTEL', 'PRINTING_STATIONERY', 
    'HOSPITAL_RECORD_FEE', 'INFORMANT_FEE', 'BONUS', 'ADVANCE', 
    'DEDUCTION', 'OTHER'
  ]),
  amount: z.number().positive('Expense amount must be greater than zero'),
  receipt_r2_key: z.string().optional().nullable(),
  receipt_sha256: z.string().length(64).optional().nullable(),
  requires_receipt: z.boolean().default(true),
  claim_notes: z.string().max(1000).optional().nullable(),
}).refine((data) => {
  if (data.requires_receipt && !['BONUS', 'ADVANCE', 'DEDUCTION'].includes(data.expense_type)) {
    return !!data.receipt_r2_key;
  }
  return true;
}, {
  message: 'Receipt upload is mandatory for this expense type',
  path: ['receipt_r2_key']
});

export const ExpenseApprovalSchema = z.object({
  expense_id: z.string().uuid(),
  status: z.enum(['APPROVED', 'REJECTED']),
  rejection_reason: z.string().max(500).optional(),
  review_notes: z.string().max(500).optional(),
}).refine((data) => {
  if (data.status === 'REJECTED') {
    return !!data.rejection_reason && data.rejection_reason.trim().length > 0;
  }
  return true;
}, {
  message: 'Rejection reason is mandatory when rejecting an expense',
  path: ['rejection_reason']
});

export const SlaExceptionRequestSchema = z.object({
  case_id: z.string().uuid(),
  extension_hours: z.number().int().positive().max(720),
  reason: z.string().min(5, 'Detailed reason required').max(1000),
});

export const ScorecardConfigSchema = z.object({
  tat_weight: z.number().min(0).max(100),
  fraud_rate_weight: z.number().min(0).max(100),
  quality_weight: z.number().min(0).max(100),
  volume_weight: z.number().min(0).max(100),
}).refine((data) => {
  return data.tat_weight + data.fraud_rate_weight + data.quality_weight + data.volume_weight === 100;
}, {
  message: 'Scorecard weights must sum to exactly 100%',
});
