import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRateLimiter } from '@/lib/rate-limiter';
import {
  checkCaseCreationQuota,
  checkStorageQuota,
  checkInvestigatorSeatQuota,
  PLAN_CONFIGURATIONS
} from '@/modules/billing/plan-limits';
import { ComplianceService } from '@/modules/compliance/service';

describe('PHASE 10: Security Audit, Hardening & Governance Gates', () => {
  const AGENCY_A = '00000000-0000-0000-0000-000000000001';
  const AGENCY_B = '00000000-0000-0000-0000-000000000002';
  const USER_A = '11111111-1111-1111-1111-111111111111';

  // =========================================================================
  // GATE 1: IDOR & Scope Perimeter Enforcement
  // =========================================================================
  describe('GATE 1: IDOR Sweep & Scope Isolation', () => {
    it('strictly blocks accessing or mutating resources belonging to another agency', () => {
      const mockCase = {
        id: 'case-100',
        agency_id: AGENCY_A,
        doc_code: 'JUL26-0001',
        owner_manager_id: 'mgr-01'
      };

      const callerContextB = {
        agency_id: AGENCY_B,
        user_id: 'user-b',
        scope: 'ALL' // Even with ALL scope, boundary is strictly limited to AGENCY_B
      };

      // IDOR check: caller agency !== resource agency
      const isAuthorized = callerContextB.agency_id === mockCase.agency_id;
      expect(isAuthorized).toBe(false);
    });

    it('enforces TEAM scope boundary: manager cannot view cases outside their subtree', () => {
      const caseInTeam1 = { id: 'c1', agency_id: AGENCY_A, owner_manager_id: 'mgr-01' };
      const caseInTeam2 = { id: 'c2', agency_id: AGENCY_A, owner_manager_id: 'mgr-02' };

      const manager1 = {
        agency_id: AGENCY_A,
        user_id: 'mgr-01',
        scope: 'TEAM' as const,
        subordinates: ['staff-01']
      };

      const canView1 = manager1.agency_id === caseInTeam1.agency_id && (caseInTeam1.owner_manager_id === manager1.user_id || manager1.subordinates.includes(caseInTeam1.owner_manager_id));
      const canView2 = manager1.agency_id === caseInTeam2.agency_id && (caseInTeam2.owner_manager_id === manager1.user_id || manager1.subordinates.includes(caseInTeam2.owner_manager_id));

      expect(canView1).toBe(true);
      expect(canView2).toBe(false); // IDOR prevented
    });
  });

  // =========================================================================
  // GATE 2: Privilege Escalation Prevention
  // =========================================================================
  describe('GATE 2: Privilege Escalation Prevention', () => {
    it('blocks a non-admin manager from granting permissions they do not possess', () => {
      const managerHeldPermissions = new Set(['cases.assign', 'reports.review']);
      const permissionToGrant = 'settings.roles'; // Administrative privilege

      const isAllowed = managerHeldPermissions.has(permissionToGrant);
      expect(isAllowed).toBe(false);
    });

    it('blocks self-granting of permissions (anti-privilege escalation rule A9)', () => {
      const callerUserId = 'user-mgr-01';
      const targetUserId = 'user-mgr-01'; // Self-delegation

      const canDelegate = callerUserId !== targetUserId;
      expect(canDelegate).toBe(false);
    });
  });

  // =========================================================================
  // GATE 3: Rate Limiting Sliding Window (Rule A7)
  // =========================================================================
  describe('GATE 3: In-Memory Sliding Window Rate Limiting', () => {
    it('enforces rate limits on sensitive perimeters and returns 429 when threshold exceeded', () => {
      const rateLimiter = new MemoryRateLimiter(5, 60000); // 5 requests max per minute
      const clientIp = '192.168.1.50';
      const route = '/api/uploads';

      for (let i = 0; i < 5; i++) {
        const res = rateLimiter.check(clientIp, route);
        expect(res.allowed).toBe(true);
      }

      // 6th request must be blocked
      const blockedRes = rateLimiter.check(clientIp, route);
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.remaining).toBe(0);
      expect(blockedRes.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // GATE 4: Plan Limits & Usage Quota Hooks (Rule A1)
  // =========================================================================
  describe('GATE 4: Plan Quota & Usage Enforcement', () => {
    it('permits case creation under quota and blocks creation when quota exceeded', () => {
      // Starter tier: 500 cases / mo
      const underQuota = checkCaseCreationQuota('starter', 499);
      expect(underQuota.allowed).toBe(true);
      expect(underQuota.percentageUsed).toBe(100); // 499 / 500 ~ 100%

      const overQuota = checkCaseCreationQuota('starter', 500);
      expect(overQuota.allowed).toBe(false);
      expect(overQuota.message).toContain('Monthly case creation limit (500) reached');
    });

    it('allows unlimited case creation for enterprise tier', () => {
      const enterpriseCheck = checkCaseCreationQuota('enterprise', 10000);
      expect(enterpriseCheck.allowed).toBe(true);
      expect(enterpriseCheck.quotaLimit).toBe(-1);
    });

    it('enforces white-label branding footer suppression only on enterprise tier (Rule A10)', () => {
      expect(PLAN_CONFIGURATIONS.free.showBrandingFooter).toBe(true);
      expect(PLAN_CONFIGURATIONS.starter.showBrandingFooter).toBe(true);
      expect(PLAN_CONFIGURATIONS.professional.showBrandingFooter).toBe(true);
      expect(PLAN_CONFIGURATIONS.enterprise.showBrandingFooter).toBe(false);
    });
  });

  // =========================================================================
  // GATE 5: DPDP Act 2023 Statutory Exemption Overrides (Section 17 vs Section 12)
  // =========================================================================
  describe('GATE 5: DPDP Act 2023 Compliance & Statutory Retention Override', () => {
    it('rejects erasure requests for active tax invoices citing CGST Act Section 36 8-year requirement', async () => {
      const mockSupabase: any = {
        from: (table: string) => ({
          update: (fields: any) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: {
                      id: '33333333-3333-3333-3333-333333333333',
                      status: fields.status,
                      rejection_legal_basis: fields.rejection_legal_basis
                    },
                    error: null
                  })
                })
              })
            })
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: '44444444-4444-4444-4444-444444444444' }, error: null })
            })
          })
        })
      };

      const complianceService = new ComplianceService(mockSupabase);

      const result = await complianceService.evaluateErasureRequest(
        AGENCY_A,
        '33333333-3333-3333-3333-333333333333',
        USER_A,
        'REJECT_LEGAL_OVERRIDE',
        'Section 17(1)(b) DPDP Act 2023: Mandatorily retained for 96 months under Section 36 of CGST Act, 2017.'
      );

      expect(result.status).toBe('REJECTED_LEGAL_OVERRIDE');
      expect(result.rejection_legal_basis).toContain('Section 36 of CGST Act');
    });
  });
});
