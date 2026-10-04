/**
 * Vericlaim Multi-Tenant SaaS: Pure Payments, TDS, Receivables & Profit Engine (Phase 7B)
 * Pure domain module using Decimal.js (no DB / UI dependencies).
 *
 * Mark: CA-VERIFY (Legal/tax calculations must follow Indian statutory accounting rules)
 */

import Decimal from 'decimal.js';
import {
  ShortSettlementSuggestion,
  AgingReportSummary,
  ProfitAndLossReport,
  ClientLedgerEntry,
  RecoveryHubItem,
  RecoveryCategory,
} from './payment-types';

// Configure central precision and rounding policy (Rule A6)
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export const DEFAULT_TDS_SECTION = '194J';
export const DEFAULT_TDS_RATE = '10.00'; // Standard 10% for professional/technical fees under 194J

// ==============================================================================
// 1. OUTSTANDING FORMULA (Rule A6)
// Outstanding = Invoice Total - Received Amount - Valid TDS
// ==============================================================================
export function calculateInvoiceOutstanding(
  totalAmount: string | number | Decimal,
  allocatedReceived: string | number | Decimal,
  validTds: string | number | Decimal = '0.00'
): Decimal {
  const total = new Decimal(totalAmount || '0.00');
  const received = new Decimal(allocatedReceived || '0.00');
  const tds = new Decimal(validTds || '0.00');

  const outstanding = total.minus(received).minus(tds);
  return outstanding.lessThan(0) ? new Decimal('0.00') : outstanding;
}

// ==============================================================================
// 2. SHORT-SETTLEMENT TDS AUTO-SUGGESTION ENGINE
// Legacy insurers deduct ~10% under Section 194J without sending Form 16A upfront.
// This engine detects if the shortfall matches ~10% (on gross or taxable base).
// CRITICAL: Must be user-confirmed, NEVER applied silently!
// ==============================================================================
export interface ShortSettlementCheckInput {
  invoiceTotal: string | number | Decimal;
  taxableAmount?: string | number | Decimal;
  receivedAmount: string | number | Decimal;
  configuredRatePercent?: number; // e.g. 10.0
  toleranceRupees?: number;       // e.g. 5.0 (for rounding)
}

export function detectShortSettlementTds(
  input: ShortSettlementCheckInput
): ShortSettlementSuggestion | null {
  const total = new Decimal(input.invoiceTotal || '0.00');
  const received = new Decimal(input.receivedAmount || '0.00');
  const ratePct = input.configuredRatePercent ?? 10.0;
  const tolerance = new Decimal(input.toleranceRupees ?? 5.0);

  if (total.isZero() || received.greaterThanOrEqualTo(total)) {
    return null;
  }

  const shortfall = total.minus(received);
  if (shortfall.isNegative() || shortfall.isZero()) {
    return null;
  }

  // Hypothesis 1: 10% deducted on Gross Total (Common insurer legacy behavior)
  const expectedGrossTds = total.times(ratePct).dividedBy(100);
  const diffGross = shortfall.minus(expectedGrossTds).abs();

  if (diffGross.lessThanOrEqualTo(tolerance)) {
    const diffPct = shortfall.dividedBy(total).times(100).toFixed(2);
    return {
      isShortSettlement: true,
      differenceAmount: shortfall.toFixed(2),
      differencePercentage: `${diffPct}%`,
      suggestedSection: '194J',
      suggestedRate: ratePct.toFixed(2),
      suggestedTdsAmount: shortfall.toFixed(2),
      suggestedValidFlag: true,
      requiresUserConfirmation: true,
      isGrossDeduction: true,
      rationale: `Remittance received (₹${received.toFixed(2)}) reflects a ~${ratePct}% deduction on Gross Invoice Total (₹${total.toFixed(2)}). Insurers commonly deduct Section 194J TDS at 10% upfront.`,
    };
  }

  // Hypothesis 2: 10% deducted on Taxable Base (Statutory standard per CBDT Circular 23/2017)
  if (input.taxableAmount) {
    const taxable = new Decimal(input.taxableAmount);
    const expectedTaxableTds = taxable.times(ratePct).dividedBy(100);
    const diffTaxable = shortfall.minus(expectedTaxableTds).abs();

    if (diffTaxable.lessThanOrEqualTo(tolerance)) {
      const diffPct = shortfall.dividedBy(total).times(100).toFixed(2);
      return {
        isShortSettlement: true,
        differenceAmount: shortfall.toFixed(2),
        differencePercentage: `${diffPct}%`,
        suggestedSection: '194J',
        suggestedRate: ratePct.toFixed(2),
        suggestedTdsAmount: shortfall.toFixed(2),
        suggestedValidFlag: true,
        requiresUserConfirmation: true,
        isGrossDeduction: false,
        rationale: `Remittance received reflects a ~${ratePct}% deduction on Taxable Base (₹${taxable.toFixed(2)}) per CBDT Circular 23/2017. Section 194J TDS auto-suggested.`,
      };
    }
  }

  // Check if shortfall is within a configurable threshold percentage (e.g. 9.5% to 10.5%)
  const actualShortfallPct = shortfall.dividedBy(total).times(100);
  if (actualShortfallPct.greaterThanOrEqualTo(9.5) && actualShortfallPct.lessThanOrEqualTo(10.5)) {
    return {
      isShortSettlement: true,
      differenceAmount: shortfall.toFixed(2),
      differencePercentage: `${actualShortfallPct.toFixed(2)}%`,
      suggestedSection: '194J',
      suggestedRate: ratePct.toFixed(2),
      suggestedTdsAmount: shortfall.toFixed(2),
      suggestedValidFlag: true,
      requiresUserConfirmation: true,
      isGrossDeduction: true,
      rationale: `Shortfall of ₹${shortfall.toFixed(2)} (${actualShortfallPct.toFixed(2)}%) matches standard 10% Section 194J withholding range. Confirm to record TDS receivable.`,
    };
  }

  return null;
}

