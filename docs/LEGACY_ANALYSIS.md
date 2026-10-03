# Comprehensive Legacy Architecture & Business Logic Analysis

## Executive Summary
This document analyzes the legacy codebase located in `legacy/` (representing DNA Professional Investigation Agency's legacy single-tenant system). Every rule, formula, trigger, policy, and workflow is cited with precise `file:line` references.

---

## (a) Tables, Columns, Constraints, Triggers & RLS Policies

The legacy schema is defined across `legacy/db_scripts/master_setup.sql`, `legacy/db_scripts/16_security_hardening_rls_payouts_audit.sql`, and incremental patch scripts.

### 1. `agency_settings`
- **Definition:** `legacy/db_scripts/master_setup.sql:11-20`, modified by `legacy/db_scripts/master_setup.sql:514-522` and `legacy/db_scripts/master_setup.sql:826-827`.
- **Columns:**
  - `id` (text, primary key constraint `agency_settings_single_row_id CHECK (id = '1')`): Hardcoded to single-row singleton (`master_setup.sql:519-521`).
  - `agency_name` (text, default `'DNA Professional Investigation Agency'`).
  - `agency_address` (text).
  - `logo_url` / `logo` (text).
  - `phone`, `email` (text).
  - `companies` (jsonb, default 13 insurer names array; `master_setup.sql:826`).
  - `case_types` (jsonb, default 9 case types array; `master_setup.sql:827`).
  - `custom_fields_config` (jsonb array of custom field specs; `legacy/custom-fields.js:54`).
  - `field_permissions` (jsonb unstructured dumping ground storing `_staffRoles`, `_companyMappings`, and `custom_fields_config`; `legacy/role-permissions.js:59-72`, `legacy/custom-fields.js:63`).
  - `created_at`, `updated_at` (timestamptz).
- **Triggers:** `update_agency_settings_updated_at` calling `update_updated_at_column()` (`master_setup.sql:154-155`).
- **RLS Policies:**
  - `agency_settings_admin_all`: FOR ALL TO authenticated USING (`is_admin()`) WITH CHECK (`is_admin()`) (`16_security_hardening_rls_payouts_audit.sql:350-353`).
  - `agency_settings_authenticated_read`: FOR SELECT TO authenticated USING (true) (`16_security_hardening_rls_payouts_audit.sql:356-358`).

### 2. `investigators`
- **Definition:** `legacy/db_scripts/master_setup.sql:27-46`, expanded in `master_setup.sql:527-542`.
- **Columns:**
  - `id` (uuid PRIMARY KEY DEFAULT gen_random_uuid()).
  - `name` (text NOT NULL UNIQUE; `master_setup.sql:29`): Used as the foreign key target across the database!
  - `phone`, `alternate_phone` (text, unique partial index on `phone` where not null; `master_setup.sql:44`).
  - `email` (text, unique partial index on `email` where not null; `master_setup.sql:45`).
  - `address`, `city`, `state`, `pincode` (text).
  - `designation`, `employee_id`, `office_branch` (text).
  - `joining_date` (date), `experience_years` (numeric), `specialization` (text).
  - `availability` (text DEFAULT 'available').
  - `max_active_cases` (integer DEFAULT 10).
  - `payment_type` (text DEFAULT 'Per Case', values: `'Per Case'` or `'Salary'`; `master_setup.sql:33`).
  - `salary_amount` (numeric(12,2) DEFAULT 0; `master_setup.sql:34`).
  - `payment_rate`, `payment_rate_type` (numeric, text).
  - `payment_type_changed_at` (timestamptz DEFAULT now(); `master_setup.sql:35`, `539`).
  - `emergency_contact_name`, `emergency_contact_phone` (text).
  - `is_base` (boolean DEFAULT true), `removed` (boolean DEFAULT false).
  - `created_at`, `updated_at` (timestamptz), `created_by` (uuid).
- **Triggers:**
  - `update_investigators_updated_at` calling `update_updated_at_column()` (`master_setup.sql:158`).
  - `trg_investigator_audit` AFTER INSERT OR UPDATE calling `log_investigator_change()` (`master_setup.sql:578-579`).
- **RLS Policies:**
  - `investigators_admin_all`: FOR ALL TO authenticated USING (`is_admin()`) (`16_security_hardening_rls_payouts_audit.sql:310-313`).
  - `investigators_staff_read`: FOR SELECT TO authenticated for role IN ('admin', 'senior', 'junior', 'accounts') (`16_security_hardening_rls_payouts_audit.sql:316-324`).
  - `investigators_update_own`: FOR UPDATE TO authenticated for role IN ('senior', 'junior') WHERE `name = ur.investigator_name` (`16_security_hardening_rls_payouts_audit.sql:327-336`).

### 3. `cases` (Main Ledger)
- **Definition:** `legacy/db_scripts/master_setup.sql:51-108`, expanded in `14_sla_tat_exceptions_and_closure_columns.sql:8-17`, `15_add_tds_deducted_column.sql`, `master_setup.sql:753-765`.
- **Columns:**
  - `id` (uuid PRIMARY KEY DEFAULT gen_random_uuid()).
  - `doc_code` (text UNIQUE; e.g. `'JUL26-0912'`).
  - `date` (date), `received_date` (date).
  - `company` (text; e.g. `'STAR HEALTH'`).
  - `case_type` (text; e.g. `'PA'`, `'CASHLESS'`, `'REIMBURSEMENT'`, `'MB'`, `'FVR'`, `'SPOT'`, `'PROJECT'`, `'HOSPICASH'`, `'POST FACTO'`).
  - `claim_no` (text), `policy_no` (text).
  - `insured_name` (text), `hospital` (text), `location` (text).
  - `invoice_no` (text), `invoice_amount` (numeric(12,2)).
  - `inv1` (text; investigator #1 name string).
  - `inv2` (text; investigator #2 name string).
  - `fee1` (numeric(12,2)), `fee2` (numeric(12,2)).
  - `ta1` (numeric(12,2)), `ta2` (numeric(12,2)).
  - `total_payable` (numeric(12,2)): Computed sum of fees + TA allowances.
  - `received` (numeric(12,2)): Bank amount received from insurer.
  - `tds_deducted` (numeric(12,2) DEFAULT 0): Client statutory tax withheld.
  - `profit` (numeric(12,2)): Computed as `(received + tds_deducted) - total_payable`.
  - `inv1_status` (text; `'Pending'`, `'Paid'`), `inv2_status` (text).
  - `hardcopy1_status` (text; `'Pending'`, `'Received'`), `hardcopy2_status` (text).
  - `hardcopy_receive_date` (date).
  - `company_hardcopy_status` (text; `'Pending'`, `'Dispatched'`), `company_hardcopy_awb` (text), `company_dispatch_date` (date).
  - `outcome` (text DEFAULT `'Pending'`; values: `'Pending'`, `'Genuine'`, `'Fraud'`, `'Suspicious'`, `'Repudiated'`, `'Untraceable'`, `'Settled'`).
  - `sla_hours` (integer DEFAULT 24; `14_sla_tat_exceptions_and_closure_columns.sql:8`).
  - `due_date` (timestamptz; `14_sla_tat_exceptions_and_closure_columns.sql:9`).
  - `completed_at` (timestamptz; `14_sla_tat_exceptions_and_closure_columns.sql:10`).
  - `risk_level` (text; `'Low'`, `'Medium'`, `'High'`).
  - `exception_type` (text; `'Withdrawn'`, `'Rejected'`; `14_sla_tat_exceptions_and_closure_columns.sql:14`).
  - `exception_reason` (text), `exception_at` (timestamptz), `exception_by` (text).
  - `remarks` (text).
  - `custom_data` (jsonb; stores dynamic custom fields and `ta_request` sub-object; `server.js:944`, `custom-fields.js:111`).
  - `owner_id`, `created_by` (uuid REFERENCES `auth.users(id)`).
  - `created_at`, `updated_at`, `last_updated` (timestamptz).
- **Constraints & Indexes:**
  - `idx_cases_unique_company_claim` UNIQUE on `(upper(btrim(company)), upper(btrim(claim_no))) WHERE claim_no IS NOT NULL AND btrim(claim_no) <> ''` (`21_security_hardening_and_duplicate_claim_lock.sql:30-32`).
  - Indexes on `doc_code`, `company`, `date`, `inv1`, `inv2`, `due_date`, `completed_at`, `exception_type`, `sla_hours`, `outcome`.
- **Triggers:**
  - `trg_calc_case_financials` BEFORE INSERT OR UPDATE ON `cases` FOR EACH ROW EXECUTE FUNCTION `calculate_case_financials()` (`20_fix_financial_triggers_and_data_cleanup.sql:57-67`).
  - `trg_guard_case_mutations` BEFORE UPDATE OR DELETE ON `cases` FOR EACH ROW EXECUTE FUNCTION `guard_case_mutations()` (`master_setup.sql:733-735`).
- **RLS Policies:**
  - `cases_admin_full_access`: FOR ALL TO authenticated USING (`is_admin()`) (`16_security_hardening_rls_payouts_audit.sql:199-202`).
  - `cases_senior_read_access`: FOR SELECT TO authenticated WHERE role = 'senior' (Reads ALL cases; `16_security_hardening_rls_payouts_audit.sql:205-212`).
  - `cases_senior_write_access`: FOR INSERT TO authenticated WHERE role = 'senior' (`16_security_hardening_rls_payouts_audit.sql:214-221`).
  - `cases_senior_update_access`: FOR UPDATE TO authenticated WHERE role = 'senior' AND (`inv1 = ur.investigator_name` OR `inv2 = ur.investigator_name` OR `inv1` IN (SELECT `investigator_name` FROM `user_roles` WHERE role = 'junior') OR `inv2` IN junior list) (`16_security_hardening_rls_payouts_audit.sql:223-236`).
  - `cases_junior_read_access`: FOR SELECT TO authenticated WHERE role = 'junior' (Reads ALL cases; `16_security_hardening_rls_payouts_audit.sql:239-246`).
  - `cases_junior_write_access`: FOR INSERT TO authenticated WHERE role = 'junior' (`16_security_hardening_rls_payouts_audit.sql:248-255`).
  - `cases_junior_update_access`: FOR UPDATE TO authenticated WHERE role = 'junior' AND (`inv1 = ur.investigator_name` OR `inv2 = ur.investigator_name`) (`16_security_hardening_rls_payouts_audit.sql:257-265`).
  - `cases_accounts_read_access` & `cases_accounts_update_access`: FOR SELECT/UPDATE TO authenticated WHERE role = 'accounts' (`16_security_hardening_rls_payouts_audit.sql:268-284`).
  - `cases_company_portal_read`: FOR SELECT TO authenticated WHERE role = 'company' AND `ur.company_name = cases.company` (`16_security_hardening_rls_payouts_audit.sql:287-296`).

### 4. `user_roles`
- **Definition:** `legacy/db_scripts/16_security_hardening_rls_payouts_audit.sql:13-20`.
- **Columns:**
  - `user_id` (uuid PRIMARY KEY REFERENCES `auth.users(id)` ON DELETE CASCADE).
  - `role` (text NOT NULL CHECK (role IN ('admin', 'senior', 'junior', 'accounts', 'company'))).
  - `investigator_name` (text REFERENCES `investigators(name)`).
  - `company_name` (text).
  - `created_at`, `updated_at` (timestamptz).
- **RLS Policies:**
  - `user_roles_read_all`: FOR SELECT TO authenticated USING (true) (`16_security_hardening_rls_payouts_audit.sql:33-35`).
  - `user_roles_admin_insert`, `update`, `delete`: FOR INSERT/UPDATE/DELETE USING (`is_admin()`) (`16_security_hardening_rls_payouts_audit.sql:38-48`).

### 5. `investigator_payouts`
- **Definition:** `legacy/db_scripts/13_investigator_payouts_and_tds_ledger.sql:8-30`, repeated in `16_security_hardening_rls_payouts_audit.sql:411-433`.
- **Columns:**
  - `id` (uuid PRIMARY KEY DEFAULT gen_random_uuid()).
  - `investigator_name` (text NOT NULL).
  - `month_code` (text NOT NULL; e.g. `'AUG26'`).
  - `month_label` (text; e.g. `'Aug 2026'`).
  - `payout_date` (date DEFAULT CURRENT_DATE).
  - `total_cases` (numeric(10,1) DEFAULT 0).
  - `gross_fees`, `gross_ta`, `expenses_amount`, `gross_total`, `taxable_base` (numeric(10,2)).
  - `tds_rate` (numeric(5,2)), `tds_section` (text), `tds_amount` (numeric(10,2)), `net_disbursable` (numeric(10,2)).
  - `status` (text DEFAULT 'Paid'), `payment_mode` (text DEFAULT 'Bank Transfer'), `reference_no` (text).
  - `created_at` (timestamptz), `created_by` (text).
  - **Constraint:** `CONSTRAINT unique_inv_month_payout UNIQUE (investigator_name, month_code)`.
- **RLS Policies:**
  - `payouts_admin_all`: FOR ALL TO authenticated USING (`is_admin()`) (`16_security_hardening_rls_payouts_audit.sql:442-445`).
  - `payouts_accounts_all`: FOR ALL TO authenticated WHERE role = 'accounts' (`16_security_hardening_rls_payouts_audit.sql:448-461`).
  - `payouts_investigator_read_own`: FOR SELECT TO authenticated WHERE role IN ('senior', 'junior') AND `ur.investigator_name = investigator_name` (`16_security_hardening_rls_payouts_audit.sql:464-473`).

### 6. `investigator_expenses`
- **Definition:** `legacy/db_scripts/11_investigator_expenses.sql:4-15`.
- **Columns:**
  - `id` (uuid PRIMARY KEY DEFAULT gen_random_uuid()).
  - `investigator_name` (text NOT NULL).
  - `category` (text NOT NULL; `'Courier / Hardcopy'`, `'Bonus / Incentive'`, `'Travel / Fuel'`, `'Printing / Stationery'`, `'Special Allowance'`, `'Advance / Deduction'`, `'Other'`).
  - `amount` (numeric(10,2) NOT NULL DEFAULT 0).
  - `date` (date NOT NULL DEFAULT CURRENT_DATE), `month_code` (text).
  - `status` (text NOT NULL DEFAULT 'Pending'; `'Pending'`, `'Paid'`).
  - `remarks` (text), `created_at` (timestamptz), `created_by` (text).
- **RLS Policies:**
  - `expenses_admin_all`: FOR ALL TO authenticated WHERE `role = 'admin'` (`21_security_hardening_and_duplicate_claim_lock.sql:52-55`).
  - `expenses_staff_read`, `insert`, `update`, `delete`: FOR staff in ('senior', 'junior', 'accounts') (`21_security_hardening_and_duplicate_claim_lock.sql:57-76`).

### 7. `insurance_company_branches`
- **Definition:** Not in SQL scripts; created ad-hoc and queried in `legacy/gst-invoicing.js:159-163` and `452-481`.
- **Columns:**
  - `id` (uuid), `company_name` (text), `legal_name` (text), `branch_name` (text), `state` (text), `state_code` (text), `gstin` (text, 15 chars), `billing_address` (text), `is_default` (boolean), `updated_at` (timestamptz).

### 8. `activity_log` & `investigator_audit_log`
- **`activity_log`:** `master_setup.sql:836-843`, append-only policy in `16_security_hardening_rls_payouts_audit.sql:371-384`. Columns: `id`, `user_id`, `module`, `action`, `reference_id`, `created_at`.
- **`investigator_audit_log`:** `master_setup.sql:550-557`. Columns: `id`, `investigator_id` (FK), `action`, `details` (jsonb), `created_by`, `created_at`.

---

## (b) Case Financial Calculation: Trigger vs JS Equivalents

### Database Trigger (`calculate_case_financials`)
- **Location:** `legacy/db_scripts/20_fix_financial_triggers_and_data_cleanup.sql:28-51`
- **Logic:**
  ```sql
  IF NEW.exception_type = 'Withdrawn' THEN
    NEW.total_payable := 0;
  ELSE
    NEW.total_payable := COALESCE(NEW.fee1, 0) + COALESCE(NEW.fee2, 0) + COALESCE(NEW.ta1, 0) + COALESCE(NEW.ta2, 0);
  END IF;

  NEW.profit := (COALESCE(NEW.received, 0) + COALESCE(NEW.tds_deducted, 0)) - COALESCE(NEW.total_payable, 0);
  ```
- **Date Auto-Population:** If `received > 0` or `tds_deducted > 0`, sets `NEW.received_date := COALESCE(NEW.received_date, CURRENT_DATE)`.

### JavaScript Equivalent (`calculateCasePayableAndProfit`)
- **Location:** `legacy/app.js:840-875`
- **Discrepancy with Database Trigger:**
  1. The JS function inspects `investigatorRows` for both `inv1` and `inv2`. If an investigator is on `'Salary'` and `caseDate >= payment_type_changed_at`, JS sets `effectiveFee = 0`, but leaves `effectiveTa` intact (`app.js:856, 866`).
  2. The SQL trigger **never joins or checks `investigators.payment_type`**! It always adds `fee1 + fee2 + ta1 + ta2`.
  3. Consequently, whenever cases were updated via direct SQL or API scripts that did not zero out fees on the client side, `cases.total_payable` stored non-zero fees for salaried investigators!
  4. Both trigger and JS define `profit = (received + tds_deducted) - total_payable`. If `received` includes GST billed, GST liability is counted as agency profit.

---

## (c) Salary vs Per Case Fee Logic & Effective Dating

- **Trigger Points in `app.js`:**
  - `legacy/app.js:853-858` (in `calculateCasePayableAndProfit`):
    ```js
    if (inv1 && inv1.payment_type === 'Salary') {
      const typeChangedAt = inv1.payment_type_changed_at ? new Date(inv1.payment_type_changed_at) : null;
      if (!typeChangedAt || caseDate >= typeChangedAt) {
        effectiveFee1 = 0; // Salaried staff earn no per-case fee, but TA is preserved
      }
    }
    ```
  - `legacy/app.js:2952-2972` (in `computeInvStats`):
    - `const isActuallySalary = isSalary && (!typeChangedAt || caseDate >= typeChangedAt);`
    - Case weight: If both slots belong to investigator (`inv1 === name && inv2 === name`), `totalCases += 1`. If single slot, `totalCases += 0.5`.
    - **Defect in `computeInvStats`:** If `isActuallySalary` is true, the entire fee/TA calculation block is skipped (`app.js:2972`). Therefore, `totalPayable`, `paidAmt`, and `totalTA` return 0, which contradicts line 856 where TA is preserved for salaried staff.
  - `legacy/app.js:3098-3115` (in `openBulkPayment` / grouped view):
    - Renders warning if investigator is currently on Salary: *"NOTE: This investigator is currently on Salary. Individual case fees are disabled for cases assigned after their salary start date."*
  - `legacy/app.js:4009-4045` (in `renderSalaryView`):
    - Filters cases by month: `mo.y < changeY || (mo.y === changeY && mo.m < changeM) -> skip`.
    - Productivity counted as: `sum + (inv1 === rName && inv2 === rName ? 1 : 0.5)` for non-withdrawn cases (`app.js:4031-4037`).
    - Payout = `salary_amount + sum(investigator_expenses vouchers)` (`app.js:4044-4045`).

---

## (d) Monthly Payout & Statutory TDS Calculation

- **Execution in `app.js`:** `legacy/app.js:7240-7279` (`executeSettlementPaid`).
- **Calculation Rules:**
  - Base determination: `taxableBase = tax.base === 'fees_only' ? (stats.totalFees || 0) : (stats.totalPayable + expTotal)` (`app.js:7255`).
  - TDS calculation: `tdsAmount = tax.rate > 0 ? Math.round((taxableBase * tax.rate) / 100) : 0` (`app.js:7256`).
  - Gross Total: `grossTotal = (stats.totalPayable || 0) + expTotal` (`app.js:7257`).
  - Net Disbursable: `netDisbursable = Math.max(0, grossTotal - tdsAmount)` (`app.js:7258`).
  - Tax Configuration Options (`app.js:7308-7335`):
    - Section 194C (Contractor): 1% or 2%
    - Section 194J (Professional fees): 2% or 10%
    - Custom rate: input percentage
    - Base options: `'fees_only'` vs `'all'` (fees + TA + vouchers)
- **Persistence:** Upserted into `investigator_payouts` with unique conflict target `(investigator_name, month_code)` (`app.js:7282`).

---

## (e) Invoice & GST Calculation, Rounding, Branch Master

- **Location:** `legacy/gst-invoicing.js:645-745` (`calcInvoiceTotals`).
- **Forward Calculation (from itemized fee and expense):**
  - `taxable = Math.round((fee + expense) * 100) / 100` (`gst-invoicing.js:698`)
  - `gstAmount = Math.round((taxable * (gstRate / 100)) * 100) / 100` (`gst-invoicing.js:699`)
  - `totalInvoice = Math.round((taxable + gstAmount) * 100) / 100` (`gst-invoicing.js:700`)
- **Backward Calculation (back-calculating taxable from grand total):**
  - `taxable = gstRate > 0 ? Math.round((total / (1 + gstRate / 100)) * 100) / 100 : total` (`gst-invoicing.js:670`)
  - `gstAmount = Math.round((total - taxable) * 100) / 100` (`gst-invoicing.js:671`)
- **Intra-State vs Inter-State GST Split:**
  - Agency State Code extracted from first 2 digits of `agency_settings.gstin` (`gst-invoicing.js:41-47`), hardcoded fallback to `'23'` (Madhya Pradesh).
  - Client State Code from selected branch (`gst-invoicing.js:728-730`).
  - If `stateCode === agencyStateCode`: Intra-State split:
    - `CGST = Math.round((finalGst / 2) * 100) / 100` at rate `gstRate / 2`
    - `SGST = Math.round((finalGst / 2) * 100) / 100` at rate `gstRate / 2`
  - If `stateCode !== agencyStateCode`: Inter-State:
    - `IGST = finalGst` at full rate `gstRate` (`gst-invoicing.js:737`).
- **Branch Master Management:**
  - Loaded from `insurance_company_branches` (`gst-invoicing.js:156-175`).
  - Validates GSTIN is exactly 15 characters (`gst-invoicing.js:447-450`).
  - Auto-manages single `is_default` branch per company (`gst-invoicing.js:466-471`).

---

## (f) Client Payment, Short-Settlement TDS Auto-Detect & Form 26AS Matching

### Short-Settlement TDS Auto-Detection
- **Location:** `legacy/dna-bugfixes.js:521-529`, `legacy/company-recovery.js:507-526`
- **Heuristic Formula:**
  ```js
  const diff = Math.round((finalInvAmt - finalRecAmt) * 100) / 100;
  const base10 = Math.round((finalInvAmt / 1.18) * 0.10); // 10% on taxable base
  const gross10 = Math.round(finalInvAmt * 0.10);          // 10% on gross billed
  if (Math.abs(diff - base10) <= 2 || Math.abs(diff - gross10) <= 2) {
    updates.tds_deducted = diff;
  }
  ```
  - Insurers commonly deduct 10% TDS under Section 194J.
  - Some deduct 10% strictly on taxable base (excluding 18% GST).
  - Others erroneously deduct 10% on the total invoice amount including GST.
  - Legacy accepts either within a tolerance of ±₹2.

### Form 26AS / AIS Matching
- **Location:** `legacy/dna-ops-suite.js:303-435`
- **Implementation:** User inputs `company`, `fy`, `tds26AS`, and acknowledgment number.
- **Storage:** Persisted in browser `localStorage` under key `'dna_tds_26as_records_v1'` (`dna-ops-suite.js:305`)!
- **Matching Rule:** Compares `portalTds` with sum of `tds_deducted` in cases ledger for that company & FY. Shows badge `🟢 26AS Matched` if exact, or red short-deposit alert (`dna-ops-suite.js:429-432`).

---

## (g) Recovery Hub Categories & Business Rules

- **Location:** `legacy/company-recovery.js:18-94` (`getCaseBillingProfile`)
- **Categories:**
  1. `withdrawn`: Assignment cancelled by insurer (`exception_type = 'Withdrawn'`). Billed amount = 0, Balance due = 0 (`company-recovery.js:30, 36, 49`).
  2. `rejected`: Bill rejected by insurer (`exception_type = 'Rejected'`). Balance due = `billedAmt` (`company-recovery.js:38, 53`).
  3. `partially_paid`: Case where `settledAmt > 0 && balanceDue > 0` (where `settledAmt = received + tds_deducted`, `balanceDue = billedAmt - settledAmt`) (`company-recovery.js:56-61`).
  4. `billable_unpaid`: Either `balanceDue > 0` with zero payment, or completed case where `billedAmt === 0 && receivedAmt === 0 && tdsAmt === 0` (`company-recovery.js:62-70`).
  5. `paid`: Fully settled, `balanceDue === 0 && settledAmt > 0` (`company-recovery.js:72-77`).

---

## (h) SLA/TAT States & Defaults

- **Database Definition:** `legacy/db_scripts/14_sla_tat_exceptions_and_closure_columns.sql:8` defaults `sla_hours` to `24`.
- **Import Engine Definition:** `legacy/smart-merge-engine.js:316` defaults to `24`.
- **Live Ops Dashboard Conflict:** `legacy/dna-ops-suite.js:49` has:
  `const slaHrs = parseInt(c.sla_hours) || 48; // default 48h SLA if not configured`
- **TAT State Machine (`dna-ops-suite.js:40-110`):**
  - `COMPLETED`: If `completed_at` is set, or `exception_type IN ('Withdrawn', 'Rejected')`, or outcome in `('Genuine', 'Fraud', 'Suspicious', 'Repudiated', 'Settled')`.
  - `NO_SLA`: If neither `due_date` nor `date` is present.
  - `diffHours = (due_date - now) / 3600000`:
    - `diffHours < 0`: `🚨 BREACHED` (e.g. `BREACHED · 14h overdue`, red).
    - `0 <= diffHours <= 12`: `⚠️ CRITICAL` (e.g. `CRITICAL · 6h remaining`, orange).
    - `12 < diffHours <= 24`: `⏳ APPROACHING` (e.g. `DUE IN 18h`, yellow).
    - `diffHours > 24`: `🟢 ON_TRACK` (e.g. `ON TRACK (2.5d)`, green).

---

## (i) Scorecard & Fraud Heatmap Formulas

### Investigator Performance Scorecard
- **Location:** `legacy/app.js:2562-2595`, `legacy/dna-bugfixes.js:181`
- **Weights:**
  - Completion (25%): `completionPct * 0.25`, where `completionPct = round(completedCount / totalCases * 100)`. Completed case is one where investigator status is `'Paid'`.
  - Speed (25%): `speedScore * 0.25`, where `speedScore = avgDays === 0 ? 100 : Math.max(0, 100 - avgDays * 3)`. `avgDays = average((received_date - allocation_date) in days)`.
  - Hardcopy (15%): `hcPct * 0.15`, where `hcPct = round(hardcopyReceivedCount / totalCases * 100)`.
  - Received % (20%): `receivedPct * 0.20`, where `receivedPct = totalPayable ? round(totalReceived / totalPayable * 100) : 0`.
  - Volume (15%): `volumeScore * 0.15`, where `volumeScore = Math.min(100, totalCases * 8)`.
- **Final Score:**
  `score = Math.round(completionPct * 0.25 + speedScore * 0.25 + hcPct * 0.15 + receivedPct * 0.20 + volumeScore * 0.15)`.

### Hospital Fraud Heatmap
- **Location:** `legacy/app.js:9154-9189` (`buildHospitalAnalytics`)
- **Outcome Classification:**
  - `Fraud`: Outcome includes `'repudiated'`, `'fraud'`, `'fake'`, `'rejected'`, or exception includes `'rejected'`.
  - `Genuine`: Outcome includes `'approved'`, `'genuine'`, `'settled'`, `'paid'`.
  - `Suspicious`: Outcome includes `'suspicious'`, `'hold'`, `'doubt'`.
  - `Pending`: All other outcomes (excluded from resolved denominator).
- **Formulas:**
  - `resolvedCases = fraud + genuine + suspicious`
  - `riskScore = resolvedCases > 0 ? Math.round(((fraud + suspicious) / resolvedCases) * 100) : 0`
  - `isHighRisk = riskScore >= 30 && resolvedCases >= 2`
  - Warning triggered in dispatch queue if hospital is tagged `HIGH RISK` (`investigator-portal.js:878`).

---

## (j) Smart Import / Merge Parsing & Normalization Rules

- **Location:** `legacy/smart-merge-engine.js:124-450`
- **Header Synonyms:** Extended synonym dictionary for 25 columns (`smart-merge-engine.js:124-151`).
- **Deduplication Hierarchy:**
  1. Primary: Exact `(upper(company), upper(claim_no))` match against existing database cases.
  2. Secondary: Match on `claim_no` alone.
  3. Tertiary: Match on `doc_code`.
  4. Intra-batch: Duplicate rows within the same pasted batch are flagged with `isBatchDup = true` (`smart-merge-engine.js:372-380`).
- **Outcome Normalization (`smart-merge-engine.js:18-28`):**
  - Includes `'fraud'`, `'fake'`, `'bogus'`, `'fabricated'` -> `'Fraud'`
  - Includes `'repudiat'`, `'reject'`, `'deni'`, `'cancel'` -> `'Repudiated'`
  - Includes `'genuin'`, `'positive'`, `'ok'`, `'settled'`, `'approved'` -> `'Genuine'` (fixes legacy typo `'Genuie'`)
  - Includes `'suspicious'`, `'doubt'` -> `'Suspicious'`
  - Includes `'not found'`, `'untraceable'` -> `'Not Found'`
  - Includes `'closed'`, `'completed'` -> `'Settled'`
- **Exception Normalization (`smart-merge-engine.js:100-120`):**
  - `'Withdrawn'`: Triggered by `'withdrawn'`, `'withdraw'`, `'cancelled'`, `'canceled'`, `'dropped'`, `'recalled'`. Zeroes fees, TA, received, sets invoice to `'WITHDRAWN'`.
  - `'Rejected'`: Triggered by `'rejected'`, `'case rejected'`, `'repudiated by company'`. Zeroes received, sets invoice to `'REJECTED'`.

---

## (k) Investigator Portal & TA Approval Flow

- **Portal Interface:** `legacy/investigator-portal.js:500-628`
  - Field investigator enters 4-digit PIN, views assigned cases.
  - Submits case outcome, investigation remarks, and selects TA Type: Local (₹0) vs Outstation (`investigator-portal.js:515-520`).
  - For Outstation: submits `distance_km`, `requested_amount`, `reason` via `POST /api/investigator/submit-case-update`.
- **Backend Storage:** `legacy/server.js:944, 989-1035`
  - Stored inside `cases.custom_data.ta_request` JSONB!
- **Admin Approval Queue:** `legacy/investigator-portal.js:689-949`, `legacy/server.js:933-1040`
  - Route: `GET /api/admin/ta-approval/list` filters cases where `custom_data.ta_request.status` is `'pending'`.
  - Same-Hospital Batch Alert: Flags cases where multiple claims at the same hospital were visited on the same day (`investigator-portal.js:878`).
  - Actions: One-click Approve, Modify amount, or Reject (`POST /api/admin/ta-approval/action`).
  - Updating: Sets `cases.ta1` or `ta2`, updates `cases.total_payable`, updates `custom_data.ta_request.status = 'approved'`, and recalculates `cases.profit` (`server.js:996-1015`).

---

## (l) Role/Permission Matrix: RLS Enforcement vs UI Hiding

### Enforced by Database RLS (`16_security_hardening_rls_payouts_audit.sql`)
| Database Role | SELECT Cases | INSERT Cases | UPDATE Cases | DELETE Cases | Payouts Table |
|---|---|---|---|---|---|
| `admin` | ALL | ALL | ALL | ALL (`guard_case_mutations:707`) | FULL |
| `senior` | ALL (`cases_senior_read_access:205`) | ALL (`cases_senior_write_access:214`) | Own + Junior cases (`cases_senior_update_access:223`) | BLOCKED | Read own only |
| `junior` | ALL (`cases_junior_read_access:239`) | ALL (`cases_junior_write_access:248`) | Own cases only (`cases_junior_update_access:257`) | BLOCKED | Read own only |
| `accounts` | ALL (`cases_accounts_read_access:268`) | BLOCKED | Restricted to financial columns by `guard_case_mutations:710-729` | BLOCKED | FULL |
| `company` | Own company cases only (`cases_company_portal_read:287`) | BLOCKED | BLOCKED | BLOCKED | BLOCKED |

### UI-Level Hiding (`legacy/role-permissions.js:27`)
- Hides DOM elements with CSS `display: none!important` using button text regex: `^(delete|remove|clear|bulk delete|manage roles|add investigator|remove investigator|rename investigator|merge investigator)`.
- Juniors: hides bulk edit, bulk invoice, bulk pay, reconciliation, scorecard, add investigator.
- Seniors: hides reconciliation.
- Accounts: hides add case, add investigator, scorecard.
- Company: hides all management tabs.
- **Flaw:** Any user with DevTools could remove CSS classes or invoke Supabase API directly to view data because RLS permitted SELECT on ALL cases to Juniors and Seniors!

---

## (m) Custom Fields & `field_permissions`

- **Location:** `legacy/custom-fields.js:1-157`, `legacy/role-permissions.js:59-73`
- **Structure:**
  - Field metadata array: `[{ id: 'cf_123', name: 'Claim Amount', type: 'number'|'text'|'date' }]`.
  - Config stored in `agency_settings.custom_fields_config` and also mirrored in `agency_settings.field_permissions.custom_fields_config`.
  - Case values stored in `cases.custom_data` as a key-value object: `{ cf_123: 50000 }`.
- **Misuse of `agency_settings.field_permissions`:**
  - In `role-permissions.js:60-72`, `field_permissions._staffRoles` stored `{ [email]: { role, company } }`.
  - In `role-permissions.js:70-72`, `field_permissions._companyMappings` stored `{ [email]: company }`.
  - Storing user authorization mappings inside a settings table that is readable by any authenticated user (`agency_settings_authenticated_read`) was a major security hole.

---

## (n) Hardcopy & Courier Manifest Logic

- **Case Columns:** `hardcopy1_status`, `hardcopy2_status`, `company_hardcopy_status`, `company_hardcopy_awb`, `hardcopy_receive_date`, `company_dispatch_date`.
- **Dual Investigator Slot Sync:** In `22_fix_fee_slots_and_hardcopy_sync.sql:36-42`, when `inv1 = inv2`, updating `hardcopy1_status = 'Received'` forced `hardcopy2_status = 'Received'`.
- **Courier Manifest Generator (`legacy/dna-ops-suite.js:136-298`):**
  - Triggered from Bulk Document & Dispatch Manager modal (`dna-ops-suite.js:139`).
  - Filters selected cases for a specific company.
  - Inputs: Courier Partner name, AWB tracking number, dispatch date.
  - Formats an HTML table with Doc Code, Claim No, Insured Name, Policy No, Hospital, Location, Case Type, and Enclosure Checklist (Original Hospital Bills, Investigation Findings, Medical Records).
  - Previews via `openPDFPreview` or calls browser `window.print()` (`dna-ops-suite.js:298`).
  - Updates `cases.company_hardcopy_status = 'Dispatched'` and `cases.company_hardcopy_awb = awbNo`.
