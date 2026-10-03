# AGENTS.md: Global Rules & Engineering Constitution

## A1. Product
Multi-tenant SaaS for Indian insurance investigation agencies. Each agency is an isolated tenant. Platform owner runs a super-admin panel and creates agencies manually. DNA Professional Investigation Agency is tenant #1 and the first real user (migrated from a live legacy system, see A12). Currently free, small branding footer; paid plans (Razorpay) later: build plan/subscription tables now, no payment integration yet.

**Lifecycle:**
`case received -> data entry -> verification -> assignment (location aware) -> investigator accepts -> field investigation -> evidence -> report -> review -> send-back/rework (unlimited, controlled) -> approval -> hardcopy tracking -> close -> invoice (GST) -> client payment (+TDS) -> investigator fee/expenses -> payout (Excel for bulk bank payment, then marked paid) -> financial closure`.
Everything traceable, nothing overwritten.

## A2. How You Must Work
- Work ONLY on the current phase. Stop at the end and report. Never start the next phase.
- Maintain: `AGENTS.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/OPEN_QUESTIONS.md`. Re-read them at the start of every session; context is lost between sessions.
- "Done" = code + migration + automated tests passing + at least one negative authorization test + audit log verified. UI-only is not done. Show real test output. Never claim completion without it.
- If a legal/tax rule or requirement is uncertain, log it in `docs/OPEN_QUESTIONS.md`, use the safest assumption, continue. Do not invent tax rules silently. You are not the authority on GST/TDS; mark such logic "CA-VERIFY".
- No giant files, no TODO stubs presented as complete, no mock data in production paths.
- Keep replies short: `changed / tested / next`.
- `legacy/` is READ-ONLY reference. Never copy legacy code or schema. Re-derive behavior from documented rules and golden tests.

## A3. Stack (Fixed)
- Next.js App Router + TypeScript strict, Tailwind, shadcn/ui, Zod, React Hook Form, TanStack Table/Query.
- Supabase Postgres + Supabase Auth.
- Files on Cloudflare R2 (private, S3 API), NOT Supabase Storage, NOT Google Drive.
- SQL migrations in `supabase/migrations`.
- Tests: Vitest, Playwright, SQL/pgTAP for RLS.
- PWA for mobile. English UI only.
- Modular layout: `src/modules/<domain>/{domain,service,repo,schema,policy}`.
- Workflow engine and finance/GST engine are pure modules (no DB/UI imports), unit tested.
- PDFs (invoices, payout statements) generated server-side, stored in R2 with SHA-256, not in the browser.

## A4. Tenancy
- Every business table has `agency_id NOT NULL`; RLS on every table filters by caller's agency. Super-admin is separate (`platform_admins`), never a normal role.
- Uniqueness always includes `agency_id` (invoice numbers, usernames, doc codes).
- Login: Supabase Auth needs globally unique emails, but one person may work for two agencies with separate credentials. Login form = `(agency_code, username, password)`; server resolves to an internal synthetic auth email `u_<uuid>@auth.<yourdomain>` and signs in. One user row belongs to exactly one agency. Investigators belong to one agency only.

