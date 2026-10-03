# Permissions, Roles & Authorization Architecture

## 1. Core Principles: Permission vs Scope

As mandated in **AGENTS.md (A5)**:
- **PERMISSION** defines **WHAT** an action a user can perform (e.g. `cases.assign`, `reports.approve`, `invoices.generate`). Permissions are toggle-based capabilities.
- **SCOPE** defines **WHOSE** data a user can see and touch (e.g. which client + case type combinations, which manager's subordinate team). Scope is assignment-based boundaries.
- **Constitutional Invariant:** A permission never widens scope; a scope never grants a permission. Both are strictly verified in server actions and enforced at the PostgreSQL Row-Level Security (RLS) layer.

---

## 2. Global Permission Catalog

All permission identifiers are hierarchical lowercase strings (`<domain>.<action>`).

| Permission ID | Module | Description | Sensitive / Audited? |
|---|---|---|---|
| `cases.create` | Cases | Create fresh case records in data entry queue. | No |
| `cases.view` | Cases | View case details within user's assigned scope. | No |
| `cases.edit_entry` | Cases | Edit case details while in `DATA_ENTRY` status. | No |
| `cases.edit_verified` | Cases | Amend case metadata after verification (requires audit note). | **Yes** |
| `cases.verify` | Cases | Verify data entry correctness and route to manager. | No |
| `cases.assign` | Cases | Assign field investigators to cases. | No |
| `cases.reassign` | Cases | Reassign an already assigned investigator. | **Yes** |
| `cases.accept` | Cases | Accept or decline field investigation assignment (mobile). | No |
| `cases.withdraw` | Cases | Mark case as Withdrawn (cancels investigation). | **Yes** |
| `cases.reject` | Cases | Mark case as Rejected by insurer. | **Yes** |
| `cases.close` | Cases | Formally close case operations. | No |
| `cases.delete` | Cases | Soft delete a case (restricted to Owner/Admin). | **Yes (Critical)** |
| `evidence.upload` | Evidence | Upload field photos, videos, and documents to Cloudflare R2. | No |
| `evidence.view` | Evidence | View and download uploaded evidence within scope. | No |
| `evidence.delete` | Evidence | Soft-delete an evidence document. | **Yes** |
| `reports.write` | Reports | Draft investigation reports. | No |
| `reports.submit` | Reports | Submit draft report for formal peer review. | No |
| `reports.review` | Reports | Review report, set findings outcome, trigger send-back/rework. | No |
| `reports.approve` | Reports | Approve report and trigger signed PDF generation. | **Yes** |
| `reports.escalate` | Reports | Override/resolve escalated reviews ($N \ge 3$ send-backs). | **Yes** |
| `hardcopy.dispatch` | Logistics | Assemble cases into courier dockets and generate manifests. | No |
| `hardcopy.receive` | Logistics | Acknowledge receipt of physical hardcopies. | No |
| `invoices.generate` | Finance | Generate sequential GST invoices for closed cases. | **Yes** |
| `invoices.credit_note`| Finance | Issue GST credit/debit notes for issued invoices. | **Yes (Critical)** |
| `payments.record` | Finance | Record client remittances, TDS withheld, bank references. | **Yes** |
| `payouts.prepare` | Finance | Prepare monthly investigator payout batches and TDS ledger. | No |
| `payouts.approve_ta` | Finance | 1-click approve or modify outstation travel allowances (TA). | **Yes** |
| `payouts.disburse` | Finance | Generate bank payment Excel sheets and mark payouts paid. | **Yes (Critical)** |
| `team.manage` | Users | Invite staff, manage reports_to hierarchy, assign roles. | **Yes** |
| `team.delegate` | Users | Grant/revoke permissions within manager's subtree. | **Yes** |
| `settings.agency` | Settings | Configure agency profile, GSTIN, letterhead, case types. | **Yes** |
| `settings.roles` | Settings | Create custom roles and edit role-permission matrices. | **Yes** |
| `audit.view` | Audit | View append-only immutable audit trail and DPDP reveal logs. | **Yes** |

---

## 3. Role Templates & Default Scopes

Roles are fully customizable per agency. The system provides 13 standardized role templates:

| Role Template | Default Scope | Primary Purpose | Key Permissions Included |
|---|---|---|---|
| **Agency Owner** | `ALL` | Complete operational & financial authority. | All 32 permissions. |
| **Admin** | `ALL` | System configuration, staff management, operations. | All permissions except statutory payout disbursement if toggled off. |
| **Case Manager** | `TEAM` | Leads team of staff and investigators; case routing. | `cases.*` (excl delete), `reports.review`, `reports.approve`, `team.delegate`. |
| **Back Office** | `TEAM` | Quality assurance, dispatch logistics, doc verification. | `cases.verify`, `cases.view`, `hardcopy.*`, `reports.review`. |
| **Data Entry** | `OWN_ENTERED` | High-speed intake of client claim intimations. | `cases.create`, `cases.edit_entry`, `cases.view`. |
| **Field Investigator**| `ASSIGNED` | Field enquiries, evidence capture, PIN portal. | `cases.accept`, `evidence.upload`, `reports.write`, `payouts.approve_ta` (request). |
| **Reviewer** | `TEAM` | Scrutinizes field reports against policy clauses. | `reports.review`, `reports.submit`, `cases.view`, `evidence.view`. |
| **Approver** | `ALL` | Executive final sign-off for insurance submission. | `reports.approve`, `reports.escalate`, `cases.view`. |
| **Accountant** | `ALL` | GST invoicing, recovery hub, client TDS, payouts. | `invoices.*`, `payments.record`, `payouts.*`, `cases.view`. |
| **Report Author** | `ASSIGNED` | Writes comprehensive investigation reports. | `reports.write`, `reports.submit`, `evidence.view`. |
| **Auditor** | `ALL` | Read-only compliance and quality inspector. | `*.view`, `audit.view` (zero write permissions). |
| **Client User** | `ASSIGNED` | Insurer portal user (scoped strictly to one client). | `cases.view` (strictly masked view, zero internal costs/fees). |

---

## 4. Scope Levels

Scope dictates which cases appear in a user's queries:

1. **`ALL`**: Can access all cases belonging to the agency (subject to permissions). Standard for Owner, Admin, Accountant, Auditor.
2. **`TEAM`**: Can access cases owned by the user's `reports_to` manager (or if the user is a Manager, all cases owned by themselves and their entire subordinate subtree).
3. **`ASSIGNED`**: Can access only cases where the user is an active assigned investigator in `case_investigators`.
4. **`OWN_ENTERED`**: Can access only cases created by the user (`data_entry_user_id = auth.uid()`). Once verified, becomes read-only unless sent back.

---

## 5. Effective Permission & Delegation Rules (A9)

### 5.1 Effective Permission Calculation
$$P_{\text{effective}} = \left( \bigcup_{r \in \text{UserRoles}} P(r) \cup P_{\text{UserALLOW}} \right) \setminus P_{\text{UserDENY}}$$
- No temporary permissions.
- Explicit `DENY` always overrides role allowances.
- Scope level is stored on the user record with a fallback to the role's default scope.

### 5.2 Manager Delegation Protocol
A manager may delegate permissions to subordinate staff under strict constraints:
1. **Subtree Only:** A manager can grant/revoke permissions *only* for users residing strictly within their `reports_to` subordinate subtree.
2. **Subset Constraint:** A manager can delegate *only* permissions that the manager currently holds. A manager cannot grant what they do not possess.
3. **No Self-Delegation:** A manager cannot modify their own permissions or scope.
4. **Scope Capped:** A manager cannot elevate a subordinate's scope to `ALL`.
5. **Full Audit:** Every delegation action records an immutable row in `audit_logs`.

---

## 6. High-Performance SQL Functions for RLS

Evaluating permissions and scopes on every row during `SELECT * FROM cases` can degrade performance if written with naive recursive subqueries. 

Vericlaim achieves **sub-millisecond evaluation** via:
1. Caching authenticated user metadata inside session variables / JWT claims.
2. Indexing `cases(agency_id, owner_manager_id, data_entry_user_id)`.
3. Indexing `case_investigators(agency_id, investigator_id, case_id)`.
4. Using non-recursive materialized path or CTE subtree helpers with `STABLE` caching.

### 6.1 `has_permission(p_permission_id text)`
```sql
CREATE OR REPLACE FUNCTION public.has_permission(p_permission_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_agency_id uuid;
  v_has boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Check explicit user DENY override first (fast fail)
  IF EXISTS (
    SELECT 1 FROM public.user_permissions
    WHERE user_id = v_user_id AND permission_id = p_permission_id AND effect = 'DENY'
  ) THEN
    RETURN false;
  END IF;

  -- 2. Check explicit user ALLOW override
  IF EXISTS (
    SELECT 1 FROM public.user_permissions
    WHERE user_id = v_user_id AND permission_id = p_permission_id AND effect = 'ALLOW'
  ) THEN
    RETURN true;
  END IF;

  -- 3. Check role permissions
  SELECT EXISTS (
    SELECT 1 
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = v_user_id AND rp.permission_id = p_permission_id
  ) INTO v_has;

  RETURN v_has;
END;
$$;
```

### 6.2 `can_view_case(p_case_id uuid)`
```sql
CREATE OR REPLACE FUNCTION public.can_view_case(
  p_case_agency_id uuid,
  p_owner_manager_id uuid,
  p_data_entry_user_id uuid,
  p_case_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_agency_id uuid;
  v_scope text;
  v_manager_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Verify caller belongs to same agency
  SELECT agency_id, scope, reports_to_id 
  INTO v_agency_id, v_scope, v_manager_id
  FROM public.users 
  WHERE id = v_user_id;

  IF v_agency_id IS NULL OR v_agency_id <> p_case_agency_id THEN
    RETURN false;
  END IF;

  -- 1. Scope ALL: Full tenant visibility
  IF v_scope = 'ALL' THEN
    RETURN true;
  END IF;

  -- 2. Scope OWN_ENTERED: Visible if caller created the entry
  IF v_scope = 'OWN_ENTERED' THEN
    RETURN p_data_entry_user_id = v_user_id;
  END IF;

  -- 3. Scope ASSIGNED: Visible if caller is assigned investigator
  IF v_scope = 'ASSIGNED' THEN
    RETURN EXISTS (
      SELECT 1 
      FROM public.case_investigators ci
      JOIN public.investigators i ON i.id = ci.investigator_id
      WHERE ci.case_id = p_case_id AND i.user_id = v_user_id
    );
  END IF;

  -- 4. Scope TEAM: Visible if case belongs to user's manager or caller is manager of owner
  IF v_scope = 'TEAM' THEN
    -- If caller owns the case directly
    IF p_owner_manager_id = v_user_id THEN
      RETURN true;
    END IF;
    -- If caller is subordinate staff, case belongs to their direct manager
    IF v_manager_id IS NOT NULL AND p_owner_manager_id = v_manager_id THEN
      RETURN true;
    END IF;
    -- If caller is a higher-level manager, check if case owner is in caller's subtree
    RETURN EXISTS (
      WITH RECURSIVE subordinates AS (
        SELECT id FROM public.users WHERE reports_to_id = v_user_id
        UNION ALL
        SELECT u.id FROM public.users u
        JOIN subordinates s ON u.reports_to_id = s.id
      )
      SELECT 1 FROM subordinates WHERE id = p_owner_manager_id
    );
  END IF;

  RETURN false;
END;
$$;
```
