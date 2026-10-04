import { describe, it, expect, beforeEach } from 'vitest';
import { Decimal } from 'decimal.js';
import { 
  resolveEffectivePaymentTerms, 
  calculateCaseInvestigatorFee, 
  calculateInvestigatorTds, 
  compileInvestigatorPayout, 
  compilePayoutBatch,
  isValidPan
} from '../../src/modules/investigators/investigator-fees';
import { 
  calculateSlaTarget, 
  evaluateSlaStatus, 
  processSlaTicker 
} from '../../src/modules/sla/sla-engine';
import { 
  calculateInvestigatorScorecard, 
  resolveScorecardTier,
  DEFAULT_SCORECARD_WEIGHTS 
} from '../../src/modules/scorecard/scorecard-engine';
import { 
  calculateHospitalRiskProfile, 
  generateDispatchWarning 
} from '../../src/modules/scorecard/hospital-fraud-engine';
import { generateBankBulkPaymentExcel } from '../../src/modules/investigators/excel-export';
import { generatePayoutStatementDocument } from '../../src/modules/investigators/pdf-payout-statement';
import { 
  InvestigatorPaymentTerm, 
  PayoutCompilationInvestigator, 
  ExpenseClaimSchema,
  ExpenseApprovalSchema 
} from '../../src/modules/investigators/investigator-types';

