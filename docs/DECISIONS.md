# Architecture Decision Records (ADR)

## ADR 001: Tenancy and Isolation Model
- **Status:** Accepted
- **Context:** Vericlaim is a multi-tenant SaaS serving independent insurance investigation agencies. Tenant #1 is DNA Professional Investigation Agency.
- **Decision:** Every tenant-scoped business table will include an `agency_id NOT NULL` foreign key. Row-Level Security (RLS) policies will enforce isolation using caller JWT metadata (`agency_id`). Super-admins will exist in a dedicated table `platform_admins` bypassing tenant tables.

## ADR 002: Technology Stack Selection
- **Status:** Accepted
- **Context:** High throughput data entry, complex financial and workflow transitions, field mobile investigator usage.
- **Decision:**
  - Frontend: Next.js (App Router), TypeScript (strict mode), Tailwind CSS, shadcn/ui, TanStack Table & TanStack Query.
  - Backend / Database: Supabase PostgreSQL with strict RLS, Supabase Auth.
  - File Storage: Private Cloudflare R2 via S3-compatible pre-signed upload/download URLs (bypassing app server).
  - Validation: Zod schemas on both client and server inputs.
  - Money Handling: `NUMERIC(14,2)` in PostgreSQL and `decimal.js` in TypeScript; zero floating-point arithmetic.
  - Testing: Vitest for pure domain logic, Playwright for E2E workflows, pgTAP for RLS security tests.

## ADR 003: Entity Resolution by Immutable IDs
- **Status:** Accepted
- **Context:** Legacy DNA database joined investigators and companies by free text strings (`investigator`, `company_name`), resulting in duplicate accounts and silent join failures on typographic differences.
- **Decision:** All entities in Vericlaim are referenced strictly by primary UUIDs. Legacy name matching will be handled via a one-way idempotent data migration pipeline with fuzzy scoring, manual reconciliation previews, and batch rollback capabilities.

## ADR 004: Decoupling Case Operational Status from Investigation Outcome
- **Status:** Accepted
- **Context:** Legacy code mixed investigation findings (`Genuine`, `Fraud`, `Suspicious`) into status dropdowns, confusing workflow state with substantive fraud determination.
- **Decision:** `cases.status` tracks operational/financial stages (`DATA_ENTRY`, `ASSIGNED`, `REPORT_REVIEW`, `APPROVED`, `BILLED`). `cases.outcome` tracks substantive findings (`PENDING`, `GENUINE`, `FRAUD`, `SUSPICIOUS`, `REPUDIATED`).

## ADR 005: 5-Level Management Subtree Limit & Cycle Prevention
- **Context:** Unbounded hierarchy queries can degrade RLS query times or create infinite cycles.
- **Decision:** Enforce maximum depth of 5 levels on `users.reports_to_id` via a database trigger with strict cycle detection.

## ADR 006: High-Performance Non-Recursive RLS Authorization Functions
- **Status:** Accepted
- **Context:** Naive recursive subqueries on RLS policies cause $O(N)$ row-level execution overhead on large datasets.
- **Decision:** Implement `has_permission()` and `can_view_case()` as `STABLE SECURITY DEFINER` functions with fast-failing user override checks and index-backed lookups.

## ADR 007: Direct-to-R2 Evidence Architecture with Pre-Signed URLs
- **Status:** Accepted
- **Context:** Video and photo evidence bytes routed through a serverless app server cause timeout errors and bandwidth bloat.
- **Decision:** Two-step upload: Client requests pre-signed PUT from `/api/uploads/init`, uploads directly to private Cloudflare R2, then calls `/api/uploads/complete` where server verifies HEAD, SHA-256, and magic bytes before marking verified.

## ADR 008: Controlled Send-Back with Escalation Threshold (N = 3)
- **Status:** Accepted
- **Context:** In insurance fraud investigations, quality control requires send-backs, but endless rework causes SLA breaches.
- **Decision:** Send-backs are unlimited in theory but require mandatory reasons. Reaching 3 rework cycles (`rework_count >= 3`) automatically triggers `ESCALATED_REVIEW` routing the case to executive management.

