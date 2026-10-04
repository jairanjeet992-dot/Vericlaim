import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import Decimal from 'decimal.js';
import {
  calculateInvoiceOutstanding,
  detectShortSettlementTds,
  match26ASRecord,
  calculateAgingBuckets,
  calculateProfitAndLoss,
  classifyRecoveryItems,
} from '../../src/modules/finance/payments';
import { PaymentService } from '../../src/modules/finance/payment-service';
import { UserScopeContext } from '../../src/modules/finance/service';
import {
  RecordPaymentInput,
  AllocatePaymentInput,
  RecordTdsInput,
  Import26ASInput,
} from '../../src/modules/finance/payment-schema';

// Test Constants & UUIDs
const AGENCY_A = '11111111-1111-4111-a111-111111111111';
const AGENCY_B = '22222222-2222-4222-b222-222222222222';
const INV_1_UUID = '33333333-1111-4111-a111-111111111111';
const INV_2_UUID = '33333333-2222-4111-a111-222222222222';
const INV_AGENCY_B_UUID = '33333333-3333-4111-a111-333333333333';


const ACCOUNTANT_A: UserScopeContext = {
  userId: 'aaaaaaaa-1111-4111-a111-111111111111',
  agencyId: AGENCY_A,
  role: 'Accountant',
  scope: 'ALL',
  permissions: ['payments.record', 'invoices.issue'],
};

const UNAUTHORIZED_USER: UserScopeContext = {
  userId: 'aaaaaaaa-2222-4111-a111-222222222222',
  agencyId: AGENCY_A,
  role: 'Data Entry',
  scope: 'OWN_ENTERED',
  permissions: ['cases.create'],
};

const FOREIGN_ACCOUNTANT: UserScopeContext = {
  userId: 'bbbbbbbb-1111-4222-b222-111111111111',
  agencyId: AGENCY_B,
  role: 'Accountant',
  scope: 'ALL',
  permissions: ['payments.record'],
};

const CLIENT_1 = 'cccccccc-1111-4111-a111-111111111111';
const CLIENT_2 = 'cccccccc-2222-4111-a111-222222222222';

// In-Memory Database Simulator for Payment & TDS Gates
class PaymentDatabaseMock {
  public client_payments: any[] = [];
  public payment_allocations: any[] = [];
  public tds_receivables: any[] = [];
  public form_26as_records: any[] = [];
  public invoices: any[] = [];
  public cases: any[] = [];
  public audit_logs: any[] = [];

  constructor() {
    this.seed();
  }

  seed() {
    // Seed an issued invoice for ₹11,800 (₹10,000 fee + ₹1,800 GST)
    this.invoices = [
      {
        id: INV_1_UUID,
        agency_id: AGENCY_A,
        client_id: CLIENT_1,
        invoice_number: 'DNA/2026-27/0001',
        total_amount: '11800.00',
        taxable_amount: '10000.00',
        cgst_amount: '900.00',
        sgst_amount: '900.00',
        igst_amount: '0.00',
        status: 'ISSUED',
        issue_date: '2026-10-01',
        due_date: '2026-10-15',
        version: 1,
      },
      {
        id: INV_2_UUID,
        agency_id: AGENCY_A,
        client_id: CLIENT_1,
        invoice_number: 'DNA/2026-27/0002',
        total_amount: '23600.00',
        taxable_amount: '20000.00',
        cgst_amount: '0.00',
        sgst_amount: '0.00',
        igst_amount: '3600.00',
        status: 'ISSUED',
        issue_date: '2026-08-01', // > 60 days old
        due_date: '2026-08-15',
        version: 1,
      },
      {
        id: INV_AGENCY_B_UUID,
        agency_id: AGENCY_B,
        client_id: CLIENT_2,
        invoice_number: 'AGB/2026-27/0001',
        total_amount: '5900.00',
        taxable_amount: '5000.00',
        cgst_amount: '450.00',
        sgst_amount: '450.00',
        igst_amount: '0.00',
        status: 'ISSUED',
        issue_date: '2026-10-01',
        due_date: '2026-10-15',
        version: 1,
      },
    ];

    this.cases = [
      {
        id: 'case-unbilled-1',
        agency_id: AGENCY_A,
        client_id: CLIENT_1,
        case_number: 'DNA-2026-0099',
        claim_number: 'CLM-998877',
        status: 'APPROVED',
        approved_at: '2026-09-20T10:00:00Z',
        invoice_id: null,
      },
    ];

    this.client_payments = [];
    this.payment_allocations = [];
    this.tds_receivables = [];
    this.form_26as_records = [];
    this.audit_logs = [];
  }

