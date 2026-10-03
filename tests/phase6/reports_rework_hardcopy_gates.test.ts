// ============================================================================
// VERICLAIM MULTI-TENANT SAAS
// TEST SUITE: tests/phase6/reports_rework_hardcopy_gates.test.ts
// PHASE 6: Reports, Review, Rework Engine, and Hardcopy Chain of Custody GATES
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { ReportsService, UserScopeContext } from '@/modules/reports/service';
import { calculateReportDiff } from '@/modules/reports/diff';
import { evaluateReworkEscalation, generateReworkTaskPayload } from '@/modules/reports/rework';
import crypto from 'crypto';

// ============================================================================
// IN-MEMORY MOCK DATABASE WITH IMMUTABILITY & APPEND-ONLY TRIGGERS FOR PHASE 6
// ============================================================================
class MockDatabase {
  agencies: any[] = [];
  users: any[] = [];
  cases: any[] = [];
  case_investigators: any[] = [];
  clients: any[] = [];
  client_branches: any[] = [];
  reports: any[] = [];
  report_versions: any[] = [];
  report_comments: any[] = [];
  rework_cycles: any[] = [];
  case_tasks: any[] = [];
  case_status_history: any[] = [];
  courier_dockets: any[] = [];
  hardcopy_packets: any[] = [];
  hardcopy_movements: any[] = [];
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