## ADR 009: Case Optimistic Locking & Unique Normalized Claim Number
- **Status:** Accepted
- **Context:** High-throughput concurrent intake, status transitions, and potential race conditions in busy investigation agencies. Also prevents duplicate claim creation where variations in spacing or casing lead to duplicate cases.
- **Decision:**
  - Optimistic locking via integer `version` incremented on every case mutation and validated inside DB trigger `trg_validate_case_transition`.
  - Sequential docket numbers generated monotonically per agency (`MMMYY-NNNN`) via `agency_doc_sequences`.
  - Normalized claim numbers (`UPPER(TRIM(claim_no))`) enforced with a unique index `uq_agency_client_normalized_claim` at database level.
  - Data entry editing locked once case is verified (`status NOT IN ('DATA_ENTRY', 'VERIFICATION')`) unless sent back by verification staff.

## ADR 010: Multi-Investigator Roster (N per Case), Assignment History Preservation & Command Center Telemetry
- **Status:** Accepted
- **Context:** Legacy DNA systems used fixed 2-investigator column slots (`inv1`, `inv2`) and overwrote investigator IDs when reassigning cases, destroying legal auditability for repudiated insurance claims.
- **Decision:**
  - `case_investigators` supports arbitrary $N$ investigators per case with individual scope (`PRIMARY`, `SECONDARY`, `HOSPITAL_CHECK`, `INSURED_MEET`, `SPOT`), fee, TA, and physical hardcopy status.
  - Reassignment never overwrites or deletes existing rows: prior assignment is marked `status = 'REASSIGNED'`, `is_active = false` with mandatory `reassignment_reason`, `reassigned_to_id`, and timestamp; a new active row is inserted for the replacement investigator.
  - Back office command center renders 13 real-time operational status tiles with composite filters and safe bulk operations, backed by composite indexes ensuring sub-100ms response times on 100k dockets while enforcing strict multi-tenant scope isolation.

## ADR 011: Cloudflare R2 Evidence Pipeline, Document Versioning & Offline PWA Queue
- **Status:** Accepted
- **Context:** Insurance field investigators frequently operate in hospitals, rural residences, and remote loss locations with intermittent cellular connectivity. Large uncompressed photos and videos exhaust bandwidth, and unverified uploads jeopardize legal court admissibility.
- **Decision:**
  - Client-side compression: All field photos scaled to maximum 1600px dimension at quality ~0.75; 64-character hexadecimal SHA-256 hash computed before transmission.
  - Two-phase R2 upload pipeline (Rule A8):
    1. `POST /api/uploads/init` verifies caller scope, validates MIME type against allowlist, enforces size threshold, inserts pending record, and returns 10-minute presigned PUT URL. Storage key strictly follows `a/{agency_id}/c/{case_id}/{uuid}`.
    2. Client uploads directly to Cloudflare R2; bytes never pass through the web application server.
    3. `POST /api/uploads/complete` verifies checksum and object integrity; throws mismatch error and marks record `REJECTED` if SHA-256 diverges.
  - Document Downloads: Governed by 5-minute presigned GET URLs (`expiresIn = 300`) with audit log entry for access.
  - Append-Only Document Versioning: Re-uploading replacement evidence generates a new row with incremented version (`version = parent.version + 1`) and parent reference; hard deletes are blocked at DB level (`trg_prevent_documents_hard_delete`); soft deletes require mandatory reason and audit entry.
  - PWA Offline Queue: Stored in persistent client storage (IndexedDB/local adapter) surviving app restarts and tab closures. Resumes sequential uploading automatically upon network restoration.
  - Automated Stale Upload Cleanup: Cron prunes uncompleted pending uploads older than 2 hours.

