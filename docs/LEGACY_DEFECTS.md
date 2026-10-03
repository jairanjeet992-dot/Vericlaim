# Legacy System Defects, Security Gaps & Anti-Patterns Catalog

This catalog documents all structural defects, security vulnerabilities, calculation anomalies, and architectural risks identified in the legacy codebase (`legacy/`). Each entry includes the category, impact, evidence file:line citation, and remediation plan for Vericlaim.

---

## 1. Security Vulnerabilities & Authorization Gaps

### SEC-01: Hardcoded Master Admin Email & Bypass in Frontend
- **Citation:** `legacy/role-permissions.js:49`, `legacy/db_scripts/16_security_hardening_rls_payouts_audit.sql:54`
- **Defect:** `user.email === 'jairanjeet992@gmail.com'` was hardcoded in client JavaScript to grant `admin` role and upsert admin status into `user_roles`.
- **Impact:** Privilege escalation risk, rigid deployment coupling, zero configurability across tenants.
- **Remediation:** Remove all email hardcoding. Super-admins reside in `platform_admins`. Tenant roles are managed purely via custom roles with UUIDs.

### SEC-02: "First User Becomes Admin" Backdoor
- **Citation:** `legacy/role-permissions.js:79`
- **Defect:** If `user_roles` count is 0, the client JavaScript automatically promotes the current user to `admin` and executes an insert into `user_roles`.
- **Impact:** An attacker registering during a transient database hiccup or fresh deployment could take over the entire system.
- **Remediation:** Strictly forbidden. Tenant owners are provisioned explicitly by the platform super-admin.

### SEC-03: Hardcoded Supabase Anon API Key & URL in Source Code
- **Citation:** `legacy/role-permissions.js:10-14`
- **Defect:** Supabase project URL and full JWT anon key are hardcoded in fallback configuration objects committed to source control.
- **Impact:** Exposes public database endpoints to anyone viewing the client bundle or repository.
- **Remediation:** Strict environment variables via `.env.local` / server-side runtime injection with CSP restrictions.

### SEC-04: Client Portal Leak of Agency Margin & Investigator Fees
- **Citation:** `legacy/db_scripts/master_setup.sql:897-909` (`company_cases_view`)
- **Defect:** The SQL view granted to insurer client portal users (`ur.role = 'company'`) explicitly projects `fee1`, `fee2`, `ta1`, `ta2`, `total_payable`, and `profit`!
- **Impact:** Major business leak: Insurance company clients could directly inspect the investigator costs and net agency profits on their claims.
- **Remediation:** Dedicated client portal views with strict column whitelisting completely excluding internal payables, payouts, investigator identities, and profit margins.

### SEC-05: User Authorization Stored in Publicly Readable Settings JSON
- **Citation:** `legacy/role-permissions.js:59-73`, `legacy/db_scripts/16_security_hardening_rls_payouts_audit.sql:356-358`
- **Defect:** `agency_settings.field_permissions._staffRoles` and `_companyMappings` stored JSON mapping user emails to roles. But `agency_settings` has policy `settings_read_all USING (true)`!
- **Impact:** Any authenticated user (including external insurer staff) could read the entire agency's role allocations and internal user directory.
- **Remediation:** Separate, isolated `user_roles`, `user_permissions`, and `manager_scopes` tables protected by RLS.

### SEC-06: Form 26AS Tax Credit Records Saved to Client `localStorage`
- **Citation:** `legacy/dna-ops-suite.js:305-325`
- **Defect:** Form 26AS / AIS tax verification entries and acknowledgment numbers were stored in browser `localStorage` (`dna_tds_26as_records_v1`), never synced to PostgreSQL!
- **Impact:** Clearing browser cache wiped out statutory tax reconciliation records. Different accountants on different PCs could not see each other's 26AS entries.
- **Remediation:** Persistent, multi-tenant `tds_reconciliations` database ledger with audit trails and multi-user sync.

