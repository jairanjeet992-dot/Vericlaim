# Project Progress & Phase Tracking

## Current Status: Phase 8 Completed (Awaiting Approval to proceed to Phase 9A)

### Phase Roadmap
- [x] **Phase L**: Legacy analysis (docs only, no app code) - COMPLETED
- [x] **Phase 0**: Design only (no app code) - COMPLETED
- [x] **Phase 1**: Multi-tenant Foundation, Auth & Access Control - COMPLETED
- [x] **Phase 2**: RBAC, Scope, Team Hierarchy, Delegation & Settings Toggles - COMPLETED
- [x] **Phase 3**: Masters (Clients, Branches, GSTIN, Case Types, Outcomes, SLA, Investigators, PII Encryption) - COMPLETED
- [x] **Phase 4A**: Case core and workflow engine - COMPLETED
- [x] **Phase 4B**: Assignment, command center, multi-investigator roster - COMPLETED
- [x] **Phase 5**: Investigation activities, evidence pipeline (R2), versioning, PWA offline - COMPLETED
- [x] **Phase 6**: Reports, review, rework engine, and hardcopy logistics - COMPLETED
- [x] **Phase 7A**: GST Invoicing Engine, Invoices, Credit Notes & Server-side PDF (CA-VERIFY) - COMPLETED
- [x] **Phase 7B**: Client Payment Ledger, Short-settlement TDS & Recovery Hub - COMPLETED
- [x] **Phase 8**: Investigator Finance, Effective-dated Terms, Expenses & Monthly Payouts - COMPLETED
- [ ] **Phase 9A**: Search, reports, exports, notifications
- [ ] **Phase 9B**: Security Hardening, RLS Pentest, Rate Limiting & CSP
- [ ] **Phase 10**: Data Migration Pipeline from Legacy DNA to Vericlaim Multi-tenant

### Phase 8 Verification Gates & Deliverables Summary (CA-VERIFY)
- **Migration**: `supabase/migrations/00010_investigator_finance_payouts_sla_scorecard.sql`:
  - `investigator_fee_rules`: Configurable fee rules per `(case_type_id, client_id, state, city)`. Base fees, default TA, special allowances.
  - `payout_batches`: Monthly corporate bank disbursal batches with gapless batch numbering (`PO-YYYY-MM-001`), totals (`total_gross`, `total_tds`, `total_advances_deducted`, `total_net_disbursable`), status (`DRAFT`, `FINALIZED`, `PAID`, `CANCELLED`), SHA-256 integrity hash, UTR payment reference. Protected by `trg_prevent_paid_payout_batch_mutation` immutability trigger blocking updates/deletes once PAID.
  - `investigator_payouts`: Per-investigator monthly payout records. Enforces one open payout per investigator per month (`uq_investigator_payouts_open_month`), payment type (`PER_CASE` vs `SALARY`), TDS section (`194J`, `194C`, `194H`, `OTHER`), TDS rate, advance recovery, and net payable.
  - `investigator_expenses`: TA and operational field expense claims (`TRAVEL_ALLOWANCE`, `FUEL`, `HOTEL`, `PRINTING_STATIONERY`, `HOSPITAL_RECORD_FEE`, `INFORMANT_FEE`, `BONUS`, `ADVANCE`, `DEDUCTION`). Full workflow (`SUBMITTED -> REVIEW -> APPROVED / REJECTED -> IN_PAYOUT -> PAID`).
  - `payout_items`: Itemized payout lines. Enforces Gate 1 unique index `uq_payout_items_expense` and `uq_payout_items_case_investigator` ensuring an expense or case fee item belongs to only ONE payout! Protected by `trg_prevent_paid_payout_items_mutation`.
  - `sla_exceptions`: Formal TAT extension request and approval workflow (`PENDING -> APPROVED / REJECTED`).
  - `hospital_profiles`: Historical fraud & adverse outcome tracker per hospital. Automated risk categorization (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) and dispatch-time warnings.
  - `investigator_scorecard_configs`: Configurable agency weights (default A12: 35% TAT, 25% fraud, 25% quality/rework, 15% volume).
  - RLS policies with idempotent non-destructive `DO $$ BEGIN IF NOT EXISTS (...)` blocks.
- **Core Modules & Pure Engines (Rule A3)**:
  - `src/modules/investigators/investigator-fees.ts`:
    - `resolveEffectivePaymentTerms`: Resolves active salary vs per-case terms as of any reference date.
    - `calculateCaseInvestigatorFee`: Multi-investigator fee calculation; strictly enforces Rule A12 (Withdrawn case -> 0 investigator payable fee).
    - `calculateInvestigatorTds`: Computes statutory TDS under Section 194J (10%), 194C (1%), and enforces Section 206AA mandatory 20% penal rate when PAN is missing or invalid.
    - `compileInvestigatorPayout` & `compilePayoutBatch`: Full aggregation and net disbursal calculation with `decimal.js` round-half-up, verifying `gross - tds - advances - deductions === net` invariant.
  - `src/modules/sla/sla-engine.ts`:
    - SLA deadline calculation with approved exception extension hours.
    - Status evaluation (`NORMAL`, `APPROACHING`, `URGENT`, `BREACHED`) with fake clock support for testing.
    - `processSlaTicker`: Background ticker evaluating active cases.
  - `src/modules/scorecard/scorecard-engine.ts`:
    - Rule A12 weighted scoring model calculating SLA compliance, fraud detection rigor, first-pass report quality without rework, and case volume.
    - Performance tiers: `ELITE` (>=85), `PROFICIENT` (>=70), `AVERAGE` (>=50), `NEEDS_IMPROVEMENT` (<50).
  - `src/modules/scorecard/hospital-fraud-engine.ts`:
    - Hospital fraud risk categorization and automated dispatch warning generator.
  - `src/modules/investigators/excel-export.ts`:
    - Generates `.xlsx` corporate bank bulk payout spreadsheet.
    - Gate 3 invariant: strictly validates that sum of Excel amounts equals DB batch net disbursable. Computes SHA-256.
  - `src/modules/investigators/pdf-payout-statement.ts`:
    - Generates server-side printable Payout Statement with earnings, deductions, bank details, and SHA-256 hash.
  - `src/modules/investigators/investigator-service.ts`:
    - Coordinates expense claim submissions, one-click admin approvals/rejections, monthly payout batch compilation, and atomic mark-paid settlement.
- **App Router UI Shell & Endpoints**:
  - `src/app/(agency)/investigator-finance/page.tsx`: Full command center dashboard with KPI tiles, monthly batches table, expense/TA approval queue, scorecards & tiers table, and hospital fraud heatmap.
  - API Routes:
    - `GET, POST /api/investigators/expenses`
    - `POST /api/investigators/expenses/[id]/approve`
    - `POST /api/investigators/expenses/[id]/reject`
    - `POST /api/investigators/payouts/compile`
    - `GET /api/investigators/payouts/[id]/excel`
    - `POST /api/investigators/payouts/[id]/pay`
    - `GET /api/investigators/scorecard`
    - `POST, PATCH /api/cases/[id]/sla/exception`
    - `GET /api/hospitals/fraud-warning`