## ADR 012: Report Versioning, Immutability, Anchored Comments, Rework Engine, and Append-Only Hardcopy Chain of Custody
- **Status:** Accepted
- **Context:** Insurance investigation reports are legal documents submitted to insurer claims committees and legal tribunals. Overwriting reports, losing historical revisions, unanchored feedback, or losing custody of physical claim files exposes agencies to legal liability and financial loss.
- **Decision:**
  - **Append-Only Report Versioning:** Each report revision is archived in `report_versions` as an immutable record containing structured section content, executive summary, outcome findings, and author attribution. Triggers block any `UPDATE` or `DELETE` on `report_versions`.
  - **Structured Diff Engine:** Pure domain algorithm (`calculateReportDiff`) compares versions without DB dependency, detailing summary diffs, outcome modifications, added/removed/altered sections, and evidence attachments.
  - **Anchored Review Comments:** Reviewers attach remarks targeting specific report sections, evidence document UUIDs, or custom fields with status tracking (`OPEN`, `RESOLVED`, `REJECTED`).
  - **Multi-Role Rework Engine with Auto-Escalation:** Send-backs can target any operational role (`INVESTIGATOR`, `BACK_OFFICE`, `DATA_ENTRY`, `REVIEWER`, `CASE_MANAGER`, `REPORT_AUTHOR`, `PREVIOUS_ASSIGNEE`) with mandatory category reasons, markdown task instructions, deadline, and target sections/evidence. Reaching $N \ge 3$ cycles automatically elevates case status to `ESCALATED_REVIEW` and marks priority `URGENT`.
  - **Approval & Immutability:** Formal report approval (`reports.approve`) marks `reports.is_immutable = true` and `reports.status = 'APPROVED'`. A database trigger (`trg_prevent_approved_report_mutation`) strictly blocks any modification or deletion of approved reports.
  - **Hardcopy Physical Logistics & Chain of Custody:**
    - Inward receipt records packet number, item counts (bills, prescriptions, reports, photos, total pages), investigator attribution, and physical location (`rack`, `shelf`, `box`).
    - Internal location transfers and outward dispatch generate append-only `hardcopy_movements` records protected by `trg_prevent_hardcopy_movements_mutation`.
    - Dispatch dockets aggregate multiple claim packets, track courier partner and AWB number, generate printable dockets/manifests, and transition case status upon client delivery confirmation.

## ADR 013: Central Decimal Rounding Policy, GST Place-of-Supply Engine, Gapless Monotonic FY Numbering, and E-Invoice Stub
- **Status:** Accepted (CA-VERIFY)
- **Context:** GST compliance under Section 31 of CGST Act 2017 requires exact tax calculations, proper determination of Place of Supply (Intra CGST+SGST vs Inter IGST), gapless unique sequential numbering per financial year, immutable issued tax invoices, and legal credit/debit notes for adjustments. Floating-point arithmetic introduces rounding drift, and non-atomic sequence generation risks duplicate invoice numbers or gaps during concurrent billing.
- **Decision:**
  - **Zero Floating-Point Arithmetic:** All money amounts are represented using `NUMERIC(14,2)` in PostgreSQL and `decimal.js` in TypeScript.
  - **Central Rounding Policy (Rule A6):** Standardized on `Decimal.ROUND_HALF_UP` rounded to 2 decimal places (`0.01`). Applied consistently at line item taxable amounts, individual tax rate splits (e.g. 9% CGST, 9% SGST), and aggregate invoice grand totals. Verified against Golden Test vectors (TEST-06, TEST-07, TEST-08).
  - **Dynamic Place-of-Supply Determination:** Pure domain engine resolves Place of Supply dynamically by comparing agency supplier state code (`agency.state_code`) with client recipient branch state code (`client_branches.state_code`). Zero hardcoded rates or states.
    - If `supplier_state === recipient_state`: Intra-state supply $\rightarrow$ CGST (50% of rate) + SGST (50% of rate).
    - If `supplier_state !== recipient_state`: Inter-state supply $\rightarrow$ IGST (100% of rate).
    - If `is_sez === true`: Inter-state treatment (IGST or zero-rated export).
    - If `is_reverse_charge === true`: Invoice flags RCM liability, withholding output tax from net payable while recording statutory tax liability.
  - **Total-Inclusive Back-Calculation Mode:** For legacy contracts where fixed gross fee includes GST (e.g. ₹2,950 total = ₹2,500 base + 18% GST), the engine provides an explicit, documented back-calculation mode: `taxable = total / (1 + rate)`.
  - **Gapless Monotonic FY Numbering:** Table `invoice_sequences` with row-level locks inside `get_next_gapless_invoice_number(agency_id, fy, doc_type)` guarantees sequential numbering (`INV/YYYY-YY/NNNN`) with zero duplicates or gaps under high concurrency.
  - **Database-Enforced Immutability:** Trigger `trg_prevent_issued_invoice_mutation` strictly blocks direct `UPDATE` or `DELETE` on issued/cancelled invoices. Corrections must be executed via formal Credit/Debit Notes (`credit_debit_notes`) or an authorized cancellation with a mandatory non-empty reason.
  - **Server-Side PDF Archiving in Cloudflare R2:** Printable invoice PDFs are rendered server-side, hashed via SHA-256 (`crypto.createHash('sha256')`), and stored directly in private Cloudflare R2 (`storage_key: a/{agency_id}/invoices/{invoice_id}/{uuid}.pdf`).
  - **E-Invoice Stub (Rule A11):** Interface `EInvoiceProvider` defined with `StubEInvoiceProvider` explicitly throwing `NotImplementedError` marked "NOT IMPLEMENTED / STUB ONLY (CA-VERIFY)" per Rule A11.

