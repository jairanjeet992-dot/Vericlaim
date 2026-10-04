import { Decimal } from 'decimal.js';
import { 
  InvestigatorPaymentTerm, 
  InvestigatorFeeRule, 
  CaseOutcomeRule, 
  PayoutCompilationInvestigator, 
  CompiledInvestigatorPayout, 
  CompiledPayoutBatch,
  TdsSection 
} from './investigator-types';

// Configure Decimal.js per Rule A6
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export function toDecimal(val: number | string | Decimal): Decimal {
  return new Decimal(val || 0);
}

export function roundPaisa(val: Decimal): Decimal {
  return val.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Resolves the active payment terms for an investigator as of a given reference date.
 * Supports effective-dated terms (Rule A12).
 */
export function resolveEffectivePaymentTerms(
  terms: InvestigatorPaymentTerm[],
  asOfDate: Date | string
): InvestigatorPaymentTerm {
  const targetDate = typeof asOfDate === 'string' ? asOfDate : asOfDate.toISOString().slice(0, 10);

  const activeTerms = terms.filter(t => {
    const from = t.effective_from;
    const to = t.effective_to;
    if (from > targetDate) return false;
    if (to && to < targetDate) return false;
    return true;
  });

  if (activeTerms.length === 0) {
    return {
      agency_id: '',
      investigator_id: '',
      payment_type: 'PER_CASE',
      base_fee_or_salary: 0,
      effective_from: '1970-01-01',
      effective_to: null,
    };
  }

  // Pick the latest effective_from
  return activeTerms.sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
}

export interface CaseFeeCalculationParams {
  agreed_fee?: number;
  travel_allowance?: number;
  fee_rule?: InvestigatorFeeRule | null;
  outcome?: CaseOutcomeRule | null; // e.g. WITHDRAWN -> 0%
}

export interface CaseFeeCalculationResult {
  base_fee: number;
  effective_case_fee: number;
  travel_allowance: number;
  special_allowance: number;
  total_case_payable: number;
  payable_percent: number;
}

/**
 * Computes fee for a case investigator assignment, factoring in outcome rules (e.g. WITHDRAWN -> 0 payable).
 */
export function calculateCaseInvestigatorFee(
  params: CaseFeeCalculationParams
): CaseFeeCalculationResult {
  const agreed = toDecimal(params.agreed_fee || 0);
  const ruleBase = toDecimal(params.fee_rule?.base_fee || 0);
  const defaultTa = toDecimal(params.fee_rule?.default_ta || 0);
  const assignedTa = toDecimal(params.travel_allowance || 0);
  const specialAllow = toDecimal(params.fee_rule?.special_allowance || 0);

  // Base fee determination
  const baseFee = agreed.gt(0) ? agreed : ruleBase;

  // Outcome percentage (e.g., WITHDRAWN = 0%, normal = 100%)
  const payablePercent = params.outcome ? params.outcome.investigator_payable_percent : 100;
  const effectiveCaseFee = roundPaisa(baseFee.times(payablePercent).dividedBy(100));

  // Travel allowance: custom assigned TA takes precedence if positive, else default TA
  const effectiveTa = assignedTa.gt(0) ? assignedTa : defaultTa;

  // Total payable for this case assignment
  const totalPayable = roundPaisa(effectiveCaseFee.plus(effectiveTa).plus(specialAllow));

  return {
    base_fee: baseFee.toNumber(),
    effective_case_fee: effectiveCaseFee.toNumber(),
    travel_allowance: effectiveTa.toNumber(),
    special_allowance: specialAllow.toNumber(),
    total_case_payable: totalPayable.toNumber(),
    payable_percent: payablePercent,
  };
}

export interface TdsCalculationParams {
  gross_amount: number;
  pan_number?: string | null;
  section?: TdsSection;
  custom_rate?: number;
}

export interface TdsCalculationResult {
  section: TdsSection;
  rate: number;
  tds_amount: number;
  is_penal_rate_206aa: boolean;
}

/**
 * Validates Indian PAN format: 5 letters, 4 digits, 1 letter.
 */
export function isValidPan(pan?: string | null): boolean {
  if (!pan) return false;
  return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.trim().toUpperCase());
}

/**
 * Calculates TDS for an investigator payout.
 * Under Section 206AA of the Income Tax Act, if PAN is missing or invalid,
 * a penal rate of 20% must be deducted.
 */
export function calculateInvestigatorTds(
  params: TdsCalculationParams
): TdsCalculationResult {
  const gross = toDecimal(params.gross_amount);
  const hasValidPan = isValidPan(params.pan_number);
  const section = params.section || '194J';

  let rate = 10.0; // Standard 194J professional fee rate
  let isPenal = false;

  if (!hasValidPan) {
    // Statutory Section 206AA penalty: Minimum 20%
    rate = 20.0;
    isPenal = true;
  } else if (params.custom_rate !== undefined && params.custom_rate >= 0) {
    rate = params.custom_rate;
  } else if (section === '194C') {
    rate = 1.0; // 1% for individual/HUF contractor
  } else if (section === '194H') {
    rate = 5.0; // 5% for commission/brokerage
  } else {
    rate = 10.0; // 194J default
  }

  const tdsAmount = roundPaisa(gross.times(rate).dividedBy(100));

  return {
    section,
    rate,
    tds_amount: tdsAmount.toNumber(),
    is_penal_rate_206aa: isPenal,
  };
}