// ==============================================================================
// 3. 26AS / AIS RECONCILIATION MATCHER
// Matches imported 26AS records against internal recorded TDS receivables
// ==============================================================================
export interface InternalTdsCandidate {
  id: string;
  invoiceNumber?: string;
  clientPanOrTan?: string;
  amount: string | Decimal;
  section: string;
  isValid: boolean;
}

export interface Imported26ASInput {
  deductorTan: string;
  financialYear: string;
  section: string;
  tdsDeducted: string | Decimal;
  amountPaid?: string | Decimal;
}

export interface Match26ASResult {
  status: 'MATCHED' | 'PARTIALLY_MATCHED' | 'UNMATCHED';
  matchedTdsId?: string;
  confidenceScore: number; // 0.0 to 1.0
  notes: string;
}

export function match26ASRecord(
  imported: Imported26ASInput,
  candidates: InternalTdsCandidate[],
  amountToleranceRupees: number = 2.0
): Match26ASResult {
  const importedTds = new Decimal(imported.tdsDeducted);
  const tolerance = new Decimal(amountToleranceRupees);

  // Exact amount match with section match
  const exactMatches = candidates.filter((c) => {
    if (!c.isValid) return false;
    const candAmount = new Decimal(c.amount);
    const amountDiff = candAmount.minus(importedTds).abs();
    const sectionMatch = !c.section || !imported.section || c.section.toUpperCase() === imported.section.toUpperCase();
    return amountDiff.lessThanOrEqualTo(tolerance) && sectionMatch;
  });

  if (exactMatches.length === 1) {
    return {
      status: 'MATCHED',
      matchedTdsId: exactMatches[0].id,
      confidenceScore: 0.98,
      notes: `Exact amount match (₹${importedTds.toFixed(2)}) found under Section ${imported.section}.`,
    };
  }

  if (exactMatches.length > 1) {
    return {
      status: 'PARTIALLY_MATCHED',
      matchedTdsId: exactMatches[0].id,
      confidenceScore: 0.70,
      notes: `Multiple internal TDS records found matching ₹${importedTds.toFixed(2)}. Manual selection recommended.`,
    };
  }

  // Check sum of multiple invoices (bulk quarterly credit in 26AS)
  let cumulativeSum = new Decimal('0.00');
  const validCandidates = candidates.filter((c) => c.isValid);
  for (const c of validCandidates) {
    cumulativeSum = cumulativeSum.plus(new Decimal(c.amount));
  }

  if (validCandidates.length > 1 && cumulativeSum.minus(importedTds).abs().lessThanOrEqualTo(tolerance)) {
    return {
      status: 'PARTIALLY_MATCHED',
      confidenceScore: 0.85,
      notes: `Batch aggregate match: 26AS TDS ₹${importedTds.toFixed(2)} matches sum of ${validCandidates.length} TDS entries.`,
    };
  }

  return {
    status: 'UNMATCHED',
    confidenceScore: 0.0,
    notes: `No internal TDS receivable found matching ₹${importedTds.toFixed(2)} for TAN ${imported.deductorTan}.`,
  };
}

