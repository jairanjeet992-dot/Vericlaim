# System Threat Model & Security Architecture

## 1. Threat Landscape Overview

Vericlaim handles highly confidential and legally sensitive insurance fraud investigations:
- **Protected Health Information (PHI) & PII:** Insured medical records, hospital admission details, pathology reports, Aadhaar, PAN cards, bank account details.
- **Financial Balances:** Multi-lakh GST invoices, statutory TDS tax deductions, investigator remuneration ledgers.
- **Evidentiary Integrity:** Geotagged field photographs, video statements, hospital registers used in consumer dispute tribunals and high court repudiation litigation.

This threat model identifies key attack vectors and the defensive controls enforced at every layer.

---

## 2. Attack Vectors & Mitigations

### 2.1 Cross-Tenant Data Leakage & Boundary Breakdown
- **Threat:** An authenticated investigator or agency admin belonging to Agency A attempts to read or mutate cases belonging to Agency B by guessing UUIDs or manipulating API payloads.
- **Impact:** Critical breach of SaaS multi-tenancy, cross-agency commercial leakage.
- **Controls & Mitigations:**
  1. **Non-Negotiable RLS:** Every tenant-scoped table has `agency_id NOT NULL` and RLS enabled.
  2. **JWT Tenant Pinning:** RLS policies evaluate `agency_id = (SELECT agency_id FROM users WHERE id = auth.uid())` or JWT claim `app_metadata.agency_id`.
  3. **Zero Blind Service-Role Usage:** Production application code runs using standard authenticated context with RLS active. Service-role credentials are strictly forbidden in client-facing API routes.
  4. **Automated Negative SQL Tests:** Automated pgTAP test suites assert that a user authenticated as Tenant A receives 0 rows when attempting direct queries against Tenant B's UUIDs.

---

### 2.2 Insecure Direct Object References (IDOR)
- **Threat:** An investigator with `ASSIGNED` scope guesses the UUID of another investigator's case or document download URL (`GET /api/cases/:id`).
- **Impact:** Unauthorized inspection of cases outside investigator assignment.
- **Controls & Mitigations:**
  1. **Server-Side Authorization Gates:** Every API handler parses the caller's session, evaluates `can_view_case(case_id)`, and returns `404 Not Found` (rather than `403 Forbidden` to prevent object existence enumeration).
  2. **Double Defense:** Even if server-side middleware were bypassed, the underlying Supabase Postgres query evaluates RLS policies which block data emission.

---

### 2.3 Evidence File Tampering & Storage Abuse (Cloudflare R2)
- **Threats:**
  - Man-in-the-Middle (MitM) replacement of evidence photos.
  - Server memory exhaustion from large video uploads.
  - Malicious executable upload disguised as `.pdf` or `.jpg`.
  - Unauthenticated file downloads via predictable S3 URLs.
- **Impact:** Tampered court evidence, malware hosting, server downtime.
- **Controls & Mitigations:**
  1. **Direct-to-R2 Flow (Bytes Never Touch App Server):**
     - Step 1: `POST /api/uploads/init` verifies caller's case scope, validates file size (<= 50MB for single, multipart for > 50MB), checks MIME allowlist (`image/jpeg`, `image/png`, `application/pdf`, `video/mp4`), inserts `documents` row status=`pending`, returns pre-signed PUT URL with a strict 10-minute expiry.
     - Step 2: Storage key is generated server-side: `a/{agency_id}/c/{case_id}/{document_uuid}` (never client filename).
     - Step 3: Client uploads directly to R2.
     - Step 4: `POST /api/uploads/complete` triggers server-side validation: verifies object existence via HEAD, verifies exact byte size, computes/validates SHA-256 hash, and inspects magic bytes (file signature) to ensure genuine JPEG/PDF/MP4 structure. Status transitions to `verified`.
  2. **Private-Only Buckets:** Bucket is completely private (no public read). Downloads generate 5-minute pre-signed GET URLs only after verifying caller authorization.
  3. **Immutable History:** Evidence files cannot be overwritten or updated in place. Replacing a document creates a new record and new storage key.

---

### 2.4 Financial Fraud & Ledger Manipulation
- **Threats:**
  - Double-crediting or duplicate client payment recording.
  - Race conditions in sequential gapless FY invoice number allocation.
  - Silent inflation or tampering of investigator fees and TA reimbursements.
- **Impact:** Tax non-compliance, financial loss, auditor repudiation.
- **Controls & Mitigations:**
  1. **Sequential Invoice Allocation Transaction:** Invoices are numbered consecutively per agency per financial year (e.g. `DNA/2026-27/0001`) allocated inside an isolated PostgreSQL transaction using `SELECT ... FOR UPDATE` on an `invoice_sequences` lock table.
  2. **Idempotency Keys:** `client_payments` enforces `UNIQUE(agency_id, idempotency_key)`. Rapid double-clicks or network retries are safely deduplicated.
  3. **Append-Only Accounting:** Payments, invoices, and payouts are immutable once issued. Corrections require statutory Credit Notes or new balancing transactions.
  4. **Separation of Concerns:** Field investigators cannot set their own fees; fees are derived strictly from `investigator_payment_terms` or manager overrides, and outstation TA requires 1-click admin approval.

---

### 2.5 Privilege Escalation & Delegation Abuse
- **Threat:** A compromised manager account attempts to grant themselves `ALL` scope, or grant super-admin permissions to another account to gain control of billing.
- **Impact:** Hostile tenant takeover.
- **Controls & Mitigations:**
  1. **Subset Invariant:** In `POST /api/team/delegate`, the server verifies:
     `requested_permissions \subseteq caller_effective_permissions`
  2. **Subtree Invariant:** Target user must be a strict descendant in the manager's `reports_to` tree.
  3. **Scope Ceilings:** Managers cannot assign scope `ALL`.
  4. **No Self-Delegation:** Target user cannot equal caller user.
  5. **Immutable Audit:** Any change to permissions or roles immediately writes an immutable record to `audit_logs` capturing caller IP, user agent, old role, and new role.

---

### 2.6 Bulk Import Poisoning & DoS Attacks
- **Threat:** Malicious or malformed Excel spreadsheets containing formula injection (e.g. `=cmd|' /C calc'!A0`), millions of rows to exhaust server memory, or deliberate duplicate claim collisions.
- **Impact:** Server DoS, spreadsheet injection vulnerabilities when exported by accountants.
- **Controls & Mitigations:**
  1. **Strict CSV/XLSX Parser:** Uses pure data extractors (disabling macro and formula evaluation). Any field starting with `=`, `+`, `-`, or `@` is sanitized by prepending a single quote before rendering or re-exporting.
  2. **Streaming Batch Intake:** File imports are chunked into batches of 100 rows. Memory limits are strictly enforced.
  3. **Batch Rollback Envelope:** Every import assigns an `import_batch_id`. If data anomalies or corruption are spotted, an admin can trigger `rollbackImportBatch(batch_id)` which safely cascades delete operations within that batch without touching other cases.