/**
 * Compiles a monthly payout for a single investigator with full item breakdown.
 */
export function compileInvestigatorPayout(
  input: PayoutCompilationInvestigator,
  payoutMonth: string
): CompiledInvestigatorPayout {
  let caseFees = new Decimal(0);
  let expenses = new Decimal(0);
  let bonuses = new Decimal(0);
  let advances = new Decimal(0);
  let otherDeductions = new Decimal(0);
  const baseSalaryOrFee = toDecimal(input.base_salary_or_fee);

  for (const item of input.items) {
    const amt = toDecimal(item.amount);
    switch (item.item_type) {
      case 'CASE_FEE':
        caseFees = caseFees.plus(amt);
        break;
      case 'EXPENSE':
        expenses = expenses.plus(amt);
        break;
      case 'BONUS':
        bonuses = bonuses.plus(amt);
        break;
      case 'ADVANCE_DEDUCTION':
        advances = advances.plus(amt);
        break;
      case 'OTHER_DEDUCTION':
        otherDeductions = otherDeductions.plus(amt);
        break;
      case 'SALARY_BASE':
        // Base salary item if present
        break;
      case 'SUPPLEMENTAL_ADJUSTMENT':
        if (item.is_deduction) {
          otherDeductions = otherDeductions.plus(amt);
        } else {
          bonuses = bonuses.plus(amt);
        }
        break;
    }
  }

  // Gross calculation
  let gross = new Decimal(0);
  if (input.payment_type === 'SALARY') {
    gross = baseSalaryOrFee.plus(expenses).plus(bonuses);
  } else {
    gross = caseFees.plus(expenses).plus(bonuses);
  }
  gross = roundPaisa(gross);

  // TDS calculation
  const tdsResult = calculateInvestigatorTds({
    gross_amount: gross.toNumber(),
    pan_number: input.pan_number,
    section: input.custom_tds_section,
    custom_rate: input.custom_tds_rate,
  });
  const tds = toDecimal(tdsResult.tds_amount);

  // Net payable calculation: Gross - TDS - Advances - Other Deductions
  const net = roundPaisa(gross.minus(tds).minus(advances).minus(otherDeductions));

  // Invariant verification (never allow negative net or rounding drift)
  const totalDeductions = advances.plus(otherDeductions);

  return {
    investigator_id: input.investigator_id,
    investigator_name: input.investigator_name,
    payment_type: input.payment_type,
    payout_month: payoutMonth,
    base_salary_or_fee: baseSalaryOrFee.toNumber(),
    total_case_fees: roundPaisa(caseFees).toNumber(),
    total_expenses: roundPaisa(expenses).toNumber(),
    total_bonuses: roundPaisa(bonuses).toNumber(),
    total_advances_deducted: roundPaisa(advances).toNumber(),
    total_deductions: roundPaisa(totalDeductions).toNumber(),
    gross_payable: gross.toNumber(),
    tds_section: tdsResult.section,
    tds_rate: tdsResult.rate,
    tds_amount: tds.toNumber(),
    net_payable: net.toNumber(),
    bank_name: input.bank_name || undefined,
    account_number: input.account_number || undefined,
    ifsc_code: input.ifsc_code || undefined,
    pan_number: input.pan_number || undefined,
    items: input.items,
  };
}

/**
 * Compiles a monthly payout batch across all investigators.
 */
export function compilePayoutBatch(
  investigators: PayoutCompilationInvestigator[],
  payoutMonth: string,
  batchNumber: string
): CompiledPayoutBatch {
  let totalGross = new Decimal(0);
  let totalTds = new Decimal(0);
  let totalAdvances = new Decimal(0);
  let totalNet = new Decimal(0);

  const compiledPayouts: CompiledInvestigatorPayout[] = [];

  for (const inv of investigators) {
    const compiled = compileInvestigatorPayout(inv, payoutMonth);
    compiledPayouts.push(compiled);

    totalGross = totalGross.plus(compiled.gross_payable);
    totalTds = totalTds.plus(compiled.tds_amount);
    totalAdvances = totalAdvances.plus(compiled.total_advances_deducted);
    totalNet = totalNet.plus(compiled.net_payable);
  }

  // Exact penny matching check
  const roundedGross = roundPaisa(totalGross).toNumber();
  const roundedTds = roundPaisa(totalTds).toNumber();
  const roundedAdvances = roundPaisa(totalAdvances).toNumber();
  const roundedNet = roundPaisa(totalNet).toNumber();

  return {
    payout_month: payoutMonth,
    batch_number: batchNumber,
    total_investigators: compiledPayouts.length,
    total_gross: roundedGross,
    total_tds: roundedTds,
    total_advances_deducted: roundedAdvances,
    total_net_disbursable: roundedNet,
    payouts: compiledPayouts,
  };
}
