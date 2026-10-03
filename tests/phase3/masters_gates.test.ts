import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { MastersService } from '@/modules/masters/service';
import { validateGstin, calculateGstinChecksum } from '@/lib/validation/gstin';
import {
  decryptField,
  computeBlindIndex,
  maskPan,
  maskBankAccount,
} from '@/lib/security/encryption';
import {
  resolveEffectivePaymentTerm,
  calculateInvestigatorFeeForCase,
  InvestigatorPaymentTerm,
} from '@/modules/masters/investigators';
import { compileCustomFieldsSchema, CustomFieldDefinition } from '@/modules/masters/case-types';

// =============================================================================
// PHASE 3 MOCK DATABASE WITH MULTI-TENANT RLS FILTERING
// =============================================================================
class Phase3MockDatabase {
  agencies: any[] = [];
  users: any[] = [];
  clients: any[] = [];
  client_branches: any[] = [];
  case_types: any[] = [];
  outcomes: any[] = [];
  sla_policies: any[] = [];
  investigators: any[] = [];
  investigator_payment_terms: any[] = [];
  audit_logs: any[] = [];

  createClient(currentUserId?: string, currentAgencyId?: string) {
    const db = this;

    const client: any = {
      auth: {
        getUser: async () => ({
          data: { user: currentUserId ? { id: currentUserId } : null },
          error: null,
        }),
      },
      from: (table: string) => {
        let rows = (db as any)[table] || [];

        // RLS enforcement: filter by currentAgencyId if set
        const applyRLS = () => {
          if (!currentAgencyId) return rows;
          return rows.filter((r: any) => r.agency_id === currentAgencyId);
        };

        const queryObj: any = {
          _filters: [] as ((r: any) => boolean)[],
          _isInsert: false,
          _insertData: null as any,
          _isUpdate: false,
          _updateData: null as any,
          _select: '*',
          _order: null as any,
          _limit: null as number | null,

          select: function (cols = '*') {
            this._select = cols;
            return this;
          },

          eq: function (col: string, val: any) {
            this._filters.push((r: any) => r[col] === val);
            return this;
          },

          order: function (col: string, opts?: { ascending?: boolean }) {
            this._order = { col, asc: opts?.ascending !== false };
            return this;
          },

          limit: function (n: number) {
            this._limit = n;
            return this;
          },

          insert: function (data: any) {
            this._isInsert = true;
            this._insertData = Array.isArray(data) ? data : [data];
            return this;
          },

          update: function (updates: any) {
            this._isUpdate = true;
            this._updateData = updates;
            return this;
          },

          single: async function () {
            const res = await this._execute();
            if (res.error) return { data: null, error: res.error };
            return {
              data: res.data?.[0] ? { ...res.data[0] } : null,
              error: res.data?.length ? null : new Error('Row not found'),
            };
          },

          maybeSingle: async function () {
            const res = await this._execute();
            if (res.error) return { data: null, error: res.error };
            return { data: res.data?.[0] ? { ...res.data[0] } : null, error: null };
          },

          then: function (resolve: any, reject: any) {
            return this._execute().then(resolve, reject);
          },

          _execute: async function () {
            if (this._isInsert) {
              const inserted = this._insertData.map((d: any) => {
                const item = {
                  id: d.id || crypto.randomUUID(),
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  ...d,
                };
                rows.push(item);
                return item;
              });
              return { data: inserted, error: null };
            }

            if (this._isUpdate) {
              let targets = rows;
              for (const f of this._filters) {
                targets = targets.filter(f);
              }
              targets.forEach((r: any) => Object.assign(r, this._updateData));
              return { data: targets, error: null };
            }

            let result = applyRLS();
            for (const f of this._filters) {
              result = result.filter(f);
            }
            if (this._order) {
              const { col, asc } = this._order;
              result.sort((a: any, b: any) => {
                if (a[col] < b[col]) return asc ? -1 : 1;
                if (a[col] > b[col]) return asc ? 1 : -1;
                return 0;
              });
            }
            if (this._limit) {
              result = result.slice(0, this._limit);
            }

            // Hydrate nested relationships if requested
            if (table === 'clients' && this._select?.includes('client_branches(*)')) {
              result = result.map((c: any) => ({
                ...c,
                client_branches: db.client_branches.filter(
                  (b: any) => b.client_id === c.id && (!currentAgencyId || b.agency_id === currentAgencyId)
                ),
              }));
            }
            if (table === 'investigators' && this._select?.includes('investigator_payment_terms(*)')) {
              result = result.map((inv: any) => ({
                ...inv,
                investigator_payment_terms: db.investigator_payment_terms.filter(
                  (t: any) => t.investigator_id === inv.id && (!currentAgencyId || t.agency_id === currentAgencyId)
                ),
              }));
            }

            return { data: result, error: null };
          },
        };

        return queryObj;
      },
    };

    return client;
  }
}

