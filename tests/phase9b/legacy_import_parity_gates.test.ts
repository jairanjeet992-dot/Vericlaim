import { describe, it, expect, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import {
  EntityResolver,
  EntityRegistry,
  KNOWN_COMPANY_ALIASES,
  KNOWN_INVESTIGATOR_NORMALIZATION,
  normalizeEntityText,
  calculateSimilarity,
  jaroWinklerSimilarity,
  levenshteinSimilarity,
  LegacyImportValidator,
  SmartPasteParser,
  LegacyBatchImporter,
  ParityReconciliationEngine,
  LegacyCaseRow,
  rollbackImportBatch
} from '@/modules/migration';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

describe('PHASE 9B: Legacy Import & Parity Verification Gates (DNA Migration)', () => {
  const AGENCY_ID = '00000000-0000-0000-0000-000000000001';
  const BATCH_ID = 'b7b25078-4eb8-4221-8ec8-bb88e9eb3410';

  let mockRegistry: EntityRegistry;

  beforeEach(() => {
    mockRegistry = {
      clients: [
        { id: 'cli-star-001', name: 'STAR HEALTH' },
        { id: 'cli-care-002', name: 'CARE' },
        { id: 'cli-tata-003', name: 'TATA AIG' },
        { id: 'cli-sbi-004', name: 'SBI' },
        { id: 'cli-hdfc-005', name: 'HDFC ERGO' }
      ],
      investigators: [
        { id: 'inv-anil-001', name: 'Anil Rajput' },
        { id: 'inv-arun-002', name: 'Arun Barfa' },
        { id: 'inv-vikram-003', name: 'Vikram Singh' },
        { id: 'inv-dheeraj-004', name: 'Dheeraj Jagadhale' },
        { id: 'inv-pavan-005', name: 'Pavan Prajapati' }
      ],
      hospitals: [
        { id: 'hosp-001', name: 'CHL Hospital Indore' },
        { id: 'hosp-002', name: 'Bombay Hospital Indore' }
      ],
      caseTypes: [
        { id: 'ct-001', name: 'CASHLESS' },
        { id: 'ct-002', name: 'REIMBURSEMENT' },
        { id: 'ct-003', name: 'PA' }
      ]
    };
  });

  // =========================================================================
  // GATE 1: Entity Resolution & Canonical Aliases Pipeline (docs/LEGACY_DATA_MAP.md)
  // =========================================================================
  describe('GATE 1: Entity Resolution Pipeline (Zero Silent Fallbacks)', () => {
    it('resolves exact client and investigator names directly to UUIDs', () => {
      const resolver = new EntityResolver(mockRegistry);

      const clientRes = resolver.resolveCompany('STAR HEALTH');
      expect(clientRes.status).toBe('EXACT');
      expect(clientRes.id).toBe('cli-star-001');
      expect(clientRes.score).toBe(1.0);

      const invRes = resolver.resolveInvestigator('Anil Rajput');
      expect(invRes.status).toBe('EXACT');
      expect(invRes.id).toBe('inv-anil-001');
    });

    it('resolves canonical company aliases from KNOWN_COMPANY_ALIASES dictionary', () => {
      const resolver = new EntityResolver(mockRegistry);

      // 'STAR' -> 'STAR HEALTH'
      const res1 = resolver.resolveCompany('STAR');
      expect(res1.status).toBe('ALIAS');
      expect(res1.id).toBe('cli-star-001');

      // 'CARE HEALTH' -> 'CARE'
      const res2 = resolver.resolveCompany('CARE HEALTH');
      expect(res2.status).toBe('ALIAS');
      expect(res2.id).toBe('cli-care-002');

      // 'SBI GENERAL' -> 'SBI'
      const res3 = resolver.resolveCompany('SBI GENERAL');
      expect(res3.status).toBe('ALIAS');
      expect(res3.id).toBe('cli-sbi-004');
    });

    it('resolves investigator normalization dictionary entries', () => {
      const resolver = new EntityResolver(mockRegistry);

      // 'ANIL RAJPUT KANOD' -> 'Anil Rajput'
      const res1 = resolver.resolveInvestigator('ANIL RAJPUT KANOD');
      expect(res1.status).toBe('ALIAS');
      expect(res1.id).toBe('inv-anil-001');

      // 'NA' -> '__UNASSIGNED__' (UUID is null, not a silent fallback)
      const res2 = resolver.resolveInvestigator('NA');
      expect(res2.status).toBe('UNASSIGNED');
      expect(res2.id).toBeNull();
    });

    it('flags fuzzy matches (score >= 0.85) for admin review and marks unresolved (< 0.85)', () => {
      const resolver = new EntityResolver(mockRegistry);

      // "Anil Rajput (Dewas)" -> contains "Anil Rajput" (high similarity >= 0.85)
      const invFuzzy = resolver.resolveInvestigator('Anil Rajput (Dewas)');
      expect(invFuzzy.status).toBe('FUZZY_FLAGGED');
      expect(invFuzzy.id).toBe('inv-anil-001');
      expect(invFuzzy.score).toBeGreaterThanOrEqual(0.85);

      // "FUTURE GENERALI TPA" -> not in registry, score < 0.85
      const compUnresolved = resolver.resolveCompany('FUTURE GENERALI TPA');
      expect(compUnresolved.status).toBe('UNRESOLVED');
      expect(compUnresolved.id).toBeNull();
    });

    it('generates the exact UnresolvedEntityReport schema conforming to Section 3 of docs/LEGACY_DATA_MAP.md', () => {
      const resolver = new EntityResolver(mockRegistry);

      const rows: LegacyCaseRow[] = [
        {
          doc_code: 'JUL26-0112',
          company: 'FUTURE GENERALI TPA',
          claim_no: 'CLM-001',
          insured_name: 'Patient A',
          inv1: 'Anil Rajput (Dewas)'
        },
        {
          doc_code: 'JUL26-0113',
          company: 'STAR HEALTH',
          claim_no: 'CLM-002',
          insured_name: 'Patient B',
          inv1: 'Anil Rajput'
        }
      ];

      const report = resolver.generateUnresolvedReport(AGENCY_ID, BATCH_ID, rows);

      expect(report.agency_id).toBe(AGENCY_ID);
      expect(report.batch_id).toBe(BATCH_ID);
      expect(report.summary.total_cases_analyzed).toBe(2);
      expect(report.summary.company_names_matched_exact).toBe(1);
      expect(report.summary.company_names_unresolved).toBe(1);
      expect(report.summary.investigator_names_matched_exact).toBe(1);
      expect(report.summary.investigator_names_fuzzy_flagged).toBe(1);

      // Verify exceptions structure
      expect(report.exceptions.length).toBe(2);
      const invExc = report.exceptions.find(e => e.entity_type === 'investigator');
      expect(invExc).toBeDefined();
      expect(invExc?.suggested_match.canonical_name).toBe('Anil Rajput');
      expect(invExc?.resolution_status).toBe('pending_admin_action');
      expect(invExc?.affected_doc_codes).toContain('JUL26-0112');
    });
  });

  // =========================================================================
  // GATE 2: Dry-Run Gatekeeper Validation
  // =========================================================================
  describe('GATE 2: Dry-Run Validation (Bad GSTIN, Dupes, Negative Amounts, Outcome Typos)', () => {
    it('detects invalid 15-character Indian GSTINs', () => {
      expect(LegacyImportValidator.isValidGstin('23AABCC1234D1Z5')).toBe(true);
      expect(LegacyImportValidator.isValidGstin('INVALID_GSTIN_123')).toBe(false);
      expect(LegacyImportValidator.isValidGstin('23AABCC1234D1')).toBe(false); // only 13 chars
    });

    it('catches duplicate claims, negative amounts, and outcome typos in batch validation', () => {
      const resolver = new EntityResolver(mockRegistry);
      const existingClaims = ['STAR HEALTH:::CLM-EXISTING-99'];
      const validator = new LegacyImportValidator(existingClaims, ['JUL26-0001']);

      const faultyRows: LegacyCaseRow[] = [
        {
          doc_code: 'JUL26-0001', // Duplicate doc_code in DB
          company: 'STAR HEALTH',
          claim_no: 'CLM-001',
          insured_name: 'John Doe',
          fee1: -500 // Negative amount
        },
        {
          doc_code: 'JUL26-0002',
          company: 'STAR HEALTH',
          claim_no: 'CLM-EXISTING-99', // Duplicate claim in DB
          insured_name: 'Jane Doe',
          outcome: 'genuin' // Outcome typo
        },
        {
          doc_code: 'JUL26-0003',
          company: 'STAR HEALTH',
          claim_no: 'CLM-003',
          insured_name: 'Bob Smith',
          custom_data: { gstin: 'BAD_GST_999' } // Bad GSTIN
        }
      ];

      const res = validator.validateBatch(faultyRows, AGENCY_ID, BATCH_ID, resolver);

      expect(res.is_valid).toBe(false);
      expect(res.error_count).toBeGreaterThanOrEqual(4);

      const errTypes = res.errors.map(e => e.error_type);
      expect(errTypes).toContain('DUPLICATE_CLAIM');
      expect(errTypes).toContain('INVALID_AMOUNT');
      expect(errTypes).toContain('OUTCOME_TYPO');
      expect(errTypes).toContain('BAD_GSTIN');

      const outcomeErr = res.errors.find(e => e.error_type === 'OUTCOME_TYPO');
      expect(outcomeErr?.suggested_fix).toBe('Genuine');
    });
  });

  // =========================================================================
  // GATE 3: Multi-Investigator Mapping & Idempotent Batch Importer
  // =========================================================================
  describe('GATE 3: Multi-Investigator N-Rows & Idempotent Batch Importer', () => {
    it('normalizes legacy inv1/inv2 slots into discrete case_investigators N-rows', () => {
      const resolver = new EntityResolver(mockRegistry);
      const importer = new LegacyBatchImporter(AGENCY_ID, BATCH_ID, resolver);

      const rows: LegacyCaseRow[] = [
        {
          doc_code: 'JUL26-0912',
          company: 'STAR HEALTH',
          claim_no: 'CLM-88192',
          insured_name: 'Rajesh Sharma',
          inv1: 'Anil Rajput',
          fee1: 500,
          ta1: 150,
          inv2: 'Arun Barfa',
          fee2: 400,
          ta2: 100,
          invoice_no: 'INV-001',
          invoice_amount: 3500,
          received: 3500,
          tds_deducted: 0,
          outcome: 'Genuine'
        }
      ];

      const result = importer.executeBatchCommit(rows);
      expect(result.status).toBe('COMMITTED');
      expect(result.imported_cases_count).toBe(1);
      expect(result.imported_investigators_count).toBe(2);

      const caseRec = result.cases[0];
      expect(caseRec.import_batch_id).toBe(BATCH_ID);
      expect(caseRec.investigators.length).toBe(2);

      // Investigator 1
      expect(caseRec.investigators[0].investigator_id).toBe('inv-anil-001');
      expect(caseRec.investigators[0].agreed_fee).toBe(500);
      expect(caseRec.investigators[0].travel_allowance).toBe(150);
      expect(caseRec.investigators[0].total_payable).toBe(650);

      // Investigator 2
      expect(caseRec.investigators[1].investigator_id).toBe('inv-arun-002');
      expect(caseRec.investigators[1].agreed_fee).toBe(400);
      expect(caseRec.investigators[1].travel_allowance).toBe(100);
      expect(caseRec.investigators[1].total_payable).toBe(500);

      // Total Investigator Cost
      expect(caseRec.total_investigator_cost).toBe(1150);
    });

    it('rejects commit if any entity remains unresolved (Zero Silent Fallbacks)', () => {
      const resolver = new EntityResolver(mockRegistry);
      const importer = new LegacyBatchImporter(AGENCY_ID, BATCH_ID, resolver);

      const rows: LegacyCaseRow[] = [
        {
          doc_code: 'JUL26-9999',
          company: 'NON_EXISTENT_INSURER',
          claim_no: 'CLM-9999',
          insured_name: 'Unknown Person'
        }
      ];

      const result = importer.executeBatchCommit(rows);
      expect(result.status).toBe('FAILED');
      expect(result.unresolved_count).toBe(1);
      expect(result.errors[0]).toContain('Unresolved company');
    });
  });

  // =========================================================================
  // GATE 4: Salary Transitions & Case Exception Golden Tests (TEST-03, 04, 05)
  // =========================================================================
  describe('GATE 4: Salary Transitions & Withdrawn Exception Rules (Golden Test Parity)', () => {
    it('TEST-03: sets fee to 0 and preserves TA for salaried investigator assigned AFTER salary start date', () => {
      const termsMap = new Map();
      termsMap.set('inv-vikram-003', {
        payment_type: 'Salary',
        salary_amount: 25000,
        payment_type_changed_at: '2026-08-01T00:00:00Z'
      });

      const resolver = new EntityResolver(mockRegistry);
      const importer = new LegacyBatchImporter(AGENCY_ID, BATCH_ID, resolver, termsMap);

      const row: LegacyCaseRow = {
        doc_code: 'AUG26-0418',
        date: '2026-08-15T00:00:00Z', // After 2026-08-01
        company: 'STAR HEALTH',
        claim_no: 'CLM-TEST-03',
        insured_name: 'Test Insured',
        inv1: 'Vikram Singh',
        fee1: 750,
        ta1: 250,
        received: 2500,
        tds_deducted: 0
      };

      const { validRecords } = importer.transformRows([row]);
      const inv = validRecords[0].investigators[0];

      expect(inv.agreed_fee).toBe(0.00); // Zeroed per salary terms
      expect(inv.travel_allowance).toBe(250.00); // Outstation TA preserved
      expect(inv.total_payable).toBe(250.00);
      expect(validRecords[0].total_investigator_cost).toBe(250.00);
    });

    it('TEST-04: retains grandfathered per-case fee for salaried investigator assigned BEFORE salary start date', () => {
      const termsMap = new Map();
      termsMap.set('inv-vikram-003', {
        payment_type: 'Salary',
        salary_amount: 25000,
        payment_type_changed_at: '2026-08-01T00:00:00Z'
      });

      const resolver = new EntityResolver(mockRegistry);
      const importer = new LegacyBatchImporter(AGENCY_ID, BATCH_ID, resolver, termsMap);

      const row: LegacyCaseRow = {
        doc_code: 'JUL26-0418',
        date: '2026-07-20T00:00:00Z', // Before 2026-08-01 transition
        company: 'STAR HEALTH',
        claim_no: 'CLM-TEST-04',
        insured_name: 'Test Insured',
        inv1: 'Vikram Singh',
        fee1: 750,
        ta1: 250,
        received: 2500,
        tds_deducted: 0
      };

      const { validRecords } = importer.transformRows([row]);
      const inv = validRecords[0].investigators[0];

      expect(inv.agreed_fee).toBe(750.00); // Retained grandfathered fee
      expect(inv.travel_allowance).toBe(250.00);
      expect(inv.total_payable).toBe(1000.00);
      expect(validRecords[0].total_investigator_cost).toBe(1000.00);
    });

    it('TEST-05: forces total_payable to 0.00 for Withdrawn cases', () => {
      const resolver = new EntityResolver(mockRegistry);
      const importer = new LegacyBatchImporter(AGENCY_ID, BATCH_ID, resolver);

      const row: LegacyCaseRow = {
        doc_code: 'AUG26-0501',
        date: '2026-08-20T00:00:00Z',
        company: 'STAR HEALTH',
        claim_no: 'CLM-TEST-05',
        insured_name: 'Test Insured',
        inv1: 'Anil Rajput',
        fee1: 500,
        ta1: 100,
        exception_type: 'Withdrawn',
        outcome: 'Withdrawn'
      };

      const { validRecords } = importer.transformRows([row]);
      expect(validRecords[0].total_investigator_cost).toBe(0.00);
      expect(validRecords[0].investigators[0].total_payable).toBe(0.00);
    });
  });

  // =========================================================================
  // GATE 5: Smart Paste Parser & Live Diff Preview
  // =========================================================================
  describe('GATE 5: Smart Paste Parser & Live Diff Preview', () => {
    it('parses tab-delimited text from spreadsheet and generates accurate diff preview', () => {
      const tsv = `Doc Code\tClaim No\tInsured Name\tCompany\tInv1\tFee1\tTA1\tOutcome\tReceived\tTDS
SEP26-01\tCLM-NEW-01\tAmit Joshi\tSTAR HEALTH\tAnil Rajput\t500\t150\tPending\t0\t0
JUL26-99\tCLM-OLD-99\tUpdated Insured Name\tSTAR HEALTH\tAnil Rajput\t500\t150\tGenuine\t3500\t0`;

      const parsedRows = SmartPasteParser.parsePastedText(tsv, '\t', true);
      expect(parsedRows.length).toBe(2);
      expect(parsedRows[0].doc_code).toBe('SEP26-01');
      expect(parsedRows[1].doc_code).toBe('JUL26-99');

      const existingMap = new Map();
      existingMap.set('JUL26-99', {
        doc_code: 'JUL26-99',
        claim_no: 'CLM-OLD-99',
        insured_name: 'Old Insured Name',
        client_name: 'STAR HEALTH',
        investigators: ['Anil Rajput'],
        total_payable: 650,
        outcome: 'Pending'
      });

      const preview = SmartPasteParser.generateDiffPreview(parsedRows, existingMap);

      expect(preview.total_pasted).toBe(2);
      expect(preview.new_cases_count).toBe(1);
      expect(preview.update_cases_count).toBe(1);
      expect(preview.error_count).toBe(0);

      // Check update row diff fields
      const updateRow = preview.rows.find(r => r.doc_code === 'JUL26-99')!;
      expect(updateRow.is_new_case).toBe(false);
      expect(updateRow.diff_fields['insured_name'].old_val).toBe('Old Insured Name');
      expect(updateRow.diff_fields['insured_name'].new_val).toBe('Updated Insured Name');
      expect(updateRow.diff_fields['outcome'].old_val).toBe('Pending');
      expect(updateRow.diff_fields['outcome'].new_val).toBe('Genuine');
    });
  });

  // =========================================================================
  // GATE 6: MANDATORY PARITY GATE (Legacy vs Staging Tenant Reconciliation)
  // =========================================================================
  describe('GATE 6: Mandatory Parity Gate (Zero Discrepancy Reconciliation)', () => {
    it('produces parity reconciliation report with difference = 0 across all financial dimensions and passing golden tests', () => {
      const termsMap = new Map();
      termsMap.set('inv-vikram-003', {
        payment_type: 'Salary',
        salary_amount: 25000,
        payment_type_changed_at: '2026-08-01T00:00:00Z'
      });

      const resolver = new EntityResolver(mockRegistry);
      const importer = new LegacyBatchImporter(AGENCY_ID, BATCH_ID, resolver, termsMap);

      // Authoritative DNA test dataset
      const legacyDataset: LegacyCaseRow[] = [
        {
          doc_code: 'JUL26-0912',
          date: '2026-07-15T10:00:00Z',
          company: 'STAR HEALTH',
          claim_no: 'CLM-STAR-01',
          insured_name: 'Rajesh Sharma',
          inv1: 'Anil Rajput',
          fee1: 500,
          ta1: 150,
          inv2: 'Arun Barfa',
          fee2: 400,
          ta2: 100,
          total_payable: 1150,
          invoice_no: 'INV-01',
          invoice_amount: 3500,
          received: 3500,
          tds_deducted: 0,
          outcome: 'Genuine'
        },
        {
          doc_code: 'JUL26-0913',
          date: '2026-07-18T11:30:00Z',
          company: 'CARE',
          claim_no: 'CLM-CARE-02',
          insured_name: 'Pooja Verma',
          inv1: 'Anil Rajput',
          fee1: 600,
          ta1: 200,
          total_payable: 800,
          invoice_no: 'INV-02',
          invoice_amount: 4000,
          received: 3600,
          tds_deducted: 400,
          outcome: 'Genuine'
        },
        {
          doc_code: 'AUG26-0418',
          date: '2026-08-15T09:00:00Z',
          company: 'TATA AIG',
          claim_no: 'CLM-TATA-03',
          insured_name: 'Sunil Chouhan',
          inv1: 'Vikram Singh',
          fee1: 0,
          ta1: 250,
          total_payable: 250,
          invoice_no: 'INV-03',
          invoice_amount: 2500,
          received: 2500,
          tds_deducted: 0,
          outcome: 'Fraud'
        },
        {
          doc_code: 'AUG26-0501',
          date: '2026-08-20T14:00:00Z',
          company: 'SBI',
          claim_no: 'CLM-SBI-04',
          insured_name: 'Mahesh Patidar',
          inv1: 'Dheeraj Jagadhale',
          fee1: 0,
          ta1: 0,
          total_payable: 0,
          exception_type: 'Withdrawn',
          outcome: 'Withdrawn',
          invoice_amount: 0,
          received: 0,
          tds_deducted: 0
        }
      ];

      const { validRecords } = importer.transformRows(legacyDataset);
      expect(validRecords.length).toBe(4);

      // Generate Parity Reconciliation Report
      const report = ParityReconciliationEngine.generateReport(
        BATCH_ID,
        legacyDataset,
        validRecords
      );

      // 1. Mandatory Gate Verification: Parity must be achieved
      expect(report.is_parity_achieved).toBe(true);

      // 2. Metrics Parity (Differences must be exactly zero)
      expect(report.metrics.total_cases.difference).toBe(0);
      expect(report.metrics.total_cases.is_match).toBe(true);

      expect(report.metrics.total_invoice_amount.difference).toBe(0);
      expect(report.metrics.total_invoice_amount.is_match).toBe(true);

      expect(report.metrics.total_received_amount.difference).toBe(0);
      expect(report.metrics.total_received_amount.is_match).toBe(true);

      expect(report.metrics.total_tds_deducted.difference).toBe(0);
      expect(report.metrics.total_tds_deducted.is_match).toBe(true);

      expect(report.metrics.total_investigator_payable.difference).toBe(0);
      expect(report.metrics.total_investigator_payable.is_match).toBe(true);

      // 3. Per-Month Case Counts Parity
      expect(report.monthly_case_counts.length).toBe(2); // 2026-07 and 2026-08
      expect(report.monthly_case_counts.every(m => m.difference === 0 && m.is_match)).toBe(true);

      // 4. Investigator Monthly Payables Parity
      expect(report.investigator_monthly_payables.every(i => i.difference === 0 && i.is_match)).toBe(true);

      // 5. Company Outstanding Parity
      expect(report.company_outstanding.every(c => c.difference === 0 && c.is_match)).toBe(true);

      // 6. Zero Line-Item Discrepancies
      expect(report.line_item_discrepancies.length).toBe(0);

      // 7. Golden Tests Passing on real imported rows
      expect(report.golden_tests_results.length).toBeGreaterThanOrEqual(4);
      expect(report.golden_tests_results.every(g => g.passed)).toBe(true);
    });
  });

  // =========================================================================
  // GATE 7: Atomic Rollback DB Procedure Invariant Check
  // =========================================================================
  describe('GATE 7: Atomic Database Rollback Contract', () => {
    it('requires minimum 5 characters reason for rollback auditing', async () => {
      const mockSupabase: any = {
        rpc: async () => ({ data: { deleted_cases: 10 }, error: null })
      };

      await expect(
        rollbackImportBatch(mockSupabase, BATCH_ID, 'user-123', 'bad')
      ).rejects.toThrow('Mandatory rollback reason (minimum 5 characters) is required');

      const res = await rollbackImportBatch(mockSupabase, BATCH_ID, 'user-123', 'Duplicate upload error corrected');
      expect(res.success).toBe(true);
      expect(res.batch_id).toBe(BATCH_ID);
    });
  });
});
