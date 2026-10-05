# DNA Professional Investigation Agency: Go-Live & Parallel Run Plan

## Executive Summary
This document outlines the strict production cutover and operational validation plan for **Tenant #1: DNA Professional Investigation Agency**. In accordance with Phase 10 specifications and Rule A1, DNA will run on Vericlaim **IN PARALLEL** with its legacy system for a defined stabilization period before full cutover. 

> [!IMPORTANT]
> **MULTI-TENANT ONBOARDING EMBARGO:**
> No other investigation agencies shall be onboarded to Vericlaim until DNA Professional Investigation Agency has operated cleanly, without data loss, and with verified financial parity for a continuous period formally approved by the platform owner.

---

## 1. 30-Day Parallel Run Protocol

### 1.1 Parallel Operating Model
During the 30-day parallel run:
1. **Intake Duplication:** Every new case received by DNA (via email, insurer portal, or client phone) is entered simultaneously into both:
   - The legacy DNA system (primary system of record during testing).
   - Vericlaim SaaS (parallel verification system).
2. **Investigation & Evidence:**
   - Field investigators submit photos and evidence directly through the Vericlaim Mobile PWA.
   - Legacy reports are authored in parallel or cross-referenced.
3. **Billing & Payouts Shadowing:**
   - Real-world GST invoices and investigator monthly payouts are calculated independently in both systems.

### 1.2 Daily Parity Check Procedure (Every Day at 19:00 IST)
At the close of business daily, the DNA Operations Manager and Head Accountant execute the automated Parity Verification tool (`/import` -> Reconciliation & Parity Dashboard):
- **Case Volume Parity:** Confirm total cases opened, closed, and pending match legacy records ($\text{Diff} = 0$).
- **Taxable Base & GST Parity:** Verify CGST, SGST, and IGST totals match to the exact paisa ($\text{Diff} = ₹0.00$).
- **Client Remittance & TDS:** Validate TDS deductions match 10% / 194J expectations.
- **Investigator Payables:** Verify salary adjustments and per-case fee calculations match between systems.
- **Daily Parity Log:** Recorded in `docs/PARITY_LOG_DNA.md` with sign-off signatures.

---

## 2. Production Cutover Checklist

### Phase A: Pre-Cutover (T-minus 7 Days)
- [ ] Complete full staging dry-run import of all legacy historical data using `/api/migration/dry-run`.
- [ ] Approve all unresolved company and investigator alias matches via Entity Resolution Review.
- [ ] Verify that automated restore drill (`scripts/restore-drill.ts`) passes with 100% schema and RLS integrity.
- [ ] Confirm Cloudflare R2 bucket CORS and presigned URL lifetime (10 minutes) in production environment.
- [ ] Confirm Supabase PostgreSQL connection pooling (pgBouncer / Supavisor) configured for concurrent staff load.
- [ ] Conduct staff briefing for Case Managers, Reviewers, and Investigators on PWA workflows.

### Phase B: Cutover Eve (T-minus 24 Hours)
- [ ] Trigger manual `pg_dump` snapshot of legacy system and store backup artifact in R2.
- [ ] Execute final historical batch migration into production tenant `tenant_1` with `import_batch_id`.
- [ ] Generate Parity Reconciliation Report and confirm **zero line-item discrepancies**.
- [ ] Lock legacy database to read-only status for normal staff.
- [ ] Verify production health probe (`GET /api/health`) returns HTTP 200 `HEALTHY`.

### Phase C: Go-Live Day (T-Zero)
- [ ] DNA staff begin live operations exclusively on Vericlaim.
- [ ] Field investigators launch PWA on Android/iOS home screens.
- [ ] Monitor real-time telemetry on the Command Center (`/command-center`).
- [ ] Verify first 10 evidence uploads directly stream to Cloudflare R2 with valid SHA-256 hashes.
- [ ] Verify first batch of issued GST invoices generates valid sequential tax numbers.

### Phase D: Post-Cutover Stabilization (Days 1 to 14)
- [ ] Daily inspection of error logs and rate limiting metrics.
- [ ] Nightly audit of backup workflows (`.github/workflows/nightly-backup.yml`).
- [ ] Verification of first month-end investigator payout generation and Excel bulk payment export.
- [ ] Formal review with Platform Owner for final sign-off.

---

## 3. Rollback & Failback Plan

If a critical blocker is encountered during the cutover window (e.g. data corruption, insurmountable RLS failure, or critical workflow halt):

1. **Immediate Execution of Database Rollback:**
   - Execute the atomic database rollback stored procedure via UI (`/import` -> Rollback Batch) or API (`POST /api/migration/rollback`).
   - The procedure activates `app.is_rolling_back_import = 'true'`, bypassing invoice immutability triggers, and cleanly purges all batch records.
2. **Re-Enable Legacy Database:**
   - Remove read-only lock from legacy DNA database.
   - DNA staff resume entries in legacy system without interruption.
3. **Data Reconciliation for Rollback Period:**
   - Any cases or evidence created in Vericlaim during the temporary live period are extracted via `/api/reports/export` and back-ported into legacy system.
4. **Post-Mortem & Incident Logging:**
   - Full post-mortem logged in `docs/DECISIONS.md`.