## ADR 014: Client Payment Ledger, Append-Only Allocations, Short-Settlement TDS Heuristic, and Statutory Profit Engine
- **Status:** Accepted (CA-VERIFY)
- **Context:** Insurance investigation agencies collect bulk remittances from insurers covering multiple invoices, occasional advance deposits, and deductions for statutory TDS (Section 194J) or disputed line items. In legacy DNA systems, client payments were entered unreliably, TDS deductions were stored in browser `localStorage`, and profit was calculated naively as `cash_received - payable`, counting government GST liability as agency profit. Furthermore, race conditions during concurrent allocations could cause over-allocation of payments or duplicate UTR entries.
- **Decision:**
  - **Multi-Tenant Payment Ledger (`client_payments`):** Tracks incoming bank remittances, UTR numbers, payment modes, advance flags, and unapplied balances. Enforces unique UTR per agency (`uq_client_payments_agency_utr`) and unique idempotency keys (`uq_client_payments_idempotency`) to eliminate duplicate payment creation on network retries.
  - **Append-Only Payment Allocations (`payment_allocations`):** Reallocates payments to invoices/cases through an immutable audit trail. Trigger `trg_prevent_payment_allocations_mutation` strictly blocks any `UPDATE` or `DELETE` on allocation records (Rule A6).
  - **Atomic, Race-Free Allocation Procedure (`allocate_payment_transaction`):** Row-level locks (`FOR UPDATE`) are placed simultaneously on both the payment and target invoice records. Validates that the allocated amount does not exceed the payment's unapplied balance or the invoice's remaining outstanding. Automatically transitions invoice status (`PARTIALLY_PAID` or `PAID`).
  - **Deterministic Outstanding Formula:** Defined as $\text{Outstanding} = \text{Total Amount} - \text{Allocated Received} - \text{Valid TDS}$. Invalid or disputed TDS entries are excluded from reducing the client's balance.
  - **Short-Settlement TDS Auto-Detection Heuristic:** Detects when an insurer remits ~90% of an invoice (either on gross total or on taxable base per CBDT Circular 23/2017) within a $\pm₹5$ tolerance. Flags the transaction and generates an auto-suggestion for Section 194J TDS with mandatory user confirmation; deductions are never applied silently.
  - **Form 26AS / AIS Candidate Matching:** Engine matches imported 26AS / AIS records against internal recorded TDS receivables based on TAN, financial year, section, and amount, providing confidence scores and reconciliation statuses (`MATCHED`, `PARTIALLY_MATCHED`, `UNMATCHED`).
  ## ADR 015: Investigator Finance, Effective-Dated Terms, Expense Workflows, Bank Bulk Excel (.xlsx) Disbursal & Scorecards