// ==============================================================================
// 4. AGING BUCKET CALCULATION (0-30, 31-60, 61-90, 90+ days)
// ==============================================================================
export interface AgingInvoiceData {
  id: string;
  invoiceNumber: string;
  issueDate: string; // ISO date string YYYY-MM-DD
  dueDate?: string | null;
  totalAmount: string | Decimal;
  allocatedAmount: string | Decimal;
  validTds: string | Decimal;
}

export function calculateAgingBuckets(
  invoices: AgingInvoiceData[],
  asOfDate: Date | string = new Date()
): AgingReportSummary {
  const asOf = typeof asOfDate === 'string' ? new Date(asOfDate) : asOfDate;
  const asOfTime = asOf.getTime();

  const initBucket = (daysBucket: '0-30' | '31-60' | '61-90' | '90+') => ({
    daysBucket,
    invoiceCount: 0,
    totalBilled: '0.00',
    totalReceived: '0.00',
    totalTds: '0.00',
    totalOutstanding: '0.00',
  });

  const b0_30 = initBucket('0-30');
  const b31_60 = initBucket('31-60');
  const b61_90 = initBucket('61-90');
  const b90_plus = initBucket('90+');

  let grandOutstanding = new Decimal('0.00');
  let grandInvoiced = new Decimal('0.00');

  for (const inv of invoices) {
    const total = new Decimal(inv.totalAmount || '0.00');
    const received = new Decimal(inv.allocatedAmount || '0.00');
    const tds = new Decimal(inv.validTds || '0.00');
    const outstanding = calculateInvoiceOutstanding(total, received, tds);

    grandInvoiced = grandInvoiced.plus(total);
    grandOutstanding = grandOutstanding.plus(outstanding);

    // Calculate days past invoice date (or due date)
    const refDate = new Date(inv.dueDate || inv.issueDate);
    const diffMs = asOfTime - refDate.getTime();
    const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    let target = b0_30;
    if (diffDays > 90) {
      target = b90_plus;
    } else if (diffDays > 60) {
      target = b61_90;
    } else if (diffDays > 30) {
      target = b31_60;
    }

    target.invoiceCount += 1;
    target.totalBilled = new Decimal(target.totalBilled).plus(total).toFixed(2);
    target.totalReceived = new Decimal(target.totalReceived).plus(received).toFixed(2);
    target.totalTds = new Decimal(target.totalTds).plus(tds).toFixed(2);
    target.totalOutstanding = new Decimal(target.totalOutstanding).plus(outstanding).toFixed(2);
  }

  return {
    asOfDate: asOf.toISOString().split('T')[0],
    buckets: {
      b0_30,
      b31_60,
      b61_90,
      b90_plus,
    },
    totalOutstanding: grandOutstanding.toFixed(2),
    totalInvoiced: grandInvoiced.toFixed(2),
  };
}

// ==============================================================================
// 5. STATUTORY PROFIT & LOSS ENGINE (Q-CA-01)
// Standard Indian Accounting Principle:
// Revenue = Net Service Fee (Strictly EXCLUDES GST).
// GST collected is a statutory liability payable to the Indian Government.
// Counting GST in revenue/profit is a major compliance violation.
// ==============================================================================
export interface ProfitCalculationInput {
  periodStart?: string;
  periodEnd?: string;
  invoices: {
    taxableAmount: string | Decimal;
    cgstAmount: string | Decimal;
    sgstAmount: string | Decimal;
    igstAmount: string | Decimal;
    totalAmount: string | Decimal;
    status: string;
  }[];
  payments: {
    amount: string | Decimal;
  }[];
  tdsRecords: {
    amount: string | Decimal;
    isValid: boolean;
  }[];
  investigatorPayables: {
    amount: string | Decimal;
    isApproved: boolean;
  }[];
  includeLegacyComparison?: boolean;
}

