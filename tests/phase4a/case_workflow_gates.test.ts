import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { CasesService } from '@/modules/cases/service';
import {
  validateTransition,
  isValidTransition,
  validateOutcome,
  resolveExceptionFinancialRule,
  WORKFLOW_TRANSITIONS,
} from '@/modules/workflow/engine';
import { RbacService } from '@/modules/rbac/service';

// =============================================================================
// PHASE 4A MOCK DATABASE WITH WORKFLOW TRIGGER & OPTIMISTIC CONCURRENCY
// =============================================================================
class Phase4AMockDatabase {
  agencies: any[] = [];
  agency_doc_sequences: any[] = [];
  users: any[] = [];
  user_roles: any[] = [];
  roles: any[] = [];
  clients: any[] = [];
  case_types: any[] = [];
  manager_scopes: any[] = [];
  cases: any[] = [];
  case_investigators: any[] = [];
  case_status_history: any[] = [];
  case_notes: any[] = [];
  case_tasks: any[] = [];
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

        // RLS enforcement: filter by currentAgencyId and caller scope
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
                // Subordinate check
                const isSubordinate = db.users.some(
                  (u) => u.reports_to_id === currentUserId && u.id === c.owner_manager_id
                );
                return isSubordinate;
              });
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

          upsert: function (data: any) {
            this._isInsert = true;
            const records = Array.isArray(data) ? data : [data];
            for (const rec of records) {
              const idx = rows.findIndex(
                (r: any) => r.agency_id === rec.agency_id && r.year_month === rec.year_month
              );
              if (idx >= 0) {
                rows[idx] = { ...rows[idx], ...rec };
              } else {
                rows.push({ ...rec, id: crypto.randomUUID() });
              }
            }
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
            if (this._isInsert && this._insertData) {
              const inserted = this._insertData.map((d: any) => {
                // DB Level Unique Constraint Check for Cases: (agency_id, client_id, normalized_claim_no)
                if (table === 'cases') {
                  const norm = d.normalized_claim_no || d.claim_no?.trim().toUpperCase();
                  const dup = db.cases.find(
                    (c) =>
                      c.agency_id === d.agency_id &&
                      c.client_id === d.client_id &&
                      c.normalized_claim_no === norm
                  );
                  if (dup) {
                    throw new Error(
                      `duplicate key value violates unique constraint "uq_agency_client_normalized_claim"`
                    );
                  }
                }

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

              for (const target of targets) {
                // DB TRIGGER SIMULATION 1: Validate Status Transition & Concurrency on Cases table
                if (table === 'cases' && this._updateData.status && this._updateData.status !== target.status) {
                  const allowed = WORKFLOW_TRANSITIONS.some(
                    (t) => t.from === target.status && t.to === this._updateData.status
                  );
                  if (!allowed) {
                    throw new Error(
                      `Illegal status transition from '${target.status}' to '${this._updateData.status}' is not allowed.`
                    );
                  }

                  // Optimistic Locking Trigger Check
                  if (this._updateData.version !== target.version + 1) {
                    throw new Error(
                      `Concurrent modification error: Expected version ${target.version} to advance to ${
                        target.version + 1
                      }, got ${this._updateData.version}`
                    );
                  }
                }

                // DB TRIGGER SIMULATION 2: Enforce Data Entry Lock After Verification
                if (
                  table === 'cases' &&
                  target.status !== 'DATA_ENTRY' &&
                  target.status !== 'VERIFICATION'
                ) {
                  const currentUser = db.users.find((u) => u.id === currentUserId);
                  if (currentUser?.scope === 'OWN_ENTERED') {
                    if (
                      (this._updateData.insured_name && this._updateData.insured_name !== target.insured_name) ||
                      (this._updateData.claim_no && this._updateData.claim_no !== target.claim_no)
                    ) {
                      throw new Error(
                        `A9 Violation: Data entry cannot edit case after verification (current status: ${target.status}).`
                      );
                    }
                  }
                }

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
            if (this._limit) {
              result = result.slice(0, this._limit);
            }

            // Hydrations
            if (table === 'cases' && this._select?.includes('clients(*)')) {
              result = result.map((c: any) => ({
                ...c,
                clients: db.clients.find((cl) => cl.id === c.client_id),
                case_types: db.case_types.find((ct) => ct.id === c.case_type_id),
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
// PHASE 4A TESTS: CASE CORE & WORKFLOW ENGINE GATES
// =============================================================================
describe('PHASE 4A: CASE CORE & WORKFLOW ENGINE GATES', () => {
  let db: Phase4AMockDatabase;

  const AGENCY_A = 'a1111111-1111-4111-8111-111111111111';
  const AGENCY_B = 'b2222222-2222-4222-8222-222222222222';

  const OWNER_USER = 'c3333333-3333-4333-8333-333333333333';
  const MANAGER_A = 'd4444444-4444-4444-8444-444444444444';
  const MANAGER_B = 'e5555555-5555-4555-8555-555555555555';
  const STAFF_A = 'f6666666-6666-4666-8666-666666666666';
  const DATA_ENTRY_USER = '77777777-7777-4777-8777-777777777777';

  const CLIENT_ICICI = '88888888-8888-4888-8888-888888888888';
  const CLIENT_HDFC = '99999999-9999-4999-8999-999999999999';
  const CASETYPE_THEFT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeEach(() => {
    db = new Phase4AMockDatabase();

    db.agencies.push(
      { id: AGENCY_A, name: 'DNA Investigation Agency', code: 'DNA' },
      { id: AGENCY_B, name: 'Apex Claims', code: 'APEX' }
    );

    db.users.push(
      { id: OWNER_USER, agency_id: AGENCY_A, full_name: 'Agency Owner', scope: 'ALL', is_active: true },
      { id: MANAGER_A, agency_id: AGENCY_A, full_name: 'Manager North', scope: 'TEAM', is_active: true },
      { id: MANAGER_B, agency_id: AGENCY_A, full_name: 'Manager South', scope: 'TEAM', is_active: true },
      { id: STAFF_A, agency_id: AGENCY_A, full_name: 'Investigator Staff', reports_to_id: MANAGER_A, scope: 'TEAM', is_active: true },
      { id: DATA_ENTRY_USER, agency_id: AGENCY_A, full_name: 'Data Entry Operator', scope: 'OWN_ENTERED', is_active: true }
    );

    db.clients.push(
      { id: CLIENT_ICICI, agency_id: AGENCY_A, name: 'ICICI Lombard', code: 'ICICI' },
      { id: CLIENT_HDFC, agency_id: AGENCY_A, name: 'HDFC ERGO', code: 'HDFC' }
    );

    db.case_types.push({
      id: CASETYPE_THEFT,
      agency_id: AGENCY_A,
      name: 'Vehicle Theft',
      code: 'THEFT',
      custom_field_definitions: [
        { name: 'fir_no', label: 'FIR Number', type: 'text', required: true },
        { name: 'vehicle_reg', label: 'Registration No', type: 'text', required: false },
      ],
    });

    db.manager_scopes.push({
      id: crypto.randomUUID(),
      agency_id: AGENCY_A,
      manager_id: MANAGER_A,
      client_id: CLIENT_ICICI,
      case_type: 'THEFT',
      is_default: true,
    });
  });

  // ===========================================================================
  // GATE 1: Illegal Transitions Rejected at DB & Engine Level
  // ===========================================================================
  describe('GATE 1: Illegal transitions rejected at DB & Engine level', () => {
    it('rejects illegal status jumps directly (e.g., DATA_ENTRY -> CLOSED or VERIFICATION -> INVOICED)', async () => {
      const client = db.createClient(OWNER_USER, AGENCY_A);
      const service = new CasesService(client);

      const created = await service.createCase(DATA_ENTRY_USER, AGENCY_A, {
        client_id: CLIENT_ICICI,
        case_type_id: CASETYPE_THEFT,
        claim_no: 'CLM-GATE1-001',
        policy_no: 'POL-GATE1',
        insured_name: 'Ajay Verma',
        custom_fields: { fir_no: 'FIR-12345' },
      });

      expect(created.status).toBe('DATA_ENTRY');
      expect(created.version).toBe(1);

      // Attempt illegal transition: DATA_ENTRY -> CLOSED
      await expect(
        service.transitionCase(OWNER_USER, AGENCY_A, created.id, ['cases.create', 'cases.close'], {
          target_status: 'CLOSED',
          current_version: 1,
        })
      ).rejects.toThrow(/Illegal status transition from 'DATA_ENTRY' to 'CLOSED'/);

      // Attempt illegal transition: DATA_ENTRY -> INVOICED
      await expect(
        service.transitionCase(OWNER_USER, AGENCY_A, created.id, ['invoices.generate'], {
          target_status: 'INVOICED',
          current_version: 1,
        })
      ).rejects.toThrow(/Illegal status transition from 'DATA_ENTRY' to 'INVOICED'/);

      // Direct DB update attempt should also be rejected by trigger simulation
      await expect(
        client
          .from('cases')
          .update({ status: 'CLOSED', version: 2 })
          .eq('id', created.id)
      ).rejects.toThrow(/Illegal status transition from 'DATA_ENTRY' to 'CLOSED'/);
    });

    it('enforces mandatory reason on send-back transitions and declination', async () => {
      const client = db.createClient(OWNER_USER, AGENCY_A);
      const service = new CasesService(client);

      const created = await service.createCase(DATA_ENTRY_USER, AGENCY_A, {
        client_id: CLIENT_ICICI,
        case_type_id: CASETYPE_THEFT,
        claim_no: 'CLM-GATE1-002',
        policy_no: 'POL-GATE1',
        insured_name: 'Sunil Sharma',
        custom_fields: { fir_no: 'FIR-5566' },
      });

      // Valid transition 1: DATA_ENTRY -> VERIFICATION
      const vCase = await service.transitionCase(DATA_ENTRY_USER, AGENCY_A, created.id, ['cases.create'], {
        target_status: 'VERIFICATION',
        current_version: 1,
      });
      expect(vCase.status).toBe('VERIFICATION');

      // Attempt send-back to DATA_ENTRY WITHOUT reason -> Rejected!
      await expect(
        service.transitionCase(OWNER_USER, AGENCY_A, created.id, ['cases.verify'], {
          target_status: 'DATA_ENTRY',
          current_version: vCase.version,
          reason: '', // Empty reason
        })
      ).rejects.toThrow(/Reason is required for status transition/);

      // Send-back WITH reason -> Succeeds!
      const sendBackCase = await service.transitionCase(
        OWNER_USER,
        AGENCY_A,
        created.id,
        ['cases.verify'],
        {
          target_status: 'DATA_ENTRY',
          current_version: vCase.version,
          reason: 'Missing original FIR copy from police station.',
        }
      );
      expect(sendBackCase.status).toBe('DATA_ENTRY');
      expect(sendBackCase.version).toBe(3);
    });

    it('auto-escalates to ESCALATED_REVIEW when rework_count reaches 3', () => {
      // 1st rework: 0 -> 1 (stays REPORT_DRAFTING)
      const res1 = validateTransition({
        fromStatus: 'REPORT_REVIEW',
        toStatus: 'REPORT_DRAFTING',
        reason: 'Typo in findings',
        userPermissions: ['reports.review'],
        currentVersion: 5,
        currentReworkCount: 0,
      });
      expect(res1.resolvedNextStatus).toBe('REPORT_DRAFTING');
      expect(res1.nextReworkCount).toBe(1);
      expect(res1.isEscalated).toBe(false);

      // 2nd rework: 1 -> 2 (stays REPORT_DRAFTING)
      const res2 = validateTransition({
        fromStatus: 'REPORT_REVIEW',
        toStatus: 'REPORT_DRAFTING',
        reason: 'Incomplete witness interview',
        userPermissions: ['reports.review'],
        currentVersion: 6,
        currentReworkCount: 1,
      });
      expect(res2.resolvedNextStatus).toBe('REPORT_DRAFTING');
      expect(res2.nextReworkCount).toBe(2);
      expect(res2.isEscalated).toBe(false);

      // 3rd rework: 2 -> 3 (AUTO-ESCALATES to ESCALATED_REVIEW per WORKFLOW.md)
      const res3 = validateTransition({
        fromStatus: 'REPORT_REVIEW',
        toStatus: 'REPORT_DRAFTING',
        reason: 'Discrepancy in hospital bill total',
        userPermissions: ['reports.review'],
        currentVersion: 7,
        currentReworkCount: 2,
      });
      expect(res3.resolvedNextStatus).toBe('ESCALATED_REVIEW');
      expect(res3.nextReworkCount).toBe(3);
      expect(res3.isEscalated).toBe(true);
    });
  });

  // ===========================================================================
  // GATE 2: Concurrent Transition Test (Optimistic Locking: Only One Wins)
  // ===========================================================================
  describe('GATE 2: Concurrent transition test (Optimistic Locking: Only One Wins)', () => {
    it('proves that two callers acting on version 1 results in exactly ONE winner and ONE rejection', async () => {
      const client = db.createClient(OWNER_USER, AGENCY_A);
      const service = new CasesService(client);

      const caseRow = await service.createCase(DATA_ENTRY_USER, AGENCY_A, {
        client_id: CLIENT_ICICI,
        case_type_id: CASETYPE_THEFT,
        claim_no: 'CLM-CONCUR-001',
        policy_no: 'POL-CONCUR',
        insured_name: 'Vikram Rajput',
        custom_fields: { fir_no: 'FIR-CONCUR' },
      });

      expect(caseRow.version).toBe(1);
      expect(caseRow.status).toBe('DATA_ENTRY');

      // Caller 1 advances case to VERIFICATION with current_version: 1
      const winner = await service.transitionCase(
        DATA_ENTRY_USER,
        AGENCY_A,
        caseRow.id,
        ['cases.create'],
        {
          target_status: 'VERIFICATION',
          current_version: 1,
        }
      );

      expect(winner.status).toBe('VERIFICATION');
      expect(winner.version).toBe(2);

      // Caller 2 attempts concurrent transition with stale current_version: 1
      await expect(
        service.transitionCase(
          OWNER_USER,
          AGENCY_A,
          caseRow.id,
          ['cases.withdraw'],
          {
            target_status: 'WITHDRAWN',
            current_version: 1, // Stale version!
            reason: 'Insurer recalled case',
          }
        )
      ).rejects.toThrow(/Concurrent modification/);

      // Verify DB case state is clean: winner's status remains, version is 2
      const finalCase = await service.getCaseById(AGENCY_A, caseRow.id);
      expect(finalCase.status).toBe('VERIFICATION');
      expect(finalCase.version).toBe(2);
    });
  });

  // ===========================================================================
  // GATE 3: Duplicate Claim Rejected incl. Case & Whitespace Variants
  // ===========================================================================
  describe('GATE 3: Duplicate claim rejected incl. case/whitespace variants', () => {
    it('enforces uniqueness on (agency_id, client_id, normalized_claim_no) rejecting all case & whitespace variants', async () => {
      const client = db.createClient(OWNER_USER, AGENCY_A);
      const service = new CasesService(client);

      // 1. Initial creation
      const original = await service.createCase(DATA_ENTRY_USER, AGENCY_A, {
        client_id: CLIENT_ICICI,
        case_type_id: CASETYPE_THEFT,
        claim_no: 'CLM-2026-98124',
        policy_no: 'POL-100',
        insured_name: 'Ramesh Patel',
        custom_fields: { fir_no: 'FIR-001' },
      });
      expect(original.doc_code).toBeDefined();

      // 2. Exact match attempt -> Rejected!
      await expect(
        service.createCase(DATA_ENTRY_USER, AGENCY_A, {
          client_id: CLIENT_ICICI,
          case_type_id: CASETYPE_THEFT,
          claim_no: 'CLM-2026-98124',
          policy_no: 'POL-200',
          insured_name: 'Another Name',
          custom_fields: { fir_no: 'FIR-002' },
        })
      ).rejects.toThrow(/Duplicate claim rejected/);

      // 3. Lowercase variant: "clm-2026-98124" -> Rejected!
      await expect(
        service.createCase(DATA_ENTRY_USER, AGENCY_A, {
          client_id: CLIENT_ICICI,
          case_type_id: CASETYPE_THEFT,
          claim_no: 'clm-2026-98124',
          policy_no: 'POL-300',
          insured_name: 'Another Name',
          custom_fields: { fir_no: 'FIR-003' },
        })
      ).rejects.toThrow(/Duplicate claim rejected/);

      // 4. Whitespace variant: "  CLM-2026-98124   " -> Rejected!
      await expect(
        service.createCase(DATA_ENTRY_USER, AGENCY_A, {
          client_id: CLIENT_ICICI,
          case_type_id: CASETYPE_THEFT,
          claim_no: '   CLM-2026-98124   ',
          policy_no: 'POL-400',
          insured_name: 'Another Name',
          custom_fields: { fir_no: 'FIR-004' },
        })
      ).rejects.toThrow(/Duplicate claim rejected/);

      // 5. Mixed case and whitespace: "  clm-2026-98124 \t" -> Rejected!
      await expect(
        service.createCase(DATA_ENTRY_USER, AGENCY_A, {
          client_id: CLIENT_ICICI,
          case_type_id: CASETYPE_THEFT,
          claim_no: '  clm-2026-98124 \t',
          policy_no: 'POL-500',
          insured_name: 'Another Name',
          custom_fields: { fir_no: 'FIR-005' },
        })
      ).rejects.toThrow(/Duplicate claim rejected/);

      // 6. Positive check: SAME claim number for a DIFFERENT client (HDFC) is ALLOWED
      const hdfcCase = await service.createCase(DATA_ENTRY_USER, AGENCY_A, {
        client_id: CLIENT_HDFC,
        case_type_id: CASETYPE_THEFT,
        claim_no: 'CLM-2026-98124',
        policy_no: 'POL-HDFC-1',
        insured_name: 'Ramesh Patel',
        custom_fields: { fir_no: 'FIR-HDFC' },
      });
      expect(hdfcCase.id).toBeDefined();

      // 7. Positive check: SAME claim number for a DIFFERENT agency (Agency B) is ALLOWED
      const clientB = db.createClient(OWNER_USER, AGENCY_B);
      const serviceB = new CasesService(clientB);
      db.clients.push({ id: 'client-b1', agency_id: AGENCY_B, name: 'ICICI Agency B', code: 'ICICI' });
      db.case_types.push({ id: 'casetype-b1', agency_id: AGENCY_B, name: 'Theft B', code: 'THEFT' });

      const agencyBCase = await serviceB.createCase(OWNER_USER, AGENCY_B, {
        client_id: 'client-b1',
        case_type_id: 'casetype-b1',
        claim_no: 'CLM-2026-98124',
        policy_no: 'POL-B',
        insured_name: 'Ramesh Patel',
      });
      expect(agencyBCase.id).toBeDefined();
    });
  });

  // ===========================================================================
  // GATE 4: Data Entry Cannot Edit After VERIFIED
  // ===========================================================================
  describe('GATE 4: Data entry cannot edit after VERIFIED', () => {
    it('allows data entry to edit in DATA_ENTRY status, but blocks updates once verified/assigned', async () => {
      const clientDataEntry = db.createClient(DATA_ENTRY_USER, AGENCY_A, 'OWN_ENTERED');
      const serviceDataEntry = new CasesService(clientDataEntry);

      const clientManager = db.createClient(MANAGER_A, AGENCY_A, 'TEAM');
      const serviceManager = new CasesService(clientManager);

      // 1. Data entry creates case
      const created = await serviceDataEntry.createCase(DATA_ENTRY_USER, AGENCY_A, {
        client_id: CLIENT_ICICI,
        case_type_id: CASETYPE_THEFT,
        claim_no: 'CLM-LOCK-001',
        policy_no: 'POL-LOCK',
        insured_name: 'Original Insured Name',
        custom_fields: { fir_no: 'FIR-ORIGINAL' },
      });
      expect(created.status).toBe('DATA_ENTRY');

      // 2. Data entry edits own case while in DATA_ENTRY status -> SUCCEEDS
      const updated = await serviceDataEntry.updateCase(
        DATA_ENTRY_USER,
        AGENCY_A,
        created.id,
        {
          version: 1,
          insured_name: 'Corrected Insured Name',
        },
        'OWN_ENTERED'
      );
      expect(updated.insured_name).toBe('Corrected Insured Name');
      expect(updated.version).toBe(2);

      // 3. Move case to VERIFICATION
      await serviceDataEntry.transitionCase(DATA_ENTRY_USER, AGENCY_A, created.id, ['cases.create'], {
        target_status: 'VERIFICATION',
        current_version: 2,
      });

      // 4. Back-office / Manager sends back case from VERIFICATION to DATA_ENTRY with reason -> UNLOCKS case
      await serviceManager.transitionCase(MANAGER_A, AGENCY_A, created.id, ['cases.verify'], {
        target_status: 'DATA_ENTRY',
        current_version: 3,
        reason: 'Policy copy illegible, please re-scan.',
      });

      // 5. Data entry can now edit again! -> SUCCEEDS
      const unlockedEdit = await serviceDataEntry.updateCase(
        DATA_ENTRY_USER,
        AGENCY_A,
        created.id,
        {
          version: 4,
          insured_name: 'Successfully Corrected After Send-Back',
        },
        'OWN_ENTERED'
      );
      expect(unlockedEdit.insured_name).toBe('Successfully Corrected After Send-Back');
      expect(unlockedEdit.version).toBe(5);

      // 6. Resubmit to VERIFICATION
      await serviceDataEntry.transitionCase(DATA_ENTRY_USER, AGENCY_A, created.id, ['cases.create'], {
        target_status: 'VERIFICATION',
        current_version: 5,
      });

      // 7. Manager verifies and routes case to ASSIGNMENT
      const assigned = await serviceManager.transitionCase(
        MANAGER_A,
        AGENCY_A,
        created.id,
        ['cases.verify'],
        {
          target_status: 'ASSIGNMENT',
          current_version: 6,
        }
      );
      expect(assigned.status).toBe('ASSIGNMENT');
      expect(assigned.version).toBe(7);

      // 8. Data entry attempts to edit case after verification -> REJECTED!
      await expect(
        serviceDataEntry.updateCase(
          DATA_ENTRY_USER,
          AGENCY_A,
          created.id,
          {
            version: 7,
            insured_name: 'Unauthorized Post-Verification Change',
          },
          'OWN_ENTERED'
        )
      ).rejects.toThrow(/A9 Violation: Data entry cannot edit case after verification/);
    });
  });

  // ===========================================================================
  // GATE 5: Scope Rules from Phase 2 Hold on Real Cases
  // ===========================================================================
  describe('GATE 5: Scope rules from Phase 2 hold on real cases', () => {
    it('proves Manager A sees only Manager A cases, Staff A sees their manager cases, and Owner sees ALL', async () => {
      const clientOwner = db.createClient(OWNER_USER, AGENCY_A, 'ALL');
      const serviceOwner = new CasesService(clientOwner);

      // Case 1: Owned by Manager A
      const caseA = await serviceOwner.createCase(DATA_ENTRY_USER, AGENCY_A, {
        client_id: CLIENT_ICICI,
        case_type_id: CASETYPE_THEFT,
        claim_no: 'CLM-MGR-A',
        policy_no: 'POL-A',
        insured_name: 'Patient A',
        owner_manager_id: MANAGER_A,
        custom_fields: { fir_no: 'FIR-A' },
      });

      // Case 2: Owned by Manager B
      const caseB = await serviceOwner.createCase(DATA_ENTRY_USER, AGENCY_A, {
        client_id: CLIENT_ICICI,
        case_type_id: CASETYPE_THEFT,
        claim_no: 'CLM-MGR-B',
        policy_no: 'POL-B',
        insured_name: 'Patient B',
        owner_manager_id: MANAGER_B,
        custom_fields: { fir_no: 'FIR-B' },
      });

      // 1. Manager A (TEAM scope) queries cases
      const clientMgrA = db.createClient(MANAGER_A, AGENCY_A, 'TEAM');
      const serviceMgrA = new CasesService(clientMgrA);
      const listMgrA = await serviceMgrA.listCases(AGENCY_A);
      expect(listMgrA.some((c: any) => c.id === caseA.id)).toBe(true);
      expect(listMgrA.some((c: any) => c.id === caseB.id)).toBe(false);

      // 2. Staff A (TEAM scope, reports to Manager A) queries cases
      const clientStaffA = db.createClient(STAFF_A, AGENCY_A, 'TEAM');
      const serviceStaffA = new CasesService(clientStaffA);
      const listStaffA = await serviceStaffA.listCases(AGENCY_A);
      expect(listStaffA.some((c: any) => c.id === caseA.id)).toBe(true);
      expect(listStaffA.some((c: any) => c.id === caseB.id)).toBe(false);

      // 3. Manager B (TEAM scope) queries cases
      const clientMgrB = db.createClient(MANAGER_B, AGENCY_A, 'TEAM');
      const serviceMgrB = new CasesService(clientMgrB);
      const listMgrB = await serviceMgrB.listCases(AGENCY_A);
      expect(listMgrB.some((c: any) => c.id === caseA.id)).toBe(false);
      expect(listMgrB.some((c: any) => c.id === caseB.id)).toBe(true);

      // 4. Owner (ALL scope) queries cases -> Sees BOTH!
      const listOwner = await serviceOwner.listCases(AGENCY_A);
      expect(listOwner.some((c: any) => c.id === caseA.id)).toBe(true);
      expect(listOwner.some((c: any) => c.id === caseB.id)).toBe(true);
    });
  });

  // ===========================================================================
  // GATE 6: Pure Workflow Engine Validation & Exceptions
  // ===========================================================================
  describe('GATE 6: Pure workflow engine unit tests & exceptions', () => {
    it('validates outcome rules: FRAUD requires mandatory fraud_reason', () => {
      // Genuine outcome without reason is valid
      expect(validateOutcome('GENUINE').isValid).toBe(true);

      // Fraud outcome without reason is invalid
      const badFraud = validateOutcome('FRAUD', '');
      expect(badFraud.isValid).toBe(false);
      expect(badFraud.error).toContain("Fraud reason category/narrative is mandatory when setting outcome to 'FRAUD'");

      // Fraud outcome with reason is valid
      const goodFraud = validateOutcome('FRAUD', 'Staged admission with fictitious doctor notes');
      expect(goodFraud.isValid).toBe(true);
    });

    it('resolves exception financial rules for WITHDRAWN (per TEST-05)', () => {
      const withdrawnRule = resolveExceptionFinancialRule('WITHDRAWN');
      expect(withdrawnRule).not.toBeNull();
      expect(withdrawnRule?.investigator_payable_percent).toBe(0);
      expect(withdrawnRule?.client_billable).toBe(false);
      expect(withdrawnRule?.zero_fee_enforced).toBe(true);
      expect(withdrawnRule?.ta_reimbursement_permitted).toBe(true);

      const rejectedRule = resolveExceptionFinancialRule('REJECTED');
      expect(rejectedRule).not.toBeNull();
      expect(rejectedRule?.investigator_payable_percent).toBe(0);
      expect(rejectedRule?.client_billable).toBe(true);
      expect(rejectedRule?.dispute_recovery_hub).toBe(true);
    });

    it('generates monotonic formatted doc_codes (e.g. MMMYY-NNNN)', async () => {
      const client = db.createClient(OWNER_USER, AGENCY_A);
      const service = new CasesService(client);

      const code1 = await service.generateDocCode(AGENCY_A);
      const code2 = await service.generateDocCode(AGENCY_A);
      const code3 = await service.generateDocCode(AGENCY_A);

      expect(code1).toMatch(/^[A-Z]{3}\d{2}-0001$/);
      expect(code2).toMatch(/^[A-Z]{3}\d{2}-0002$/);
      expect(code3).toMatch(/^[A-Z]{3}\d{2}-0003$/);
    });
  });
});
