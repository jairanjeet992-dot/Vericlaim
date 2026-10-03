import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import Decimal from 'decimal.js';
import {
  calculateGst,
  convertNumberToIndianWords,
  getFinancialYear,
  resolvePlaceOfSupply,
  round2,
  format2,
} from '../../src/modules/finance/gst-engine';
import { generateInvoiceDocument } from '../../src/modules/finance/pdf-invoice';
import { defaultEInvoiceProvider } from '../../src/modules/finance/einvoice';
import { InvoicingService, UserScopeContext } from '../../src/modules/finance/service';
import { R2StorageService } from '../../src/modules/evidence/storage';
import { validateGstin } from '../../src/lib/validation/gstin';

// Test Constants & UUIDs
const AGENCY_A = '11111111-1111-4111-a111-111111111111';
const AGENCY_B = '22222222-2222-4222-b222-222222222222';

const OWNER_A_USER = 'aaaaaaaa-1111-4111-a111-111111111111';
const ACCOUNTANT_A_USER = 'aaaaaaaa-2222-4111-a111-222222222222';
const FOREIGN_USER = 'bbbbbbbb-1111-4222-b222-111111111111';

const CLIENT_1 = 'cccccccc-1111-4111-a111-111111111111';
const BRANCH_MP = 'dddddddd-1111-4111-a111-111111111111'; // MP Branch (Code 23)
const BRANCH_MH = 'dddddddd-2222-4111-a111-222222222222'; // MH Branch (Code 27)

const CASE_1 = 'eeeeeeee-1111-4111-a111-111111111111';
const CASE_2 = 'eeeeeeee-2222-4111-a111-222222222222';

// In-Memory Database Simulator for Invoicing & GST Gates
class InvoicingDatabaseMock {
  public agencies: any[] = [];
  public clients: any[] = [];
  public client_branches: any[] = [];
  public cases: any[] = [];
  public invoices: any[] = [];
  public invoice_items: any[] = [];
  public invoice_taxes: any[] = [];
  public credit_debit_notes: any[] = [];
  public invoice_sequences: any[] = [];
  public case_status_history: any[] = [];
  public audit_logs: any[] = [];

  constructor() {
    this.seed();
  }

  seed() {
    this.agencies = [
      {
        id: AGENCY_A,
        name: 'DNA Professional Investigation Agency',
        code: 'DNA',
        gstin: '23AABCC1234D1Z5',
        state_code: '23', // Madhya Pradesh
        address: '101 Trade Center, Indore, MP',
      },
      {
        id: AGENCY_B,
        name: 'Apex Detective Agency',
        code: 'APEX',
        gstin: '27AABCA5678E1Z2',
        state_code: '27', // Maharashtra
        address: '404 Nariman Point, Mumbai, MH',
      },
    ];

    this.clients = [
      {
        id: CLIENT_1,
        agency_id: AGENCY_A,
        name: 'Star Health & Allied Insurance',
        pan_number: 'AAACS1234K',
      },
    ];

    this.client_branches = [
      {
        id: BRANCH_MP,
        agency_id: AGENCY_A,
        client_id: CLIENT_1,
        branch_name: 'Indore Regional Office',
        branch_code: 'IND-01',
        legal_name: 'Star Health & Allied Insurance Co Ltd',
        gstin: '23AAACS1234K1Z8',
        state: 'Madhya Pradesh',
        state_code: '23',
        billing_address: 'UG-10 Apollo Square, Indore, MP 452001',
      },
      {
        id: BRANCH_MH,
        agency_id: AGENCY_A,
        client_id: CLIENT_1,
        branch_name: 'Mumbai Central Claims Hub',
        branch_code: 'BOM-01',
        legal_name: 'Star Health & Allied Insurance Co Ltd',
        gstin: '27AAACS1234K1Z0',
        state: 'Maharashtra',
        state_code: '27',
        billing_address: 'Bandra-Kurla Complex, Mumbai, MH 400051',
      },
    ];

    this.cases = [
      {
        id: CASE_1,
        agency_id: AGENCY_A,
        docket_no: 'OCT26-0001',
        claim_no: 'CLM-STAR-2026-901',
        insured_name: 'Rajesh Sharma',
        case_type: 'Reimbursement',
        client_id: CLIENT_1,
        status: 'CLOSED',
        version: 1,
      },
      {
        id: CASE_2,
        agency_id: AGENCY_A,
        docket_no: 'OCT26-0002',
        claim_no: 'CLM-STAR-2026-902',
        insured_name: 'Sunita Patel',
        case_type: 'Cashless',
        client_id: CLIENT_1,
        status: 'CLOSED',
        version: 1,
      },
    ];

    this.invoices = [];
    this.invoice_items = [];
    this.invoice_taxes = [];
    this.credit_debit_notes = [];
    this.invoice_sequences = [];
    this.case_status_history = [];
    this.audit_logs = [];
  }

