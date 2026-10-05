# Vericlaim User Manual & Standard Operating Procedures (SOP)

## 1. Role-Based Navigation & Responsibilities

| Role | Key Capabilities | Primary Working Screens |
|---|---|---|
| **Agency Owner / Admin** | Agency settings, team hierarchy, manager scopes, user management, audit logs, backup & rollback. | `/settings`, `/settings/team`, `/settings/roles`, `/audit`, `/import` |
| **Case Manager** | Location-aware case assignment, command center oversight, SLA tracking, rework escalation. | `/command-center`, `/cases` |
| **Data Entry Staff** | Case intake, policy/claim number verification, unrouted queue management, smart paste bulk import. | `/cases`, `/import` |
| **Field Investigator** | Mobile evidence capture (photos, video), GPS claim metadata, task acceptance, expense claims. | `/investigator` (PWA) |
| **Quality Reviewer / Approver** | Report QC review, unlimited send-backs with reasons, executive approval, fraud finding classification. | `/reports` |
| **Accountant** | GST tax invoicing, payment receipt allocation, 10% TDS auto-matching, monthly payout Excel compilation. | `/invoicing`, `/payments`, `/investigator-finance` |

---

## 2. Core Operational Workflows

### 2.1 Case Intake & Allocation
1. Navigate to **Case Intake & Roster** (`/cases`).
2. Click **Create New Case** or use **Smart Paste** (`/import`).
3. Enter Claim Number, Insured Name, Client Insurance Company, Branch, Hospital, and Estimated SLA Hours.
4. If eligible manager routing is unique, case automatically routes to the responsible Case Manager; otherwise, it appears in the **Unrouted Queue** for allocation.
5. Case Manager assigns one or two Field Investigators based on city/location proximity and agreed fee rates.

### 2.2 Field Investigator Mobile Workflow (PWA)
1. Investigator logs in via mobile browser (`/investigator`) and adds Vericlaim to home screen.
2. Accepts assigned case on the mobile dashboard.
3. Conducts hospital or insured residence inquiry:
   - Captures photos and video directly in PWA.
   - PWA compresses image (max 1600px) and calculates client-side SHA-256 hash.
   - Files upload directly to private Cloudflare R2 via pre-signed URL (bypassing app server).
4. Submits travel allowance (TA) or conveyance expense vouchers with uploaded receipts.
5. Marks field investigation completed.

### 2.3 Quality Review, QC Send-Backs & Executive Approval
1. Case transitions to **Report Review & QC** (`/reports`).
2. Reviewer inspects uploaded evidence, statements, and investigator findings.
3. **If deficiencies exist:**
   - Reviewer clicks **Send Back for Rework**, selects deficiency categories (e.g. missing treating doctor statement, unclear hospital bill), and enters mandatory instructions.
   - Investigator receives push/in-app notification and re-submits corrected evidence.
   - **Escalation Trigger:** Reaching rework cycle $\ge 3$ automatically flags the case as `ESCALATED_REVIEW` for executive intervention.
4. **If findings are sound:**
   - Approver classifies final outcome (`Genuine`, `Fraud`, `Suspicious`, `Repudiated`, `Untraceable`).
   - Case is formally approved and locked against retrospective alteration.

### 2.4 Hardcopy Logistics & Courier Manifest
1. Staff navigate to **Hardcopy Logistics** (`/hardcopy`).
2. Log physical file movements (e.g. Received from Investigator -> Stored in Archive Rack -> Dispatched to Client).
3. Generate printable courier manifests with AWB tracking numbers.

### 2.5 Finance, GST Invoicing & Client Payments
1. **Invoice Generation (`/invoicing`):**
   - Click **Generate Invoice** for approved cases.
   - System automatically calculates Intra-State (CGST 9% + SGST 9%) or Inter-State (IGST 18%) tax split.
   - Monotonic gapless tax invoice number is allocated inside a database transaction. Server generates immutable hashed PDF stored in Cloudflare R2.
2. **Client Payment & Short-Settlement TDS (`/payments`):**
   - Record insurer bank remittance.
   - The TDS Auto-Detection Heuristic analyzes short-settlements: if the shortfall matches ~10% of the taxable base under Section 194J within $\pm₹5$, auto-suggestion is presented for one-click confirmation.
   - Reallocate balance across invoices; allocations are recorded in append-only ledgers.

### 2.6 Investigator Finance & Bank Bulk Excel Disbursal (`/investigator-finance`)
1. Review pending investigator fees and submitted travel expenses.
2. Click **Compile Monthly Payouts** for target month.
3. System dynamically evaluates effective-dated compensation terms:
   - Salaried investigators receive base salary plus approved outstation TA; per-case fee is normalized to ₹0.
   - Per-case investigators receive fee per case plus approved expenses.
   - Statutory TDS (Section 194J 10% or Section 194C 1%) is automatically deducted; Section 206AA penal 20% applied if PAN is absent.
4. Click **Download Bank Bulk Excel (.xlsx)**:
   - Generates standard Indian corporate bulk payment spreadsheet (Beneficiary, Account No, IFSC, Net Amount, Narration).
5. After bank transfer is executed, click **Mark as Paid** with bank reference number to permanently lock the payout batch.