## A5. Permission vs Scope (Never Mix)
- **PERMISSION** = what a user can do (`cases.assign`, `reports.approve`...). Toggle-based.
- **SCOPE** = whose data a user can see (which client + case type, which manager's team). Assignment-based.
- A permission never widens scope; scope never grants permission. Both enforced in Postgres RLS, not only in app code. UI hiding is cosmetic only.

## A6. Data Rules
- Append-only history: `case_status_history`, `assignments`, `report_versions`, `payments`, `audit_logs`, `hardcopy_movements`, `import_batches`. No UPDATE/DELETE for normal roles (RLS + triggers). Corrections = new rows.
- Soft delete only (`deleted_by`, `delete_reason`).
- Money: `NUMERIC(14,2)` in DB; `decimal.js` in code; never JS float. One central rounding policy, documented.
- Timestamps `timestamptz` (UTC), displayed in IST.
- Idempotency keys + unique constraints on payments, payouts, invoice generation, upload complete, imports.
- Optimistic locking (`version`) on cases, reports, invoices, payouts.
- Everything references entities by ID, NEVER by name text.
- Invoices immutable after issue. Corrections via credit/debit notes only. Sequential gapless numbering per agency per financial year (Apr-Mar), allocated inside a transaction.

## A7. Security Baseline
- Server-side authz on every action AND RLS. Never expose service-role key to client.
- Zod validation on all server inputs. Defend against IDOR, privilege escalation, SQLi, XSS, CSRF, mass assignment, duplicate payments, race conditions.
- Rate limit auth/upload/search/export. Secure headers + strict CSP, no third-party ad/analytics scripts.
- No hardcoded admin emails, no "first user becomes admin" logic, no roles stored in readable settings JSON.
- PII (Aadhaar, PAN, bank, medical): column-level encryption, masked by default, reveal is audited; searchable identifiers use normalized text + HMAC blind index. DPDP Act 2023 readiness documented in `docs/COMPLIANCE.md`. Never commit data exports or backups to git.

## A8. Files (Cloudflare R2, bytes never through the app server)
- Client compresses (photo max 1600px q~0.75, video 720p) and computes SHA-256.
- `POST /api/uploads/init` checks authz (case scope), allowlists mime/size, inserts `documents` row status=pending, key `a/{agency_id}/c/{case_id}/{uuid}`, returns presigned PUT (10 min; multipart if >50MB).
- Client uploads directly to R2 (offline: IndexedDB queue, resumable).
- `POST /api/uploads/complete` HEADs object, verifies size+checksum+magic bytes, sets verified, audits.
- Download = authz check + 5 min signed GET; sensitive views audited. No overwrite/delete; new version = new row. `uploaded_at` is server time and authoritative; client GPS/EXIF/time stored as "claimed metadata". Cron cleans stale pending rows and incomplete multiparts.

## A9. Access Model
- Roles are CUSTOM per agency (admin can create any post). Default templates: Agency Owner, Admin, Manager, Case Manager, Back Office, Data Entry, Field Investigator, Reviewer, Approver, Accountant, Report Author, Auditor, plus Client User.
- Legacy roles map: `admin -> Admin/Owner`, `senior -> Case Manager/Back Office`, `junior -> Data Entry/Back Office`, `accounts -> Accountant`, `company -> Client User`.
- Effective permission = `(role permissions UNION user ALLOW) MINUS user DENY`.
- Scope levels: `ALL`, `TEAM` (owner manager's cases), `ASSIGNED`, `OWN_ENTERED`.
- Case ownership:
  - Every case has exactly one `owner_manager_id`.
  - Managers get `(client, case_type)` combinations in `manager_scopes`.
  - On creation: routing rule resolves eligible managers for `(client, case_type)`. Data entry picks one (required if several; default if exactly one is marked default). None eligible -> "Unrouted" queue visible only to `ALL`-scope roles.
  - Manager sees only cases they own (plus their `reports_to` subtree). Staff have ONE `reports_to` manager; `TEAM` scope = that manager's cases.
  - Data entry: creates cases for any client; edits own entries until case is `VERIFIED`; default scope `OWN_ENTERED`.
  - Owner/Admin/Accountant: `ALL` scope, full permissions by default, but Admin can toggle ANY permission off.
  - Investigator: `ASSIGNED` scope.
  - Manager may grant/revoke ONLY permissions they hold, ONLY for users in their subtree, never to self, never scope `ALL`. All audited.
  - Manager removal blocked until transfer wizard moves open cases, staff `reports_to`, `manager_scopes`.

## A10. UX
- Desktop: dense, fast, professional; mono font for doc codes and claim numbers.
- Mobile PWA: investigator-first, big touch targets, camera capture, offline queue.
- No decorative animation/glassmorphism.
- Footer: small static "Powered by <Product>" unless plan has `show_branding_footer=false`.

## A11. Do Not Build Yet (Do Not Block)
Client/insurer portal, Razorpay, SMS/WhatsApp, e-invoice IRN (interface + stub only), multi-language, bank API payouts.

## A12. Legacy Business Rules Reference
- Doc code format like JUL26-0912; case types: PA, Cashless, Reimbursement, MB, FVR, Spot, Project, Hospicash, Post Facto.
- Outcome enum: Pending, Genuine, Fraud, Suspicious, Withdrawn, Repudiated, with fraud_reason. Exception lifecycle.
- Unique claim per company (upper + trim) at DB level.
- Multi-investigator N rows (replacing legacy 2 fixed slots).
- Salary vs Per Case fees with effective-dated terms (`payment_type_changed_at`).
- Withdrawn case -> investigator payable 0 (configurable exception financial rule).
- Strict separation of GST collected vs revenue vs profit.
- Monthly investigator payout with TDS calculation and net disbursable.
- TA approval workflow.
- GST rules: branch master, intra/inter-state split, bulk invoicing, no hardcoding.
- Recovery hub categories, short-settlement TDS auto-detection (~10%), 26AS matching.
- SLA/TAT calculation and badges.
- Courier manifest & hardcopy tracking.
- Scorecard & hospital fraud heatmap.
- Smart bulk paste/import with fuzzy matching and batch rollback.
