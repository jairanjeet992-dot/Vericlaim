# Phase Implementation Plan & Engineering Roadmap

## 1. Phase Execution Sequence

The implementation follows the strict sequential roadmap defined in **PART A**:
$$\text{Phase L} \rightarrow \mathbf{0} \rightarrow \mathbf{1} \rightarrow \mathbf{2} \rightarrow \mathbf{3} \rightarrow \mathbf{4A} \rightarrow \mathbf{4B} \rightarrow \mathbf{5} \rightarrow \mathbf{6} \rightarrow \mathbf{7A} \rightarrow \mathbf{7B} \rightarrow \mathbf{8} \rightarrow \mathbf{9A} \rightarrow \mathbf{9B} \rightarrow \mathbf{10}$$

No phase reordering is needed; the sequence establishes foundational security, tenancy, and data structures before building operational workflows, finance, and migrations.

---

## 2. Phase-by-Phase Scope & Completion Criteria

Every phase adheres to the constitutional definition of **"Done" (AGENTS.md A2)**:
`Code + Migration + Automated Tests Passing + At Least One Negative Authorization Test + Audit Log Verified. UI-only is NOT done.`

---

### Phase L: Legacy Analysis (COMPLETED)
- **Goal:** Comprehensive audit of read-only legacy codebase without writing application code.
- **Deliverables:**
  - `docs/LEGACY_ANALYSIS.md` (all 14 sections with file:line citations)
  - `docs/LEGACY_DEFECTS.md` (catalog of security, financial, and architectural flaws)
  - `docs/GOLDEN_TESTS.md` (17 hand-computed golden vectors)
  - `docs/LEGACY_DATA_MAP.md` (column mapping and entity resolution plan)
  - `docs/OPEN_QUESTIONS.md` (Owner questions and CA-VERIFY tax ledger questions)

---

### Phase 0: Architecture & Foundation Design (CURRENT)
- **Goal:** Complete data models, state machine, permissions, scope traversal, threat models, and phase roadmap.
- **Deliverables:**
  - `docs/ERD.md` (complete schema, constraints, keys, Mermaid ERD)
  - `docs/WORKFLOW.md` (state machine, rework escalation, exception tracks)
  - `docs/PERMISSIONS.md` (permission catalog, role templates, fast SQL RLS functions)
  - `docs/SCOPE_MODEL.md` (routing engine, subtree depth cap, transfer wizard)
  - `docs/THREAT_MODEL.md` (tenant isolation, IDOR, R2 uploads, financial fraud)
  - `docs/PHASE_PLAN.md` (this document)
- **Exit Gate:** Owner review and sign-off before any code or scaffolding begins.

---

### Phase 1: Multi-Tenant Foundation, Auth & Access Control
- **Goal:** Next.js scaffolding, Supabase multi-tenant schema, custom roles, permissions, and synthetic login.
- **Key Modules:**
  - Synthetic login form `(agency_code, username, password)` resolving to `u_<uuid>@auth.<domain>`.
  - Supabase migrations: `agencies`, `plans`, `users`, `roles`, `permissions`, `manager_scopes`.
  - SQL RLS policies with `has_permission()` and `can_view_case()` functions.
- **Automated Tests:**
  - Positive test: User with `cases.view` and `ALL` scope reads agency cases.
  - Negative authorization test: User from Tenant A attempts query with Tenant B's JWT -> 0 rows returned.
  - Subtree depth trigger test: Creating a 6-level or cyclic reporting tree throws PostgreSQL exception.

---

### Phase 2: Case Management, Multi-Investigator & Status Machine
- **Goal:** Core case ledger, dynamic routing engine, $N$-investigator assignments, and optimistic locking.
- **Key Modules:**
  - `cases`, `case_investigators`, `case_status_history`, `hospitals`.
  - Dynamic routing engine resolving `(client, case_type)` to eligible manager.
  - Unique constraint on `(agency_id, client_id, claim_no)`.
- **Automated Tests:**
  - Golden tests TEST-01 and TEST-02 parity verification.
  - Negative authorization test: Field investigator attempting to view cases outside `ASSIGNED` scope gets 404/empty.
  - Optimistic locking collision test: Simultaneous edits on stale version throw conflict error.

---

### Phase 3: Evidence Management & Cloudflare R2 Uploads
- **Goal:** Secure, direct-to-R2 upload pipeline, mobile PWA camera capture, and offline IndexedDB queue.
- **Key Modules:**
  - Presigned upload endpoint `POST /api/uploads/init` with scope check and MIME allowlist.
  - Server-side completion verification `POST /api/uploads/complete` (SHA-256 and magic bytes).
  - PWA client offline queue with client-side image compression (max 1600px).