### SEC-07: Reliance on UI Hiding for Security
- **Citation:** `legacy/role-permissions.js:20-27`
- **Defect:** Sensitive action buttons (delete, bulk edit, bulk pay) were hidden using DOM CSS `display: none!important` matched via button label text regex.
- **Impact:** In the database RLS (`16_security_hardening_rls_payouts_audit.sql:205, 239`), Juniors and Seniors had permission to `SELECT` ALL cases. Any junior could query every case and amount via browser console.
- **Remediation:** True tenancy and scope isolation (ALL, TEAM, ASSIGNED, OWN_ENTERED) enforced at the PostgreSQL RLS layer.

---

## 2. Financial, Calculation & Tax Calculation Defects

### FIN-01: Discrepancy Between Database Trigger and Frontend Salary Calculation
- **Citation:** `legacy/db_scripts/20_fix_financial_triggers_and_data_cleanup.sql:31-40` vs `legacy/app.js:849-874`
- **Defect:**
  - In frontend JS, `calculateCasePayableAndProfit` checks `investigators.payment_type`. If `'Salary'`, it sets `effectiveFee = 0` (preserving TA).
  - In the database trigger `calculate_case_financials`, it sums `fee1 + fee2 + ta1 + ta2` unconditionally!
- **Impact:** Cases inserted or updated through imports or bulk SQL had inflated `total_payable` and deflated `profit` because fees were not zeroed for salaried investigators.
- **Remediation:** Effective-dated investigator compensation terms table (`investigator_payment_terms`) evaluated authoritatively inside pure finance service modules and verified database triggers.

### FIN-02: Misleading Profit Definition Counting GST as Income
- **Citation:** `legacy/db_scripts/20_fix_financial_triggers_and_data_cleanup.sql:39`, `legacy/app.js:873`
- **Defect:** `profit = (received + tds_deducted) - total_payable`.
  - When an agency bills ₹10,000 + 18% GST = ₹11,800, the client remits ₹11,800 (less 10% TDS on base = ₹10,800 received + ₹1,000 TDS = ₹11,800).
  - The legacy formula evaluates revenue as ₹11,800, completely failing to recognize the ₹1,800 GST output liability payable to the government!
- **Impact:** Gross overstatement of agency profitability; severe tax audit confusion.
- **Remediation:** Explicit separation of Net Revenue (Taxable Billed Amount), Output GST Liability (payable to tax authority), Client TDS Withheld (asset receivable), Total Investigator Cost (direct cost of service), and Gross Agency Margin (`Net Revenue - Direct Cost`). Logged for CA verification.

### FIN-03: Inconsistent Salaried Travel Allowance (TA) Tracking
- **Citation:** `legacy/app.js:856` vs `legacy/app.js:2972-2973`
- **Defect:**
  - Line 856 explicitly documents: *"Salaried staff earn no per-case fee, but travel reimbursement (TA) is preserved"*.
  - But in `computeInvStats` (lines 2972-2973), if `isActuallySalary` is true, the entire fee AND TA calculation loop is skipped.
- **Impact:** Travel allowances incurred by salaried staff were excluded from investigator monthly totals in `computeInvStats`!
- **Remediation:** Distinct tracking for fee components vs travel/expense reimbursements in domain entities.

### FIN-04: Floating-Point Rounding & Cumulative Rounding Drift
- **Citation:** `legacy/gst-invoicing.js:670-671`, `legacy/gst-invoicing.js:698-700`, `legacy/app.js:3033`
- **Defect:** Reliance on JavaScript IEEE 754 floating-point numbers (`parseFloat`, `Math.round((val) * 100) / 100`).
- **Impact:** In multi-case bulk invoices or cumulative annual ledgers, float representation errors accumulate off-by-one-paisa discrepancies.
- **Remediation:** Use `decimal.js` with explicit rounding mode (`ROUND_HALF_UP`) in TypeScript and `NUMERIC(14,2)` in PostgreSQL.