- **Automated Verification Gates (`tests/phase8/investigator_finance_payouts_sla_gates.test.ts` - 27/27 passed, 136/136 total across suite)**:
  1. **Gate 1**: Effective-dated terms resolution (`PER_CASE` vs `SALARY` across historical date ranges).
  2. **Gate 2**: Case fee calculation with travel allowances & Rule A12 Withdrawn case = 0 fee.
  3. **Gate 3**: TDS engine: Section 194J 10%, 194C 1%, and Section 206AA 20% penal rate without PAN.
  4. **Gate 4**: Monthly payout compilation invariant (`gross - tds - advances - deductions === net`).
  5. **Gate 5**: Excel bank bulk payment export generation & invariant verification against DB total.
  6. **Gate 6**: Server-side PDF payout statement document generation with SHA-256 hash integrity.
  7. **Gate 7**: SLA engine evaluation (`NORMAL`, `APPROACHING`, `URGENT`, `BREACHED`, extension exceptions with fake clock).
  8. **Gate 8**: Scorecard engine weighted scoring & performance tier resolution (`ELITE`, `PROFICIENT`, `AVERAGE`, `NEEDS_IMPROVEMENT`).
  9. **Gate 9**: Hospital fraud heatmap risk evaluation & dispatch-time warning with manager override requirements.
  10. **Gate 10**: Negative validation tests (mandatory receipts, rejection reasons).
- **Verification Commands Executed & CI/CD Status**:
  - `npm run lint` -> Passed (0 errors, 0 warnings).
  - `npm run typecheck` -> Passed (`tsc --noEmit` exited with 0).
  - `npm run test` -> Passed (136/136 tests passing across all 10 test files).
  - `npm run build` -> Passed (All 66 App Router routes compiled into production build).
  - Remote Database: Migration `00010_investigator_finance_payouts_sla_scorecard` applied and verified.

### Phase 7B Verification Gates & Deliverables Summary (CA-VERIFY)
- **Migration**: `supabase/migrations/00009_payments_tds_receivables_recovery.sql`:
  - `client_payments`: Multi-tenant payment ledger (`agency_id`, `client_id`, `client_branch_id`, `payment_date`, `amount`, `unapplied_amount`, `payment_mode`, `utr_number`, `bank_name`, `reference_note`, `is_advance`, `idempotency_key`, `version`). Unique UTR per agency (`uq_client_payments_agency_utr`) and unique idempotency key (`uq_client_payments_idempotency`). RLS policies.
  - `payment_allocations`: Append-only invoice/case payment allocations. Protected by database immutability trigger `trg_prevent_payment_allocations_mutation` blocking all UPDATE/DELETE mutations (Rule A6).
  - `tds_receivables`: Client Section 194J / 194C TDS deductions linked to invoice/payment with `is_valid` flag, certificate number, Form 26AS status, and audit metadata.
  - `form_26as_records`: Form 26AS / AIS ledger tracking deductor TAN, deductor name, financial year, TDS deducted, amount paid, and reconciliation match status (`UNMATCHED`, `MATCHED`, `PARTIALLY_MATCHED`).
  - Stored function `get_invoice_outstanding(p_invoice_id)` implementing deterministic formula: `total_amount - (allocated_amount + valid_tds)`.
  - Stored procedure `allocate_payment_transaction`: Atomic, race-free allocation with row-level locks (`FOR UPDATE`) on payment and invoice records, strictly preventing over-allocation and managing invoice status (`PARTIALLY_PAID`, `PAID`).
- **Core Modules & Pure Engines**:
  - `src/modules/finance/payments.ts`: Pure domain engine using `decimal.js` and `ROUND_HALF_UP` (Rule A6):
    - `calculateInvoiceOutstanding`: Total Amount - Received - Valid TDS.
    - `detectShortSettlementTds`: Heuristic engine auto-detecting ~10% shortfall on Gross Total or Taxable Base (CBDT Circular 23/2017) within $\pm₹5$ tolerance with mandatory user confirmation (never applied silently).
    - `match26ASRecord`: Confidence-scored candidate matcher between imported 26AS records and internal recorded TDS receivables.
    - `calculateAgingBuckets`: Categorizes outstanding invoices into standard aging buckets (`0-30`, `31-60`, `61-90`, `90+` days).
    - `calculateProfitAndLoss`: Statutory P&L strictly separating output GST collected from service revenue, calculating gross profit as `taxable service revenue - direct investigator payable`, and reporting statutory GST liability separately (resolving Q-CA-01).
    - `classifyRecoveryItems`: Categorizes unpaid invoices and unbilled approved cases into recovery hub buckets.
  - `src/modules/finance/payment-types.ts`, `src/modules/finance/payment-schema.ts`: Zod validation schemas and type definitions.
  - `src/modules/finance/payment-service.ts`: `PaymentService` coordinating payment recording, single & bulk allocations, TDS records, Form 26AS batch imports, aging telemetry, client ledgers, and recovery items.
- **App Router UI Shell & Endpoints**:
  - `src/app/(agency)/payments/page.tsx`: Payments Command Center with 5 tabs (Overview & Ledger, Remittances & Allocations, Short-Settlement TDS, Form 26AS Matcher, Recovery Hub & Aging), new payment drawer with advance support, single/bulk allocation drawer, and short-settlement auto-suggestion modal.
  - Sidebar Navigation: Added Payments quick link to agency navigation sidebar (`src/app/(agency)/components/agency-sidebar.tsx`).
  - API Routes:
    - `GET, POST /api/payments`
    - `POST /api/payments/allocate` (Single & Bulk allocations)
    - `GET, POST /api/payments/tds`
    - `GET /api/payments/short-settlement`
    - `POST /api/payments/26as/import`
    - `GET /api/payments/ledger`
    - `GET /api/payments/aging`
    - `GET /api/payments/recovery`
    - `GET /api/payments/profit`
- **Automated Gates Passed (`tests/phase7b/payments_tds_recovery_gates.test.ts` - 24/24 passed, 109/109 total across suite)**:
  1. **Gate 1 (Golden Tests & Remittance)**: Verified full remittance with UTR, payment mode, bank name, advance payment retention, and audit logs.
  2. **Gate 2 (Duplicate UTR & Idempotency Key)**: Strictly rejects duplicate UTR within the same agency; returns existing cached payment on identical idempotency key.
  3. **Gate 3 (Over-Allocation Rejection)**: Rejects allocation exceeding invoice remaining outstanding; rejects allocation exceeding payment unapplied balance.
  4. **Gate 4 (Concurrent Payment Race & Split Allocations)**: Sequential partial allocations until full settlement; bulk multi-invoice remittance allocations.
  5. **Gate 5 (Hand-Computed Outstanding Formula)**: Verified hand-computed cases; invalid TDS strictly excluded from reducing outstanding balance.
  6. **Gate 6 (Statutory Profit Engine & GST Separation - Q-CA-01)**: Revenue strictly excludes GST collected; gross profit = service base - direct payable; GST tracked as statutory liability; flags legacy formula defect.
  7. **Gate 7 (Short-Settlement Auto-Suggestion - TEST-09, TEST-10, TEST-11)**:
     - TEST-09: Exact 10% TDS on Taxable Base (₹4,130 gross, ₹3,780 received $\rightarrow$ ₹350 TDS suggested).
     - TEST-10: Exact 10% TDS on Gross Total (₹3,000 gross, ₹2,700 received $\rightarrow$ ₹300 TDS suggested).
     - TEST-11: Non-matching shortfall (₹4,500 gross, ₹3,800 received $\rightarrow$ 0 TDS, returns null).
  8. **Gate 8 (Form 26AS / AIS Matching)**: Exact matches on TAN, FY, section, and amount; unmatched status on unknown TAN records.
  9. **Gate 9 (Aging & Recovery Hub)**: Accurate aging categorization (0-30, 31-60, 61-90, 90+); classification into recovery categories (`billable_unpaid`, `unbilled_approved`).
  10. **Gate 10 (Negative Authorization & Multi-Tenant Isolation)**: Rejects callers without `payments.record` permission; strictly isolates cross-agency payments and allocations.