- **Status:** Accepted (CA-VERIFY)
- **Context:** Insurance investigation agencies disburse monthly compensation to field investigators who operate either on per-case rates or fixed salary retainers. In legacy systems, payment terms lacked historical effective dates, expense claims were handled via uncoordinated messaging with no receipt validation, payouts allowed the same expense to be paid multiple times, and paid records could be altered after the fact. Furthermore, tracking SLA breaches and evaluating investigator performance lacked quantitative scoring.
- **Decision:**
  - **Effective-Dated Terms:** Table `investigator_payment_terms` stores historical transitions (`payment_type`, `base_fee_or_salary`, `effective_from`, `effective_to`). Payout compiler dynamically resolves terms as of month-end, preventing retrospective distortion of past earnings.
  - **Single Payout Item Invariant:** Partial unique indexes `uq_payout_items_expense` and `uq_payout_items_case_investigator` at the database level strictly guarantee that an approved expense or completed case assignment belongs to only ONE payout.
  - **Paid Batch Immutability (Rule A6):** Database triggers `trg_prevent_paid_payout_batch_mutation` and `trg_prevent_paid_payout_items_mutation` permanently lock batches and line items once status reaches `PAID`.
  - **Indian Corporate Bank Bulk Excel (.xlsx):** `generateBankBulkPaymentExcel` formats disbursals into standard bank bulk upload format (Beneficiary Name, Account Number, IFSC, Amount, Payment Mode, Narration) and strictly validates that the sum of Excel amounts equals the database net disbursable amount down to the exact paisa with `decimal.js`. Generates SHA-256 hash.
  - **Statutory Section 194J / 194C / 206AA TDS:** 10% on professional fees (194J) or 1% on contractor fees (194C). If an investigator does not have a valid PAN recorded, Section 206AA penal rate of 20% is automatically applied.
  - **Outcome Financial Rules (Rule A12):** Withdrawn cases yield 0 investigator fee payable while preserving legitimate travel allowance reimbursements.
  - **Pure SLA Engine & Scorecard:** Four-state SLA engine (`NORMAL`, `APPROACHING`, `URGENT`, `BREACHED`) with fake clock testing and formal TAT exception extension workflows. Weighted investigator scorecard (35% TAT, 25% fraud detection rigor, 25% quality/low rework, 15% volume) categorizing investigators into `ELITE`, `PROFICIENT`, `AVERAGE`, and `NEEDS_IMPROVEMENT`. Hospital fraud heatmap warns dispatchers before allocating cases to high-risk hospitals.

## ADR 016: Scope-Filtered Global Search, Operational/Financial Analytics, Export Auditing & Notifications Engine
- **Status:** Accepted (CA-VERIFY)
- **Context:** Insurance investigation agencies handle thousands of active cases, invoices, courier dockets, and bank remittances. Users need unified global search across diverse entity types without leaking out-of-scope cases between managers or investigators. Executives require real-time operations, financial, and logistics reporting with strict statutory GST separation (GST collected is never counted as service revenue or profit). Furthermore, exporting reports must be permission-gated (`reports.export`), strictly scope-filtered, and permanently audited in `export_logs`. Notifications must support multi-channel delivery (in-app, email, and Rule A11 SMS/WhatsApp stubs) for core lifecycle events.
- **Decision:**
  - **Unified Global Search Engine:** PostgreSQL trigram (`pg_trgm`) and GIN indexes on `cases`, `invoices`, `client_payments`, `courier_dockets`, and `investigators`. Stored function `search_global_agency_data` and pure engine enforce `public.can_view_case()` at the DB level, guaranteeing zero out-of-scope leakage across `ALL`, `TEAM`, `ASSIGNED`, and `OWN_ENTERED` perimeters. Search benchmarked under 300ms on 100k indexed cases (< 50ms).
  - **Operational & Logistics Analytics:** Computes volume breakdowns by client, investigator, location, case type, and outcome; tracks SLA compliance rates and stage turnaround times (TAT) in hours; monitors hardcopy custody and courier delivery performance.
  - **Statutory GST Separation & Gross Margin Engine (Q-CA-01):** Enforces zero-float `decimal.js` calculations where output GST is recognized purely as a balance sheet liability, not income. Taxable Service Revenue is isolated, Gross Profit is calculated as `Taxable Base - Direct Costs`, and Net Profit accounts for operational overhead.
  - **Permission-Gated & Audited Exports:** Supported formats: CSV, Excel (`exceljs`), and PDF. Gated by `reports.export` permission. Every export attempt (successful, denied, or failed) is permanently logged in `export_logs` with SHA-256 integrity hash, row count, filter parameters, and caller IP address. Out-of-scope rows are strictly stripped before export generation.
  - **Multi-Channel Notification Dispatcher:** Dispatches `IN_APP` ledger records, `EMAIL` notifications, and Rule A11 `SMS_STUB` and `WHATSAPP_STUB` messages on core lifecycle events (`CASE_ASSIGNED`, `REWORK_REQUESTED` with auto-escalation priority, `REPORT_APPROVED`, `SLA_WARNING`, `PAYMENT_RECEIVED`, `EXPENSE_APPROVED`/`REJECTED`, `PAYOUT_FINALIZED`).