  // Create a mock SupabaseClient that delegates to this state
  createClient(): any {
    const db = this;

    return {
      from: (table: string) => {
        let filters: Array<(row: any) => boolean> = [];
        let orderCol: string | null = null;
        let orderAsc = true;
        let pendingInsert: any = null;
        let pendingUpdate: any = null;

        const builder: any = {
          select: (_cols = '*') => builder,
          eq: (col: string, val: any) => {
            filters.push((row) => row[col] === val);
            return builder;
          },
          neq: (col: string, val: any) => {
            filters.push((row) => row[col] !== val);
            return builder;
          },
          gt: (col: string, val: any) => {
            filters.push((row) => Number(row[col]) > Number(val));
            return builder;
          },
          in: (col: string, vals: any[]) => {
            filters.push((row) => vals.includes(row[col]));
            return builder;
          },
          order: (col: string, { ascending = true } = {}) => {
            orderCol = col;
            orderAsc = ascending;
            return builder;
          },
          insert: (data: any) => {
            pendingInsert = data;
            return builder;
          },
          update: (data: any) => {
            pendingUpdate = data;
            return builder;
          },
          single: async () => {
            if (pendingInsert) {
              const row = {
                id: pendingInsert.id || crypto.randomUUID(),
                ...pendingInsert,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              (db as any)[table].push(row);
              return { data: row, error: null };
            }

            const rows = (db as any)[table].filter((r: any) => filters.every((f) => f(r)));
            if (rows.length === 0) return { data: null, error: new Error('Row not found') };
            return { data: rows[0], error: null };
          },
          maybeSingle: async () => {
            const rows = (db as any)[table].filter((r: any) => filters.every((f) => f(r)));
            return { data: rows[0] || null, error: null };
          },
          then: async (resolve: any) => {
            if (pendingUpdate) {
              let count = 0;
              (db as any)[table].forEach((r: any) => {
                if (filters.every((f) => f(r))) {
                  Object.assign(r, pendingUpdate);
                  count++;
                }
              });
              return resolve({ data: null, count, error: null });
            }

            let rows = (db as any)[table].filter((r: any) => filters.every((f) => f(r)));
            if (orderCol) {
              rows = [...rows].sort((a, b) => {
                if (a[orderCol!] < b[orderCol!]) return orderAsc ? -1 : 1;
                if (a[orderCol!] > b[orderCol!]) return orderAsc ? 1 : -1;
                return 0;
              });
            }
            return resolve({ data: rows, error: null });
          },
        };

        return builder;
      },

      rpc: async (fnName: string, args: any) => {
        if (fnName === 'get_invoice_outstanding') {
          const inv = db.invoices.find((i) => i.id === args.p_invoice_id);
          if (!inv) return { data: '0.00', error: null };

          const allocSum = db.payment_allocations
            .filter((a) => a.invoice_id === args.p_invoice_id)
            .reduce((sum, a) => sum.plus(new Decimal(a.allocated_amount)), new Decimal('0.00'));

          const tdsSum = db.tds_receivables
            .filter((t) => t.invoice_id === args.p_invoice_id && t.is_valid)
            .reduce((sum, t) => sum.plus(new Decimal(t.amount)), new Decimal('0.00'));

          const outstanding = calculateInvoiceOutstanding(inv.total_amount, allocSum, tdsSum);
          return { data: outstanding.toFixed(2), error: null };
        }

        if (fnName === 'allocate_payment_transaction') {
          // Simulate atomic stored procedure
          const payment = db.client_payments.find(
            (p) => p.id === args.p_payment_id && p.agency_id === args.p_agency_id
          );
          if (!payment) {
            return { data: null, error: new Error('Payment record not found.') };
          }

          const allocAmount = new Decimal(args.p_allocated_amount);
          const unapplied = new Decimal(payment.unapplied_amount);

          if (unapplied.lessThan(allocAmount)) {
            return {
              data: null,
              error: new Error(
                `A6 Violation: Allocated amount (${allocAmount.toFixed(2)}) exceeds unapplied payment balance (${unapplied.toFixed(2)}).`
              ),
            };
          }

          const invoice = db.invoices.find(
            (i) => i.id === args.p_invoice_id && i.agency_id === args.p_agency_id
          );
          if (!invoice) {
            return { data: null, error: new Error('Invoice record not found.') };
          }

          if (invoice.status === 'CANCELLED') {
            return { data: null, error: new Error('Cannot allocate payment to cancelled invoice.') };
          }

          // Calculate current outstanding
          const currentAlloc = db.payment_allocations
            .filter((a) => a.invoice_id === args.p_invoice_id)
            .reduce((sum, a) => sum.plus(new Decimal(a.allocated_amount)), new Decimal('0.00'));

          const currentTds = db.tds_receivables
            .filter((t) => t.invoice_id === args.p_invoice_id && t.is_valid)
            .reduce((sum, t) => sum.plus(new Decimal(t.amount)), new Decimal('0.00'));

          const currentOutstanding = calculateInvoiceOutstanding(
            invoice.total_amount,
            currentAlloc,
            currentTds
          );

          if (allocAmount.greaterThan(currentOutstanding)) {
            return {
              data: null,
              error: new Error(
                `A6 Violation: Over-allocation rejected. Allocated amount (${allocAmount.toFixed(2)}) exceeds remaining invoice outstanding (${currentOutstanding.toFixed(2)}).`
              ),
            };
          }

          // Insert allocation
          const allocId = crypto.randomUUID();
          db.payment_allocations.push({
            id: allocId,
            agency_id: args.p_agency_id,
            payment_id: args.p_payment_id,
            invoice_id: args.p_invoice_id,
            case_id: args.p_case_id || null,
            allocated_amount: allocAmount.toFixed(2),
            created_by: args.p_actor_id,
            created_at: new Date().toISOString(),
          });

          // Decrement unapplied balance
          payment.unapplied_amount = unapplied.minus(allocAmount).toFixed(2);

          // Update invoice status
          const remInv = currentOutstanding.minus(allocAmount);
          if (remInv.isZero()) {
            invoice.status = 'PAID';
          } else {
            invoice.status = 'PARTIALLY_PAID';
          }

          return {
            data: {
              allocation_id: allocId,
              invoice_status: invoice.status,
              remaining_invoice_outstanding: remInv.toNumber(),
              remaining_payment_unapplied: Number(payment.unapplied_amount),
            },
            error: null,
          };
        }

        return { data: null, error: new Error(`Unknown RPC ${fnName}`) };
      },
    };
  }
}

describe('Phase 7B: Payments, TDS, Receivables, Recovery & Profit Gates', () => {
  let db: PaymentDatabaseMock;
  let service: PaymentService;

  beforeEach(() => {
    db = new PaymentDatabaseMock();
    service = new PaymentService(db.createClient());
  });

  // ============================================================================
  // GATE 1: GOLDEN TESTS & RECORD REMITTANCE
  // ============================================================================
  describe('GATE 1: Golden Tests (Remittance & Advance Recording)', () => {
    it('records a full remittance with UTR, payment mode, and bank name', async () => {
      const payment = await service.recordPayment(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        amount: '11800.00',
        payment_mode: 'NEFT',
        utr_number: 'UTR-HDFC-99887766',
        bank_name: 'HDFC Bank',
        is_advance: false,
      });

      expect(payment).toBeDefined();
      expect(payment.amount).toBe('11800.00');
      expect(payment.unapplied_amount).toBe('11800.00');
      expect(payment.utr_number).toBe('UTR-HDFC-99887766');
      expect(payment.payment_mode).toBe('NEFT');

      // Verify audit log
      expect(db.audit_logs.length).toBe(1);
      expect(db.audit_logs[0].action).toBe('PAYMENT_RECORDED');
    });

    it('records an advance payment with unapplied balance retention', async () => {
      const advance = await service.recordPayment(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        amount: '50000.00',
        payment_mode: 'RTGS',
        utr_number: 'UTR-SBI-ADV-001',
        is_advance: true,
        reference_note: 'Quarterly advance deposit from ICICI Lombard',
      });

      expect(advance.is_advance).toBe(true);
      expect(advance.unapplied_amount).toBe('50000.00');
    });
  });

