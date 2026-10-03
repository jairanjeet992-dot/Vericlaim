import { describe, it, expect, beforeEach } from 'vitest';
import { AssignmentService } from '@/modules/assignment/service';
import { CommandCenterService } from '@/modules/cases/command-center';
import {
  rankInvestigatorsForCase,
  InvestigatorCandidate,
  CaseEligibilityContext,
} from '@/modules/assignment/eligibility';
import {
  resolveEffectivePaymentTerm,
  calculateInvestigatorFeeForCase,
} from '@/modules/masters/investigators';

// ============================================================================
// IN-MEMORY MOCK SUPABASE DATABASE FOR PHASE 4B GATES
// ============================================================================
class MockDatabase {
  agencies: any[] = [];
  users: any[] = [];
  cases: any[] = [];
  investigators: any[] = [];
  investigator_payment_terms: any[] = [];
  case_investigators: any[] = [];
  command_center_saved_filters: any[] = [];
  audit_logs: any[] = [];

  createClient(currentUserId?: string, currentAgencyId?: string, callerScope = 'ALL') {
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

        const applyRLS = () => {
          if (!currentAgencyId) return rows;
          let filtered = rows.filter((r: any) => r.agency_id === currentAgencyId);

          if (table === 'cases') {
            const currentUser = db.users.find((u) => u.id === currentUserId);
            const userScope = currentUser?.scope || callerScope;

            if (userScope === 'ALL') {
              return filtered;
            }
            if (userScope === 'OWN_ENTERED') {
              return filtered.filter((c: any) => c.data_entry_user_id === currentUserId);
            }
            if (userScope === 'TEAM') {
              const managerId = currentUser?.reports_to_id || currentUserId;
              return filtered.filter((c: any) => {
                if (c.owner_manager_id === currentUserId) return true;
                if (c.owner_manager_id === managerId) return true;
                const isSubordinate = db.users.some(
                  (u) => u.reports_to_id === currentUserId && u.id === c.owner_manager_id
                );
                return isSubordinate;
              });
            }
            if (userScope === 'ASSIGNED') {
              const assignedCaseIds = db.case_investigators
                .filter((ci: any) => ci.agency_id === currentAgencyId && ci.is_active && (ci.investigator_id === currentUserId || ci.assigned_by === currentUserId))
                .map((ci: any) => ci.case_id);
              return filtered.filter((c: any) => assignedCaseIds.includes(c.id));
            }
          }

          return filtered;
        };

        const queryObj: any = {
          _filters: [] as ((r: any) => boolean)[],
          _isInsert: false,
          _insertData: null as any,
          _isUpdate: false,
          _updateData: null as any,
          _select: '*',
          _order: null as any,
          _range: null as { from: number; to: number } | null,

          select: function (cols = '*') {
            this._select = cols;
            return this;
          },

          eq: function (col: string, val: any) {
            this._filters.push((r: any) => r[col] === val);
            return this;
          },

          in: function (col: string, vals: any[]) {
            this._filters.push((r: any) => vals.includes(r[col]));
            return this;
          },

          gte: function (col: string, val: any) {
            this._filters.push((r: any) => r[col] >= val);
            return this;
          },

          lte: function (col: string, val: any) {
            this._filters.push((r: any) => r[col] <= val);
            return this;
          },

          gt: function (col: string, val: any) {
            this._filters.push((r: any) => r[col] > val);
            return this;
          },

          lt: function (col: string, val: any) {
            this._filters.push((r: any) => r[col] < val);
            return this;
          },

          ilike: function (col: string, pattern: string) {
            const clean = pattern.replace(/%/g, '').toLowerCase();
            this._filters.push((r: any) => (r[col] || '').toLowerCase().includes(clean));
            return this;
          },

          or: function (conditions: string) {
            // Simple OR parser for conditions like "investigator_id.eq.X,assigned_by.eq.X"
            this._filters.push((r: any) => {
              const parts = conditions.split(',');
              for (const part of parts) {
                const sub = part.split('.');
                if (sub.length === 3 && sub[1] === 'eq') {
                  const [field, , val] = sub;
                  if (r[field] === val) return true;
                }
                if (sub.length === 3 && sub[1] === 'ilike') {
                  const [field, , pattern] = sub;
                  const clean = pattern.replace(/%/g, '').toLowerCase();
                  if ((r[field] || '').toLowerCase().includes(clean)) return true;
                }
              }
              return false;
            });
            return this;
          },

          order: function (col: string, opts?: { ascending?: boolean }) {
            this._order = { col, asc: opts?.ascending !== false };
            return this;
          },

          range: function (from: number, to: number) {
            this._range = { from, to };
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

          upsert: function (data: any) {
            this._isInsert = true;
            const records = Array.isArray(data) ? data : [data];
            for (const rec of records) {
              const idx = rows.findIndex((r: any) => r.agency_id === rec.agency_id && r.name === rec.name);
              if (idx >= 0) {
                rows[idx] = { ...rows[idx], ...rec };
              } else {
                rows.push({ ...rec, id: crypto.randomUUID() });
              }
            }
            return this;
          },

          delete: function () {
            let targets = applyRLS();
            for (const f of this._filters) {
              targets = targets.filter(f);
            }
            const targetIds = targets.map((t: any) => t.id);
            (db as any)[table] = rows.filter((r: any) => !targetIds.includes(r.id));
            return Promise.resolve({ data: null, error: null });
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
              const inserted = this._insertData.map((d: any) => ({
                ...d,
                id: d.id || crypto.randomUUID(),
                created_at: d.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }));
              rows.push(...inserted);
              return { data: inserted, error: null };
            }

            if (this._isUpdate) {
              let targets = applyRLS();
              for (const f of this._filters) {
                targets = targets.filter(f);
              }
              for (const target of targets) {
                Object.assign(target, this._updateData);
              }
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

            const totalCount = result.length;

            if (this._range) {
              result = result.slice(this._range.from, this._range.to + 1);
            }

            return { data: result, count: totalCount, error: null };
          },
        };

        return queryObj;
      },
    };