describe('PHASE 8: Investigator Fees, Expenses, Payouts, SLA & Scorecard Gates', () => {

  const agencyId = '11111111-1111-1111-1111-111111111111';
  const investigator1Id = '22222222-2222-2222-2222-222222222222';
  const investigator2Id = '33333333-3333-3333-3333-333333333333';

  // =========================================================================
  // GATE 1: Effective-Dated Terms Resolution (Per Case vs Salary)
  // =========================================================================
  describe('GATE 1: Effective-Dated Terms Resolution', () => {
    it('resolves historical PER_CASE terms before transition date', () => {
      const termsHistory: InvestigatorPaymentTerm[] = [
        {
          agency_id: agencyId,
          investigator_id: investigator1Id,
          payment_type: 'PER_CASE',
          base_fee_or_salary: 1200,
          effective_from: '2026-01-01',
          effective_to: '2026-06-30',
        },
        {
          agency_id: agencyId,
          investigator_id: investigator1Id,
          payment_type: 'SALARY',
          base_fee_or_salary: 35000,
          effective_from: '2026-07-01',
          effective_to: null,
        },
      ];

      const termInMay = resolveEffectivePaymentTerms(termsHistory, '2026-05-15');
      expect(termInMay.payment_type).toBe('PER_CASE');
      expect(termInMay.base_fee_or_salary).toBe(1200);

      const termInAugust = resolveEffectivePaymentTerms(termsHistory, '2026-08-10');
      expect(termInAugust.payment_type).toBe('SALARY');
      expect(termInAugust.base_fee_or_salary).toBe(35000);
    });

    it('falls back to default per case when no terms exist', () => {
      const fallback = resolveEffectivePaymentTerms([], '2026-10-01');
      expect(fallback.payment_type).toBe('PER_CASE');
      expect(fallback.base_fee_or_salary).toBe(0);
    });
  });

  // =========================================================================
  // GATE 2: Case Fee Calculation & Withdrawn Case Exception (Rule A12)
  // =========================================================================
  describe('GATE 2: Case Fee & Outcome Financial Rules (Withdrawn Case = 0)', () => {
    it('calculates regular case fee with travel allowance and special allowance', () => {
      const result = calculateCaseInvestigatorFee({
        agreed_fee: 1500,
        travel_allowance: 350,
        fee_rule: {
          agency_id: agencyId,
          state: 'Maharashtra',
          city: 'Mumbai',
          base_fee: 1200,
          default_ta: 200,
          special_allowance: 100,
          is_active: true,
        },
        outcome: { code: 'GENUINE', investigator_payable_percent: 100 },
      });

      expect(result.base_fee).toBe(1500);
      expect(result.effective_case_fee).toBe(1500);
      expect(result.travel_allowance).toBe(350);
      expect(result.special_allowance).toBe(100);
      expect(result.total_case_payable).toBe(1950); // 1500 + 350 + 100
    });

    it('strictly applies Rule A12: Withdrawn case results in 0 investigator payable fee', () => {
      const result = calculateCaseInvestigatorFee({
        agreed_fee: 1800,
        travel_allowance: 0,
        fee_rule: {
          agency_id: agencyId,
          state: 'Delhi',
          city: 'New Delhi',
          base_fee: 1500,
          default_ta: 250,
          special_allowance: 0,
          is_active: true,
        },
        outcome: { code: 'WITHDRAWN', investigator_payable_percent: 0 },
      });

      expect(result.effective_case_fee).toBe(0);
      // TA is reimbursed even on withdrawn case if incurred
      expect(result.travel_allowance).toBe(250);
      expect(result.total_case_payable).toBe(250);
    });
  });

  // =========================================================================
  // GATE 3: TDS Engine & Section 206AA Penal Deductions
  // =========================================================================
  describe('GATE 3: TDS Engine (Section 194J, 194C, & 206AA Penal Rate)', () => {
    it('applies standard 10% TDS under Section 194J when valid PAN is present', () => {
      const res = calculateInvestigatorTds({
        gross_amount: 50000,
        pan_number: 'ABCDE1234F',
        section: '194J',
      });

      expect(res.section).toBe('194J');
      expect(res.rate).toBe(10.0);
      expect(res.tds_amount).toBe(5000.0);
      expect(res.is_penal_rate_206aa).toBe(false);
    });

    it('applies 1% TDS under Section 194C for individual contractor', () => {
      const res = calculateInvestigatorTds({
        gross_amount: 30000,
        pan_number: 'ABCDE1234F',
        section: '194C',
      });

      expect(res.section).toBe('194C');
      expect(res.rate).toBe(1.0);
      expect(res.tds_amount).toBe(300.0);
      expect(res.is_penal_rate_206aa).toBe(false);
    });

    it('enforces Section 206AA mandatory 20% penal TDS when PAN is missing or invalid', () => {
      const withoutPan = calculateInvestigatorTds({
        gross_amount: 40000,
        pan_number: null,
      });

      expect(withoutPan.rate).toBe(20.0);
      expect(withoutPan.tds_amount).toBe(8000.0);
      expect(withoutPan.is_penal_rate_206aa).toBe(true);

      const withInvalidPan = calculateInvestigatorTds({
        gross_amount: 40000,
        pan_number: 'INVALID_PAN',
      });
      expect(withInvalidPan.rate).toBe(20.0);
      expect(withInvalidPan.tds_amount).toBe(8000.0);
      expect(withInvalidPan.is_penal_rate_206aa).toBe(true);
    });

    it('validates PAN format accurately', () => {
      expect(isValidPan('ABCDE1234F')).toBe(true);
      expect(isValidPan('abcde1234f')).toBe(true);
      expect(isValidPan('12345ABCDE')).toBe(false);
      expect(isValidPan('')).toBe(false);
      expect(isValidPan(null)).toBe(false);
    });
  });

  // =========================================================================
  // GATE 4: Payout Compilation Invariant & Arithmetic Match
  // =========================================================================
  describe('GATE 4: Monthly Payout Compilation & Invariant Consistency', () => {
    it('compiles per-case investigator payout with expenses, advances, and TDS', () => {
      const input: PayoutCompilationInvestigator = {
        investigator_id: investigator1Id,
        investigator_name: 'Rajesh Kumar',
        payment_type: 'PER_CASE',
        pan_number: 'ABCDE1234F',
        base_salary_or_fee: 0,
        items: [
          { item_type: 'CASE_FEE', description: 'Case #101', amount: 1500, is_deduction: false },
          { item_type: 'CASE_FEE', description: 'Case #102', amount: 2000, is_deduction: false },
          { item_type: 'EXPENSE', description: 'Fuel Expense', amount: 450.50, is_deduction: false },
          { item_type: 'BONUS', description: 'Special Fraud Detection Incentive', amount: 1000, is_deduction: false },
          { item_type: 'ADVANCE_DEDUCTION', description: 'Mid-month Advance Recovery', amount: 1500, is_deduction: true },
        ],
      };

      const compiled = compileInvestigatorPayout(input, '2026-10');

      // Gross: 1500 + 2000 + 450.50 + 1000 = 4950.50
      expect(compiled.gross_payable).toBe(4950.50);
      // TDS: 10% of 4950.50 = 495.05
      expect(compiled.tds_amount).toBe(495.05);
      expect(compiled.total_advances_deducted).toBe(1500.0);

      // Net: 4950.50 - 495.05 - 1500 = 2955.45
      expect(compiled.net_payable).toBe(2955.45);

      // Invariant check: Gross - TDS - Advances === Net
      const reconstructed = new Decimal(compiled.gross_payable)
        .minus(compiled.tds_amount)
        .minus(compiled.total_advances_deducted)
        .toNumber();
      expect(reconstructed).toBe(compiled.net_payable);
    });

    it('compiles salaried investigator payout with fixed retainer', () => {
      const input: PayoutCompilationInvestigator = {
        investigator_id: investigator2Id,
        investigator_name: 'Amit Sharma',
        payment_type: 'SALARY',
        pan_number: 'BKZPS9876Q',
        base_salary_or_fee: 35000,
        items: [
          { item_type: 'EXPENSE', description: 'Intercity Travel', amount: 2400, is_deduction: false },
          { item_type: 'OTHER_DEDUCTION', description: 'Equipment Loss Recovery', amount: 500, is_deduction: true },
        ],
      };

      const compiled = compileInvestigatorPayout(input, '2026-10');

      // Gross: 35000 + 2400 = 37400
      expect(compiled.gross_payable).toBe(37400.0);
      // TDS: 10% = 3740
      expect(compiled.tds_amount).toBe(3740.0);
      // Net: 37400 - 3740 - 500 = 33160
      expect(compiled.net_payable).toBe(33160.0);
    });

    it('compiles complete monthly batch across multiple investigators', () => {
      const batch = compilePayoutBatch([
        {
          investigator_id: investigator1Id,
          investigator_name: 'Rajesh Kumar',
          payment_type: 'PER_CASE',
          pan_number: 'ABCDE1234F',
          base_salary_or_fee: 0,
          items: [{ item_type: 'CASE_FEE', description: 'Case #1', amount: 5000, is_deduction: false }],
        },
        {
          investigator_id: investigator2Id,
          investigator_name: 'Amit Sharma',
          payment_type: 'SALARY',
          pan_number: null, // Penal 20% TDS
          base_salary_or_fee: 20000,
          items: [],
        },
      ], '2026-10', 'PO-2026-10-001');

      expect(batch.total_investigators).toBe(2);
      expect(batch.total_gross).toBe(25000.0); // 5000 + 20000
      expect(batch.total_tds).toBe(4500.0); // 500 (10%) + 4000 (20%)
      expect(batch.total_net_disbursable).toBe(20500.0); // 4500 + 16000
    });
  });

  // =========================================================================
  // GATE 5: Excel Bulk Payment Export & DB Total Integrity
  // =========================================================================
  describe('GATE 5: Excel Bank Bulk Payment & Invariant Matching', () => {
    it('generates valid .xlsx buffer and strictly matches DB net disbursable total', async () => {
      const batch = compilePayoutBatch([
        {
          investigator_id: investigator1Id,
          investigator_name: 'Rajesh Kumar',
          payment_type: 'PER_CASE',
          pan_number: 'ABCDE1234F',
          bank_name: 'HDFC Bank',
          account_number: '50100234567890',
          ifsc_code: 'HDFC0000123',
          base_salary_or_fee: 0,
          items: [{ item_type: 'CASE_FEE', description: 'Case #1', amount: 15450.75, is_deduction: false }],
        },
        {
          investigator_id: investigator2Id,
          investigator_name: 'Amit Sharma',
          payment_type: 'SALARY',
          pan_number: 'BKZPS9876Q',
          bank_name: 'ICICI Bank',
          account_number: '000105001234',
          ifsc_code: 'ICIC0000001',
          base_salary_or_fee: 28500.25,
          items: [],
        },
      ], '2026-10', 'PO-2026-10-002');

      const excelResult = await generateBankBulkPaymentExcel(batch);

      expect(excelResult.row_count).toBe(2);
      expect(excelResult.matches_db_total).toBe(true);
      expect(excelResult.total_net_in_excel).toBe(batch.total_net_disbursable);
      expect(excelResult.sha256).toBeDefined();
      expect(excelResult.sha256.length).toBe(64);
      expect(excelResult.buffer.length).toBeGreaterThan(1000);
    });
  });

  // =========================================================================
  // GATE 6: Server-Side PDF Payout Statement with SHA-256
  // =========================================================================
  describe('GATE 6: Server-Side Payout Statement Document & Hash Integrity', () => {
    it('generates deterministic HTML/PDF statement with valid SHA-256 hash', () => {
      const compiled = compileInvestigatorPayout({
        investigator_id: investigator1Id,
        investigator_name: 'Rajesh Kumar',
        payment_type: 'PER_CASE',
        pan_number: 'ABCDE1234F',
        bank_name: 'State Bank of India',
        account_number: '30012345678',
        ifsc_code: 'SBIN0001234',
        base_salary_or_fee: 0,
        items: [
          { item_type: 'CASE_FEE', description: 'Case #2026-0912', amount: 2500, is_deduction: false },
          { item_type: 'EXPENSE', description: 'Highway Toll Receipts', amount: 350, is_deduction: false },
        ],
      }, '2026-10');

      const statement = generatePayoutStatementDocument({
        agency: {
          name: 'DNA Professional Investigation Agency',
          code: 'DNA-01',
          gstin: '27AABCD1234E1Z5',
          address: 'Fort, Mumbai, Maharashtra 400001',
        },
        payout: compiled,
        batchNumber: 'PO-2026-10-001',
        paymentReference: 'CMS192837465',
        paidAt: '2026-10-31T18:00:00Z',
      });

      expect(statement.mimeType).toBe('text/html');
      expect(statement.sha256).toHaveLength(64);
      expect(statement.htmlContent).toContain('DNA Professional Investigation Agency');
      expect(statement.htmlContent).toContain('Rajesh Kumar');
      expect(statement.htmlContent).toContain('CMS192837465');
      expect(statement.htmlContent).toContain('Section 194J');
    });
  });

  // =========================================================================
  // GATE 7: SLA Engine with Fake Clock & TAT Exceptions
  // =========================================================================
  describe('GATE 7: SLA Engine (Normal, Approaching, Urgent, Breached & Exceptions)', () => {
    const intakeTime = new Date('2026-10-01T10:00:00Z');
    const deadline48h = calculateSlaTarget({
      received_at: intakeTime,
      target_hours: 48,
    }); // 2026-10-03T10:00:00Z

    it('evaluates NORMAL state when elapsed is below warning threshold (<75%)', () => {
      // 12 hours elapsed out of 48 (25%)
      const clockAt12h = new Date('2026-10-01T22:00:00Z');
      const status = evaluateSlaStatus({
        received_at: intakeTime,
        target_deadline: deadline48h,
        current_time: clockAt12h,
      });

      expect(status.status).toBe('NORMAL');
      expect(status.elapsed_percent).toBe(25);
      expect(status.remaining_hours).toBe(36);
      expect(status.is_breached).toBe(false);
    });

    it('evaluates APPROACHING state when elapsed is between 75% and 90%', () => {
      // 38.4 hours elapsed out of 48 (80%)
      const clockAt38h = new Date('2026-10-03T00:24:00Z');
      const status = evaluateSlaStatus({
        received_at: intakeTime,
        target_deadline: deadline48h,
        current_time: clockAt38h,
      });

      expect(status.status).toBe('APPROACHING');
      expect(status.elapsed_percent).toBe(80);
      expect(status.is_breached).toBe(false);
    });

    it('evaluates URGENT state when remaining time is <= 4 hours or elapsed >= 90%', () => {
      // 45 hours elapsed (3 hours remaining)
      const clockAt45h = new Date('2026-10-03T07:00:00Z');
      const status = evaluateSlaStatus({
        received_at: intakeTime,
        target_deadline: deadline48h,
        current_time: clockAt45h,
      });

      expect(status.status).toBe('URGENT');
      expect(status.remaining_hours).toBe(3);
      expect(status.is_breached).toBe(false);
    });

    it('evaluates BREACHED state when current time exceeds deadline', () => {
      // 50 hours elapsed
      const clockAt50h = new Date('2026-10-03T12:00:00Z');
      const status = evaluateSlaStatus({
        received_at: intakeTime,
        target_deadline: deadline48h,
        current_time: clockAt50h,
      });

      expect(status.status).toBe('BREACHED');
      expect(status.is_breached).toBe(true);
      expect(status.remaining_hours).toBeLessThan(0);
    });

    it('rescues breached case when approved SLA exception extension is applied', () => {
      // Approved 24 hour extension
      const extendedDeadline = calculateSlaTarget({
        received_at: intakeTime,
        target_hours: 48,
        approved_extension_hours: 24, // Total 72 hours
      });

      // At 50 hours (which was breached before), case is now safely active!
      const clockAt50h = new Date('2026-10-03T12:00:00Z');
      const status = evaluateSlaStatus({
        received_at: intakeTime,
        target_deadline: extendedDeadline,
        current_time: clockAt50h,
      });

      expect(status.is_breached).toBe(false);
      expect(status.status).not.toBe('BREACHED');
      expect(status.remaining_hours).toBe(22); // 72 - 50 = 22 hours left
    });

    it('runs background ticker across batch of active cases', () => {
      const summary = processSlaTicker([
        {
          case_id: 'c1',
          case_number: 'CASE-001',
          received_at: '2026-10-01T10:00:00Z',
          target_deadline: '2026-10-03T10:00:00Z',
        },
        {
          case_id: 'c2',
          case_number: 'CASE-002',
          received_at: '2026-10-01T10:00:00Z',
          target_deadline: '2026-10-02T10:00:00Z',
        },
      ], '2026-10-02T12:00:00Z'); // 26 hours in

      expect(summary.total_cases).toBe(2);
      expect(summary.breached_count).toBe(1); // c2 deadline was 24h ago
      expect(summary.normal_count + summary.approaching_count).toBe(1); // c1 has 48h deadline
    });
  });

  // =========================================================================
  // GATE 8: Scorecard Engine & Configurable Weighted Tiers
  // =========================================================================
  describe('GATE 8: Scorecard Engine & Tier Resolution', () => {
    it('evaluates high performing investigator into ELITE tier (>= 85)', () => {
      const stats = {
        total_assigned: 20,
        total_completed: 20,
        completed_within_sla: 19, // 95% SLA compliance
        fraud_detected_count: 5,  // 25% fraud detection rate (score = 100)
        suspicious_detected_count: 1,
        first_pass_approved_count: 19, // 95% first pass
        total_rework_cycles: 1, // 0.05 rework per case
        target_monthly_capacity: 15, // 133% volume (capped 100)
      };

      const scorecard = calculateInvestigatorScorecard(stats, DEFAULT_SCORECARD_WEIGHTS);

      expect(scorecard.tat_score).toBe(95);
      expect(scorecard.fraud_score).toBe(100);
      expect(scorecard.tier).toBe('ELITE');
      expect(scorecard.composite_score).toBeGreaterThanOrEqual(85);
    });

    it('evaluates low performing investigator into NEEDS_IMPROVEMENT tier (< 50)', () => {
      const stats = {
        total_assigned: 10,
        total_completed: 6,
        completed_within_sla: 2, // 33% SLA compliance
        fraud_detected_count: 0,
        suspicious_detected_count: 0,
        first_pass_approved_count: 2,
        total_rework_cycles: 8, // 1.33 reworks per case
        target_monthly_capacity: 15,
      };

      const scorecard = calculateInvestigatorScorecard(stats, DEFAULT_SCORECARD_WEIGHTS);

      expect(scorecard.tier).toBe('NEEDS_IMPROVEMENT');
      expect(scorecard.composite_score).toBeLessThan(50);
    });

    it('resolves correct tiers across score boundaries', () => {
      expect(resolveScorecardTier(92)).toBe('ELITE');
      expect(resolveScorecardTier(85)).toBe('ELITE');
      expect(resolveScorecardTier(75)).toBe('PROFICIENT');
      expect(resolveScorecardTier(70)).toBe('PROFICIENT');
      expect(resolveScorecardTier(60)).toBe('AVERAGE');
      expect(resolveScorecardTier(50)).toBe('AVERAGE');
      expect(resolveScorecardTier(45)).toBe('NEEDS_IMPROVEMENT');
    });
  });

  // =========================================================================
  // GATE 9: Hospital Fraud Heatmap & Dispatch-Time Warnings
  // =========================================================================
  describe('GATE 9: Hospital Fraud Heatmap & Dispatch Warning Rules', () => {
    it('categorizes hospital risk levels accurately from historical claim ratios', () => {
      const critical = calculateHospitalRiskProfile({
        hospital_name: 'Apex Super Specialty Care',
        total_cases: 20,
        fraud_cases: 9,
        suspicious_cases: 1,
        genuine_cases: 10,
      }); // 50% adverse
      expect(critical.risk_level).toBe('CRITICAL');
      expect(critical.fraud_rate_percent).toBe(50.0);

      const high = calculateHospitalRiskProfile({
        hospital_name: 'Metro City Hospital',
        total_cases: 40,
        fraud_cases: 11,
        suspicious_cases: 1,
        genuine_cases: 28,
      }); // 30% adverse
      expect(high.risk_level).toBe('HIGH');
      expect(high.fraud_rate_percent).toBe(30.0);

      const low = calculateHospitalRiskProfile({
        hospital_name: 'Lilavati Hospital & Research Centre',
        total_cases: 50,
        fraud_cases: 1,
        suspicious_cases: 1,
        genuine_cases: 48,
      }); // 4% adverse
      expect(low.risk_level).toBe('LOW');
    });

    it('triggers critical dispatch warning and requires manager override for blacklisted hospital', () => {
      const blacklistedProfile = calculateHospitalRiskProfile({
        hospital_name: 'Fake Medicare Nursing Home',
        total_cases: 10,
        fraud_cases: 8,
        suspicious_cases: 0,
        genuine_cases: 2,
        is_blacklisted: true,
      });

      const warning = generateDispatchWarning(blacklistedProfile);

      expect(warning.should_warn).toBe(true);
      expect(warning.severity).toBe('CRITICAL');
      expect(warning.is_blacklisted).toBe(true);
      expect(warning.requires_manager_override).toBe(true);
      expect(warning.warning_title).toContain('BLACKLISTED');
      expect(warning.recommended_actions.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // GATE 10: Validation Schemas & Negative Authorization Tests
  // =========================================================================
  describe('GATE 10: Schema Validation & Negative Input Tests', () => {
    it('rejects expense submission without receipt when receipt is required', () => {
      const invalidClaim = {
        agency_id: agencyId,
        investigator_id: investigator1Id,
        expense_type: 'FUEL',
        amount: 850,
        requires_receipt: true,
        receipt_r2_key: null, // Missing!
      };

      const parseResult = ExpenseClaimSchema.safeParse(invalidClaim);
      expect(parseResult.success).toBe(false);
    });

    it('accepts expense submission without receipt for advance/bonus type', () => {
      const validAdvance = {
        agency_id: agencyId,
        investigator_id: investigator1Id,
        expense_type: 'ADVANCE',
        amount: 5000,
        requires_receipt: false,
        receipt_r2_key: null,
      };

      const parseResult = ExpenseClaimSchema.safeParse(validAdvance);
      expect(parseResult.success).toBe(true);
    });

    it('rejects expense rejection without explanatory reason', () => {
      const invalidRejection = {
        expense_id: '44444444-4444-4444-4444-444444444444',
        status: 'REJECTED',
        rejection_reason: '', // Empty!
      };

      const parseResult = ExpenseApprovalSchema.safeParse(invalidRejection);
      expect(parseResult.success).toBe(false);
    });
  });
});