// =============================================================================
// TEST SUITE: PHASE 3 MASTERS GATES
// =============================================================================
describe('PHASE 3: MASTERS GATES VERIFICATION', () => {
  let db: Phase3MockDatabase;
  const AGENCY_A = 'a1111111-1111-4111-8111-111111111111';
  const AGENCY_B = 'b2222222-2222-4222-8222-222222222222';
  const USER_A = 'c3333333-3333-4333-8333-333333333333';
  const USER_B = 'd4444444-4444-4444-8444-444444444444';

  // Helper valid GSTINs
  const validGstinMP = '23AAAAA0000A1Z' + calculateGstinChecksum('23AAAAA0000A1Z'); // 23AAAAA0000A1ZA
  const validGstinMH = '27AABCU9603R1Z' + calculateGstinChecksum('27AABCU9603R1Z');

  beforeEach(() => {
    db = new Phase3MockDatabase();
    db.agencies.push(
      { id: AGENCY_A, name: 'DNA Investigation Agency', code: 'DNA' },
      { id: AGENCY_B, name: 'Apex Claims Investigators', code: 'APEX' }
    );
    db.users.push(
      { id: USER_A, agency_id: AGENCY_A, email: 'admin@dna.internal' },
      { id: USER_B, agency_id: AGENCY_B, email: 'admin@apex.internal' }
    );
  });

  // ===========================================================================
  // GATE 1: Multi-tenant scope respected on all lists
  // ===========================================================================
  describe('GATE 1: Scope respected on all master query lists (Multi-Tenant Isolation)', () => {
    it('proves Agency A and Agency B cannot see each other clients, branches, case types, outcomes, or investigators', async () => {
      const clientA = db.createClient(USER_A, AGENCY_A);
      const clientB = db.createClient(USER_B, AGENCY_B);

      const serviceA = new MastersService(clientA);
      const serviceB = new MastersService(clientB);

      // 1. Create Masters in Agency A
      const clA = await serviceA.createClient(USER_A, AGENCY_A, {
        name: 'ICICI Lombard DNA',
        code: 'ICICI-A',
      });
      await serviceA.createClientBranch(USER_A, AGENCY_A, {
        client_id: clA.id,
        branch_name: 'Bhopal Branch',
        branch_code: 'BPL',
        legal_name: 'ICICI Lombard General Insurance Co Ltd',
        gstin: validGstinMP,
        state: 'Madhya Pradesh',
        state_code: '23',
      });
      await serviceA.createCaseType(USER_A, AGENCY_A, {
        code: 'THEFT_DNA',
        name: 'Vehicle Theft',
        default_sla_hours: 48,
        default_fee_rule: { base_fee: 1500 },
        custom_field_definitions: [],
      });
      await serviceA.createOutcome(USER_A, AGENCY_A, {
        code: 'GENUINE_DNA',
        name: 'Genuine Claim',
        category: 'GENUINE',
      });
      await serviceA.createSlaPolicy(USER_A, AGENCY_A, {
        name: 'Express 24h',
        target_hours: 24,
      });
      await serviceA.createInvestigator(USER_A, AGENCY_A, {
        code: 'INV-A1',
        full_name: 'Investigator DNA One',
        phone: '9876543210',
        email: 'inv1@dna.internal',
        pan: 'ABCDE1234F',
        bank_account_number: '123456789012',
        state: 'Madhya Pradesh',
        district: 'Indore',
        city: 'Indore',
      });

      // 2. Create Masters in Agency B
      const clB = await serviceB.createClient(USER_B, AGENCY_B, {
        name: 'HDFC ERGO APEX',
        code: 'HDFC-B',
      });
      await serviceB.createClientBranch(USER_B, AGENCY_B, {
        client_id: clB.id,
        branch_name: 'Mumbai Branch',
        branch_code: 'MUM',
        legal_name: 'HDFC ERGO General Insurance Co Ltd',
        gstin: validGstinMH,
        state: 'Maharashtra',
        state_code: '27',
      });
      await serviceB.createCaseType(USER_B, AGENCY_B, {
        code: 'HEALTH_APEX',
        name: 'Cashless Hospital Investigation',
        default_sla_hours: 24,
        default_fee_rule: { base_fee: 2000 },
        custom_field_definitions: [],
      });
      await serviceB.createOutcome(USER_B, AGENCY_B, {
        code: 'FRAUD_APEX',
        name: 'Confirmed Fraud',
        category: 'FRAUD',
      });
      await serviceB.createSlaPolicy(USER_B, AGENCY_B, {
        name: 'Urgent 12h',
        target_hours: 12,
      });
      await serviceB.createInvestigator(USER_B, AGENCY_B, {
        code: 'INV-B1',
        full_name: 'Investigator Apex One',
        phone: '9123456780',
        email: 'inv1@apex.internal',
        pan: 'XYZAB5678C',
        bank_account_number: '987654321098',
        state: 'Maharashtra',
        district: 'Mumbai',
        city: 'Mumbai',
      });

      // 3. Verify Agency A lists ONLY Agency A records
      const listClientsA = await serviceA.listClients(AGENCY_A);
      expect(listClientsA).toHaveLength(1);
      expect(listClientsA[0].name).toBe('ICICI Lombard DNA');
      expect(listClientsA[0].client_branches).toHaveLength(1);
      expect(listClientsA[0].client_branches[0].branch_code).toBe('BPL');

      const listCaseTypesA = await serviceA.listCaseTypes(AGENCY_A);
      expect(listCaseTypesA).toHaveLength(1);
      expect(listCaseTypesA[0].code).toBe('THEFT_DNA');

      const listOutcomesA = await serviceA.listOutcomes(AGENCY_A);
      expect(listOutcomesA).toHaveLength(1);
      expect(listOutcomesA[0].code).toBe('GENUINE_DNA');

      const listSlaA = await serviceA.listSlaPolicies(AGENCY_A);
      expect(listSlaA).toHaveLength(1);
      expect(listSlaA[0].name).toBe('Express 24h');

      const listInvA = await serviceA.listInvestigators(AGENCY_A);
      expect(listInvA).toHaveLength(1);
      expect(listInvA[0].code).toBe('INV-A1');

      // 4. Verify Agency B lists ONLY Agency B records
      const listClientsB = await serviceB.listClients(AGENCY_B);
      expect(listClientsB).toHaveLength(1);
      expect(listClientsB[0].name).toBe('HDFC ERGO APEX');
      expect(listClientsB[0].client_branches).toHaveLength(1);
      expect(listClientsB[0].client_branches[0].branch_code).toBe('MUM');

      const listCaseTypesB = await serviceB.listCaseTypes(AGENCY_B);
      expect(listCaseTypesB).toHaveLength(1);
      expect(listCaseTypesB[0].code).toBe('HEALTH_APEX');

      const listOutcomesB = await serviceB.listOutcomes(AGENCY_B);
      expect(listOutcomesB).toHaveLength(1);
      expect(listOutcomesB[0].code).toBe('FRAUD_APEX');

      const listSlaB = await serviceB.listSlaPolicies(AGENCY_B);
      expect(listSlaB).toHaveLength(1);
      expect(listSlaB[0].name).toBe('Urgent 12h');

      const listInvB = await serviceB.listInvestigators(AGENCY_B);
      expect(listInvB).toHaveLength(1);
      expect(listInvB[0].code).toBe('INV-B1');

      // 5. Cross-Agency Isolation: No leakage across any entity
      expect(listClientsA.some((c: any) => c.name.includes('APEX'))).toBe(false);
      expect(listClientsB.some((c: any) => c.name.includes('DNA'))).toBe(false);
    });
  });

  // ===========================================================================
  // GATE 2: Encrypted fields unreadable in raw SQL by app role
  // ===========================================================================
  describe('GATE 2: Encrypted fields unreadable in raw SQL by app role (A7 Compliance)', () => {
    it('proves PAN and Bank Account numbers are encrypted using AES-256-GCM and unreadable in raw DB storage', async () => {
      const rawPan = 'ABCDE1234F';
      const rawBankAcc = '50100234567890';

      const client = db.createClient(USER_A, AGENCY_A);
      const service = new MastersService(client);

      const investigator = await service.createInvestigator(USER_A, AGENCY_A, {
        code: 'INV-SECURE',
        full_name: 'Rajesh Sharma',
        phone: '9826012345',
        email: 'rajesh@example.com',
        pan: rawPan,
        bank_account_number: rawBankAcc,
        bank_name: 'HDFC Bank',
        bank_ifsc: 'HDFC0001234',
        state: 'Madhya Pradesh',
        district: 'Indore',
        city: 'Indore',
      });

      // 1. Inspect raw storage row in db.investigators
      const rawDbRow = db.investigators.find((i) => i.id === investigator.id);
      expect(rawDbRow).toBeDefined();

      // RAW SQL CHECK: Plaintext values must NOT appear anywhere in the raw row!
      const rawRowJson = JSON.stringify(rawDbRow);
      expect(rawRowJson.includes(rawPan)).toBe(false);
      expect(rawRowJson.includes(rawBankAcc)).toBe(false);

      // Ciphertext structure: must be iv:authTag:ciphertext (3 colon-separated hex segments)
      expect(rawDbRow.pan_encrypted).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
      expect(rawDbRow.bank_account_encrypted).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);

      // 2. Blind Index Verification: Exact searches without decryption
      const expectedBlindIndex = computeBlindIndex(rawPan);
      expect(rawDbRow.pan_blind_index).toBe(expectedBlindIndex);
      expect(rawDbRow.pan_blind_index).toHaveLength(64); // 256-bit SHA-256 hex string

      // Fast blind index exact match in DB
      const searchResult = db.investigators.find((i) => i.pan_blind_index === expectedBlindIndex);
      expect(searchResult?.id).toBe(investigator.id);

      // 3. Decryption Verification: Application service decrypts accurately
      const decryptedPan = decryptField(rawDbRow.pan_encrypted);
      const decryptedBank = decryptField(rawDbRow.bank_account_encrypted);
      expect(decryptedPan).toBe(rawPan);
      expect(decryptedBank).toBe(rawBankAcc);

      // 4. Masking Verification: Standard listings mask PII and strip raw ciphertexts
      expect(maskPan(rawPan)).toBe('XXXXX1234F');
      expect(maskBankAccount(rawBankAcc)).toBe('XXXXXXXXXX7890');

      const listOutput = await service.listInvestigators(AGENCY_A);
      const returnedInv = listOutput.find((i: any) => i.id === investigator.id);
      expect(returnedInv.pan_display).toBe('XXXXX1234F');
      expect(returnedInv.bank_account_display).toBe('XXXXXXXXXX7890');
      expect(returnedInv.pan_encrypted).toBeUndefined();
      expect(returnedInv.bank_account_encrypted).toBeUndefined();
    });

    it('proves encryption fails gracefully and rejects corrupted ciphertexts', () => {
      expect(() => decryptField('malformed_ciphertext')).toThrow();
      expect(() => decryptField('abc:def:invalid_tag')).toThrow();
    });
  });

  // ===========================================================================
  // GATE 3: GSTIN validator unit tests (Format & Luhn MOD 36 Checksum)
  // ===========================================================================
  describe('GATE 3: GSTIN validator unit tests (Format + Luhn MOD 36 Checksum)', () => {
    it('validates official Indian GSTIN checksums across multiple states', () => {
      // 1. Madhya Pradesh (23)
      const prefixMP = '23AAAAA0000A1Z';
      const checkMP = calculateGstinChecksum(prefixMP);
      expect(checkMP).toBe('A');
      const gstinMP = `${prefixMP}${checkMP}`;
      const resMP = validateGstin(gstinMP, '23');
      expect(resMP.isValid).toBe(true);
      expect(resMP.stateName).toBe('Madhya Pradesh');

      // 2. Maharashtra (27)
      const prefixMH = '27AABCU9603R1Z';
      const checkMH = calculateGstinChecksum(prefixMH);
      const gstinMH = `${prefixMH}${checkMH}`;
      const resMH = validateGstin(gstinMH, '27');
      expect(resMH.isValid).toBe(true);
      expect(resMH.stateName).toBe('Maharashtra');

      // 3. Karnataka (29)
      const prefixKA = '29ABCDE1234F1Z';
      const checkKA = calculateGstinChecksum(prefixKA);
      const gstinKA = `${prefixKA}${checkKA}`;
      const resKA = validateGstin(gstinKA, '29');
      expect(resKA.isValid).toBe(true);
      expect(resKA.stateName).toBe('Karnataka');

      // 4. Delhi (07)
      const prefixDL = '07AAAAA0000A1Z';
      const checkDL = calculateGstinChecksum(prefixDL);
      const gstinDL = `${prefixDL}${checkDL}`;
      const resDL = validateGstin(gstinDL, '07');
      expect(resDL.isValid).toBe(true);
      expect(resDL.stateName).toBe('Delhi');
    });

    it('rejects invalid GSTINs: checksum mismatch, wrong length, wrong state, or malformed structure', () => {
      // 1. Checksum mismatch: Wrong check character
      const badChecksum = '23AAAAA0000A1Z9';
      const resBadCheck = validateGstin(badChecksum, '23');
      expect(resBadCheck.isValid).toBe(false);
      expect(resBadCheck.error).toContain('GSTIN checksum failed');

      // 2. State mismatch: GSTIN starts with '27' (MH) but branch state code is '23' (MP)
      const stateMismatch = validGstinMH;
      const resStateMismatch = validateGstin(stateMismatch, '23');
      expect(resStateMismatch.isValid).toBe(false);
      expect(resStateMismatch.error).toContain('does not match expected state');

      // 3. Length errors
      expect(validateGstin('23AAAAA0000A1Z').isValid).toBe(false);
      expect(validateGstin('23AAAAA0000A1ZA99').isValid).toBe(false);

      // 4. Invalid 14th character: Must be 'Z'
      expect(validateGstin('23AAAAA0000A1X5', '23').isValid).toBe(false);

      // 5. Invalid embedded PAN: 4th char of PAN must be a letter (C/P/H/F/A/T/B/L/J/G)
      expect(validateGstin('23AAAA10000A1Z5', '23').isValid).toBe(false);

      // 6. Non-existent state code '99'
      expect(validateGstin('99AAAAA0000A1Z5', '99').isValid).toBe(false);
    });

    it('enforces GSTIN validation when creating client branches in MastersService', async () => {
      const client = db.createClient(USER_A, AGENCY_A);
      const service = new MastersService(client);

      const cl = await service.createClient(USER_A, AGENCY_A, {
        name: 'SBI General Insurance',
        code: 'SBIG',
      });

      // Valid branch creation succeeds
      const branch = await service.createClientBranch(USER_A, AGENCY_A, {
        client_id: cl.id,
        branch_name: 'Indore Hub',
        branch_code: 'IND',
        legal_name: 'SBI General Insurance Co Ltd',
        gstin: validGstinMP,
        state: 'Madhya Pradesh',
        state_code: '23',
      });
      expect(branch.id).toBeDefined();

      // Invalid GSTIN branch creation fails with clear validation error
      await expect(
        service.createClientBranch(USER_A, AGENCY_A, {
          client_id: cl.id,
          branch_name: 'Invalid Branch',
          branch_code: 'INV-BR',
          legal_name: 'SBI General Insurance Co Ltd',
          gstin: '23AAAAA0000A1Z9', // Bad checksum
          state: 'Madhya Pradesh',
          state_code: '23',
        })
      ).rejects.toThrow(/GSTIN Validation Failed/);
    });
  });

  // ===========================================================================
  // GATE 4: Payment-terms effective-date selection (Golden Tests TEST-03, 04, 05)
  // ===========================================================================
  describe('GATE 4: Payment-terms effective-date selection unit tests (Golden Tests Parity)', () => {
    it('executes Golden Test TEST-03: Salaried Investigator Assigned AFTER Salary Start Date', () => {
      // Scenario: Investigator "Vikram Singh" converted to Salary on 2026-08-01. Case assigned on 2026-08-15.
      const terms: InvestigatorPaymentTerm[] = [
        {
          id: 'term-1',
          agency_id: AGENCY_A,
          investigator_id: 'inv-vikram',
          payment_type: 'PER_CASE',
          base_fee_or_salary: 750,
          effective_from: '2025-01-01',
          effective_to: '2026-07-31',
        },
        {
          id: 'term-2',
          agency_id: AGENCY_A,
          investigator_id: 'inv-vikram',
          payment_type: 'SALARY',
          base_fee_or_salary: 30000,
          effective_from: '2026-08-01',
          effective_to: null,
        },
      ];

      // Case allocation on 2026-08-15
      const effectiveTerm = resolveEffectivePaymentTerm(terms, '2026-08-15');
      expect(effectiveTerm).not.toBeNull();
      expect(effectiveTerm?.payment_type).toBe('SALARY');
      expect(effectiveTerm?.base_fee_or_salary).toBe(30000);

      // Fee calculation for case: Entered fee: 750.00, ta: 250.00
      const calc = calculateInvestigatorFeeForCase({
        term: effectiveTerm,
        enteredFee: 750.0,
        enteredTa: 250.0,
      });

      // Expected Output per GOLDEN_TESTS.md TEST-03:
      // effectiveFee1: 0.00, effectiveTa1: 250.00, total_payable: 250.00
      expect(calc.effective_fee).toBe(0.0);
      expect(calc.effective_ta).toBe(250.0);
      expect(calc.total_payable).toBe(250.0);
      expect(calc.is_salaried).toBe(true);
    });

    it('executes Golden Test TEST-04: Salaried Investigator Assigned BEFORE Salary Start Date (Grandfathered)', () => {
      // Scenario: Same investigator "Vikram Singh" on Salary effective 2026-08-01, but case is from 2026-07-20
      const terms: InvestigatorPaymentTerm[] = [
        {
          id: 'term-1',
          agency_id: AGENCY_A,
          investigator_id: 'inv-vikram',
          payment_type: 'PER_CASE',
          base_fee_or_salary: 750,
          effective_from: '2025-01-01',
          effective_to: '2026-07-31',
        },
        {
          id: 'term-2',
          agency_id: AGENCY_A,
          investigator_id: 'inv-vikram',
          payment_type: 'SALARY',
          base_fee_or_salary: 30000,
          effective_from: '2026-08-01',
          effective_to: null,
        },
      ];

      // Case allocation on 2026-07-20 (< 2026-08-01)
      const effectiveTerm = resolveEffectivePaymentTerm(terms, '2026-07-20');
      expect(effectiveTerm).not.toBeNull();
      expect(effectiveTerm?.payment_type).toBe('PER_CASE');
      expect(effectiveTerm?.base_fee_or_salary).toBe(750);

      // Fee calculation: Entered fee: 750.00, ta: 250.00
      const calc = calculateInvestigatorFeeForCase({
        term: effectiveTerm,
        enteredFee: 750.0,
        enteredTa: 250.0,
      });

      // Expected Output per GOLDEN_TESTS.md TEST-04:
      // effectiveFee1: 750.00, total_payable: 1000.00
      expect(calc.effective_fee).toBe(750.0);
      expect(calc.effective_ta).toBe(250.0);
      expect(calc.total_payable).toBe(1000.0);
      expect(calc.is_salaried).toBe(false);
    });

    it('executes Golden Test TEST-05: Withdrawn Case Zero-Payable Rule', () => {
      // Scenario: Case cancelled/withdrawn by insurer after field investigator was allotted ₹500 fee + ₹100 TA
      const terms: InvestigatorPaymentTerm[] = [
        {
          id: 'term-1',
          agency_id: AGENCY_A,
          investigator_id: 'inv-1',
          payment_type: 'PER_CASE',
          base_fee_or_salary: 500,
          effective_from: '2026-01-01',
          effective_to: null,
        },
      ];

      const effectiveTerm = resolveEffectivePaymentTerm(terms, '2026-08-10');

      const calc = calculateInvestigatorFeeForCase({
        term: effectiveTerm,
        enteredFee: 500.0,
        enteredTa: 100.0,
        exceptionType: 'Withdrawn',
      });

      // Expected Output per GOLDEN_TESTS.md TEST-05:
      // total_payable: 0.00, effective_fee: 0.00, effective_ta: 0.00
      expect(calc.effective_fee).toBe(0.0);
      expect(calc.effective_ta).toBe(0.0);
      expect(calc.total_payable).toBe(0.0);
      expect(calc.exception_applied).toBe('Withdrawn');
    });

    it('resolves multi-term chronological transitions with exact boundary selection', () => {
      const terms: InvestigatorPaymentTerm[] = [
        {
          id: 't1',
          agency_id: AGENCY_A,
          investigator_id: 'inv-multi',
          payment_type: 'PER_CASE',
          base_fee_or_salary: 1000,
          effective_from: '2025-01-01',
          effective_to: '2025-12-31',
        },
        {
          id: 't2',
          agency_id: AGENCY_A,
          investigator_id: 'inv-multi',
          payment_type: 'SALARY',
          base_fee_or_salary: 25000,
          effective_from: '2026-01-01',
          effective_to: '2026-06-30',
        },
        {
          id: 't3',
          agency_id: AGENCY_A,
          investigator_id: 'inv-multi',
          payment_type: 'SALARY',
          base_fee_or_salary: 35000,
          effective_from: '2026-07-01',
          effective_to: null,
        },
      ];

      // Exact boundaries
      expect(resolveEffectivePaymentTerm(terms, '2025-06-15')?.base_fee_or_salary).toBe(1000);
      expect(resolveEffectivePaymentTerm(terms, '2025-12-31')?.base_fee_or_salary).toBe(1000);
      expect(resolveEffectivePaymentTerm(terms, '2026-01-01')?.base_fee_or_salary).toBe(25000);
      expect(resolveEffectivePaymentTerm(terms, '2026-06-30')?.base_fee_or_salary).toBe(25000);
      expect(resolveEffectivePaymentTerm(terms, '2026-07-01')?.base_fee_or_salary).toBe(35000);
      expect(resolveEffectivePaymentTerm(terms, '2026-12-01')?.base_fee_or_salary).toBe(35000);

      // Out of bounds before first term
      expect(resolveEffectivePaymentTerm(terms, '2024-12-31')).toBeNull();
    });
  });

  // ===========================================================================
  // GATE 5: CRUD Audited across all master entities
  // ===========================================================================
  describe('GATE 5: CRUD operations audited (A6 & A7 Compliance)', () => {
    it('verifies audit_logs records every master creation and mutation with complete metadata', async () => {
      const client = db.createClient(USER_A, AGENCY_A);
      const service = new MastersService(client);

      // 1. Audit Client Create
      const clientObj = await service.createClient(USER_A, AGENCY_A, {
        name: 'Bajaj Allianz General Insurance',
        code: 'BAGIC',
      });
      const clientAudit = db.audit_logs.find(
        (l) => l.action === 'CLIENT_CREATE' && l.entity_id === clientObj.id
      );
      expect(clientAudit).toBeDefined();
      expect(clientAudit.agency_id).toBe(AGENCY_A);
      expect(clientAudit.user_id).toBe(USER_A);
      expect(clientAudit.entity_type).toBe('client');

      // 2. Audit Client Branch Create
      const branchObj = await service.createClientBranch(USER_A, AGENCY_A, {
        client_id: clientObj.id,
        branch_name: 'Pune Main Branch',
        branch_code: 'PUN',
        legal_name: 'Bajaj Allianz General Insurance Co Ltd',
        gstin: validGstinMH,
        state: 'Maharashtra',
        state_code: '27',
      });
      const branchAudit = db.audit_logs.find(
        (l) => l.action === 'CLIENT_BRANCH_CREATE' && l.entity_id === branchObj.id
      );
      expect(branchAudit).toBeDefined();
      expect(branchAudit.new_values.gstin).toBe(validGstinMH);

      // 3. Audit Case Type Create
      const caseTypeObj = await service.createCaseType(USER_A, AGENCY_A, {
        code: 'BURGLARY',
        name: 'Commercial Burglary',
        default_sla_hours: 72,
        default_fee_rule: { base_fee: 2500 },
        custom_field_definitions: [],
      });
      const caseTypeAudit = db.audit_logs.find(
        (l) => l.action === 'CASE_TYPE_CREATE' && l.entity_id === caseTypeObj.id
      );
      expect(caseTypeAudit).toBeDefined();
      expect(caseTypeAudit.new_values.code).toBe('BURGLARY');

      // 4. Audit Outcome Create
      const outcomeObj = await service.createOutcome(USER_A, AGENCY_A, {
        code: 'WITHDRAWN',
        name: 'Case Withdrawn by Insurer',
        category: 'EXCEPTION',
        financial_rule: { investigator_payable_percent: 0, client_billable: false },
      });
      const outcomeAudit = db.audit_logs.find(
        (l) => l.action === 'OUTCOME_CREATE' && l.entity_id === outcomeObj.id
      );
      expect(outcomeAudit).toBeDefined();
      expect(outcomeAudit.new_values.code).toBe('WITHDRAWN');

      // 5. Audit SLA Policy Create
      const slaObj = await service.createSlaPolicy(USER_A, AGENCY_A, {
        name: 'Standard 48h SLA',
        target_hours: 48,
        is_agency_default: true,
      });
      const slaAudit = db.audit_logs.find(
        (l) => l.action === 'SLA_POLICY_CREATE' && l.entity_id === slaObj.id
      );
      expect(slaAudit).toBeDefined();
      expect(slaAudit.new_values.target_hours).toBe(48);

      // 6. Audit Investigator Create & Payment Term Add
      const invObj = await service.createInvestigator(USER_A, AGENCY_A, {
        code: 'INV-AUDIT',
        full_name: 'Audit Test Investigator',
        phone: '9988776655',
        email: 'audit.inv@example.com',
        pan: 'ABCDE5678G',
        bank_account_number: '112233445566',
        state: 'Madhya Pradesh',
        district: 'Bhopal',
        city: 'Bhopal',
      });
      const invAudit = db.audit_logs.find(
        (l) => l.action === 'INVESTIGATOR_CREATE' && l.entity_id === invObj.id
      );
      expect(invAudit).toBeDefined();
      expect(invAudit.new_values.code).toBe('INV-AUDIT');

      const termObj = await service.addPaymentTerm(USER_A, AGENCY_A, {
        investigator_id: invObj.id,
        payment_type: 'SALARY',
        base_fee_or_salary: 28000,
        effective_from: '2026-09-01',
      });
      const termAudit = db.audit_logs.find(
        (l) => l.action === 'INVESTIGATOR_PAYMENT_TERM_ADD' && l.entity_id === termObj.id
      );
      expect(termAudit).toBeDefined();
      expect(termAudit.new_values.payment_type).toBe('SALARY');

      // Total audited events across masters
      const mastersAudits = db.audit_logs.filter((l) => l.agency_id === AGENCY_A);
      expect(mastersAudits.length).toBeGreaterThanOrEqual(7);
    });
  });

  // ===========================================================================
  // DYNAMIC CUSTOM FIELD SCHEMA VALIDATION
  // ===========================================================================
  describe('DYNAMIC CUSTOM FIELDS SCHEMA COMPILATION (ZOD)', () => {
    it('compiles and validates dynamic custom field definitions per case type', () => {
      const fieldDefs: CustomFieldDefinition[] = [
        { name: 'fir_number', label: 'Police FIR Number', type: 'text', required: true },
        { name: 'claim_amount', label: 'Claimed Amount', type: 'number', required: true },
        { name: 'date_of_loss', label: 'Date of Loss', type: 'date', required: true },
        {
          name: 'vehicle_type',
          label: 'Vehicle Category',
          type: 'select',
          options: ['2W', '4W', 'COMMERCIAL'],
          required: false,
        },
        { name: 'spot_visit_completed', label: 'Spot Visit Completed', type: 'boolean', required: false },
      ];

      const schema = compileCustomFieldsSchema(fieldDefs);

      // Valid intake payload passes
      const validPayload = {
        fir_number: 'FIR-2026-9812',
        claim_amount: 150000,
        date_of_loss: '2026-08-14',
        vehicle_type: '4W',
        spot_visit_completed: true,
      };
      const validParsed = schema.safeParse(validPayload);
      expect(validParsed.success).toBe(true);

      // Invalid payload: Missing required FIR number and invalid date
      const invalidPayload = {
        claim_amount: 'not-a-number',
        date_of_loss: '14/08/2026', // must be YYYY-MM-DD
        vehicle_type: 'AEROPLANE', // not in options
      };
      const invalidParsed = schema.safeParse(invalidPayload);
      expect(invalidParsed.success).toBe(false);
      expect(invalidParsed.error?.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});