### FIN-05: Single Invoice Amount Field with No Credit / Debit Notes
- **Citation:** `legacy/db_scripts/master_setup.sql:754-755`, `legacy/gst-invoicing.js:648`
- **Defect:** `cases` table had a single mutable `invoice_amount` and `invoice_no` column.
- **Impact:** If an invoice had an error or partial settlement dispute, users simply edited the existing number. No audit trail of original billing, zero statutory GST credit note compliance.
- **Remediation:** Immutable invoices with sequential gapless FY numbering, snapshot PDF stored in R2, and formal GST Credit/Debit Note issuance.

---

## 3. Data Integrity & Architecture Anti-Patterns

### ARCH-01: Name-Based Entity Joining
- **Citation:** `legacy/db_scripts/master_setup.sql:132`, `legacy/db_scripts/master_setup.sql:264`, `legacy/db_scripts/master_setup.sql:907`, `legacy/db_scripts/21_security_hardening_and_duplicate_claim_lock.sql:13-27`, `legacy/app.js:5823`
- **Defect:** Investigators and companies were joined by text name strings (`inv1 = 'Anil Rajput'`, `ur.company_name = c.company`).
- **Impact:** Minor typos or casing variations (e.g. "Anil rajput kanod" vs "Anil Rajput", "Genuie" vs "Genuine") broke joins and required manual database patches. Renaming an investigator required batch-updating hundreds of historical case rows across tables (`app.js:5823, 5889`).
- **Remediation:** Foreign key references strictly using immutable UUID primary keys.

### ARCH-02: Hardcoded Two-Investigator Slot Limit
- **Citation:** `legacy/db_scripts/master_setup.sql:71-76` (`inv1`, `inv2`, `fee1`, `fee2`, `ta1`, `ta2`)
- **Defect:** Fixed columns for exactly two investigators per case.
- **Impact:** Inability to handle cases requiring three or more field operatives (e.g. simultaneous multi-city insured verification, hospital verification, employer check).
- **Remediation:** Relational `case_investigators` table supporting $N$ investigator assignments per case with individual scopes, fee models, and statuses.

### ARCH-03: Hardcoded Madhya Pradesh State Code (23) & 18% GST
- **Citation:** `legacy/gst-invoicing.js:46`, `legacy/dna-bugfixes.js:524`
- **Defect:** Fallback agency state code was hardcoded to `'23'` (MP), and GST rate hardcoded to 18% (`1.18`) in multiple scripts.
- **Impact:** Makes the SaaS unusable for agencies headquartered in Maharashtra (27), Delhi (07), Karnataka (29), or Gujarat (24), and unable to support varying service tax rates.
- **Remediation:** Configurable agency GSTIN and state master per tenant, dynamic tax schedule.

### ARCH-04: Conflicting SLA Defaults (24h in DB vs 48h in UI)
- **Citation:** `legacy/db_scripts/14_sla_tat_exceptions_and_closure_columns.sql:8` vs `legacy/dna-ops-suite.js:49`
- **Defect:** Database schema default `sla_hours` is `24`. Live monitoring dashboard (`dna-ops-suite.js`) defaulted missing `sla_hours` to `48`.
- **Impact:** Cases appeared "On Track" in the ops suite while breaching database query thresholds.
- **Remediation:** Unified SLA rule configuration per client and case type, defaulting to 24 hours unless explicitly overridden.

### ARCH-05: Monolithic 480KB Frontend Script (`app.js`)
- **Citation:** `legacy/app.js` (10,837 lines, 489,421 bytes)
- **Defect:** Entire application state, Supabase client calls, modal HTML injection, spreadsheet parsing, and reporting lumped into a single unmaintainable script.
- **Impact:** High cognitive load, severe regression risk on every edit, impossible to unit test.
- **Remediation:** Modular TypeScript architecture (`src/modules/<domain>/{domain,service,repo,schema,policy}`) with pure logic decoupled from UI and database.