  createClient(callerUserId: string, callerAgencyId: string) {
    const db = this;

    return {
      rpc: async (fnName: string, args: any) => {
        if (fnName === 'get_next_gapless_invoice_number') {
          const { p_agency_id, p_fy, p_doc_type } = args;
          const docType = p_doc_type || 'INV';
          let seq = db.invoice_sequences.find(
            (s) => s.agency_id === p_agency_id && s.financial_year === p_fy && s.doc_type === docType
          );
          if (!seq) {
            seq = {
              agency_id: p_agency_id,
              financial_year: p_fy,
              doc_type: docType,
              current_val: 1,
            };
            db.invoice_sequences.push(seq);
          } else {
            seq.current_val += 1;
          }

          const prefix = docType === 'CN' ? 'CN' : docType === 'DN' ? 'DN' : 'INV';
          return { data: `${prefix}/${p_fy}/${String(seq.current_val).padStart(4, '0')}`, error: null };
        }
        return { data: null, error: { message: `RPC ${fnName} not found` } };
      },

      from: (table: string) => {
        const rows: any[] = (db as any)[table] || [];

        return {
          select: (columns: string = '*') => {
            let working = [...rows];

            const queryObj: any = {
              eq: (col: string, val: any) => {
                working = working.filter((r) => r[col] === val);
                return queryObj;
              },
              in: (col: string, vals: any[]) => {
                working = working.filter((r) => vals.includes(r[col]));
                return queryObj;
              },
              order: () => queryObj,
              single: async () => {
                if (working.length === 0) return { data: null, error: { message: 'Row not found' } };
                const res = { ...working[0] };
                // Populate relations if requested
                if (table === 'client_branches') {
                  res.clients = db.clients.find((c) => c.id === res.client_id) || null;
                }
                return { data: res, error: null };
              },
              then: (resolve: any) => {
                const mapped = working.map((r) => {
                  const res = { ...r };
                  if (table === 'invoices') {
                    res.clients = db.clients.find((c) => c.id === res.client_id) || null;
                    res.client_branches = db.client_branches.find((b) => b.id === res.client_branch_id) || null;
                  }
                  return res;
                });
                resolve({ data: mapped, error: null });
              },
            };
            return queryObj;
          },

          insert: (data: any | any[]) => {
            const arr = Array.isArray(data) ? data : [data];

            const executeInsert = (single: boolean) => {
              const inserted: any[] = [];
              for (const item of arr) {
                const row = {
                  id: item.id || crypto.randomUUID(),
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  ...item,
                };

                // Simulated Trigger: prevent_invoice_items_mutation
                if (table === 'invoice_items') {
                  const parentInv = db.invoices.find((inv) => inv.id === row.invoice_id);
                  if (parentInv && (parentInv.is_immutable || parentInv.status !== 'DRAFT')) {
                    throw new Error(
                      'A6 Security Violation: Line items of issued invoices are immutable and cannot be added, edited, or deleted.'
                    );
                  }
                }

                rows.push(row);
                inserted.push({ ...row });
              }

              if (single) {
                return { data: inserted[0], error: null };
              }
              return { data: Array.isArray(data) ? inserted : inserted[0], error: null };
            };

            return {
              select: () => ({
                single: async () => executeInsert(true),
                then: (resolve: any, reject: any) => {
                  try {
                    resolve(executeInsert(false));
                  } catch (err) {
                    if (reject) reject(err);
                    else throw err;
                  }
                },
              }),
              then: (resolve: any, reject: any) => {
                try {
                  resolve(executeInsert(false));
                } catch (err) {
                  if (reject) reject(err);
                  else throw err;
                }
              },
            };
          },

          update: (updates: any) => {
            let working = [...rows];

            const executeUpdate = (single: boolean) => {
              // Simulated Trigger: prevent_issued_invoice_mutation
              if (table === 'invoices') {
                for (const row of working) {
                  if (row.is_immutable === true || ['ISSUED', 'PAID', 'PARTIALLY_PAID'].includes(row.status)) {
                    // Check if this is an authorized cancellation
                    if (updates.status === 'CANCELLED' && row.status !== 'CANCELLED') {
                      if (!updates.cancellation_reason || updates.cancellation_reason.trim() === '') {
                        throw new Error(
                          'A6 Security Violation: Cancellation of issued invoice requires mandatory cancellation_reason.'
                        );
                      }
                      // Allow cancellation transition
                      continue;
                    }

                    // Check if this is a payment reconciliation update
                    if (
                      ['PAID', 'PARTIALLY_PAID'].includes(updates.status) &&
                      updates.total_amount === row.total_amount &&
                      updates.invoice_number === row.invoice_number
                    ) {
                      continue;
                    }

                    throw new Error(
                      'A6 Security Violation: Issued invoices are immutable. Financial figures, items, and tax amounts cannot be modified or deleted. Use Credit/Debit Notes for corrections.'
                    );
                  }
                }
              }

              // Simulated Trigger: prevent_invoice_items_mutation
              if (table === 'invoice_items') {
                for (const row of working) {
                  const parentInv = db.invoices.find((inv) => inv.id === row.invoice_id);
                  if (parentInv && (parentInv.is_immutable || parentInv.status !== 'DRAFT')) {
                    throw new Error(
                      'A6 Security Violation: Line items of issued invoices are immutable and cannot be added, edited, or deleted.'
                    );
                  }
                }
              }

              // Simulated Trigger: prevent_credit_notes_mutation
              if (table === 'credit_debit_notes') {
                throw new Error(
                  'A6 Security Violation: Credit and debit notes are append-only historical records and cannot be modified or deleted.'
                );
              }

              const updatedRows: any[] = [];
              for (const row of working) {
                const idx = rows.findIndex((r: any) => r.id === row.id);
                if (idx !== -1) {
                  rows[idx] = { ...rows[idx], ...updates, updated_at: new Date().toISOString() };
                  updatedRows.push({ ...rows[idx] });
                }
              }

              if (single) {
                return {
                  data: updatedRows.length > 0 ? { ...updatedRows[0] } : null,
                  error: updatedRows.length === 0 ? { message: 'Row not found' } : null,
                };
              }
              return { data: updatedRows, error: null };
            };

            const queryObj: any = {
              eq: (col: string, val: any) => {
                working = working.filter((r) => r[col] === val);
                return queryObj;
              },
              select: () => ({
                single: async () => executeUpdate(true),
                then: (resolve: any, reject: any) => {
                  try {
                    resolve(executeUpdate(false));
                  } catch (err) {
                    if (reject) reject(err);
                    else throw err;
                  }
                },
              }),
              then: (resolve: any, reject: any) => {
                try {
                  resolve(executeUpdate(false));
                } catch (err) {
                  if (reject) reject(err);
                  else throw err;
                }
              },
            };
            return queryObj;
          },

          delete: () => {
            let working = [...rows];

            const queryObj: any = {
              eq: (col: string, val: any) => {
                working = working.filter((r) => r[col] === val);
                return queryObj;
              },
              then: (resolve: any, reject: any) => {
                try {
                  // Simulated Trigger: prevent_issued_invoice_mutation
                  if (table === 'invoices') {
                    for (const row of working) {
                      if (row.is_immutable === true || row.status !== 'DRAFT') {
                        throw new Error('A6 Security Violation: Issued invoices cannot be deleted.');
                      }
                    }
                  }

                  // Simulated Trigger: prevent_invoice_items_mutation
                  if (table === 'invoice_items') {
                    for (const row of working) {
                      const parentInv = db.invoices.find((inv) => inv.id === row.invoice_id);
                      if (parentInv && (parentInv.is_immutable || parentInv.status !== 'DRAFT')) {
                        throw new Error(
                          'A6 Security Violation: Line items of issued invoices are immutable and cannot be added, edited, or deleted.'
                        );
                      }
                    }
                  }

                  // Simulated Trigger: prevent_credit_notes_mutation
                  if (table === 'credit_debit_notes') {
                    throw new Error(
                      'A6 Security Violation: Credit and debit notes are append-only historical records and cannot be modified or deleted.'
                    );
                  }

                  for (const row of working) {
                    const idx = rows.findIndex((r: any) => r.id === row.id);
                    if (idx !== -1) rows.splice(idx, 1);
                  }
                  resolve({ data: working, error: null });
                } catch (err) {
                  if (reject) reject(err);
                  else throw err;
                }
              },
            };
            return queryObj;
          },

          upsert: (record: any) => {
            const idx = rows.findIndex(
              (r) =>
                r.agency_id === record.agency_id &&
                r.financial_year === record.financial_year &&
                r.doc_type === record.doc_type
            );
            if (idx !== -1) {
              rows[idx] = { ...rows[idx], ...record, updated_at: new Date().toISOString() };
            } else {
              rows.push({ ...record, updated_at: new Date().toISOString() });
            }
            return {
              then: (resolve: any) => resolve({ data: record, error: null }),
            };
          },
        };
      },
    };
  }
}