export function calculateProfitAndLoss(
  input: ProfitCalculationInput
): ProfitAndLossReport {
  let netServiceRevenue = new Decimal('0.00');
  let gstCollectedLiability = new Decimal('0.00');
  let totalBilledGross = new Decimal('0.00');

  // Sum non-cancelled invoices
  for (const inv of input.invoices) {
    if (inv.status === 'CANCELLED') continue;
    const taxable = new Decimal(inv.taxableAmount || '0.00');
    const cgst = new Decimal(inv.cgstAmount || '0.00');
    const sgst = new Decimal(inv.sgstAmount || '0.00');
    const igst = new Decimal(inv.igstAmount || '0.00');
    const total = new Decimal(inv.totalAmount || '0.00');

    netServiceRevenue = netServiceRevenue.plus(taxable);
    gstCollectedLiability = gstCollectedLiability.plus(cgst).plus(sgst).plus(igst);
    totalBilledGross = totalBilledGross.plus(total);
  }

  // Sum direct investigation costs
  let directInvestigationCosts = new Decimal('0.00');
  for (const invCost of input.investigatorPayables) {
    if (invCost.isApproved) {
      directInvestigationCosts = directInvestigationCosts.plus(new Decimal(invCost.amount || '0.00'));
    }
  }

  // Statutory Gross Profit = Net Service Revenue - Direct Investigation Costs
  const grossProfit = netServiceRevenue.minus(directInvestigationCosts);
  const grossMarginPercentage = netServiceRevenue.isZero()
    ? '0.00%'
    : `${grossProfit.dividedBy(netServiceRevenue).times(100).toFixed(2)}%`;

  // Cash Inflows
  let totalCashReceived = new Decimal('0.00');
  for (const p of input.payments) {
    totalCashReceived = totalCashReceived.plus(new Decimal(p.amount || '0.00'));
  }

  let totalTdsReceivable = new Decimal('0.00');
  for (const t of input.tdsRecords) {
    if (t.isValid) {
      totalTdsReceivable = totalTdsReceivable.plus(new Decimal(t.amount || '0.00'));
    }
  }

  const report: ProfitAndLossReport = {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    netServiceRevenue: netServiceRevenue.toFixed(2),
    directInvestigationCosts: directInvestigationCosts.toFixed(2),
    grossProfit: grossProfit.toFixed(2),
    grossMarginPercentage,
    gstCollectedLiability: gstCollectedLiability.toFixed(2),
    totalCashReceived: totalCashReceived.toFixed(2),
    totalTdsReceivable: totalTdsReceivable.toFixed(2),
  };

  // Optional legacy comparison (if owner explicitly asks)
  if (input.includeLegacyComparison) {
    // Legacy formula: profit = (received + tds) - total_payable
    const legacyProfit = totalCashReceived.plus(totalTdsReceivable).minus(directInvestigationCosts);
    report.legacyProfitComparison = {
      legacyFormula: '(received + tds) - total_payable',
      legacyProfitAmount: legacyProfit.toFixed(2),
      warning: 'CA-VERIFY: Legacy formula improperly counts statutory GST liability as agency income.',
    };
  }

  return report;
}

// ==============================================================================
// 6. RECOVERY CATEGORIZATION ENGINE
// ==============================================================================
export interface RecoveryCaseItem {
  id: string;
  caseNumber: string;
  claimNumber?: string;
  clientName: string;
  clientId: string;
  branchName?: string;
  status: string;
  approvedDate?: string;
  estimatedFee?: string | number;
}

export interface RecoveryInvoiceItem {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  branchName?: string;
  issueDate: string;
  totalAmount: string | Decimal;
  outstandingAmount: string | Decimal;
  status: string;
}

export function classifyRecoveryItems(
  invoices: RecoveryInvoiceItem[],
  unbilledCases: RecoveryCaseItem[]
): RecoveryHubItem[] {
  const items: RecoveryHubItem[] = [];
  const now = new Date().getTime();

  // 1. Invoiced but Unpaid (Billable Unpaid)
  for (const inv of invoices) {
    const outstanding = new Decimal(inv.outstandingAmount || '0.00');
    if (outstanding.greaterThan(0) && inv.status !== 'CANCELLED') {
      const issueMs = new Date(inv.issueDate).getTime();
      const days = Math.max(0, Math.floor((now - issueMs) / (1000 * 60 * 60 * 24)));
      items.push({
        id: `rec-inv-${inv.id}`,
        clientName: inv.clientName,
        clientId: inv.clientId,
        branchName: inv.branchName,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.issueDate,
        category: 'billable_unpaid',
        amount: outstanding.toFixed(2),
        daysPending: days,
        status: inv.status,
        remarks: `Invoice ${inv.invoiceNumber} outstanding ₹${outstanding.toFixed(2)}`,
      });
    }
  }

  // 2. Unbilled Approved (Work completed & approved, ready for invoicing)
  for (const c of unbilledCases) {
    const fee = new Decimal(c.estimatedFee || '0.00');
    const appMs = c.approvedDate ? new Date(c.approvedDate).getTime() : now;
    const days = Math.max(0, Math.floor((now - appMs) / (1000 * 60 * 60 * 24)));
    items.push({
      id: `rec-case-${c.id}`,
      clientName: c.clientName,
      clientId: c.clientId,
      branchName: c.branchName,
      caseId: c.id,
      caseNumber: c.caseNumber,
      claimNumber: c.claimNumber,
      category: 'unbilled_approved',
      amount: fee.toFixed(2),
      daysPending: days,
      status: c.status,
      remarks: `Case ${c.caseNumber} approved, pending invoice drafting`,
    });
  }

  return items;
}