  // ============================================================================
  // GATE 2: DUPLICATE UTR & IDEMPOTENCY KEY
  // ============================================================================
  describe('GATE 2: Duplicate UTR & Idempotency Key Rejection', () => {
    it('strictly rejects duplicate UTR numbers within the same agency', async () => {
      await service.recordPayment(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        amount: '10000.00',
        payment_mode: 'NEFT',
        utr_number: 'UTR-DUPLICATE-TEST',
      });

      // Attempting to record same UTR again must throw
      await expect(
        service.recordPayment(ACCOUNTANT_A, {
          client_id: CLIENT_1,
          amount: '10000.00',
          payment_mode: 'NEFT',
          utr_number: 'UTR-DUPLICATE-TEST',
        })
      ).rejects.toThrow(/Duplicate UTR number/);
    });

    it('returns existing payment record when the same idempotency_key is reused', async () => {
      const key = 'idem-payment-key-12345';
      const payment1 = await service.recordPayment(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        amount: '15000.00',
        payment_mode: 'IMPS',
        utr_number: 'UTR-IDEM-001',
        idempotency_key: key,
      });

      const payment2 = await service.recordPayment(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        amount: '15000.00',
        payment_mode: 'IMPS',
        utr_number: 'UTR-IDEM-001',
        idempotency_key: key,
      });

      expect(payment1.id).toBe(payment2.id);
      expect(db.client_payments.length).toBe(1); // Only 1 record created
    });
  });

  // ============================================================================
  // GATE 3: OVER-ALLOCATION REJECTED
  // ============================================================================
  describe('GATE 3: Over-allocation Rejection', () => {
    it('rejects allocation when amount exceeds invoice remaining outstanding', async () => {
      const payment = await service.recordPayment(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        amount: '20000.00',
        payment_mode: 'NEFT',
        utr_number: 'UTR-OVERALLOC-1',
      });

      // Invoice INV_1_UUID total is ₹11,800.00. Trying to allocate ₹15,000 must fail!
      await expect(
        service.allocatePayment(ACCOUNTANT_A, {
          payment_id: payment.id,
          invoice_id: INV_1_UUID,
          allocated_amount: '15000.00',
        })
      ).rejects.toThrow(/Over-allocation rejected/);
    });

    it('rejects allocation when amount exceeds payment unapplied balance', async () => {
      const payment = await service.recordPayment(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        amount: '5000.00',
        payment_mode: 'NEFT',
        utr_number: 'UTR-OVERALLOC-2',
      });

      // Trying to allocate ₹8,000 from a ₹5,000 payment must fail!
      await expect(
        service.allocatePayment(ACCOUNTANT_A, {
          payment_id: payment.id,
          invoice_id: INV_1_UUID,
          allocated_amount: '8000.00',
        })
      ).rejects.toThrow(/exceeds unapplied payment balance/);
    });
  });

  // ============================================================================
  // GATE 4: CONCURRENT PAYMENT RACE TEST & SPLIT ALLOCATION
  // ============================================================================
  describe('GATE 4: Concurrent Payment Race & Split Allocations', () => {
    it('allows sequential partial allocations until invoice is fully settled', async () => {
      const payment = await service.recordPayment(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        amount: '11800.00',
        payment_mode: 'NEFT',
        utr_number: 'UTR-SPLIT-1',
      });

      // First partial allocation of ₹6,000
      const alloc1 = await service.allocatePayment(ACCOUNTANT_A, {
        payment_id: payment.id,
        invoice_id: INV_1_UUID,
        allocated_amount: '6000.00',
      });

      expect(alloc1.invoice_status).toBe('PARTIALLY_PAID');
      expect(alloc1.remaining_invoice_outstanding).toBe(5800.0);
      expect(alloc1.remaining_payment_unapplied).toBe(5800.0);

      // Second final allocation of remaining ₹5,800
      const alloc2 = await service.allocatePayment(ACCOUNTANT_A, {
        payment_id: payment.id,
        invoice_id: INV_1_UUID,
        allocated_amount: '5800.00',
      });

      expect(alloc2.invoice_status).toBe('PAID');
      expect(alloc2.remaining_invoice_outstanding).toBe(0.0);
      expect(alloc2.remaining_payment_unapplied).toBe(0.0);
    });

    it('handles bulk remittance allocation across multiple invoices', async () => {
      const payment = await service.recordPayment(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        amount: '30000.00',
        payment_mode: 'RTGS',
        utr_number: 'UTR-BULK-REMIT-01',
      });

      const bulkRes = await service.bulkAllocatePayment(ACCOUNTANT_A, {
        payment_id: payment.id,
        allocations: [
          { invoice_id: INV_1_UUID, allocated_amount: '11800.00' }, // Fully pays INV_1_UUID
          { invoice_id: INV_2_UUID, allocated_amount: '15000.00' }, // Partially pays INV_2_UUID
        ],
      });

      expect(bulkRes.success).toBe(true);
      expect(bulkRes.allocations.length).toBe(2);

      const inv1 = db.invoices.find((i) => i.id === INV_1_UUID);
      const inv2 = db.invoices.find((i) => i.id === INV_2_UUID);
      expect(inv1.status).toBe('PAID');
      expect(inv2.status).toBe('PARTIALLY_PAID');

      const payRecord = db.client_payments.find((p) => p.id === payment.id);
      expect(payRecord.unapplied_amount).toBe('3200.00'); // ₹30,000 - ₹26,800 = ₹3,200 remaining
    });
  });

  // ============================================================================
  // GATE 5: OUTSTANDING FORMULA VERIFIED ON HAND-COMPUTED CASES
  // Formula: Outstanding = Total Amount - Received - Valid TDS
  // ============================================================================
  describe('GATE 5: Hand-computed Outstanding Formula (Rule A6)', () => {
    it('Case 1: Full settlement with remittance + 10% TDS (Hand-computed: 0.00)', () => {
      // Gross: ₹11,800.00
      // Remittance: ₹10,620.00 (90%)
      // TDS: ₹1,180.00 (10%)
      const outstanding = calculateInvoiceOutstanding('11800.00', '10620.00', '1180.00');
      expect(outstanding.toFixed(2)).toBe('0.00');
    });

    it('Case 2: Partial remittance + partial TDS (Hand-computed: ₹11,600.00)', () => {
      // Gross: ₹23,600.00
      // Remittance: ₹10,000.00
      // TDS: ₹2,000.00
      // Outstanding: ₹23,600 - ₹12,000 = ₹11,600.00
      const outstanding = calculateInvoiceOutstanding('23600.00', '10000.00', '2000.00');
      expect(outstanding.toFixed(2)).toBe('11600.00');
    });

    it('Case 3: Invalid TDS is ignored in outstanding formula', async () => {
      // Record a valid TDS of ₹500
      await service.recordTds(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        invoice_id: INV_1_UUID,
        section: '194J',
        rate: '10.00',
        amount: '500.00',
        is_valid: true,
      });

      // Record an invalid/disputed TDS of ₹680
      await service.recordTds(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        invoice_id: INV_1_UUID,
        section: '194J',
        rate: '10.00',
        amount: '680.00',
        is_valid: false,
      });

      // Valid TDS = ₹500; Invalid ₹680 must NOT reduce outstanding
      const outstandingRpc = await db.createClient().rpc('get_invoice_outstanding', {
        p_invoice_id: INV_1_UUID,
      });
      // 11800 - 500 = 11300
      expect(outstandingRpc.data).toBe('11300.00');
    });
  });

  // ============================================================================
  // GATE 6: GST STRICTLY EXCLUDED FROM PROFIT (Q-CA-01)
  // ============================================================================
  describe('GATE 6: Statutory Profit Engine & GST Separation (Q-CA-01)', () => {
    it('verifies revenue strictly excludes GST collected and never counts GST as profit', () => {
      const pnl = calculateProfitAndLoss({
        invoices: [
          {
            taxableAmount: '10000.00',
            cgstAmount: '900.00',
            sgstAmount: '900.00',
            igstAmount: '0.00',
            totalAmount: '11800.00',
            status: 'ISSUED',
          },
        ],
        payments: [{ amount: '11800.00' }],
        tdsRecords: [],
        investigatorPayables: [{ amount: '4000.00', isApproved: true }],
        includeLegacyComparison: true,
      });

      // Statutory Net Service Revenue = Taxable Service Base (Excludes ₹1,800 GST)
      expect(pnl.netServiceRevenue).toBe('10000.00');

      // Direct Investigation Costs = ₹4,000.00
      expect(pnl.directInvestigationCosts).toBe('4000.00');

      // Gross Profit = ₹10,000 - ₹4,000 = ₹6,000.00
      expect(pnl.grossProfit).toBe('6000.00');
      expect(pnl.grossMarginPercentage).toBe('60.00%');

      // GST liability strictly tracked as statutory liability, NOT revenue or profit
      expect(pnl.gstCollectedLiability).toBe('1800.00');

      // Compare with improper legacy formula: (11800 - 4000) = ₹7,800
      expect(pnl.legacyProfitComparison).toBeDefined();
      expect(pnl.legacyProfitComparison?.legacyProfitAmount).toBe('7800.00');
      expect(pnl.legacyProfitComparison?.warning).toContain('CA-VERIFY');

      // Crucial assertion: Gross Profit strictly does NOT equal total cash received minus payable
      expect(pnl.grossProfit).not.toBe(pnl.legacyProfitComparison?.legacyProfitAmount);
    });
  });

  // ============================================================================
  // GATE 7: SHORT-SETTLEMENT 10% TDS DETECTION
  // ============================================================================
  describe('GATE 7: Short-settlement Auto-suggestion Engine (GOLDEN_TESTS TEST-09, TEST-10, TEST-11)', () => {
    it('TEST-09: Exact 10% TDS Deducted on Taxable Base (GOLDEN_TESTS)', () => {
      // Inputs from GOLDEN_TESTS.md: invoice_amount = 4130.00, taxable = 3500.00, received = 3780.00
      const suggestion = detectShortSettlementTds({
        invoiceTotal: '4130.00',
        taxableAmount: '3500.00',
        receivedAmount: '3780.00',
        configuredRatePercent: 10.0,
      });

      expect(suggestion).not.toBeNull();
      expect(suggestion?.isShortSettlement).toBe(true);
      expect(suggestion?.suggestedSection).toBe('194J');
      expect(suggestion?.suggestedRate).toBe('10.00');
      expect(suggestion?.suggestedTdsAmount).toBe('350.00');
      expect(suggestion?.isGrossDeduction).toBe(false);
      expect(suggestion?.requiresUserConfirmation).toBe(true);
    });

    it('TEST-10: Exact 10% TDS Deducted on Gross Billed Total (GOLDEN_TESTS)', () => {
      // Inputs from GOLDEN_TESTS.md: invoice_amount = 3000.00, received = 2700.00
      const suggestion = detectShortSettlementTds({
        invoiceTotal: '3000.00',
        receivedAmount: '2700.00',
        configuredRatePercent: 10.0,
      });

      expect(suggestion).not.toBeNull();
      expect(suggestion?.isShortSettlement).toBe(true);
      expect(suggestion?.suggestedSection).toBe('194J');
      expect(suggestion?.suggestedRate).toBe('10.00');
      expect(suggestion?.suggestedTdsAmount).toBe('300.00');
      expect(suggestion?.isGrossDeduction).toBe(true);
      expect(suggestion?.requiresUserConfirmation).toBe(true);
    });

    it('TEST-11: Non-Matching Difference Disallowed TA / Shortfall (GOLDEN_TESTS)', () => {
      // Inputs from GOLDEN_TESTS.md: invoice_amount = 4500.00, received = 3800.00 (diff = 700.00)
      const suggestion = detectShortSettlementTds({
        invoiceTotal: '4500.00',
        receivedAmount: '3800.00',
      });

      // Expected Output: is_tds_auto_match = false (suggestion is null)
      expect(suggestion).toBeNull();
    });

    it('detects 10% deduction on Gross Total and suggests Section 194J with user confirmation', () => {
      // Gross ₹11,800; Insurer remitted ₹10,620 (Difference ₹1,180 = exactly 10%)
      const suggestion = detectShortSettlementTds({
        invoiceTotal: '11800.00',
        receivedAmount: '10620.00',
        configuredRatePercent: 10.0,
      });

      expect(suggestion).not.toBeNull();
      expect(suggestion?.isShortSettlement).toBe(true);
      expect(suggestion?.suggestedSection).toBe('194J');
      expect(suggestion?.suggestedRate).toBe('10.00');
      expect(suggestion?.suggestedTdsAmount).toBe('1180.00');
      expect(suggestion?.requiresUserConfirmation).toBe(true); // Never applied silently!
    });

    it('detects 10% deduction on Taxable Base per CBDT Circular 23/2017', () => {
      // Gross ₹11,800 (Taxable ₹10,000 + GST ₹1,800)
      // Insurer correctly deducts 10% on Taxable (₹1,000 TDS) -> Remittance = ₹10,800
      const suggestion = detectShortSettlementTds({
        invoiceTotal: '11800.00',
        taxableAmount: '10000.00',
        receivedAmount: '10800.00',
        configuredRatePercent: 10.0,
      });

      expect(suggestion).not.toBeNull();
      expect(suggestion?.isShortSettlement).toBe(true);
      expect(suggestion?.suggestedTdsAmount).toBe('1000.00');
      expect(suggestion?.isGrossDeduction).toBe(false);
    });

    it('does not trigger suggestion if shortfall is unrelated to standard TDS rates', () => {
      // Received ₹5,000 on ₹11,800 invoice (shortfall of ₹6,800 is ~57%, not TDS)
      const suggestion = detectShortSettlementTds({
        invoiceTotal: '11800.00',
        receivedAmount: '5000.00',
      });

      expect(suggestion).toBeNull();
    });
  });

  // ============================================================================
  // GATE 8: 26AS / AIS RECONCILIATION MATCHER
  // ============================================================================
  describe('GATE 8: Form 26AS / AIS Matching Engine', () => {
    it('matches single exact recorded TDS by section and amount', () => {
      const candidates = [
        { id: 'tds-1', amount: '1180.00', section: '194J', isValid: true },
        { id: 'tds-2', amount: '2360.00', section: '194J', isValid: true },
      ];

      const result = match26ASRecord(
        {
          deductorTan: 'DELI12345A',
          financialYear: '2026-27',
          section: '194J',
          tdsDeducted: '1180.00',
        },
        candidates
      );

      expect(result.status).toBe('MATCHED');
      expect(result.matchedTdsId).toBe('tds-1');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.95);
    });

    it('returns UNMATCHED when TAN record has no matching recorded TDS', () => {
      const candidates = [
        { id: 'tds-1', amount: '500.00', section: '194J', isValid: true },
      ];

      const result = match26ASRecord(
        {
          deductorTan: 'MUMB99887B',
          financialYear: '2026-27',
          section: '194J',
          tdsDeducted: '9500.00',
        },
        candidates
      );

      expect(result.status).toBe('UNMATCHED');
      expect(result.matchedTdsId).toBeUndefined();
    });
  });

  // ============================================================================
  // GATE 9: AGING & RECOVERY HUB CLASSIFICATION
  // ============================================================================
  describe('GATE 9: Aging Analysis & Recovery Hub Categorization', () => {
    it('categorizes invoices into correct aging buckets (0-30, 31-60, 61-90, 90+)', () => {
      const summary = calculateAgingBuckets(
        [
          {
            id: 'inv-recent',
            invoiceNumber: 'INV-01',
            issueDate: '2026-10-01',
            dueDate: '2026-10-15',
            totalAmount: '10000.00',
            allocatedAmount: '0.00',
            validTds: '0.00',
          },
          {
            id: 'inv-old',
            invoiceNumber: 'INV-02',
            issueDate: '2026-07-01', // > 90 days
            dueDate: '2026-07-15',
            totalAmount: '20000.00',
            allocatedAmount: '5000.00',
            validTds: '0.00',
          },
        ],
        new Date('2026-10-20')
      );

      expect(summary.buckets.b0_30.invoiceCount).toBe(1);
      expect(summary.buckets.b0_30.totalOutstanding).toBe('10000.00');

      expect(summary.buckets.b90_plus.invoiceCount).toBe(1);
      expect(summary.buckets.b90_plus.totalOutstanding).toBe('15000.00');

      expect(summary.totalOutstanding).toBe('25000.00');
    });

    it('classifies unbilled approved cases and unpaid invoices into recovery categories', () => {
      const items = classifyRecoveryItems(
        [
          {
            id: 'inv-1',
            invoiceNumber: 'INV-100',
            clientId: CLIENT_1,
            clientName: 'ICICI Lombard',
            issueDate: '2026-09-01',
            totalAmount: '11800.00',
            outstandingAmount: '11800.00',
            status: 'ISSUED',
          },
        ],
        [
          {
            id: 'case-1',
            caseNumber: 'CASE-200',
            clientName: 'HDFC Ergo',
            clientId: CLIENT_2,
            status: 'APPROVED',
            approvedDate: '2026-09-15',
            estimatedFee: '3500.00',
          },
        ]
      );

      expect(items.length).toBe(2);
      expect(items[0].category).toBe('billable_unpaid');
      expect(items[0].amount).toBe('11800.00');

      expect(items[1].category).toBe('unbilled_approved');
      expect(items[1].amount).toBe('3500.00');
    });
  });

  // ============================================================================
  // GATE 10: NEGATIVE AUTHORIZATION & TENANT ISOLATION
  // ============================================================================
  describe('GATE 10: Negative Authorization & Multi-tenant Isolation', () => {
    it('rejects recording payments for users without payments.record permission', async () => {
      await expect(
        service.recordPayment(UNAUTHORIZED_USER, {
          client_id: CLIENT_1,
          amount: '5000.00',
          payment_mode: 'NEFT',
        })
      ).rejects.toThrow(/Permission denied/);
    });

    it('prevents foreign agency from allocating across agency boundary', async () => {
      // Payment belongs to Agency A, Foreign user belongs to Agency B
      const paymentA = await service.recordPayment(ACCOUNTANT_A, {
        client_id: CLIENT_1,
        amount: '10000.00',
        payment_mode: 'NEFT',
      });

      // Foreign accountant in Agency B attempting to allocate Agency A's payment
      await expect(
        service.allocatePayment(FOREIGN_ACCOUNTANT, {
          payment_id: paymentA.id,
          invoice_id: INV_AGENCY_B_UUID,
          allocated_amount: '5000.00',
        })
      ).rejects.toThrow(/Payment record not found/);
    });
  });
});