        return {
          select: (columns = '*') => {
            let working = [...rows];

            const queryObj: any = {
              eq: (col: string, val: any) => {
                working = working.filter((r) => r[col] === val);
                return queryObj;
              },
              neq: (col: string, val: any) => {
                working = working.filter((r) => r[col] !== val);
                return queryObj;
              },
              in: (col: string, vals: any[]) => {
                working = working.filter((r) => vals.includes(r[col]));
                return queryObj;
              },
              is: (col: string, val: any) => {
                if (val === null) {
                  working = working.filter((r) => r[col] === null || r[col] === undefined);
                } else {
                  working = working.filter((r) => r[col] === val);
                }
                return queryObj;
              },
              order: (col: string, opts?: any) => {
                const asc = opts?.ascending !== false;
                working.sort((a, b) => {
                  if (a[col] < b[col]) return asc ? -1 : 1;
                  if (a[col] > b[col]) return asc ? 1 : -1;
                  return 0;
                });
                return queryObj;
              },
              single: async () => {
                if (working.length === 0) {
                  return { data: null, error: { message: 'Row not found' } };
                }
                return { data: { ...working[0] }, error: null };
              },
              maybeSingle: async () => {
                return { data: working.length > 0 ? { ...working[0] } : null, error: null };
              },
              then: (resolve: any) => {
                resolve({ data: working.map((w) => ({ ...w })), error: null });
              },
            };
            return queryObj;
          },

          insert: (itemOrItems: any) => {
            const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
            const insertedRows: any[] = [];

            for (const item of items) {
              const newRow = {
                id: item.id || crypto.randomUUID(),
                created_at: item.created_at || new Date().toISOString(),
                ...item,
              };

              // Simulated Trigger: Check immutability on report_versions
              if (table === 'report_versions') {
                const existingVer = db.report_versions.find(
                  (rv) => rv.report_id === newRow.report_id && rv.version_number === newRow.version_number
                );
                if (existingVer) {
                  throw new Error(`Unique violation: version ${newRow.version_number} already exists for report`);
                }
              }

              // Simulated Trigger: Unique packet_no
              if (table === 'hardcopy_packets') {
                const existingPkt = db.hardcopy_packets.find(
                  (hp) => hp.agency_id === newRow.agency_id && hp.packet_no === newRow.packet_no
                );
                if (existingPkt) {
                  throw new Error(`Unique violation: packet_no ${newRow.packet_no} already exists`);
                }
              }

              rows.push(newRow);
              insertedRows.push({ ...newRow });
            }

            const queryObj: any = {
              select: () => ({
                single: async () => ({ data: { ...insertedRows[0] }, error: null }),
                then: (resolve: any) => resolve({ data: insertedRows.map((r) => ({ ...r })), error: null }),
              }),
              then: (resolve: any) => resolve({ data: insertedRows.map((r) => ({ ...r })), error: null }),
            };
            return queryObj;
          },

          update: (updates: any) => {
            let working = [...rows];

            const queryObj: any = {
              eq: (col: string, val: any) => {
                working = working.filter((r) => r[col] === val);
                return queryObj;
              },
              select: () => ({
                single: async () => {
                  return executeUpdate(true);
                },
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

            const executeUpdate = (single: boolean) => {
              // Simulated Trigger: prevent_report_versions_mutation
              if (table === 'report_versions') {
                throw new Error(
                  'A6 Security Violation: report_versions is append-only. Historical report versions cannot be modified or deleted.'
                );
              }

              // Simulated Trigger: prevent_hardcopy_movements_mutation
              if (table === 'hardcopy_movements') {
                throw new Error(
                  'A6 Security Violation: hardcopy_movements is append-only. Hardcopy chain of custody movements cannot be edited or deleted.'
                );
              }

              // Simulated Trigger: prevent_approved_report_mutation
              if (table === 'reports') {
                for (const row of working) {
                  if (row.is_immutable === true || row.status === 'APPROVED' || row.status === 'FINAL') {
                    // Allow only transition from false to true
                    if (!(row.is_immutable === false && updates.is_immutable === true)) {
                      throw new Error(
                        'A6 Security Violation: Approved report is sealed and immutable. Content and state cannot be modified.'
                      );
                    }
                  }
                }
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
              return { data: updatedRows.map((r) => ({ ...r })), error: null };
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
                  // Simulated Trigger: prevent_report_versions_mutation
                  if (table === 'report_versions') {
                    throw new Error(
                      'A6 Security Violation: report_versions is append-only. Historical report versions cannot be modified or deleted.'
                    );
                  }

                  // Simulated Trigger: prevent_hardcopy_movements_mutation
                  if (table === 'hardcopy_movements') {
                    throw new Error(
                      'A6 Security Violation: hardcopy_movements is append-only. Hardcopy chain of custody movements cannot be edited or deleted.'
                    );
                  }

                  // Simulated Trigger: prevent_approved_report_mutation
                  if (table === 'reports') {
                    for (const row of working) {
                      if (row.is_immutable === true || row.status === 'APPROVED') {
                        throw new Error('A6 Security Violation: Approved report cannot be deleted.');
                      }
                    }
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
        };
      },
    };

    return client;
  }
}

// ============================================================================
// TEST SUITE: PHASE 6 REPORTS, REVIEW, REWORK, HARDCOPY GATES
// ============================================================================
describe('PHASE 6: Reports, Review, Rework Engine, and Hardcopy Chain of Custody Gates', () => {
  let db: MockDatabase;
  const AGENCY_A = '11111111-1111-1111-1111-111111111111';
  const AGENCY_B = '22222222-2222-2222-2222-222222222222';

  const OWNER_USER = 'aaaaaaaa-1111-1111-1111-111111111111';
  const REVIEWER_USER = 'bbbbbbbb-1111-1111-1111-111111111111';
  const AUTHOR_USER = 'cccccccc-1111-1111-1111-111111111111';
  const INVESTIGATOR_USER = 'dddddddd-1111-1111-1111-111111111111';
  const INVESTIGATOR_B_USER = 'eeeeeeee-1111-1111-1111-111111111111';
  const DATA_ENTRY_USER = 'ffffffff-1111-1111-1111-111111111111';
  const FOREIGN_USER = '99999999-9999-9999-9999-999999999999';
  const NON_CREATOR_USER = '88888888-8888-8888-8888-888888888888';

  const CASE_1 = '33333333-1111-1111-1111-111111111111';
  const CLIENT_A = '44444444-1111-1111-1111-111111111111';

  let ownerContext: UserScopeContext;
  let reviewerContext: UserScopeContext;
  let authorContext: UserScopeContext;
  let investigatorContext: UserScopeContext;
  let foreignContext: UserScopeContext;

  beforeEach(() => {
    db = new MockDatabase();

    // 1. Seed Agencies
    db.agencies.push(
      { id: AGENCY_A, name: 'DNA Professional Investigation Agency', code: 'DNA' },
      { id: AGENCY_B, name: 'Rival Investigation Agency', code: 'RIVAL' }
    );

    // 2. Seed Users
    db.users.push(
      { id: OWNER_USER, agency_id: AGENCY_A, full_name: 'Rajesh Sharma (Owner)', scope: 'ALL' },
      { id: REVIEWER_USER, agency_id: AGENCY_A, full_name: 'Amitabh Sen (Reviewer)', scope: 'TEAM' },
      { id: AUTHOR_USER, agency_id: AGENCY_A, full_name: 'Pooja Verma (Author)', scope: 'TEAM' },
      { id: INVESTIGATOR_USER, agency_id: AGENCY_A, full_name: 'Vikram Singh (Investigator 1)', scope: 'ASSIGNED' },
      { id: INVESTIGATOR_B_USER, agency_id: AGENCY_A, full_name: 'Karan Patel (Investigator 2)', scope: 'ASSIGNED' },
      { id: DATA_ENTRY_USER, agency_id: AGENCY_A, full_name: 'Suresh Kumar (Data Entry)', scope: 'OWN_ENTERED' },
      { id: FOREIGN_USER, agency_id: AGENCY_B, full_name: 'Foreign Admin', scope: 'ALL' },
      { id: NON_CREATOR_USER, agency_id: AGENCY_A, full_name: 'Non Creator User', scope: 'OWN_ENTERED' }
    );

    // 3. Seed Client
    db.clients.push({
      id: CLIENT_A,
      agency_id: AGENCY_A,
      name: 'Star Health & Allied Insurance',
      code: 'STAR',
    });

    // 4. Seed Case
    db.cases.push({
      id: CASE_1,
      agency_id: AGENCY_A,
      doc_code: 'OCT26-0001',
      claim_no: 'CLM-STAR-2026-991',
      insured_name: 'Ramesh Patel',
      patient_name: 'Ramesh Patel',
      client_id: CLIENT_A,
      owner_manager_id: REVIEWER_USER,
      data_entry_user_id: DATA_ENTRY_USER,
      status: 'REPORT_DRAFTING',
      outcome: 'PENDING',
      version: 1,
      rework_count: 0,
      created_at: new Date().toISOString(),
    });

    // 5. Seed Assignment for Investigator 1
    db.case_investigators.push({
      id: 'assign-001',
      agency_id: AGENCY_A,
      case_id: CASE_1,
      investigator_id: INVESTIGATOR_USER,
      is_active: true,
      assignment_scope: 'PRIMARY',
      hardcopy_status: 'PENDING',
    });

    // Scope Contexts
    ownerContext = {
      userId: OWNER_USER,
      agencyId: AGENCY_A,
      role: 'Agency Owner',
      scope: 'ALL',
      permissions: [
        'cases.view', 'reports.write', 'reports.submit', 'reports.review',
        'reports.approve', 'reports.escalate', 'hardcopy.dispatch', 'hardcopy.receive',
      ],
    };

    reviewerContext = {
      userId: REVIEWER_USER,
      agencyId: AGENCY_A,
      role: 'Reviewer',
      scope: 'TEAM',
      permissions: ['cases.view', 'reports.review', 'reports.submit'],
    };

    authorContext = {
      userId: AUTHOR_USER,
      agencyId: AGENCY_A,
      role: 'Report Author',
      scope: 'TEAM',
      permissions: ['cases.view', 'reports.write', 'reports.submit'],
    };

    investigatorContext = {
      userId: INVESTIGATOR_USER,
      agencyId: AGENCY_A,
      role: 'Field Investigator',
      scope: 'ASSIGNED',
      permissions: ['cases.view', 'evidence.upload', 'reports.write'],
    };

    foreignContext = {
      userId: FOREIGN_USER,
      agencyId: AGENCY_B,
      role: 'Agency Owner',
      scope: 'ALL',
      permissions: [
        'cases.view', 'reports.write', 'reports.submit', 'reports.review',
        'reports.approve', 'hardcopy.dispatch', 'hardcopy.receive',
      ],
    };
  });

  // ===========================================================================
  // GATE 1: 5 REWORK CYCLES PRESERVE ALL VERSIONS
  // ===========================================================================
  describe('GATE 1: 5 rework cycles preserve all versions', () => {
    it('executes 5 successive rework cycles, retaining all discrete versions (v1..v6) with diffs and auto-escalation', async () => {
      const client = db.createClient(AUTHOR_USER, AGENCY_A);
      const service = new ReportsService(client);

      // 1. Initial Report Draft (Version 1)
      const report = await service.createOrGetReport(authorContext, {
        case_id: CASE_1,
        title: 'Investigation Report - CLM-STAR-2026-991',
        summary: 'Initial field investigation findings: Insured admitted for acute pancreatitis.',
        initial_sections: {
          hospital_verification: {
            title: 'Hospital Verification',
            text: 'Visited Lifeline Hospital. Verified admission register on 10-Oct.',
            evidence_ids: ['00000000-0000-0000-0000-000000000001'],
            verified: true,
          },
          insured_statement: {
            title: 'Insured Statement',
            text: 'Insured claims sudden onset of abdominal pain on 9-Oct.',
            evidence_ids: [],
            verified: false,
          },
        },
      });

      expect(report.current_version).toBe(1);
      expect(report.status).toBe('DRAFT');

      // Submit Draft Version 1 for Review
      await service.submitReport(authorContext, {
        report_id: report.id,
        outcome: 'GENUINE',
        change_summary: 'Version 1 submitted for peer scrutiny',
      });

      const cyclesConfig = [
        {
          cycle: 1,
          recipient: 'INVESTIGATOR' as const,
          reason: 'INCOMPLETE_EVIDENCE',
          priority: 'MEDIUM' as const,
          instructions: 'Collect certified Indoor Case Paper (ICP) and pathology reports.',
          targets: ['hospital_verification'],
          correctionSummary: 'Added certified ICP indoor sheets from Medical Superintendent.',
          updatedText: 'Visited Lifeline Hospital. Obtained certified ICP sheets showing vitals.',
        },
        {
          cycle: 2,
          recipient: 'REPORT_AUTHOR' as const,
          reason: 'INACCURATE_FINDINGS',
          priority: 'HIGH' as const,
          instructions: 'Clarify discrepancy in onset date between claim form and doctor notes.',
          targets: ['insured_statement'],
          correctionSummary: 'Cross-verified onset date with treating physician Dr. Mehta.',
          updatedText: 'Onset date reconciled to 8-Oct evening per treating physician Dr. Mehta.',
        },
        {
          cycle: 3,
          recipient: 'BACK_OFFICE' as const,
          reason: 'DISCREPANCY_IN_DATES',
          priority: 'HIGH' as const,
          instructions: 'Hospital bill summary indicates discharge on 14-Oct; claim form says 15-Oct.',
          targets: ['hospital_verification'],
          correctionSummary: 'Discharge date corrected to 14-Oct; billing summary reconciled.',
          updatedText: 'Discharge date formally reconciled to 14-Oct per hospital discharge slip.',
        },
        {
          cycle: 4,
          recipient: 'CASE_MANAGER' as const,
          reason: 'POLICY_CLAUSE_MISMATCH',
          priority: 'URGENT' as const,
          instructions: 'Pre-existing condition exclusion clause 4.2 requires formal opinion.',
          targets: ['policy_clauses'],
          correctionSummary: 'Pre-existing clause 4.2 reviewed; acute episode confirmed non-chronic.',
          updatedText: 'Clause 4.2 scrutinized. Condition confirmed acute non-chronic pancreatitis.',
        },
        {
          cycle: 5,
          recipient: 'DATA_ENTRY' as const,
          reason: 'OTHER',
          priority: 'URGENT' as const,
          instructions: 'Recheck hospital registration ROHINI code against insurance portal.',
          targets: ['hospital_verification'],
          correctionSummary: 'Hospital ROHINI code 890123 confirmed active.',
          updatedText: 'ROHINI code 890123 verified active on registry.',
        },
      ];

      // Execute 5 Cycles Sequentially
      for (const step of cyclesConfig) {
        // Reviewer sends back
        const reworkResult = await service.sendBackForRework(reviewerContext, {
          case_id: CASE_1,
          report_id: report.id,
          target_recipient_type: step.recipient,
          reason_category: step.reason,
          instructions: step.instructions,
          priority: step.priority,
          target_sections: step.targets,
        });

        expect(reworkResult.reworkCycle.cycle_number).toBe(step.cycle);

        // Auto-escalation Gate Check at Cycle >= 3
        if (step.cycle >= 3) {
          expect(reworkResult.isEscalated).toBe(true);
          expect(reworkResult.targetCaseStatus).toBe('ESCALATED_REVIEW');
          expect(reworkResult.reworkCycle.priority).toBe('URGENT');
        } else {
          expect(reworkResult.isEscalated).toBe(false);
          expect(reworkResult.targetCaseStatus).toBe('REPORT_DRAFTING');
        }

        // Author submits corrections, creating discrete version V+1
        const activeCycle = reworkResult.reworkCycle;
        const currentCaseReport = await service.getReportByCaseId(authorContext, CASE_1);
        const lastVersion = currentCaseReport!.versions[currentCaseReport!.versions.length - 1];

        const updatedContent = {
          ...lastVersion.content,
          outcome: (lastVersion.content.outcome as any) || 'GENUINE',
          summary: `Executive Summary revision #${step.cycle}: ${step.correctionSummary}`,
          sections: {
            ...lastVersion.content.sections,
            [step.targets[0]]: {
              title: step.targets[0].replace(/_/g, ' '),
              text: step.updatedText,
              evidence_ids: [],
              verified: true,
            },
          },
        };

        const correctionResult = await service.submitReworkCorrection(authorContext, {
          rework_cycle_id: activeCycle.id,
          report_id: report.id,
          content: updatedContent,
          change_summary: step.correctionSummary,
          correction_notes: `Addressed ${step.reason}: ${step.instructions}`,
        });

        expect(correctionResult.newVersion.version_number).toBe(step.cycle + 1);
        expect(correctionResult.report.current_version).toBe(step.cycle + 1);
      }

      // Final Inspection of Retained Versions:
      // Starting from v1 + 5 cycles = exactly 6 versions retained
      const dossier = await service.getReportByCaseId(ownerContext, CASE_1);
      expect(dossier).not.toBeNull();
      expect(dossier!.versions.length).toBe(6);

      const versionNumbers = dossier!.versions.map((v) => v.version_number);
      expect(versionNumbers).toEqual([1, 2, 3, 4, 5, 6]);

      // Verify each version content is distinct and retained (nothing overwritten)
      expect(dossier!.versions[0].change_summary).toBe('Initial report draft initialized');
      expect(dossier!.versions[1].change_summary).toBe('Added certified ICP indoor sheets from Medical Superintendent.');
      expect(dossier!.versions[2].change_summary).toBe('Cross-verified onset date with treating physician Dr. Mehta.');
      expect(dossier!.versions[3].change_summary).toBe('Discharge date corrected to 14-Oct; billing summary reconciled.');
      expect(dossier!.versions[4].change_summary).toBe('Pre-existing clause 4.2 reviewed; acute episode confirmed non-chronic.');
      expect(dossier!.versions[5].change_summary).toBe('Hospital ROHINI code 890123 confirmed active.');

      // Verify structured diff calculation between version 1 and version 6
      const diff1to6 = await service.getReportDiff(ownerContext, report.id, 1, 6);
      expect(diff1to6.fromVersionNumber).toBe(1);
      expect(diff1to6.toVersionNumber).toBe(6);
      expect(diff1to6.hasChanges).toBe(true);
      expect(diff1to6.summaryChange.hasChanged).toBe(true);
      expect(diff1to6.sectionDiffs.length).toBeGreaterThan(0);

      // Verify all 5 rework cycles exist in rework_cycles table with status CORRECTED
      expect(dossier!.reworkCycles.length).toBe(5);
      expect(dossier!.reworkCycles.every((c) => c.status === 'CORRECTED')).toBe(true);

      // Verify 5 actionable tasks created in case_tasks
      const tasks = db.case_tasks.filter((t) => t.case_id === CASE_1);
      expect(tasks.length).toBe(5);
      expect(tasks[0].task_title).toContain('[Rework #1]');
      expect(tasks[2].task_title).toContain('[Rework #3]');
      expect(tasks[4].task_title).toContain('[Rework #5]');
    });
  });

  // ===========================================================================
  // GATE 2: APPROVED REPORT IMMUTABLE
  // ===========================================================================
  describe('GATE 2: Approved report immutable', () => {
    it('strictly locks report upon approval, rendering it immutable against updates, drafts, comments, rework and DB triggers', async () => {
      const client = db.createClient(OWNER_USER, AGENCY_A);
      const service = new ReportsService(client);

      // Create report draft and submit
      const report = await service.createOrGetReport(ownerContext, {
        case_id: CASE_1,
        title: 'Approved Docket Report',
        summary: 'Investigation finalized: Genuine acute claim.',
      });

      // Submit for review
      await service.submitReport(ownerContext, {
        report_id: report.id,
        outcome: 'GENUINE',
        change_summary: 'Submitted for signoff',
      });

      // Add a reviewer comment before approval
      const comment = await service.addReviewComment(ownerContext, {
        report_id: report.id,
        version_number: 1,
        target_type: 'SECTION',
        target_id: 'investigation_summary',
        comment: 'Please confirm treating consultant registration number.',
      });
      expect(comment.id).toBeDefined();

      // Formally Approve the Report
      const approved = await service.approveReport(ownerContext, {
        report_id: report.id,
        approval_notes: 'All medical records verified against original hospital admission register. Genuine claim.',
        signoff_declaration: true,
      });

      expect(approved.status).toBe('APPROVED');
      expect(approved.is_immutable).toBe(true);
      expect(approved.approved_by).toBe(OWNER_USER);
      expect(approved.approved_at).toBeDefined();

      // Verify case status advanced to APPROVED
      const caseRow = db.cases.find((c) => c.id === CASE_1);
      expect(caseRow.status).toBe('APPROVED');

      // 1. Negative Test: saveDraft rejected on approved report
      await expect(
        service.saveDraft(ownerContext, {
          report_id: report.id,
          content: { summary: 'Attempted alteration', sections: {} },
        })
      ).rejects.toThrow(/A6 Security Violation: Approved report is sealed and immutable/);

      // 2. Negative Test: submitReport rejected on approved report
      await expect(
        service.submitReport(ownerContext, {
          report_id: report.id,
          outcome: 'FRAUD',
          fraud_reason: 'Fabricated records',
        })
      ).rejects.toThrow(/A6 Security Violation: Approved report is sealed and immutable/);

      // 3. Negative Test: addReviewComment rejected on approved report
      await expect(
        service.addReviewComment(ownerContext, {
          report_id: report.id,
          version_number: 1,
          target_type: 'SECTION',
          target_id: 'investigation_summary',
          comment: 'Post-approval comment attempt',
        })
      ).rejects.toThrow(/A6 Security Violation: Approved report is sealed and immutable/);

      // 4. Negative Test: sendBackForRework rejected on approved report
      await expect(
        service.sendBackForRework(ownerContext, {
          case_id: CASE_1,
          report_id: report.id,
          target_recipient_type: 'INVESTIGATOR',
          reason_category: 'INCOMPLETE_EVIDENCE',
          instructions: 'Cannot rework approved report',
        })
      ).rejects.toThrow(/A6 Security Violation: Approved report is sealed and immutable/);

      // 5. Negative Test: submitReworkCorrection rejected on approved report
      await expect(
        service.submitReworkCorrection(ownerContext, {
          rework_cycle_id: crypto.randomUUID(),
          report_id: report.id,
          content: { summary: 'Altered', sections: {} },
          change_summary: 'Attempted correction',
          correction_notes: 'Should fail',
        })
      ).rejects.toThrow(/A6 Security Violation: Approved report is sealed and immutable/);

      // 6. Negative Test: Direct DB UPDATE on reports rejected by trigger
      await expect(
        client.from('reports').update({ title: 'Tampered Report' }).eq('id', report.id)
      ).rejects.toThrow(/A6 Security Violation: Approved report is sealed and immutable/);

      // 7. Negative Test: Direct DB UPDATE on report_versions rejected by append-only trigger
      await expect(
        client.from('report_versions').update({ summary: 'Hacked Summary' }).eq('report_id', report.id)
      ).rejects.toThrow(/A6 Security Violation: report_versions is append-only/);

      // 8. Negative Test: Direct DB DELETE on report_versions rejected by append-only trigger
      await expect(
        client.from('report_versions').delete().eq('report_id', report.id)
      ).rejects.toThrow(/A6 Security Violation: report_versions is append-only/);
    });
  });

  // ===========================================================================
  // GATE 3: HARDCOPY MOVEMENTS CANNOT BE EDITED / DELETED
  // ===========================================================================
  describe('GATE 3: Hardcopy movements cannot be edited/deleted', () => {
    it('manages full hardcopy lifecycle with append-only chain of custody and strictly forbids movement mutations', async () => {
      const client = db.createClient(OWNER_USER, AGENCY_A);
      const service = new ReportsService(client);

      // 1. Inward physical packet from investigator
      const packet = await service.inwardPacket(ownerContext, {
        case_id: CASE_1,
        packet_no: 'PKT-DNA-9901',
        investigator_id: INVESTIGATOR_USER,
        item_counts: {
          bills: 14,
          prescriptions: 7,
          reports: 5,
          photos: 22,
          total_pages: 48,
        },
        condition_notes: 'Original signed bills enclosed in tamper-evident envelope.',
        storage_location: {
          room: 'Main Archive',
          rack: 'R4',
          shelf: 'S2',
          box: 'B11',
        },
      });

      expect(packet.packet_no).toBe('PKT-DNA-9901');
      expect(packet.current_status).toBe('RECEIVED');
      expect(packet.item_counts.total_pages).toBe(48);

      // Verify investigator hardcopy status updated to RECEIVED
      const assign = db.case_investigators.find((ci) => ci.case_id === CASE_1);
      expect(assign.hardcopy_status).toBe('RECEIVED');

      // 2. Relocate Packet inside archive room
      const relocated = await service.updatePacketLocation(ownerContext, {
        packet_id: packet.id,
        storage_location: {
          room: 'Main Archive',
          rack: 'R1',
          shelf: 'S4',
          box: 'B02',
        },
        movement_type: 'STORED_IN_ARCHIVE',
        notes: 'Transferred to long-term audit shelf',
      });
      expect(relocated.storage_location.rack).toBe('R1');
      expect(relocated.current_status).toBe('STORED');

      // 3. Retrieve packet for reviewer verification
      const retrieved = await service.updatePacketLocation(ownerContext, {
        packet_id: packet.id,
        storage_location: {
          room: 'Review Desk',
          rack: 'DESK',
          shelf: 'D1',
          box: 'TRAY',
        },
        movement_type: 'RETRIEVED_FOR_REVIEW',
        notes: 'Handover to Reviewer Amitabh Sen for bill audit',
      });
      expect(retrieved.current_status).toBe('RETRIEVED');

      // 4. Mark Case Approved to test courier dispatch
      db.cases.find((c) => c.id === CASE_1)!.status = 'APPROVED';

      // 5. Dispatch packet via Blue Dart courier
      const docket = await service.dispatchHardcopy(ownerContext, {
        client_id: CLIENT_A,
        courier_partner: 'Blue Dart',
        awb_number: 'BD-889123041',
        packet_ids: [packet.id],
      });

      expect(docket.docket_number).toContain('DOK-');
      expect(docket.awb_number).toBe('BD-889123041');
      expect(docket.delivery_status).toBe('IN_TRANSIT');

      // Verify packet updated to DISPATCHED
      const pktRow = db.hardcopy_packets.find((p) => p.id === packet.id);
      expect(pktRow.current_status).toBe('DISPATCHED');
      expect(pktRow.courier_docket_id).toBe(docket.id);

      // Verify case status transitioned to HARDCOPY_TRANSIT
      const caseRow = db.cases.find((c) => c.id === CASE_1);
      expect(caseRow.status).toBe('HARDCOPY_TRANSIT');

      // 6. Generate and verify Printable Courier Manifest
      const manifest = await service.getPrintableManifest(ownerContext, docket.id);
      expect(manifest.docketNumber).toBe(docket.docket_number);
      expect(manifest.awbNumber).toBe('BD-889123041');
      expect(manifest.courierPartner).toBe('Blue Dart');
      expect(manifest.totalPackets).toBe(1);
      expect(manifest.packets[0].packetNo).toBe('PKT-DNA-9901');
      expect(manifest.packets[0].claimNo).toBe('CLM-STAR-2026-991');
      expect(manifest.packets[0].insuredName).toBe('Ramesh Patel');

      // 7. Acknowledge Delivery at Insurer Claims Desk
      const acknowledged = await service.acknowledgeDelivery(ownerContext, {
        docket_id: docket.id,
        recipient_name: 'Mr. Pradeep Joshi (Star Health Claims Desk)',
        acknowledgement_notes: 'All envelopes received intact with seals verified.',
      });

      expect(acknowledged.delivery_status).toBe('DELIVERED');
      expect(acknowledged.recipient_name).toBe('Mr. Pradeep Joshi (Star Health Claims Desk)');

      // Verify case closed upon delivery acknowledgement
      expect(db.cases.find((c) => c.id === CASE_1)!.status).toBe('CLOSED');

      // 8. Verify Chain of Custody History
      const movements = await service.getChainOfCustody(ownerContext, CASE_1);
      expect(movements.length).toBe(5);
      expect(movements[0].movement_type).toBe('RECEIVED_FROM_INVESTIGATOR');
      expect(movements[1].movement_type).toBe('STORED_IN_ARCHIVE');
      expect(movements[2].movement_type).toBe('RETRIEVED_FOR_REVIEW');
      expect(movements[3].movement_type).toBe('DISPATCHED_TO_CLIENT');
      expect(movements[4].movement_type).toBe('DELIVERY_ACKNOWLEDGED');

      // 9. CONSTITUTIONAL GATE: hardcopy_movements CANNOT BE EDITED OR DELETED
      const firstMovement = movements[0];

      // Attempt UPDATE -> must throw
      await expect(
        client
          .from('hardcopy_movements')
          .update({ notes: 'Tampered custody note' })
          .eq('id', firstMovement.id)
      ).rejects.toThrow(
        /A6 Security Violation: hardcopy_movements is append-only. Hardcopy chain of custody movements cannot be edited or deleted./
      );

      // Attempt DELETE -> must throw
      await expect(
        client
          .from('hardcopy_movements')
          .delete()
          .eq('id', firstMovement.id)
      ).rejects.toThrow(
        /A6 Security Violation: hardcopy_movements is append-only. Hardcopy chain of custody movements cannot be edited or deleted./
      );

      // Verify original movement is completely unchanged in DB
      const verifiedMovement = db.hardcopy_movements.find((m) => m.id === firstMovement.id);
      expect(verifiedMovement.notes).toBe('Original signed bills enclosed in tamper-evident envelope.');
    });
  });

  // ===========================================================================
  // GATE 4: SCOPE NEGATIVES & AUTHORIZATION ENFORCEMENT
  // ===========================================================================
  describe('GATE 4: Scope negatives & authorization enforcement', () => {
    it('strictly isolates tenant dockets and denies out-of-scope or unauthorized users', async () => {
      const clientA = db.createClient(OWNER_USER, AGENCY_A);
      const serviceA = new ReportsService(clientA);

      // Initialize report in Agency A
      await serviceA.createOrGetReport(ownerContext, {
        case_id: CASE_1,
        title: 'Confidential Fraud Investigation',
        summary: 'Sensitive findings.',
      });

      // 1. Cross-Agency Negative: Agency B caller cannot access Agency A report
      const clientB = db.createClient(FOREIGN_USER, AGENCY_B);
      const serviceB = new ReportsService(clientB);

      await expect(
        serviceB.getReportByCaseId(foreignContext, CASE_1)
      ).rejects.toThrow(new RegExp(`Case ${CASE_1} not found or access denied in agency ${AGENCY_B}`));

      await expect(
        serviceB.createOrGetReport(foreignContext, {
          case_id: CASE_1,
          title: 'Cross-Tenant Exploit Attempt',
        })
      ).rejects.toThrow(new RegExp(`Case ${CASE_1} not found or access denied in agency ${AGENCY_B}`));

      // 2. Assigned Scope Negative: Investigator 2 (not assigned to Case 1) cannot access report
      const unassignedContext: UserScopeContext = {
        userId: INVESTIGATOR_B_USER,
        agencyId: AGENCY_A,
        role: 'Field Investigator',
        scope: 'ASSIGNED',
        permissions: ['cases.view', 'reports.write'],
      };

      await expect(
        serviceA.getReportByCaseId(unassignedContext, CASE_1)
      ).rejects.toThrow(/Scope violation: You are not assigned to this case/);

      // 3. Own-Entered Scope Negative: User with OWN_ENTERED who did not create the case is rejected
      const nonCreatorContext: UserScopeContext = {
        userId: NON_CREATOR_USER,
        agencyId: AGENCY_A,
        role: 'Data Entry',
        scope: 'OWN_ENTERED',
        permissions: ['cases.view', 'reports.write'],
      };

      await expect(
        serviceA.getReportByCaseId(nonCreatorContext, CASE_1)
      ).rejects.toThrow(/Scope violation: You can only access cases you entered/);

      // 4. Missing Permission Negatives
      const noApproveContext: UserScopeContext = {
        ...authorContext,
        permissions: ['cases.view', 'reports.write'], // Missing reports.approve
      };

      const report = db.reports.find((r) => r.case_id === CASE_1);

      await expect(
        serviceA.approveReport(noApproveContext, {
          report_id: report.id,
          approval_notes: 'Unauthorized approval attempt',
          signoff_declaration: true,
        })
      ).rejects.toThrow(/Permission denied: Missing 'reports.approve'/);

      const noDispatchContext: UserScopeContext = {
        ...authorContext,
        permissions: ['cases.view'], // Missing hardcopy.dispatch
      };

      await expect(
        serviceA.dispatchHardcopy(noDispatchContext, {
          client_id: CLIENT_A,
          courier_partner: 'DTDC',
          awb_number: 'DTDC-112233',
          packet_ids: ['00000000-0000-0000-0000-000000000099'],
        })
      ).rejects.toThrow(/Permission denied: Missing 'hardcopy.dispatch'/);

      const noReceiveContext: UserScopeContext = {
        ...authorContext,
        permissions: ['cases.view'], // Missing hardcopy.receive
      };

      await expect(
        serviceA.inwardPacket(noReceiveContext, {
          case_id: CASE_1,
          packet_no: 'PKT-DENIED',
          item_counts: { bills: 1, prescriptions: 1, reports: 1, photos: 1, total_pages: 4 },
          storage_location: { room: 'Main Archive', rack: 'R1', shelf: 'S1', box: 'B1' },
        })
      ).rejects.toThrow(/Permission denied: Missing 'hardcopy.receive'/);

      // 5. Audit Trail Verification:
      // Verify immutable audit logs recorded for Phase 6 operations
      const auditActions = db.audit_logs.map((al) => al.action);
      expect(auditActions).toContain('REPORTS.CREATE');
    });
  });
});
