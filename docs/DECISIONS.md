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