describe('PHASE 7A: Invoicing, GST, and Credit Notes Gates (CA-VERIFY)', () => {
  let db: InvoicingDatabaseMock;
  let clientA: any;
  let serviceA: InvoicingService;
  let ownerContext: UserScopeContext;
  let accountantContext: UserScopeContext;
  let foreignContext: UserScopeContext;

  beforeEach(() => {
    R2StorageService.resetMockStorage();
    db = new InvoicingDatabaseMock();
    clientA = db.createClient(OWNER_A_USER, AGENCY_A);
    serviceA = new InvoicingService(clientA);

    ownerContext = {
      userId: OWNER_A_USER,
      agencyId: AGENCY_A,
      role: 'Agency Owner',
      scope: 'ALL',
      permissions: ['invoices.create', 'invoices.issue', 'invoices.cancel', 'cases.view'],
    };

    accountantContext = {
      userId: ACCOUNTANT_A_USER,
      agencyId: AGENCY_A,
      role: 'Accountant',
      scope: 'ALL',
      permissions: ['invoices.create', 'invoices.issue', 'invoices.cancel', 'cases.view'],
    };

    foreignContext = {
      userId: FOREIGN_USER,
      agencyId: AGENCY_B,
      role: 'Agency Owner',
      scope: 'ALL',
      permissions: ['invoices.create', 'invoices.issue', 'invoices.cancel', 'cases.view'],
    };
  });

  // ===========================================================================
  // GATE 1: GOLDEN_TESTS FOR GST PASS (TEST-06, TEST-07, TEST-08)
  // ===========================================================================
  describe('GATE 1: GOLDEN_TESTS for GST Verification', () => {
    it('TEST-06: Intra-State GST Invoicing (Forward Calculation MP to MP 18%)', () => {
      // Inputs: MP (23) to MP (23), Fee: 3000.00, Expense: 500.00, GST: 18.00%
      const res = calculateGst(
        [
          { description: 'Professional Investigation Fee', amount: 3000.0 },
          { description: 'Conveyance / Traveling Allowance', amount: 500.0 },
        ],
        {
          supplierStateCode: '23',
          recipientStateCode: '23',
          defaultTaxRate: 18.0,
          calculationMode: 'FORWARD',
        }
      );

      // Expected Output per GOLDEN_TESTS.md TEST-06:
      // Taxable: 3500.00, CGST: 315.00 (9%), SGST: 315.00 (9%), IGST: 0.00, Total: 4130.00
      expect(res.isIntraState).toBe(true);
      expect(res.placeOfSupplyStateCode).toBe('23');
      expect(res.taxableAmount).toBe('3500.00');
      expect(res.cgstAmount).toBe('315.00');
      expect(res.sgstAmount).toBe('315.00');
      expect(res.igstAmount).toBe('0.00');
      expect(res.totalTaxAmount).toBe('630.00');
      expect(res.totalAmount).toBe('4130.00');
      expect(res.amountInWords).toBe('Indian Rupees Four Thousand One Hundred Thirty Only');
    });

    it('TEST-07: Inter-State GST Invoicing (Forward Calculation MP to MH 18%)', () => {
      // Inputs: MP (23) to MH (27), Fee: 4500.00, Expense: 250.00, GST: 18.00%
      const res = calculateGst(
        [
          { description: 'Professional Investigation Fee', amount: 4500.0 },
          { description: 'Traveling Allowance', amount: 250.0 },
        ],
        {
          supplierStateCode: '23',
          recipientStateCode: '27',
          defaultTaxRate: 18.0,
          calculationMode: 'FORWARD',
        }
      );

      // Expected Output per GOLDEN_TESTS.md TEST-07:
      // Taxable: 4750.00, CGST: 0.00, SGST: 0.00, IGST: 855.00 (18%), Total: 5605.00
      expect(res.isIntraState).toBe(false);
      expect(res.placeOfSupplyStateCode).toBe('27');
      expect(res.taxableAmount).toBe('4750.00');
      expect(res.cgstAmount).toBe('0.00');
      expect(res.sgstAmount).toBe('0.00');
      expect(res.igstAmount).toBe('855.00');
      expect(res.totalTaxAmount).toBe('855.00');
      expect(res.totalAmount).toBe('5605.00');
      expect(res.amountInWords).toBe('Indian Rupees Five Thousand Six Hundred Five Only');
    });

    it('TEST-08: Backward Calculation from Grand Total (Legacy Case Parity 18%)', () => {
      // Inputs: Flat gross total 2950.00, GST rate 18.00%, Intra-state (23 to 23)
      const res = calculateGst(
        [{ description: 'Consolidated Case Invoice', amount: 2950.0 }],
        {
          supplierStateCode: '23',
          recipientStateCode: '23',
          defaultTaxRate: 18.0,
          calculationMode: 'TOTAL_INCLUSIVE',
        }
      );

      // Expected Output per GOLDEN_TESTS.md TEST-08:
      // Taxable: 2500.00, CGST: 225.00, SGST: 225.00, Total: 2950.00
      expect(res.calculationMode).toBe('TOTAL_INCLUSIVE');
      expect(res.isIntraState).toBe(true);
      expect(res.taxableAmount).toBe('2500.00');
      expect(res.cgstAmount).toBe('225.00');
      expect(res.sgstAmount).toBe('225.00');
      expect(res.igstAmount).toBe('0.00');
      expect(res.totalTaxAmount).toBe('450.00');
      expect(res.totalAmount).toBe('2950.00');
    });
  });

  // ===========================================================================
  // GATE 2: INTRA / INTER / ZERO-RATED / REVERSE-CHARGE / ROUNDING EDGE TESTS
  // ===========================================================================
  describe('GATE 2: Tax Rates, Zero-Rated, RCM, and Rounding Edge Tests', () => {
    it('handles multiple GST tax slabs (5%, 12%, 18%, 28%) accurately', () => {
      // 5% Rate (e.g. basic logistics/transport)
      const res5 = calculateGst([{ description: 'Transport', amount: 1000 }], {
        supplierStateCode: '23',
        recipientStateCode: '23',
        defaultTaxRate: 5.0,
      });
      expect(res5.cgstAmount).toBe('25.00');
      expect(res5.sgstAmount).toBe('25.00');
      expect(res5.totalAmount).toBe('1050.00');

      // 12% Rate
      const res12 = calculateGst([{ description: 'Equipment', amount: 1000 }], {
        supplierStateCode: '23',
        recipientStateCode: '27',
        defaultTaxRate: 12.0,
      });
      expect(res12.igstAmount).toBe('120.00');
      expect(res12.totalAmount).toBe('1120.00');

      // 28% Rate
      const res28 = calculateGst([{ description: 'Specialized Tech', amount: 1000 }], {
        supplierStateCode: '23',
        recipientStateCode: '23',
        defaultTaxRate: 28.0,
      });
      expect(res28.cgstAmount).toBe('140.00');
      expect(res28.sgstAmount).toBe('140.00');
      expect(res28.totalAmount).toBe('1280.00');
    });

    it('handles SEZ zero-rated supplies correctly', () => {
      const res = calculateGst(
        [{ description: 'SEZ IT Unit Investigation', amount: 5000 }],
        {
          supplierStateCode: '23',
          recipientStateCode: '23', // Even within same state, SEZ is treated as inter-state zero-rated
          isSez: true,
          defaultTaxRate: 0,
        }
      );

      expect(res.isSez).toBe(true);
      expect(res.isIntraState).toBe(false); // SEZ supplies are deemed inter-state
      expect(res.taxableAmount).toBe('5000.00');
      expect(res.cgstAmount).toBe('0.00');
      expect(res.sgstAmount).toBe('0.00');
      expect(res.igstAmount).toBe('0.00');
      expect(res.totalAmount).toBe('5000.00');
    });

    it('handles Reverse Charge Mechanism (RCM)', () => {
      const res = calculateGst(
        [{ description: 'Legal Consultancy Services', amount: 10000 }],
        {
          supplierStateCode: '23',
          recipientStateCode: '27',
          isReverseCharge: true,
          defaultTaxRate: 18.0,
        }
      );

      expect(res.isReverseCharge).toBe(true);
      // Under RCM, tax is not added to invoice payable total from supplier
      expect(res.taxableAmount).toBe('10000.00');
      expect(res.igstAmount).toBe('0.00');
      expect(res.totalAmount).toBe('10000.00');
    });

    it('executes ROUND_HALF_UP rounding policy on fractional paise without divergence', () => {
      // Amount 333.333 @ 18% -> Taxable 333.33, Tax 59.9994 -> 60.00, Total 393.33
      const res = calculateGst([{ description: 'Fractional Item', amount: '333.333' }], {
        supplierStateCode: '23',
        recipientStateCode: '27',
        defaultTaxRate: 18.0,
      });

      expect(res.taxableAmount).toBe('333.33');
      expect(res.igstAmount).toBe('60.00');
      expect(res.totalAmount).toBe('393.33');

      // Half-up test: 0.005 rounds up to 0.01
      expect(format2('10.005')).toBe('10.01');
      expect(format2('10.004')).toBe('10.00');
    });

    it('converts complex numbers to Indian Words (Rupees, Lakhs, Crores, Paise)', () => {
      expect(convertNumberToIndianWords(4130.0)).toBe(
        'Indian Rupees Four Thousand One Hundred Thirty Only'
      );
      expect(convertNumberToIndianWords(100050.5)).toBe(
        'Indian Rupees One Lakh Fifty and Fifty Paise Only'
      );
      expect(convertNumberToIndianWords(25000000.0)).toBe(
        'Indian Rupees Two Crore Fifty Lakh Only'
      );
      expect(convertNumberToIndianWords(0)).toBe('Indian Rupees Zero Only');
    });

    it('verifies GSTIN format and MOD 36 checksum verification', () => {
      // Valid MP GSTIN (prefix: 23AAAAA0000A1Z -> check char is A)
      const validGstin = '23AAAAA0000A1ZA';
      const check = validateGstin(validGstin, '23');
      expect(check.isValid).toBe(true);
      expect(check.stateCode).toBe('23');

      // Invalid state code mismatch
      const mismatch = validateGstin(validGstin, '27');
      expect(mismatch.isValid).toBe(false);
      expect(mismatch.error).toContain('does not match expected state');

      // Malformed GSTIN
      const malformed = validateGstin('INVALID-GSTIN-01');
      expect(malformed.isValid).toBe(false);
    });

    it('marks e-invoice provider as stub and not-implemented per Rule A11', async () => {
      expect(defaultEInvoiceProvider.isLive()).toBe(false);
      const res = await defaultEInvoiceProvider.generateIrn({
        invoiceId: crypto.randomUUID(),
        invoiceNumber: 'INV/2026-27/0001',
        financialYear: '2026-27',
        supplierGstin: '23AABCC1234D1Z5',
        recipientGstin: '27AAACS1234K1Z0',
        taxableAmount: '3500.00',
        totalTaxAmount: '630.00',
        totalAmount: '4130.00',
        placeOfSupplyStateCode: '27',
        isIntraState: false,
        isReverseCharge: false,
      });

      expect(res.status).toBe('NOT_IMPLEMENTED');
      expect(res.errorMessage).toContain('CA-VERIFY');
      expect(res.errorMessage).toContain('Rule A11');
    });
  });

  // ===========================================================================
  // GATE 3: DB REJECTS UPDATE ON ISSUED INVOICE (IMMUTABILITY ENFORCEMENT)
  // ===========================================================================
  describe('GATE 3: Immutability & DB Protection of Issued Invoices', () => {
    it('strictly locks issued invoice: rejects direct UPDATE and DELETE at DB level', async () => {
      // 1. Create Draft Invoice
      const draftDossier = await serviceA.createDraftInvoice(ownerContext, {
        client_id: CLIENT_1,
        client_branch_id: BRANCH_MP,
        items: [
          {
            description: 'Field Verification Services',
            amount: 3500.0,
            tax_rate: 18.0,
          },
        ],
      });

      const invId = draftDossier.invoice.id;
      expect(draftDossier.invoice.status).toBe('DRAFT');
      expect(draftDossier.invoice.is_immutable).toBe(false);

      // 2. Issue the invoice formally
      const issuedDossier = await serviceA.issueInvoice(ownerContext, { invoice_id: invId });
      const issued = issuedDossier.invoice;

      expect(issued.status).toBe('ISSUED');
      expect(issued.is_immutable).toBe(true);
      expect(issued.invoice_number).toMatch(/^INV\/[0-9]{4}-[0-9]{2}\/[0-9]{4}$/);
      expect(issued.pdf_r2_key).toBeDefined();
      expect(issued.pdf_sha256).toHaveLength(64);

      // 3. Negative Test: Direct DB UPDATE on financial amount of issued invoice
      await expect(
        clientA.from('invoices').update({ total_amount: 9999.0 }).eq('id', invId)
      ).rejects.toThrow(
        /A6 Security Violation: Issued invoices are immutable. Financial figures, items, and tax amounts cannot be modified or deleted/
      );

      // 4. Negative Test: Direct DB DELETE of issued invoice
      await expect(
        clientA.from('invoices').delete().eq('id', invId)
      ).rejects.toThrow(/A6 Security Violation: Issued invoices cannot be deleted/);

      // 5. Negative Test: Adding line items to issued invoice
      await expect(
        clientA.from('invoice_items').insert({
          agency_id: AGENCY_A,
          invoice_id: invId,
          description: 'Hacked Item',
          amount: 500,
        })
      ).rejects.toThrow(
        /A6 Security Violation: Line items of issued invoices are immutable and cannot be added, edited, or deleted/
      );

      // 6. Authorized Cancellation requires mandatory cancellation_reason
      await expect(
        serviceA.cancelInvoice(ownerContext, {
          invoice_id: invId,
          cancellation_reason: '', // Empty reason should fail
        })
      ).rejects.toThrow();

      // Valid cancellation succeeds and updates status
      const cancelled = await serviceA.cancelInvoice(ownerContext, {
        invoice_id: invId,
        cancellation_reason: 'Billed to incorrect client branch Ind-01 instead of Ind-02',
      });

      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancellation_reason).toBe(
        'Billed to incorrect client branch Ind-01 instead of Ind-02'
      );
    });

    it('generates append-only Credit Note linked to original issued invoice', async () => {
      // 1. Create and issue original invoice
      const draft = await serviceA.createDraftInvoice(ownerContext, {
        client_id: CLIENT_1,
        client_branch_id: BRANCH_MH,
        items: [{ description: 'Hospital Records Check', amount: 5000.0, tax_rate: 18.0 }],
      });
      const issued = await serviceA.issueInvoice(ownerContext, { invoice_id: draft.invoice.id });

      // 2. Issue Credit Note for ₹1,000 partial fee waiver
      const creditNote = await serviceA.createCreditNote(ownerContext, {
        original_invoice_id: issued.invoice.id,
        reason: 'Insurer disallowed special conveyance expense of ₹1,000',
        taxable_amount: 1000.0,
      });

      expect(creditNote.note_number).toMatch(/^CN\/[0-9]{4}-[0-9]{2}\/[0-9]{4}$/);
      expect(creditNote.taxable_amount).toBe('1000.00');
      expect(creditNote.igst_amount).toBe('180.00');
      expect(creditNote.total_amount).toBe('1180.00');
      expect(creditNote.is_immutable).toBe(true);

      // 3. Negative Test: Modifying Credit Note rejected by append-only trigger
      await expect(
        clientA.from('credit_debit_notes').update({ reason: 'Tampered' }).eq('id', creditNote.id)
      ).rejects.toThrow(/A6 Security Violation: Credit and debit notes are append-only/);
    });
  });

  // ===========================================================================
  // GATE 4: CONCURRENT NUMBERING TEST (NO GAPS, NO DUPLICATES)
  // ===========================================================================
  describe('GATE 4: Gapless Monotonic Sequence Numbering per FY', () => {
    it('allocates strictly gapless numbers under concurrent issuance without duplicates', async () => {
      const fy = '2026-27';
      const allocatedNumbers: string[] = [];

      // Create 15 drafts concurrently
      const draftPromises = Array.from({ length: 15 }).map((_, idx) =>
        serviceA.createDraftInvoice(ownerContext, {
          client_id: CLIENT_1,
          client_branch_id: BRANCH_MP,
          items: [{ description: `Case Service #${idx + 1}`, amount: 1000 }],
        })
      );

      const drafts = await Promise.all(draftPromises);
      expect(drafts.length).toBe(15);

      // Issue all 15 invoices concurrently (simulating concurrent worker threads)
      const issuePromises = drafts.map((d) =>
        serviceA.issueInvoice(ownerContext, { invoice_id: d.invoice.id })
      );

      const issuedResults = await Promise.all(issuePromises);

      for (const res of issuedResults) {
        allocatedNumbers.push(res.invoice.invoice_number);
      }

      // 1. Verify exact count
      expect(allocatedNumbers.length).toBe(15);

      // 2. Verify uniqueness (Zero duplicates)
      const uniqueSet = new Set(allocatedNumbers);
      expect(uniqueSet.size).toBe(15);

      // 3. Verify strictly monotonic gapless sequence: INV/2026-27/0001 through INV/2026-27/0015
      const sorted = [...allocatedNumbers].sort();
      for (let i = 0; i < 15; i++) {
        const expectedSeq = `INV/${fy}/${String(i + 1).padStart(4, '0')}`;
        expect(sorted[i]).toBe(expectedSeq);
      }
    });
  });

  // ===========================================================================
  // GATE 5: SERVER-SIDE PDF ARCHIVING IN R2 & SHA-256 HASH VERIFICATION
  // ===========================================================================
  describe('GATE 5: Server-Side PDF Archiving in R2 & SHA-256 Hash Verification', () => {
    it('generates server-side PDF document, stores in R2, and validates cryptographic SHA-256', async () => {
      const draft = await serviceA.createDraftInvoice(ownerContext, {
        client_id: CLIENT_1,
        client_branch_id: BRANCH_MP,
        items: [
          { description: 'Comprehensive Cashless Audit', amount: 4000.0, tax_rate: 18.0 },
        ],
      });

      const issued = await serviceA.issueInvoice(ownerContext, { invoice_id: draft.invoice.id });
      const inv = issued.invoice;

      expect(inv.pdf_r2_key).toBe(`a/${AGENCY_A}/invoices/${inv.id}.html`);
      expect(inv.pdf_sha256).toBeDefined();

      // Retrieve presigned download URL
      const download = await serviceA.getInvoicePdfDownloadUrl(ownerContext, inv.id);
      expect(download.downloadUrl).toContain(`https://mock-r2.vericlaim.internal`);
      expect(download.downloadUrl).toContain(`expires_in=300`); // 5 min expiry per Rule A8
      expect(download.sha256).toBe(inv.pdf_sha256);
    });

    it('supports bulk invoicing for multiple closed cases into a single consolidated invoice', async () => {
      const bulkDossier = await serviceA.bulkCreateInvoiceForCases(ownerContext, {
        client_id: CLIENT_1,
        client_branch_id: BRANCH_MP,
        case_ids: [CASE_1, CASE_2],
        fee_per_case: 4000.0,
      });

      expect(bulkDossier.items.length).toBe(2);
      expect(bulkDossier.invoice.taxable_amount).toBe('8000.00'); // 4000 * 2
      expect(bulkDossier.invoice.total_tax_amount).toBe('1440.00'); // 18% of 8000
      expect(bulkDossier.invoice.total_amount).toBe('9440.00');

      // Issue bulk invoice
      const issued = await serviceA.issueInvoice(ownerContext, {
        invoice_id: bulkDossier.invoice.id,
      });

      expect(issued.invoice.status).toBe('ISSUED');

      // Verify cases transitioned to BILLED
      const case1 = db.cases.find((c) => c.id === CASE_1);
      const case2 = db.cases.find((c) => c.id === CASE_2);
      expect(case1.status).toBe('BILLED');
      expect(case2.status).toBe('BILLED');
    });

    it('enforces multi-tenant isolation, negative permissions, and records audit trail', async () => {
      // 1. Cross-Agency Isolation: Agency B cannot access Agency A invoice
      const draftA = await serviceA.createDraftInvoice(ownerContext, {
        client_id: CLIENT_1,
        client_branch_id: BRANCH_MP,
        items: [{ description: 'Confidential Task', amount: 2000 }],
      });

      const clientB = db.createClient(FOREIGN_USER, AGENCY_B);
      const serviceB = new InvoicingService(clientB as any);

      await expect(
        serviceB.getInvoiceById(foreignContext, draftA.invoice.id)
      ).rejects.toThrow(/not found or access denied/);

      // 2. Permission Negatives: missing invoices.create or invoices.issue
      const noPermContext: UserScopeContext = {
        ...ownerContext,
        permissions: ['cases.view'], // Missing invoices.*
      };

      await expect(
        serviceA.createDraftInvoice(noPermContext, {
          client_id: CLIENT_1,
          client_branch_id: BRANCH_MP,
          items: [{ description: 'Should fail', amount: 1000 }],
        })
      ).rejects.toThrow(/Permission denied: Missing 'invoices.create'/);

      await expect(
        serviceA.issueInvoice(noPermContext, { invoice_id: draftA.invoice.id })
      ).rejects.toThrow(/Permission denied: Missing 'invoices.issue'/);

      // 3. Verify Audit Trail
      const auditActions = db.audit_logs.map((al) => al.action);
      expect(auditActions).toContain('INVOICES.CREATE_DRAFT');
    });
  });
});