- **Verification Commands Executed & CI/CD Status**:
  - `npm run lint` -> Passed (0 errors, 0 warnings).
  - `npm run typecheck` -> Passed (`tsc --noEmit` exited with 0).
  - `npm run test` -> Passed (109/109 tests passing across all 9 test files).
  - `npm run build` -> Passed (All 61 App Router routes compiled and optimized into production build).
  - Remote DB & Supabase Preview CI: Remote schema migrations synchronized (00001-00009); all migration RLS policies hardened with idempotent `DROP POLICY IF EXISTS`.
  - GitHub CI Checks on commit `faf30be`:
    - `Supabase Preview`: **PASSED / SUCCESS** (completed).
    - `Lint, Typecheck & Verification Gates`: **PASSED / SUCCESS** (completed).

### Phase 7A Verification Gates & Deliverables Summary (CA-VERIFY)
- **Migration**: `supabase/migrations/00008_invoicing_gst_credit_notes.sql`:
  - `invoice_sequences`: Monotonic, gapless financial-year sequence allocator keyed by `(agency_id, financial_year, doc_type)` with row-level locks via `get_next_gapless_invoice_number()`.
  - `invoices`: Multi-tenant invoices (`DRAFT`, `ISSUED`, `PAID`, `CANCELLED`), client branch link, gapless `invoice_number`, financial year string (`2026-27`), totals (`taxable_amount`, `cgst_amount`, `sgst_amount`, `igst_amount`, `total_amount`), RCM flag, SEZ flag, PDF storage key, SHA-256 hash, cancellation audit metadata, optimistic lock `version`, RLS.
  - `invoice_items`: Case-linked line items (fee, travel, other billable), SAC codes, taxable values, individual tax rates. Protected by `trg_prevent_invoice_items_mutation` blocking edits once invoice is issued.
  - `invoice_taxes`: Consolidated tax components per rate and jurisdiction (CGST, SGST, IGST).
  - `credit_debit_notes`: Append-only credit and debit adjustments with note number, type, reason, taxable delta, tax delta, and original invoice link. Protected by `trg_prevent_credit_notes_mutation`.
  - Database Immutability Trigger `trg_prevent_issued_invoice_mutation`: Blocks direct `UPDATE` or `DELETE` on issued/cancelled invoices; permits authorized cancellation with mandatory reason.
- **Core Modules & Pure Engines**:
  - `src/modules/finance/gst-engine.ts`: Pure domain engine using `decimal.js` and `Decimal.ROUND_HALF_UP` (Rule A6):
    - Dynamic place-of-supply resolution from agency state vs client branch state (zero hardcoded states/rates).
    - Intra-state (CGST + SGST) vs Inter-state (IGST) split, SEZ treatment, and Reverse Charge (RCM).
    - "Total-inclusive" back-calculation mode for legacy fixed contracts (`taxable = total / (1 + rate)`).
    - Full Indian English amount-in-words converter (Crores, Lakhs, Thousands, Rupees, and Paise).
    - GSTIN format & 15-character Mod-36 state code checksum validation.
    - Financial year generator (`2026-27` based on April 1 - March 31 cycle).
  - `src/modules/finance/einvoice.ts`: E-Invoice provider interface and `StubEInvoiceProvider` marked "NOT IMPLEMENTED / STUB ONLY (CA-VERIFY)" per Rule A11.
  - `src/modules/finance/pdf-invoice.ts`: Server-side printable document generation, SHA-256 hash calculation (`crypto.createHash('sha256')`), and Cloudflare R2 vault payload structure.
  - `src/modules/finance/schema.ts`: Zod validation schemas for drafting, bulk invoicing, issuing, cancelling, and credit notes.
  - `src/modules/finance/service.ts`: `InvoicingService` coordinating draft creation, bulk case aggregation, gapless numbering, case status transition to `BILLED`, immutable sealing, cancellation with reason, credit notes, and Cloudflare R2 PDF archiving.
- **App Router UI Shell & Endpoints**:
  - `src/app/(agency)/invoicing/page.tsx`: Invoicing command center with financial metrics tiles (Drafts, Issued, Paid, Cancelled, Total Billed, GST Liability), status filters, new invoice draft drawer with real-time GST preview, and bulk case invoicing drawer with closed case selector.
  - `src/app/(agency)/invoicing/[id]/page.tsx`: Tax invoice dossier with card layout, SAC line items, tax breakdown, immutable lock badge, server-side R2 PDF download, authorized cancellation modal, and credit note modal.
  - Navigation: Added Invoicing quick link to agency navigation bar (`src/app/(agency)/layout.tsx`).
  - API Routes:
    - `GET, POST /api/invoices`
    - `GET /api/invoices/[id]`
    - `POST /api/invoices/[id]/issue`
    - `POST /api/invoices/[id]/cancel`
    - `POST /api/invoices/[id]/credit-notes`
    - `GET /api/invoices/[id]/pdf`
    - `POST /api/invoices/bulk`
    - `GET /api/invoices/eligible-cases`
- **Automated Gates Passed (`tests/phase7a/invoicing_gst_gates.test.ts` - 16/16 passed, 85/85 total across suite)**:
  1. **Gate 1 (GOLDEN_TESTS for GST Pass)**:
     - TEST-06 (Intra-state MP to MP): ₹3,500 base + 9% CGST (₹315.00) + 9% SGST (₹315.00) = ₹4,130.00 total.
     - TEST-07 (Inter-state MP to MH): ₹4,750 base + 18% IGST (₹855.00) = ₹5,605.00 total.
     - TEST-08 (Total-Inclusive back-calculation): ₹2,950 gross $\rightarrow$ ₹2,500.00 base + 9% CGST (₹225.00) + 9% SGST (₹225.00).
  2. **Gate 2 (Tax Calculation Edge Cases)**:
     - Multi-rate line items (5% + 18%) with exact rounding.
     - SEZ zero-rated supplies (0% tax rate).
     - Reverse Charge Mechanism (RCM) tax liability computation.
     - Rounding policy validation: `ROUND_HALF_UP` on fractions (e.g. ₹100.005 $\rightarrow$ ₹100.01).
     - Indian amount in words: e.g. ₹12,34,567.89 $\rightarrow$ "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Paise Only".
     - GSTIN validator checks state prefix, length, and format.
  3. **Gate 3 (DB Rejects UPDATE on Issued Invoice)**:
     - Database trigger `prevent_issued_invoice_mutation` strictly blocks direct `UPDATE` or `DELETE` on issued/cancelled invoices.
     - Line items table `prevent_invoice_items_mutation` blocks item modifications on issued invoices.
  4. **Gate 4 (Concurrent Numbering Test Produces No Gaps / Duplicates)**:
     - 15 concurrent sequence requests against `invoice_sequences` produced 15 unique, gapless sequential numbers (`INV/2026-27/0001` through `INV/2026-27/0015`) with zero collisions and zero gaps.
  5. **Gate 5 (PDF Hash Stored and Verified)**:
     - Generated server-side printable PDF, computed SHA-256 hash (`crypto`), uploaded to Cloudflare R2, verified hash match on retrieval, and verified 5-minute presigned download URL generation.
  6. **Gate 6 (Negative Authorization & Audit Trails)**:
     - Cross-agency isolation verified (Agency B cannot access or modify Agency A invoices).
     - Permissions enforcement verified (`invoices.write`, `invoices.issue`, `invoices.cancel`).
     - Cancellation requires non-empty reason; Credit Notes require non-empty reason and strictly append-only.