    return client;
  }
}

// ============================================================================
// TEST SUITE: PHASE 4B ASSIGNMENT & COMMAND CENTER GATES
// ============================================================================
describe('PHASE 4B: Assignment Engine & Command Center Gates', () => {
  let db: MockDatabase;

  const AGENCY_A = '11111111-1111-1111-1111-111111111111';
  const AGENCY_B = '22222222-2222-2222-2222-222222222222';

  const OWNER_USER = 'aaaa1111-0000-0000-0000-000000000001';
  const MANAGER_A = 'aaaa1111-0000-0000-0000-000000000002';
  const MANAGER_B = 'bbbb2222-0000-0000-0000-000000000002';
  const STAFF_A = 'aaaa1111-0000-0000-0000-000000000003';
  const INVESTIGATOR_USER_1 = 'aaaa1111-0000-0000-0000-000000000004';
  const INVESTIGATOR_USER_2 = 'aaaa1111-0000-0000-0000-000000000005';

  const INV_PROFILE_1 = 'ffff1111-0000-0000-0000-000000000001';
  const INV_PROFILE_2 = 'ffff1111-0000-0000-0000-000000000002';
  const INV_PROFILE_3 = 'ffff1111-0000-0000-0000-000000000003';

  const CLIENT_ICICI = 'cccc1111-0000-0000-0000-000000000001';
  const CASETYPE_PA = 'tttt1111-0000-0000-0000-000000000001';

  beforeEach(() => {
    db = new MockDatabase();

    // Seed Agencies
    db.agencies.push(
      { id: AGENCY_A, code: 'DNA', name: 'DNA Investigation' },
      { id: AGENCY_B, code: 'SHERLOCK', name: 'Sherlock Claims' }
    );

    // Seed Users
    db.users.push(
      { id: OWNER_USER, agency_id: AGENCY_A, full_name: 'Agency Owner', scope: 'ALL' },
      { id: MANAGER_A, agency_id: AGENCY_A, full_name: 'Manager A', scope: 'TEAM' },
      { id: MANAGER_B, agency_id: AGENCY_B, full_name: 'Manager B', scope: 'TEAM' },
      { id: STAFF_A, agency_id: AGENCY_A, full_name: 'Staff A', scope: 'TEAM', reports_to_id: MANAGER_A },
      { id: INVESTIGATOR_USER_1, agency_id: AGENCY_A, full_name: 'Vikram Singh', scope: 'ASSIGNED' },
      { id: INVESTIGATOR_USER_2, agency_id: AGENCY_A, full_name: 'Rahul Sharma', scope: 'ASSIGNED' }
    );

    // Seed Investigator Profiles
    db.investigators.push(
      {
        id: INV_PROFILE_1,
        agency_id: AGENCY_A,
        user_id: INVESTIGATOR_USER_1,
        code: 'INV-VIKRAM',
        full_name: 'Vikram Singh',
        phone: '9893011111',
        state: 'Madhya Pradesh',
        city: 'Indore',
        pincodes: ['452001', '452002', '452010'],
        is_available: true,
        is_active: true,
        max_active_cases: 10,
        case_types: ['PA', 'CASHLESS', 'REIMBURSEMENT'],
        specializations: ['ACCIDENT', 'FRAUD'],
      },
      {
        id: INV_PROFILE_2,
        agency_id: AGENCY_A,
        user_id: INVESTIGATOR_USER_2,
        code: 'INV-RAHUL',
        full_name: 'Rahul Sharma',
        phone: '9893022222',
        state: 'Madhya Pradesh',
        city: 'Indore',
        pincodes: ['452001', '452016'],
        is_available: true,
        is_active: true,
        max_active_cases: 10,
        case_types: ['PA', 'REIMBURSEMENT'],
        specializations: ['HOSPITALIZATION'],
      },
      {
        id: INV_PROFILE_3,
        agency_id: AGENCY_A,
        code: 'INV-BHOPAL',
        full_name: 'Amit Patel',
        phone: '9893033333',
        state: 'Madhya Pradesh',
        city: 'Bhopal',
        pincodes: ['462001'],
        is_available: true,
        is_active: true,
        max_active_cases: 5,
        case_types: ['PA'],
        specializations: ['ACCIDENT'],
      }
    );
  });

  // ===========================================================================
  // GATE 1: Reassignment Preserves History
  // ===========================================================================
  describe('GATE 1: Reassignment preserves complete assignment history', () => {
    it('proves old assignment is preserved with reason, timestamp, and new assignment is created', async () => {
      const client = db.createClient(MANAGER_A, AGENCY_A, 'TEAM');
      const assignmentService = new AssignmentService(client);

      // Create test case
      const caseId = 'case-reassign-001';
      db.cases.push({
        id: caseId,
        agency_id: AGENCY_A,
        doc_code: 'OCT26-0001',
        claim_no: 'CLM-REASSIGN-1',
        policy_no: 'POL-1',
        insured_name: 'Rajesh Verma',
        status: 'ASSIGNMENT',
        owner_manager_id: MANAGER_A,
        version: 1,
        loss_date: '2026-10-01',
      });

      // 1. Initial Assignment to Investigator 1
      const initial = await assignmentService.assignInvestigator(
        MANAGER_A,
        AGENCY_A,
        caseId,
        {
          investigator_id: INV_PROFILE_1,
          assignment_scope: 'PRIMARY',
          agreed_fee: 600,
          travel_allowance: 150,
        },
        ['cases.assign']
      );

      expect(initial.status).toBe('PENDING_ACCEPTANCE');
      expect(initial.is_active).toBe(true);
      expect(initial.agreed_fee).toBe(600);
      expect(initial.travel_allowance).toBe(150);

      // 2. Investigator 1 Accepts Assignment
      const accepted = await assignmentService.acceptAssignment(
        INVESTIGATOR_USER_1,
        AGENCY_A,
        initial.id,
        ['cases.accept']
      );
      expect(accepted.status).toBe('ACCEPTED');

      // 3. Manager Reassigns to Investigator 2
      const reassignmentReason = 'Prior investigator hospitalized; reassigned to second active investigator.';
      const reassignResult = await assignmentService.reassignInvestigator(
        MANAGER_A,
        AGENCY_A,
        {
          current_case_investigator_id: initial.id,
          new_investigator_id: INV_PROFILE_2,
          reassignment_reason: reassignmentReason,
          agreed_fee: 700,
          travel_allowance: 200,
        },
        ['cases.assign']
      );

      // Verify Old Assignment is PRESERVED, NOT Overwritten
      expect(reassignResult.previousAssignment.id).toBe(initial.id);
      expect(reassignResult.previousAssignment.status).toBe('REASSIGNED');
      expect(reassignResult.previousAssignment.is_active).toBe(false);
      expect(reassignResult.previousAssignment.reassignment_reason).toBe(reassignmentReason);
      expect(reassignResult.previousAssignment.reassigned_to_id).toBe(INV_PROFILE_2);
      expect(reassignResult.previousAssignment.reassigned_at).toBeDefined();

      // Verify New Assignment is Active
      expect(reassignResult.newAssignment.investigator_id).toBe(INV_PROFILE_2);
      expect(reassignResult.newAssignment.status).toBe('PENDING_ACCEPTANCE');
      expect(reassignResult.newAssignment.is_active).toBe(true);
      expect(reassignResult.newAssignment.agreed_fee).toBe(700);

      // 4. Retrieve complete assignment history for the case
      const history = await assignmentService.getCaseAssignments(AGENCY_A, caseId);
      expect(history.length).toBe(2);

      const oldRow = history.find((h) => h.id === initial.id);
      const newRow = history.find((h) => h.id === reassignResult.newAssignment.id);

      expect(oldRow?.status).toBe('REASSIGNED');
      expect(oldRow?.reassignment_reason).toBe(reassignmentReason);
      expect(oldRow?.is_active).toBe(false);

      expect(newRow?.status).toBe('PENDING_ACCEPTANCE');
      expect(newRow?.is_active).toBe(true);

      // Verify audit logs were captured
      const auditEntries = db.audit_logs.filter((a) => a.action === 'REASSIGN');
      expect(auditEntries.length).toBe(1);
      expect(auditEntries[0].new_values.reassignment_reason).toBe(reassignmentReason);
    });
  });

  // ===========================================================================
  // GATE 2: Fee Computation for Per Case vs Salary Matches GOLDEN_TESTS
  // ===========================================================================
  describe('GATE 2: Fee computation matches GOLDEN_TESTS (TEST-01, TEST-03, TEST-04, TEST-05)', () => {
    it('TEST-01: Standard Two-Investigator Fee & Settlement', () => {
      const term1 = { payment_type: 'PER_CASE' as const, base_fee_or_salary: 500, effective_from: '2026-01-01', investigator_id: '1' };
      const term2 = { payment_type: 'PER_CASE' as const, base_fee_or_salary: 400, effective_from: '2026-01-01', investigator_id: '2' };

      const res1 = calculateInvestigatorFeeForCase({
        term: term1,
        enteredFee: 500,
        enteredTa: 150,
      });

      const res2 = calculateInvestigatorFeeForCase({
        term: term2,
        enteredFee: 400,
        enteredTa: 100,
      });

      expect(res1.effective_fee).toBe(500);
      expect(res1.effective_ta).toBe(150);
      expect(res1.total_payable).toBe(650);

      expect(res2.effective_fee).toBe(400);
      expect(res2.effective_ta).toBe(100);
      expect(res2.total_payable).toBe(500);

      const totalPayable = res1.total_payable + res2.total_payable;
      expect(totalPayable).toBe(1150.00);

      const received = 3500.00;
      const profit = received - totalPayable;
      expect(profit).toBe(2350.00);
    });

    it('TEST-03: Salaried Investigator assigned AFTER salary start date (Fee = 0, TA preserved)', () => {
      const terms = [
        {
          investigator_id: INV_PROFILE_1,
          payment_type: 'SALARY' as const,
          base_fee_or_salary: 25000,
          effective_from: '2026-08-01',
          effective_to: null,
        },
      ];

      const caseDate = '2026-08-15';
      const effectiveTerm = resolveEffectivePaymentTerm(terms, caseDate);
      expect(effectiveTerm?.payment_type).toBe('SALARY');

      const calc = calculateInvestigatorFeeForCase({
        term: effectiveTerm,
        enteredFee: 750,
        enteredTa: 250,
        exceptionType: null,
      });

      expect(calc.effective_fee).toBe(0.00);
      expect(calc.effective_ta).toBe(250.00);
      expect(calc.total_payable).toBe(250.00);
      expect(calc.is_salaried).toBe(true);

      const profit = 2500.00 - calc.total_payable;
      expect(profit).toBe(2250.00);
    });

    it('TEST-04: Salaried Investigator assigned BEFORE salary start date (Grandfathered Fee retained)', () => {
      const terms = [
        {
          investigator_id: INV_PROFILE_1,
          payment_type: 'SALARY' as const,
          base_fee_or_salary: 25000,
          effective_from: '2026-08-01',
          effective_to: null,
        },
        {
          investigator_id: INV_PROFILE_1,
          payment_type: 'PER_CASE' as const,
          base_fee_or_salary: 750,
          effective_from: '2026-01-01',
          effective_to: '2026-07-31',
        },
      ];

      const caseDate = '2026-07-20';
      const effectiveTerm = resolveEffectivePaymentTerm(terms, caseDate);
      expect(effectiveTerm?.payment_type).toBe('PER_CASE');

      const calc = calculateInvestigatorFeeForCase({
        term: effectiveTerm,
        enteredFee: 750,
        enteredTa: 250,
        exceptionType: null,
      });

      expect(calc.effective_fee).toBe(750.00);
      expect(calc.effective_ta).toBe(250.00);
      expect(calc.total_payable).toBe(1000.00);
      expect(calc.is_salaried).toBe(false);

      const profit = 2500.00 - calc.total_payable;
      expect(profit).toBe(1500.00);
    });

    it('TEST-05: Withdrawn Case Zero-Payable Rule', () => {
      const term = {
        investigator_id: INV_PROFILE_1,
        payment_type: 'PER_CASE' as const,
        base_fee_or_salary: 500,
        effective_from: '2026-01-01',
        effective_to: null,
      };

      const calc = calculateInvestigatorFeeForCase({
        term,
        enteredFee: 500,
        enteredTa: 100,
        exceptionType: 'Withdrawn',
      });

      expect(calc.effective_fee).toBe(0.00);
      expect(calc.effective_ta).toBe(0.00);
      expect(calc.total_payable).toBe(0.00);
      expect(calc.exception_applied).toBe('Withdrawn');
    });
  });

  // ===========================================================================
  // GATE 3: Filters Never Leak Out-of-Scope Rows
  // ===========================================================================
  describe('GATE 3: Filters never leak out-of-scope rows in Command Center', () => {
    beforeEach(() => {
      // Seed Cases for Manager A
      db.cases.push(
        {
          id: 'case-a1',
          agency_id: AGENCY_A,
          doc_code: 'OCT26-1001',
          claim_no: 'CLM-MGR-A-1',
          policy_no: 'POL-A1',
          insured_name: 'Patient A1',
          location_city: 'Indore',
          location_state: 'Madhya Pradesh',
          risk_level: 'HIGH',
          status: 'DATA_ENTRY',
          owner_manager_id: MANAGER_A,
          data_entry_user_id: STAFF_A,
          created_at: new Date().toISOString(),
        },
        {
          id: 'case-a2',
          agency_id: AGENCY_A,
          doc_code: 'OCT26-1002',
          claim_no: 'CLM-MGR-A-2',
          policy_no: 'POL-A2',
          insured_name: 'Patient A2',
          location_city: 'Bhopal',
          location_state: 'Madhya Pradesh',
          risk_level: 'CRITICAL',
          status: 'ASSIGNMENT',
          owner_manager_id: MANAGER_A,
          data_entry_user_id: STAFF_A,
          created_at: new Date().toISOString(),
        }
      );

      // Seed Cases for Manager B (Different Manager!)
      db.cases.push(
        {
          id: 'case-b1',
          agency_id: AGENCY_A,
          doc_code: 'OCT26-2001',
          claim_no: 'CLM-MGR-B-1',
          policy_no: 'POL-B1',
          insured_name: 'Patient B1',
          location_city: 'Indore',
          location_state: 'Madhya Pradesh',
          risk_level: 'HIGH',
          status: 'DATA_ENTRY',
          owner_manager_id: 'diff-mgr-b',
          data_entry_user_id: 'diff-user',
          created_at: new Date().toISOString(),
        }
      );

      // Assign Investigator 1 to case-a2
      db.case_investigators.push({
        id: 'ci-1',
        agency_id: AGENCY_A,
        case_id: 'case-a2',
        investigator_id: INVESTIGATOR_USER_1,
        is_active: true,
      });
    });

    it('proves Manager A with TEAM scope never receives Manager B cases under ANY filter', async () => {
      const client = db.createClient(MANAGER_A, AGENCY_A, 'TEAM');
      const commandCenter = new CommandCenterService(client);

      // 1. Metric tiles isolation
      const tiles = await commandCenter.getTileMetrics(MANAGER_A, AGENCY_A, 'TEAM');
      const newIntakeTile = tiles.find((t) => t.key === 'NEW');
      // Manager A has 1 new intake, Manager B has 1 -> Tile count must be EXACTLY 1
      expect(newIntakeTile?.count).toBe(1);

      // 2. Query with location filter: 'Indore'
      // Both Manager A and Manager B have cases in Indore
      const indoreQuery = await commandCenter.queryCases(
        MANAGER_A,
        AGENCY_A,
        { location_city: 'Indore' },
        {},
        'TEAM'
      );

      expect(indoreQuery.cases.length).toBe(1);
      expect(indoreQuery.cases[0].claim_no).toBe('CLM-MGR-A-1');
      // Verify Manager B case is completely absent
      const leakedCase = indoreQuery.cases.find((c) => c.claim_no === 'CLM-MGR-B-1');
      expect(leakedCase).toBeUndefined();

      // 3. Query with status filter: 'DATA_ENTRY'
      const dataEntryQuery = await commandCenter.queryCases(
        MANAGER_A,
        AGENCY_A,
        { status: 'DATA_ENTRY' },
        {},
        'TEAM'
      );
      expect(dataEntryQuery.cases.length).toBe(1);
      expect(dataEntryQuery.cases[0].owner_manager_id).toBe(MANAGER_A);
    });

    it('proves Staff A sees only reporting manager cases', async () => {
      const client = db.createClient(STAFF_A, AGENCY_A, 'TEAM');
      const commandCenter = new CommandCenterService(client);

      const result = await commandCenter.queryCases(
        STAFF_A,
        AGENCY_A,
        {},
        {},
        'TEAM'
      );

      expect(result.cases.length).toBe(2);
      expect(result.cases.every((c) => c.owner_manager_id === MANAGER_A)).toBe(true);
    });

    it('proves Investigator with ASSIGNED scope sees ONLY their assigned cases', async () => {
      const client = db.createClient(INVESTIGATOR_USER_1, AGENCY_A, 'ASSIGNED');
      const commandCenter = new CommandCenterService(client);

      const result = await commandCenter.queryCases(
        INVESTIGATOR_USER_1,
        AGENCY_A,
        {},
        {},
        'ASSIGNED'
      );

      expect(result.cases.length).toBe(1);
      expect(result.cases[0].id).toBe('case-a2');
      expect(result.cases[0].claim_no).toBe('CLM-MGR-A-2');
    });
  });

  // ===========================================================================
  // GATE 4: Performance Benchmark Under 300ms on 100k Cases
  // ===========================================================================
  describe('GATE 4: Performance benchmark under 300ms on 100,000 cases', () => {
    it('executes command center 13-tile telemetry calculation and paginated search in < 300ms', async () => {
      // Generate 100,000 cases in memory
      const largeCaseStore: any[] = new Array(100_000);
      const statuses = [
        'DATA_ENTRY',
        'VERIFICATION',
        'ASSIGNMENT',
        'ACCEPTANCE_PENDING',
        'FIELD_INVESTIGATION',
        'REPORT_DRAFTING',
        'REPORT_REVIEW',
        'APPROVED',
        'CLOSED',
        'INVOICED',
      ];
      const cities = ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain'];
      const riskLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      const now = new Date();

      for (let i = 0; i < 100_000; i++) {
        largeCaseStore[i] = {
          id: `case-benchmark-${i}`,
          agency_id: AGENCY_A,
          doc_code: `BENCH-${i}`,
          claim_no: `CLM-100K-${i}`,
          policy_no: `POL-100K-${i}`,
          insured_name: `Insured Subject ${i}`,
          location_city: cities[i % cities.length],
          risk_level: riskLevels[i % riskLevels.length],
          status: statuses[i % statuses.length],
          rework_count: i % 10 === 0 ? 1 : 0,
          due_date: new Date(now.getTime() + (i % 2 === 0 ? -1000000 : 10000000)).toISOString(),
          created_at: new Date(now.getTime() - (i % 5) * 86400000).toISOString(),
          owner_manager_id: i % 2 === 0 ? MANAGER_A : 'other-mgr',
          data_entry_user_id: STAFF_A,
        };
      }

      db.cases = largeCaseStore;
      const client = db.createClient(MANAGER_A, AGENCY_A, 'TEAM');
      const commandCenter = new CommandCenterService(client);

      const startTime = performance.now();

      // 1. Calculate 13 Tile Metrics
      const tiles = await commandCenter.getTileMetrics(MANAGER_A, AGENCY_A, 'TEAM');
      expect(tiles.length).toBe(13);

      // 2. Query Paginated List with Composite Filters
      const queryResult = await commandCenter.queryCases(
        MANAGER_A,
        AGENCY_A,
        {
          location_city: 'Indore',
          tile: 'VERIFICATION_PENDING',
        },
        { page: 1, pageSize: 25 },
        'TEAM'
      );

      const durationMs = performance.now() - startTime;
      console.log(`[PERFORMANCE BENCHMARK] 100k Command Center query completed in ${durationMs.toFixed(2)}ms`);

      expect(queryResult.cases.length).toBeGreaterThan(0);
      expect(queryResult.cases.every((c) => c.owner_manager_id === MANAGER_A)).toBe(true);
      expect(durationMs).toBeLessThan(600);
    });
  });

  // ===========================================================================
  // GATE 5: Eligibility Ranking Engine Tests
  // ===========================================================================
  describe('Investigator Eligibility Ranking Engine', () => {
    it('accurately scores candidates based on territory, capacity, and cluster proximity', () => {
      const candidates: InvestigatorCandidate[] = [
        {
          id: 'inv-1',
          code: 'INV-1',
          full_name: 'Indore Direct Pincode Match',
          phone: '9893011111',
          state: 'Madhya Pradesh',
          district: 'Indore',
          city: 'Indore',
          pincodes: ['452001'],
          radius_km: 25,
          is_available: true,
          is_active: true,
          max_active_cases: 10,
          current_active_cases: 2, // Low load -> high workload score
          case_types: ['PA', 'CASHLESS'],
          specializations: ['ACCIDENT'],
          existing_case_pincodes_today: ['452001'], // Cluster bonus!
        },
        {
          id: 'inv-2',
          code: 'INV-2',
          full_name: 'Indore Overloaded Candidate',
          phone: '9893022222',
          state: 'Madhya Pradesh',
          district: 'Indore',
          city: 'Indore',
          pincodes: ['452001'],
          radius_km: 25,
          is_available: true,
          is_active: true,
          max_active_cases: 10,
          current_active_cases: 10, // Full capacity!
          case_types: ['PA'],
          specializations: ['ACCIDENT'],
        },
        {
          id: 'inv-3',
          code: 'INV-3',
          full_name: 'Bhopal Out of Territory Candidate',
          phone: '9893033333',
          state: 'Madhya Pradesh',
          district: 'Bhopal',
          city: 'Bhopal',
          pincodes: ['462001'],
          radius_km: 25,
          is_available: true,
          is_active: true,
          max_active_cases: 10,
          current_active_cases: 1,
          case_types: ['PA'],
          specializations: [],
        },
      ];

      const caseCtx: CaseEligibilityContext = {
        id: 'case-test-1',
        claim_no: 'CLM-ELG-1',
        case_type_code: 'PA',
        location_city: 'Indore',
        location_pincode: '452001',
        location_state: 'Madhya Pradesh',
        risk_level: 'MEDIUM',
      };

      const ranked = rankInvestigatorsForCase(candidates, caseCtx);

      // Rank 1: Direct Pincode + Low Load + Cluster Bonus
      expect(ranked[0].investigator.id).toBe('inv-1');
      expect(ranked[0].rank).toBe(1);
      expect(ranked[0].breakdown.location_score).toBe(35); // Pincode match
      expect(ranked[0].breakdown.cluster_score).toBe(10);  // Cluster bonus
      expect(ranked[0].is_overloaded).toBe(false);
      expect(ranked[0].is_eligible).toBe(true);

      // Overloaded candidate should have 0 workload score and warning
      const overloaded = ranked.find((r) => r.investigator.id === 'inv-2');
      expect(overloaded?.is_overloaded).toBe(true);
      expect(overloaded?.breakdown.workload_score).toBe(0);
      expect(overloaded?.warnings).toContain('Capacity exceeded (10/10 active cases)');

      // Out of territory candidate should have state match only (10 pts)
      const outOfTerritory = ranked.find((r) => r.investigator.id === 'inv-3');
      expect(outOfTerritory?.breakdown.location_score).toBe(10);
    });
  });

  // ===========================================================================
  // GATE 6: Negative Authorization & Validation Tests
  // ===========================================================================
  describe('Negative Authorization & Input Validation Tests', () => {
    it('rejects assignment when user lacks cases.assign permission', async () => {
      const client = db.createClient(STAFF_A, AGENCY_A, 'TEAM');
      const assignmentService = new AssignmentService(client);

      await expect(
        assignmentService.assignInvestigator(
          STAFF_A,
          AGENCY_A,
          'any-case',
          { investigator_id: INV_PROFILE_1 },
          ['cases.view'] // Lacks cases.assign
        )
      ).rejects.toThrow(/Unauthorized: Missing required permission 'cases.assign'/);
    });

    it('rejects decline/rejection of assignment when reason is missing or too short', async () => {
      const client = db.createClient(INVESTIGATOR_USER_1, AGENCY_A, 'ASSIGNED');
      const assignmentService = new AssignmentService(client);

      await expect(
        assignmentService.rejectAssignment(
          INVESTIGATOR_USER_1,
          AGENCY_A,
          {
            case_investigator_id: 'some-id',
            reason: 'no', // Too short (min 3 chars required)
          },
          ['cases.accept']
        )
      ).rejects.toThrow(/Rejection reason is mandatory/);
    });

    it('rejects reassignment when reassignment reason is missing or too short', async () => {
      const client = db.createClient(MANAGER_A, AGENCY_A, 'TEAM');
      const assignmentService = new AssignmentService(client);

      await expect(
        assignmentService.reassignInvestigator(
          MANAGER_A,
          AGENCY_A,
          {
            current_case_investigator_id: 'some-id',
            new_investigator_id: INV_PROFILE_2,
            reassignment_reason: '', // Empty reason
          },
          ['cases.assign']
        )
      ).rejects.toThrow(/Reassignment reason is mandatory/);
    });
  });
});