- **Automated Tests:**
  - Upload init authorization test (rejects cases outside user's scope).
  - File integrity test: Modifying byte contents before `complete` triggers checksum mismatch rejection.

---

### Phase 4A: Report Writing, Versioning & Review Engine
- **Goal:** Markdown/JSON report authoring, multi-stage approval, send-back rework tracking, and PDF compilation.
- **Key Modules:**
  - `report_versions` append-only versioning.
  - Reviewer send-back reason logger.
  - Auto-escalation trigger when `rework_count >= 3`.
  - Server-side PDF generation stored in R2 with SHA-256.
- **Automated Tests:**
  - Escalation rule test: 3rd rework automatically blocks normal approval and routes to executive queue.
  - Negative authorization test: Field author cannot approve their own report.

---

### Phase 4B: Hardcopy Tracking & Courier Manifests
- **Goal:** Physical docket transmittal slips, courier manifests, and delivery acknowledgment.
- **Key Modules:**
  - `courier_dockets`, `hardcopy_movements`.
  - Printable Courier Manifest generator with AWB tracking.
- **Automated Tests:**
  - Manifest generation parity against legacy dispatch dockets.
  - Hardcopy movement append-only integrity test.

---

### Phase 5: Smart Import & Reconciliation Hub
- **Goal:** High-throughput clipboard/Excel intake with fuzzy matching and batch rollback.
- **Key Modules:**
  - Universal parser supporting tab-separated text and CSV.
  - Intra-batch duplicate detection and outcome normalization.
  - Batch rollback engine (`rollbackImportBatch`).
- **Automated Tests:**
  - Batch rollback test: Importing 100 cases, verifying insertion, executing rollback -> complete clean deletion without side effects.
  - Synonym mapping tests for all 25 header variations.

---

### Phase 6: SLA Engine, Scorecards & Fraud Heatmap
- **Goal:** Live operational TAT monitors, investigator scorecard ranking, and hospital fraud intelligence.
- **Key Modules:**
  - Real-time SLA state machine (`BREACHED`, `CRITICAL`, `APPROACHING`, `ON_TRACK`).
  - Scorecard weighting calculation engine.
  - Hospital fraud heatmap and dispatch alert trigger.
- **Automated Tests:**
  - Golden tests TEST-14, TEST-15, TEST-16, TEST-17 unit test suite passing.

---

### Phase 7A: GST Invoicing Engine & Branch Master
- **Goal:** Statutory tax engine, client branch master, and gapless FY invoice allocation.
- **Key Modules:**
  - `client_branches` with 15-char GSTIN validation.
  - Gapless sequential invoice number allocator (`DNA/2026-27/0001`).
  - Intra-state (CGST+SGST) vs Inter-state (IGST) tax calculation using `decimal.js`.
  - Credit note issuance engine.
- **Automated Tests:**
  - Golden tests TEST-06, TEST-07, TEST-08 unit test suite passing.
  - Concurrency test: 10 simultaneous invoice requests generate sequential gapless numbers without duplicates or gaps.

---

### Phase 7B: Client Payments, Short-Settlement TDS & Recovery Hub
- **Goal:** Append-only payment ledger, Section 194J TDS auto-detection, Form 26AS reconciliation, and recovery hub.
- **Key Modules:**
  - `client_payments` with idempotency key enforcement.
  - Short-settlement TDS auto-detect heuristic (base 10% vs gross 10% within ±₹2).
  - Multi-tenant `tds_reconciliations` database ledger (replacing legacy `localStorage`).
  - Company recovery category engine (`withdrawn`, `rejected`, `partially_paid`, `billable_unpaid`, `paid`).
- **Automated Tests:**
  - Golden tests TEST-09, TEST-10, TEST-11 passing.
  - Idempotency test: Submitting duplicate payment key returns cached 200 without creating duplicate ledger row.

---

### Phase 8: Investigator Finance, Terms & Monthly Payouts
- **Goal:** Effective-dated compensation terms, outstation TA approval queue, and monthly payout settlement with TDS.
- **Key Modules:**
  - `investigator_payment_terms` (Per Case vs Salary with effective date range).
  - Admin 1-click TA approval queue with same-hospital batch alerts.
  - Monthly payout batch generator with Section 194C / 194J TDS deduction.
  - Exportable bulk NEFT/RTGS Excel generation.
- **Automated Tests:**
  - Golden tests TEST-03, TEST-04, TEST-05, TEST-12, TEST-13 passing.
  - Effective date boundary tests for salary transitions.

---

### Phase 9A: Audit Trails, DPDP Compliance & PII Protection
- **Goal:** Digital Personal Data Protection (DPDP) Act 2023 readiness, column-level masking, and HMAC blind indexing.
- **Key Modules:**
  - Append-only `audit_logs` protected by database triggers against updates/deletes.
  - PII masking on UI with audited reveal button.
  - HMAC blind indexing for searchable fields (e.g. claim number, policy number, mobile).
- **Automated Tests:**
  - RLS / Trigger test: Attempting `DELETE FROM audit_logs` raises PostgreSQL exception.
  - Audit verification: Querying a revealed PII field generates an immutable log entry.

---

### Phase 9B: Security Hardening, RLS Pentest & Rate Limiting
- **Goal:** Comprehensive penetration test of all RLS policies, rate limiting, and strict CSP headers.
- **Key Modules:**
  - Comprehensive pgTAP security test suite covering all roles and tables.
  - Rate limiting on auth endpoints and R2 upload initiations.
  - Strict Content Security Policy (CSP) blocking third-party scripts.
- **Automated Tests:**
  - Automated RLS pentest suite passing 100% of negative assertion tests.

---

### Phase 10: Production Migration Pipeline
- **Goal:** Idempotent migration tool to extract DNA legacy data, resolve entities, and populate Vericlaim.
- **Key Modules:**
  - Entity Resolution Pipeline (Exact -> Alias -> Fuzzy -> Interactive Review).
  - Unresolved entities exception reporter.
  - One-click batch rollback capability.
- **Automated Tests:**
  - Parity test: Migrated legacy database results in identical financial, SLA, and case counts as audited legacy baselines.