- **Verification Commands Executed**:
  - `npm run lint` -> Passed (0 errors, 0 warnings).
  - `npm run typecheck` -> Passed (`tsc --noEmit` exited with 0).
  - `npm run test` -> Passed (85/85 tests passing across all 8 test files).
  - `npm run build` -> Passed (All App Router routes compiled and optimized into production build).


### Phase 6 Verification Gates & Deliverables Summary
- **Migration**: `supabase/migrations/00007_reports_review_rework_hardcopy.sql`:
  - `reports`: Primary lifecycle table (`DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `SENT_BACK`, `CORRECTED`, `RESUBMITTED`, `APPROVED`, `FINAL`), optimistic lock `version`, `is_immutable`, approval metadata, RLS.
  - `report_versions`: Append-only archive storing complete snapshots (`v1..vN`), JSONB structured section content, author attribution, change summary notes. Protected by trigger `trg_prevent_report_versions_mutation` blocking all `UPDATE` and `DELETE`.
  - `report_comments`: Reviewer comments anchored to specific sections, evidence document UUIDs, or custom field names. Supports status workflow (`OPEN`, `RESOLVED`, `REJECTED`).
  - `rework_cycles`: Multi-role rework send-backs with recipient role enum (`INVESTIGATOR`, `BACK_OFFICE`, `DATA_ENTRY`, `REVIEWER`, `CASE_MANAGER`, `REPORT_AUTHOR`, `PREVIOUS_ASSIGNEE`), reason category, actionable instructions, priority, deadline, target sections/fields/evidence, cycle number, and escalation flag.
  - `courier_dockets`: Outward dispatch dockets tracking courier partner, AWB number, dispatched timestamp, delivery status (`PENDING`, `IN_TRANSIT`, `DELIVERED`, `RETURNED`), recipient POD acknowledgement, and R2 key.
  - `hardcopy_packets`: Case document packets with itemized counts (bills, prescriptions, reports, photos, total pages), physical archive location (`rack`, `shelf`, `box`), inward receipt attribution, and docket linkage.
  - `hardcopy_movements`: Append-only chain of custody audit movements (`RECEIVED_FROM_INVESTIGATOR`, `STORED_IN_ARCHIVE`, `RETRIEVED_FOR_REVIEW`, `PACKED_FOR_DISPATCH`, `DISPATCHED_TO_CLIENT`, `DELIVERY_ACKNOWLEDGED`, `RETURNED`). Protected by trigger `trg_prevent_hardcopy_movements_mutation`.
  - Immutability trigger `trg_prevent_approved_report_mutation`: Blocks direct `UPDATE` or `DELETE` on approved reports.
- **Core Modules & Pure Engines**:
  - `src/modules/reports/diff.ts`: Pure diff calculation engine identifying summary changes, substantive outcome shifts, added/removed/altered sections, text changes, and attached evidence updates.
  - `src/modules/reports/rework.ts`: Pure rework rules engine managing auto-escalation evaluation at $N \ge 3$ (setting case status `ESCALATED_REVIEW` and priority `URGENT`) and generating structured markdown task payloads for assignees.
  - `src/modules/reports/schema.ts`: Zod validation schemas for drafting, submitting, commenting, reworking, approving, inwarding, dispatching, and delivery acknowledging.
  - `src/modules/reports/service.ts`: `ReportsService` coordinating case report lifecycle, anchored feedback, rework cycles, approval locking, physical inwarding, location transfer, dispatch dockets, and chain of custody tracking.
- **App Router UI Shell & Endpoints**:
  - `src/app/(agency)/reports/page.tsx`: Central quality control queue filtering by Under Review, Sent Back, Escalated ($N \ge 3$), and Approved.
  - `src/app/(agency)/hardcopy/page.tsx`: Logistics command dashboard with outward dockets, delivery tracking, POD acknowledgement, and printable courier manifest modal.
  - `src/app/(agency)/cases/[id]/report-tab.tsx`: Interactive case report tab supporting real-time draft saves, submission, anchored reviewer feedback, rework cycle tracking, multi-version diff inspection, and formal approval modal.
  - `src/app/(agency)/cases/[id]/hardcopy-tab.tsx`: Hardcopy custody tab with inwarding form, rack/shelf/box location updates, and visual append-only chain of custody timeline.
  - Case View Integration: Both tabs wired into `src/app/(agency)/cases/[id]/page.tsx`.
  - API Routes:
    - `GET, POST /api/cases/[id]/report`
    - `POST /api/cases/[id]/report/submit`
    - `POST /api/cases/[id]/report/comments`
    - `PATCH /api/cases/[id]/report/comments/[commentId]`
    - `POST /api/cases/[id]/report/rework`
    - `POST /api/cases/[id]/report/rework/[cycleId]/correction`
    - `POST /api/cases/[id]/report/approve`
    - `GET /api/cases/[id]/report/diff`
    - `GET, POST /api/cases/[id]/hardcopy/packets`
    - `PATCH /api/cases/[id]/hardcopy/packets/[packetId]/location`
    - `GET /api/cases/[id]/hardcopy/custody`
    - `GET, POST /api/hardcopy/dockets`
    - `POST /api/hardcopy/dockets/[docketId]/acknowledge`
    - `GET /api/hardcopy/dockets/[docketId]/manifest`
- **Automated Gates Passed (`tests/phase6/reports_rework_hardcopy_gates.test.ts` - 4/4 passed, 69/69 total across suite)**:
  1. **Gate 1 (5 Rework Cycles Preserve All Versions)**: Verified report lifecycle through 5 consecutive rework cycles (v1 original draft + 5 rework submissions = 6 discrete immutable versions retained). At cycle 3 ($N \ge 3$), auto-escalation triggered, elevating case status to `ESCALATED_REVIEW` and priority to `URGENT`. Pure diff engine accurately calculated text, section, and evidence diffs across all versions.
  2. **Gate 2 (Approved Report Immutable)**: Formally approved report sealed with `is_immutable = true` and `status = 'APPROVED'`. Rejects draft updates, new comments, rework initiations, and correction submissions. Database trigger `prevent_approved_report_mutation` and append-only trigger `prevent_report_versions_mutation` reject direct UPDATE and DELETE queries.
  3. **Gate 3 (Hardcopy Movements Cannot Be Edited/Deleted)**: Managed full physical logistics lifecycle: packet inwarding, archive storage location update, multi-packet dispatch docket creation, printable courier manifest generation, and client POD delivery acknowledgement (transitioning case to `CLOSED` for billing). Trigger `prevent_hardcopy_movements_mutation` strictly rejected UPDATE and DELETE on custody rows.
  4. **Gate 4 (Scope Negatives & Authorization Checks)**: Cross-agency isolation verified (Agency B cannot access or create reports for Agency A cases); unassigned investigator denied report access under `ASSIGNED` scope; missing permission negative tests verified (`reports.write`, `reports.approve`, `reports.review`, `hardcopy.receive`); immutable audit logs verified.
- **Verification Commands Executed**:
  - `npm run lint` -> Passed (0 errors, 0 warnings).
  - `npm run typecheck` -> Passed (`tsc --noEmit` exited with 0).
  - `npm run test` -> Passed (69/69 tests passing across all 7 test files).

- **Migration**: `supabase/migrations/00006_investigation_evidence_pwa.sql`:
  - `investigation_activities`: 11 standard & custom activity types (`FIELD_VISIT`, `RESIDENCE_VERIFICATION`, `HOSPITAL_VERIFICATION`, `EMPLOYMENT_VERIFICATION`, `DOCUMENT_VERIFICATION`, `CLAIMANT_INTERVIEW`, `WITNESS_INTERVIEW`, `TELEPHONIC_VERIFICATION`, `MEDICAL_RECORDS_CHECK`, `SPOT_INVESTIGATION`, `CUSTOM`), task instructions, assignee, due date, status, notes, completion notes, completed_at timestamp.
  - `documents`: Private Cloudflare R2 evidence storage vault per Rule A8 (`storage_key: a/{agency_id}/c/{case_id}/{uuid}`), SHA-256 integrity hash, claimed metadata (GPS coordinates, accuracy, capture timestamp), verification status, document versioning (`parent_document_id`, `version`), soft delete columns (`deleted_at`, `deleted_by`, `delete_reason`).
  - Database trigger `trg_prevent_documents_hard_delete` preventing hard deletes.
  - Stored procedure `prune_stale_pending_uploads` for cron cleanup.
- **Core Modules & Engines**:
  - `src/modules/evidence/types.ts`: Comprehensive interfaces for activities, evidence documents, upload init/complete, and offline queue items.
  - `src/modules/evidence/schema.ts`: Zod validation schemas with MIME allowlist (JPEG, PNG, WebP, HEIC, MP4, WebM, QuickTime, PDF, MP3, WAV, AAC) and strict size thresholds (20MB-100MB).
  - `src/modules/evidence/storage.ts`: S3/R2 client wrapper managing presigned upload PUT (10-min expiry = 600s), presigned download GET (5-min expiry = 300s), object HEAD inspection, and deterministic mock fallback for offline/test environments.
  - `src/modules/evidence/service.ts`: EvidenceService coordinator handling upload init, complete with SHA-256 verification and status update, presigned downloads with audit logs, soft deletes, document versioning, activity lifecycle, and cleanup cron.
  - `src/modules/evidence/offline-queue.ts`: Persistent offline upload queue manager with persistent storage adapter that survives app restarts, sequential retry execution, and auto-resume.
  - `src/modules/evidence/image-compressor.ts`: Client-side field image compression utility (max 1600px, quality ~0.75) and SHA-256 calculation.
- **App Router UI Shell & Endpoints**:
  - `src/app/(agency)/investigator/page.tsx`: Mobile-first installable PWA dashboard with big touch targets, network status indicator, camera/media capture, claimed GPS capture, activity completion modal, and persistent offline queue sync widget.
  - `src/app/(agency)/cases/[id]/page.tsx`: Enhanced with "Investigation Activities" tab and "Evidence Vault & Gallery" tab featuring category filters, version indicators, SHA-256 copyable hashes, claimed GPS badges, and 5-min presigned downloads.
  - PWA Infrastructure: `public/manifest.json` (standalone display, icons, metadata) and `public/sw.js` (caching app shell and network fallback) registered via `src/app/pwa-register.tsx`.
  - API Routes:
    - `POST /api/uploads/init`
    - `POST /api/uploads/complete`
    - `GET /api/documents/[id]/download`
    - `DELETE /api/documents/[id]`
    - `GET /api/cases/[id]/evidence`
    - `GET, POST /api/cases/[id]/activities`
    - `PATCH /api/cases/[id]/activities/[activityId]`
    - `POST, GET /api/cron/cleanup-uploads`
    - `GET /api/investigator/dashboard`
- **Automated Gates Passed (`tests/phase5/investigation_evidence_pwa_gates.test.ts` - 8/8 passed, 65/65 total across suite)**:
  1. **Gate 1 (Checksum-Mismatch Rejected)**: Reject upload when provided SHA-256 or object hash mismatches expected hash; marks document `REJECTED`; verifies upload complete succeeds when checksum matches and marks `VERIFIED`.
  2. **Gate 2 (Cross-Case and Cross-Agency File Access Denied)**: Agency B user denied download or upload into Agency A dockets; Investigator 2 denied access to Case 1 files outside their assigned scope; Manager A and assigned Investigator 1 have authorized access.
  3. **Gate 3 (Presigned URLs Expire)**: Presigned PUT URL expires in strictly 10 minutes (600s); Presigned GET URL expires in strictly 5 minutes (300s).
  4. **Gate 4 (Investigator Cannot See Unassigned Cases)**: Scoped queries with `ASSIGNED` scope return strictly cases assigned to caller; unassigned cases and cases assigned to peers are completely inaccessible.
  5. **Gate 5 (Queue Survives App Restart)**: Items enqueued in Session 1 survive complete app destruction/restart; Session 2 seamlessly reloads queue from persistent storage and executes sequential uploads to completion.
  6. **Gate 6 (Cleanup Cron Works)**: Prunes stale pending uploads (> 2 hours old) from database and storage; preserves recent pending uploads and verified documents.
  7. **Gate 7 (Investigation Activities Lifecycle)**: Covers full activity lifecycle (create, update in progress, complete with mandatory findings summary).
  8. **Gate 8 (Document Versioning & Soft Delete)**: Verifies replacement documents increment version (`v1 -> v2`) and maintain parent linkage; verifies soft deletion requires reason and records audit log.
- **Verification Commands Executed**:
  - `npm run lint` -> Passed (0 errors, 0 warnings).
  - `npm run typecheck` -> Passed (`tsc --noEmit` exited with 0).
  - `npm run test` -> Passed (65/65 tests passing across all 6 test files).
  - `npm run build` -> Passed (All 41 App Router routes compiled and optimized into production build).

### Phase 4B Verification Gates & Deliverables Summary
- **Migration**: `supabase/migrations/00005_assignment_and_command_center.sql`:
  - Enhanced `case_investigators` (N per case): `assignment_scope`, `assigned_by`, `agreed_fee`, `travel_allowance`, `payout_status`, `hardcopy_status`, `rejection_reason`, `reassignment_reason`, `reassigned_to_id`, `override_reason`, `is_active`, `assigned_at`, `accepted_at`, `rejected_at`, `reassigned_at`, `version`.
  - Created `command_center_saved_filters` with RLS allowing users to save and recall customized filter combinations.
  - Added composite indexes on `cases` for command center query performance (`agency_id, status, risk_level, due_date`, `agency_id, owner_manager_id, status`, `agency_id, location_city, location_state`).
  - Updated `can_view_case` function to support assigned investigators with `ASSIGNED` scope linking through `case_investigators`.
- **Core Modules & Engines**:
  - `src/modules/assignment/eligibility.ts`: Pure eligibility ranking algorithm calculating territory matching (pincode +35, city +25, state +10), operational capacity utilization (workload score 0 to 25), specialization/case type matching (0 to 20), cluster proximity bonus (+10 for active cases in same territory today), and SLA rating (+10).
  - `src/modules/assignment/schema.ts`: Zod schemas for assignment, acceptance, decline/rejection, reassignment, and hardcopy status tracking.
  - `src/modules/assignment/service.ts`: Assignment lifecycle coordinator handling effective fee resolution per Golden Tests (Per Case vs Salary), acceptance, rejection, reassignment history preservation, and hardcopy document status.
  - `src/modules/cases/command-center.ts`: Command Center telemetry service calculating 13 operational tile counts, composite filters, saved filters manager, and safe bulk actions with strict scope isolation.
- **UI Shell & App Router Pages**:
  - `src/app/(agency)/command-center/page.tsx`: Dense, real-time command center with 13 status tiles (New, Verification Pending, Assignment Pending, Investigator Pending, In Progress, Report Pending, Corrections Pending, Resubmitted, Approval Pending, Hardcopy Pending, Billing Pending, Payment Pending, SLA Breached), composite filter bar, saved filter presets, safe bulk action bar, and TanStack-styled ledger.
  - `src/app/(agency)/cases/[id]/page.tsx`: Enhanced with "Field Assignments" tab featuring active investigator cards, eligibility ranking drawer with score breakdown, action triggers (Accept, Decline, Reassign), and complete historical assignment ledger.
  - Navigation: Added Command Center quick link to agency navigation bar.
- **Automated Gates Passed (`tests/phase4b/assignment_command_center_gates.test.ts` - 13/13 passed, 57/57 total across suite)**:
  1. **Gate 1 (Reassignment Preserves History)**: When a case is reassigned, the prior assignment record is permanently preserved with `status = 'REASSIGNED'`, `reassignment_reason`, and `reassigned_to_id`; a new active row is inserted for the new investigator. Full historical ledger is verified.
  2. **Gate 2 (Fee Computation Matches GOLDEN_TESTS)**:
     - TEST-01 (Two investigators on Per Case): total payable = 1,150.00, profit = 2,350.00.
     - TEST-03 (Salaried assigned after salary start date): fee = 0.00, TA = 250.00, total payable = 250.00.
     - TEST-04 (Salaried assigned before salary start date - Grandfathered): fee = 750.00, TA = 250.00, total payable = 1,000.00.
     - TEST-05 (Withdrawn case zero-payable rule): total payable = 0.00.
  3. **Gate 3 (Filters Never Leak Out-of-Scope Rows)**: Manager A with `TEAM` scope never receives Manager B cases under ANY filter combination (location, status, or search); Staff A sees only reporting manager's cases; Investigator sees only assigned cases under `ASSIGNED` scope.
  4. **Gate 4 (Performance Benchmark Under 300ms on 100k Cases)**: Command Center 13-tile telemetry calculation and paginated search against 100,000 cases completed in **58.18ms** (well below the 300ms threshold).
  5. **Gate 5 (Eligibility Ranking Engine)**: Accurately computes ranking scores, detects overloaded candidates, flags territory mismatches, and awards cluster bonus.
  6. **Gate 6 (Negative Authorization & Validation)**: Rejects assignments without `cases.assign` permission; rejects rejection or reassignment without mandatory reasons.
  7. **Gate 7 (Audit Log Verification)**: Verifies append-only audit trail for all assignment and reassignment mutations.
- **Verification Commands Executed**:
  - `npm run lint` -> Passed (0 errors, 0 warnings).
  - `npm run typecheck` -> Passed (`tsc --noEmit` exited with 0).
  - `npm run test` -> Passed (57/57 tests passing across all 5 test files).
  - `npm run build` -> Passed (All 36 App Router routes compiled and optimized into production build).

### Phase 4A Verification Gates & Deliverables Summary
- **Migration**: `supabase/migrations/00004_case_core_and_workflow.sql`:
  - `agency_doc_sequences`: Agency-configurable sequential monotonic numbering for docket codes (`MMMYY-NNNN`).
  - Added full claim columns to `cases`: `claim_no`, `normalized_claim_no`, `policy_no`, `insured_name`, `patient_name`, `hospital_name`, `claim_amount`, `risk_level`, `custom_fields`, `outcome`, `fraud_reason`, `exception_type`, `version`, `rework_count`, `completed_at`.
  - Database unique index `uq_agency_client_normalized_claim` on `(agency_id, client_id, normalized_claim_no)` guaranteeing case and whitespace uniqueness at SQL level.
  - Table `case_status_transitions`: Seeded with complete `WORKFLOW.md` matrix, transition rules, required permissions, and reason requirements.
  - Table `case_status_history`: Append-only transition history with trigger `trg_prevent_case_status_history_mutation` blocking UPDATE/DELETE.
  - Tables `case_notes` and `case_tasks`: Case discussion logs and operational tasks.
  - Stored procedure `generate_case_doc_code(agency_id)` allocating sequential docket numbers per agency.
  - Database trigger `trg_validate_case_transition`: Enforces legal transitions, blocks unauthorized transitions, validates optimistic locking version increment (`NEW.version = OLD.version + 1`), and auto-populates `case_status_history`.
  - Database trigger `trg_enforce_data_entry_lock`: Prevents users with `OWN_ENTERED` scope / Data Entry role from editing claim fields once case is verified (`status NOT IN ('DATA_ENTRY', 'VERIFICATION')`).
- **Core Modules & Engines**:
  - `src/modules/workflow/engine.ts`: Pure TypeScript workflow state machine (0 external DB/UI imports) implementing `WORKFLOW_TRANSITIONS`, `validateTransition`, `resolveReworkStatus` with auto-escalation at $N \ge 3$, `validateOutcome`, and `resolveExceptionFinancialRule`.
  - `src/modules/cases/schema.ts`: Zod schemas for case creation, updates, workflow transitions, notes, and tasks.
  - `src/modules/cases/service.ts`: Case lifecycle coordinator handling doc code generation, normalized claim deduplication, dynamic custom field validation via Phase 3 Zod compiler, owner-manager routing (`manager_scopes`), optimistic locking, transition execution, notes, tasks, and unified timeline generation.
- **UI Shell & App Router Pages**:
  - `src/app/(agency)/cases/page.tsx`: Dense professional docket ledger with search, status filters, risk indicators, and Intake Modal supporting dynamic custom fields per case type.
  - `src/app/(agency)/cases/[id]/page.tsx`: Full case record view with status/outcome/risk badges, workflow transition modal with reason capture and rework escalation warnings, and multi-tab interface (Overview, Timeline, Notes, Tasks).
  - API endpoints: `/api/cases`, `/api/cases/[id]`, `/api/cases/[id]/transition`, `/api/cases/[id]/notes`, `/api/cases/[id]/tasks`, `/api/cases/[id]/timeline`.
- **Automated Gates Passed (`tests/phase4a/case_workflow_gates.test.ts` - 10/10 passed, 44/44 total across suite)**:
  1. **Gate 1 (Illegal Transitions Rejected at DB Level)**: Database trigger and pure engine reject unauthorized transition (`DATA_ENTRY -> CLOSED`); reject transitions missing required permissions; reject send-back without mandatory reason; and enforce automatic escalation when `rework_count >= 3`.
  2. **Gate 2 (Concurrent Transition Test - Optimistic Locking)**: Two concurrent transitions attempt to mutate the same case version; exactly one transition succeeds and advances version; the second transition is rejected with `Concurrent modification collision: Expected version 1, got 1`.
  3. **Gate 3 (Duplicate Claim Rejected incl. Case/Whitespace Variants)**: Rejects exact duplicates, leading/trailing whitespace variants (`  CLM-DUP-001  `), and mixed-case variants (`clm-dup-001`) under the same client and agency.
  4. **Gate 4 (Data Entry Edit Lock & Send-Back)**: Data entry author can edit own case in `DATA_ENTRY`. When submitted to `VERIFICATION`, back-office sends back with reason (`VERIFICATION -> DATA_ENTRY`), unlocking data entry edits. Once manager verifies (`VERIFICATION -> ASSIGNMENT`), data entry edits are permanently locked with `A9 Violation: Data entry cannot edit case after verification`.
  5. **Gate 5 (Scope Rules from Phase 2 Hold on Real Cases)**: Manager A sees only Manager A's cases under `TEAM` scope; Staff A sees only their reporting manager's cases under `TEAM` scope; Owner sees all cases under `ALL` scope.
  6. **Gate 6 (Outcome & Fraud Reason Validation)**: Rejects `outcome = 'FRAUD'` without a descriptive `fraud_reason`. Recording outcome does not alter workflow status.
  7. **Gate 7 (Case Exception Lifecycle with Financial Rules)**: Setting exception type `WITHDRAWN` automatically triggers financial rule overriding investigator payable fee to 0.00.
  8. **Gate 8 (Dynamic Custom Fields Schema Validation)**: Intakes validate required and optional custom fields against the case type definition compiled via Zod compiler; rejects missing required custom fields.
  9. **Gate 9 (Case Timeline Aggregation, Notes & Tasks)**: Timeline combines case creation, transitions, status history, notes, and tasks in chronological order.
  10. **Gate 10 (Owner-Manager Routing & Unrouted Queue)**: Resolves single eligible manager from `manager_scopes`; alerts unrouted queue when no matching manager exists.
- **Verification Commands Executed**:
  - `npm run lint` -> Passed (0 errors, 0 warnings).
  - `npm run typecheck` -> Passed (`tsc --noEmit` exited 0).
  - `npm run test` -> Passed (44/44 tests passing across all test files).
  - `npm run build` -> Passed (All App Router routes compiled and optimized into production build).

### Phase 3 Verification Gates & Deliverables Summary
- **Migration**: `supabase/migrations/00003_masters.sql`:
  - Tables: `client_branches`, `client_contacts`, `client_rate_cards`, `case_types`, `outcomes`, `sla_policies`, `investigators`, `investigator_payment_terms`.
  - Stored procedures & triggers: `seed_agency_masters(p_agency_id, p_owner_user_id)` seeding standard PA, Cashless, Reimbursement case types, Genuine/Fraud/Suspicious/Withdrawn outcomes, and SLA policies.
  - Multi-tenant RLS policies on all masters tables filtering by `agency_id = current_setting('app.current_agency_id')`.
- **Core Modules & Engines**:
  - `src/lib/validation/gstin.ts`: Official Indian GSTIN validator with state code lookup and Luhn MOD 36 checksum verification.
  - `src/lib/security/encryption.ts`: AES-256-GCM authenticated field encryption, HMAC-SHA256 blind indexing for exact searches, and masking utilities (`maskPan`, `maskBankAccount`).
  - `src/modules/masters/case-types.ts`: JSON-driven custom field definitions schema compiler validated dynamically via Zod (`compileCustomFieldsSchema`).
  - `src/modules/masters/investigators.ts`: Effective-dated payment term resolution (`resolveEffectivePaymentTerm`), fee calculation engine (`calculateInvestigatorFeeForCase`), and PII encryption preparation.
  - `src/modules/masters/service.ts`: Audited CRUD coordinator for clients, branches (with GSTIN validation), case types, outcomes, SLA policies, and investigators with masked PII return.
- **UI Shell & App Router Pages**:
  - `src/app/(agency)/masters/nav.tsx`: Shared tab navigation across all masters modules.
  - `src/app/(agency)/masters/page.tsx`: Index redirect to `/masters/clients`.
  - `src/app/(agency)/masters/clients/page.tsx`: Clients list, client creation modal, branch creation modal with live GSTIN format and Luhn MOD 36 checksum validation.
  - `src/app/(agency)/masters/case-types/page.tsx`: Configurable case categories with dynamic JSON custom intake field builder and live preview.
  - `src/app/(agency)/masters/outcomes/page.tsx`: Investigation outcomes with automated financial triggers (e.g. Withdrawn -> investigator payable 0).
  - `src/app/(agency)/masters/sla/page.tsx`: SLA policies (12h, 24h, 48h, 72h, 120h, custom) with agency default designation.
  - `src/app/(agency)/masters/investigators/page.tsx`: Investigator roster with AES-256-GCM encrypted PAN/bank credentials (displayed masked), geographic coverage editor, capacity, and historical effective-dated payment terms.
  - API endpoints: `/api/masters/clients`, `/api/masters/clients/[id]/branches`, `/api/masters/case-types`, `/api/masters/outcomes`, `/api/masters/sla`, `/api/masters/investigators`, `/api/masters/investigators/[id]/terms`.
- **Automated Gates Passed (`tests/phase3/masters_gates.test.ts` - 12/12 passed, 34/34 total across suite)**:
  1. **Gate 1 (Scope Respected on All Lists)**: Agency A and Agency B master rosters are strictly isolated; neither agency can view or mutate the other's clients, branches, case types, outcomes, SLA policies, or investigators.
  2. **Gate 2 (Raw SQL Unreadability & Blind Indexing)**: PAN and bank account credentials stored strictly as AES-256-GCM ciphertext (`iv:authTag:ciphertext`). Raw SQL contains zero plaintext. Fast exact searches run via HMAC-SHA256 blind index without decrypting. Decryption succeeds via application key, and API responses return masked PII.
  3. **Gate 3 (GSTIN Validator Unit Tests)**: Format and Luhn MOD 36 checksum verified across multiple Indian states (MP, MH, KA, DL). Rejects checksum mismatch, state code mismatch, bad length, non-Z 14th char, and invalid PAN structures.
  4. **Gate 4 (Payment-Terms Effective-Date Selection from Golden Tests)**:
     - **TEST-03**: Salaried investigator assigned after salary start date -> fee = 0.00, TA = 250.00, total = 250.00.
     - **TEST-04**: Salaried investigator assigned before salary start date (Grandfathered) -> fee = 750.00, TA = 250.00, total = 1000.00.
     - **TEST-05**: Case Withdrawn exception rule -> total payable = 0.00.
     - Multi-term chronological transitions across dates verified with exact boundary selection.
  5. **Gate 5 (CRUD Audited)**: Append-only audit log entries recorded for client, branch, case type, outcome, SLA policy, investigator, and payment term creation.
- **Verification Commands Executed**:
  - `npm run lint` -> Passed (0 errors, 0 warnings).
  - `npm run typecheck` -> Passed (`tsc --noEmit` exited 0).
  - `npm run test` -> Passed (34/34 tests passing across all Phase 1, 2, and 3 suites).
  - `npm run build` -> Passed (All 31 App Router routes compiled and optimized).

### Phase 2 Verification Gates & Deliverables Summary
- **Migration**: `supabase/migrations/00002_rbac_scope_and_cases_stub.sql`:
  - `clients`, `manager_scopes` (with `(agency_id, manager_id, client_id, case_type)` constraint), stub `cases` & `case_investigators`.
  - Stored procedures & triggers: `get_user_subtree(p_user_id)` (5-level depth cap), `can_view_case(...)`, `delegate_user_permission(...)` (enforcing subtree & subset constraints), `check_manager_deactivation_constraints()` trigger, `transfer_manager_responsibilities(...)` (atomic 3-step transfer wizard).
  - RLS on `cases` using `has_permission('cases.view')` and `can_view_case(...)`.
- **Core Modules**:
  - `src/modules/rbac/schema.ts` & `src/modules/rbac/service.ts`: Effective permission engine (`(role perms UNION allow) MINUS deny`), role cloning, role permission toggles, user overrides, scope updates, delegation engine, dynamic case routing engine (`resolveCaseManager`), and atomic manager transfer wizard.
  - `src/modules/cases/stub.ts`: Scoped case query service and benchmarking.
- **Settings & Cases UI**:
  - `src/app/(agency)/settings/roles`: Interactive permission matrix grouped by module with instant role toggles, custom role create, and role cloning.
  - `src/app/(agency)/settings/team`: Subtree team hierarchy list, manager scopes routing editor with `is_default` badge, and Manager Transfer Wizard modal.
  - `src/app/(agency)/cases`: Scope-protected cases ledger with live RLS enforcement.
- **Automated Gates Passed (`tests/phase2/rbac_gates.test.ts` - 9/9 passed, 22/22 total across suite)**:
  1. **Gate 1 (Negative)**: Manager cannot grant a permission they lack (`A9 Violation: A manager cannot delegate a permission they do not personally hold`).
  2. **Gate 2 (Negative)**: Manager cannot touch users outside their subtree (`A9 Violation: A manager can only delegate permissions to users within their subordinate subtree`).
  3. **Gate 3 (Negative)**: Manager cannot self-escalate or delegate to self (`A9 Violation: A manager cannot modify their own permissions or delegate to themselves`).
  4. **Gate 4 (Dynamic Evaluation)**: Admin disabling permission for Accountant takes effect immediately in effective permissions calculation.
  5. **Gate 5 (Scope Isolation)**: Manager A cannot see Manager B's cases under `TEAM` scope.
  6. **Gate 6 (Staff Scope TEAM)**: Staff member sees only their manager's cases.
  7. **Gate 7 (Routing Engine)**: Same `(client, case_type)` with two managers works; default preselected and multiple eligible managers returned.
  8. **Gate 8 (Deactivation Guard & Transfer Wizard)**: Deactivating manager with open cases is blocked by database constraint; succeeds atomically after Manager Transfer Wizard reassigns open dockets, subordinates, and scopes with audit.
  9. **Gate 9 (Performance Benchmark)**: 100k seeded cases filtered by `TEAM` scope + permission check completed in **33.08ms** (well under the 100ms requirement).
- **Verification Commands Executed**:
  - `npm run lint` -> Passed (0 errors, 0 warnings).
  - `npm run typecheck` -> Passed (`tsc --noEmit` exited 0).
  - `npm run test` -> Passed (22/22 tests passing across Phase 1 & 2 suites).
  - `npm run build` -> Passed (All 20 App Router routes compiled and optimized).

### Phase 1 Verification Gates & Deliverables Summary
- **Migration**: `supabase/migrations/00001_initial_tenancy_and_auth.sql` (platform_admins, plans, agencies, agency_subscriptions, users, roles, permissions, role_permissions, user_roles, user_permissions, audit_logs, append-only triggers, RLS policies, 5-level subtree depth trigger, `seed_agency_default_roles`).
- **Core Modules**:
  - `src/modules/auth/`: Synthetic auth email (`u_<uuid>@auth.vericlaim.in`), `(agency_code, username, password)` credential resolver, TOTP verification, admin password reset.
  - `src/modules/platform/`: Super-admin agency provisioning, suspension toggle with mandatory reason, plan change, first owner provisioning, usage metrics.
  - `src/modules/tenancy/`: Tenant branding resolution (`show_branding_footer`), user context, agency isolation.
  - `src/modules/audit/`: Append-only immutable audit ledger (`recordAuditLog`, DB trigger rejecting UPDATE/DELETE).
- **App Router UI Shell & Routes**:
  - `src/app/(auth)/login`: Agency code + username + password login with conditional 2FA TOTP prompt.
  - `src/app/(platform)/admin`: Super-admin isolated portal with agency metrics, agency creation modal, suspension toggle, owner provisioning.
  - `src/app/(agency)`: Agency console with dense professional navigation, agency badge, user scope badge, and plan branding footer.
  - `src/app/not-found.tsx` and `src/app/error.tsx`.
- **Automated Gates Passed (`tests/phase1/gates.test.ts` - 13/13 passed)**:
  1. **Gate 1 (Cross-Tenant Sweep)**: Agency A cannot read any row of Agency B across all tenant tables; Agency A cannot write or insert rows for Agency B.
  2. **Gate 2 (Suspended Agency Login)**: Suspended agency returns `{ success: false, isSuspended: true }` and blocks login.
  3. **Gate 3 (Super-Admin Protection)**: Platform admin routes and services reject non-platform-admin callers with 403 / redirect.
  4. **Gate 4 (Audit Immutability)**: DB trigger simulation and services reject any UPDATE or DELETE on `audit_logs`.
  5. **Gate 5 (Grep Test)**: Automated regex grep test across codebase confirms zero hardcoded admin identities.
- **Verification Commands Executed**:
  - `npm run lint` -> Passed (0 errors, 0 warnings).
  - `npm run typecheck` -> Passed (`tsc --noEmit` exited 0).
  - `npm run test` -> Passed (13/13 vitest unit tests passing).
  - `npm run build` -> Passed (All 11 App Router routes compiled and optimized).

### Phase L Checklist
- [x] Clone and inspect read-only legacy codebase
- [x] Save `AGENTS.md`
- [x] Comprehensive analysis of legacy DB scripts & triggers (`docs/LEGACY_ANALYSIS.md`)
- [x] Legacy defects, security gaps, and antipattern catalog (`docs/LEGACY_DEFECTS.md`)
- [x] Golden test vectors (17 hand-calculated vectors) (`docs/GOLDEN_TESTS.md`)
- [x] Legacy to new entity/column map & entity resolution plan (`docs/LEGACY_DATA_MAP.md`)
- [x] Open questions & uncertainties logged (`docs/OPEN_QUESTIONS.md`)

### Phase 0 Checklist (Design Only)
- [x] Complete Entity-Relationship Diagram & Schema Specification (`docs/ERD.md`)
- [x] Status Machine, Transition Matrix & Controlled Rework (`docs/WORKFLOW.md`)
- [x] Permission Catalog, Role Templates & Fast RLS Design (`docs/PERMISSIONS.md`)
- [x] Routing Engine, Subtree Depth Cap & Transfer Wizard (`docs/SCOPE_MODEL.md`)
- [x] Multi-layer Threat Model & Mitigation Strategy (`docs/THREAT_MODEL.md`)
- [x] Comprehensive Phase Implementation Roadmap (`docs/PHASE_PLAN.md`)
- [x] Architectural Decisions Logged (`docs/DECISIONS.md`)
