/**
 * Vericlaim Multi-Tenant SaaS: Payments, TDS, Receivables & Recovery Types (Phase 7B)
 * CA-VERIFY: Tax, TDS, and Profit computations must follow statutory Indian accounting rules.
 */

import Decimal from 'decimal.js';

export type PaymentMode = 'NEFT' | 'RTGS' | 'IMPS' | 'CHEQUE' | 'UPI' | 'BANK_TRANSFER' | 'CASH';

export type TdsSection = '194J' | '194C' | '194H' | '194Q' | 'OTHER';

export type Form26ASStatus = 'PENDING' | 'MATCHED' | 'MISMATCHED' | 'CLAIMED';

export type RecoveryCategory =
  | 'billable_unpaid'        // Invoiced and issued, but payment pending
  | 'unbilled_approved'      // Case approved/closed, but not yet invoiced
  | 'rejected_short'         // Insurer made deduction/short-settlement requiring follow-up
  | 'withdrawn_disputed';    // Case cancelled/withdrawn or disputed by client

export interface ClientPayment {
  id: string;
  agency_id: string;
  client_id: string;
  client_branch_id?: string | null;
  payment_date: string;
  amount: string;
  unapplied_amount: string;
  payment_mode: PaymentMode;
  utr_number?: string | null;
  bank_name?: string | null;
  reference_note?: string | null;
  is_advance: boolean;
  idempotency_key?: string | null;
  version: number;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentAllocation {
  id: string;
  agency_id: string;
  payment_id: string;
  invoice_id: string;
  case_id?: string | null;
  allocated_amount: string;
  created_by?: string | null;
  created_at: string;
}

export interface TdsReceivable {
  id: string;
  agency_id: string;
  client_id: string;
  invoice_id: string;
  payment_id?: string | null;
  section: TdsSection;
  rate: string;
  amount: string;
  is_valid: boolean;
  certificate_number?: string | null;
  form_26as_status: Form26ASStatus;
  match_metadata?: Record<string, unknown> | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Form26ASRecord {
  id: string;
  agency_id: string;
  financial_year: string;
  deductor_tan: string;
  deductor_name?: string | null;
  section: string;
  transaction_date?: string | null;
  booking_date?: string | null;
  amount_paid: string;
  tds_deducted: string;
  status: 'UNMATCHED' | 'MATCHED' | 'PARTIALLY_MATCHED';
  matched_tds_id?: string | null;
  created_at: string;
}

export interface ShortSettlementSuggestion {
  isShortSettlement: boolean;
  differenceAmount: string;
  differencePercentage: string;
  suggestedSection: TdsSection;
  suggestedRate: string;
  suggestedTdsAmount: string;
  suggestedValidFlag: boolean;
  requiresUserConfirmation: true;
  rationale: string;
  isGrossDeduction?: boolean; // Q-CA-02: Insurer deducted on gross instead of taxable
}

export interface AgingBucketItem {
  daysBucket: '0-30' | '31-60' | '61-90' | '90+';
  invoiceCount: number;
  totalBilled: string;
  totalReceived: string;
  totalTds: string;
  totalOutstanding: string;
}

export interface AgingReportSummary {
  asOfDate: string;
  buckets: {
    b0_30: AgingBucketItem;
    b31_60: AgingBucketItem;
    b61_90: AgingBucketItem;
    b90_plus: AgingBucketItem;
  };
  totalOutstanding: string;
  totalInvoiced: string;
}

export interface ClientLedgerEntry {
  date: string;
  transactionType: 'INVOICE' | 'PAYMENT' | 'TDS_CREDIT' | 'CREDIT_NOTE';
  referenceId: string;
  referenceNumber: string;
  debit: string;   // Increase in receivable (Invoice)
  credit: string;  // Decrease in receivable (Payment, TDS, Credit Note)
  balance: string; // Running outstanding balance
  note?: string;
}

export interface ProfitAndLossReport {
  periodStart?: string;
  periodEnd?: string;
  /** Statutory Net Service Revenue = Taxable Service Fee (EXCLUDES GST collected) */
  netServiceRevenue: string;
  /** Direct Investigation Costs = Investigator fees + approved conveyance */
  directInvestigationCosts: string;
  /** Gross Profit = Net Service Revenue - Direct Investigation Costs */
  grossProfit: string;
  /** Gross Margin Percentage = (Gross Profit / Net Service Revenue) * 100 */
  grossMarginPercentage: string;
  /** GST Liability collected (CGST + SGST + IGST) - Balance Sheet liability, NEVER income */
  gstCollectedLiability: string;
  /** Total Remittance Inflow = Net received + TDS withheld */
  totalCashReceived: string;
  totalTdsReceivable: string;
  /** Legacy comparison mode (if owner explicitly asks) */
  legacyProfitComparison?: {
    legacyFormula: '(received + tds) - total_payable';
    legacyProfitAmount: string;
    warning: 'CA-VERIFY: Legacy formula improperly counts statutory GST liability as agency income.';
  };
}

export interface RecoveryHubItem {
  id: string;
  clientName: string;
  clientId: string;
  branchName?: string;
  caseId?: string;
  caseNumber?: string;
  claimNumber?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  category: RecoveryCategory;
  amount: string;
  daysPending: number;
  status: string;
  remarks?: string;
}
