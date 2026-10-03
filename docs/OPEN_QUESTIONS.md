# Open Questions, Legal Ambiguities & Verification Ledger

All uncertain business, legal, or tax requirements identified during Phase L legacy analysis are documented here. Safest engineering defaults are in place, but these must be formally resolved.

---

## 1. Questions for Platform Owner (Business & Workflow Decisions)

### Q-OWNER-01: SLA / TAT Default Duration Standard
- **Context:** The legacy database schema (`14_sla_tat_exceptions_and_closure_columns.sql:8`) set `sla_hours DEFAULT 24`, whereas the ops dashboard (`dna-ops-suite.js:49`) defaulted missing SLAs to `48 hours`.
- **Safest Assumption Used:** Vericlaim defaults standard case SLA to **24 hours** unless overridden by client/case-type contract in agency settings.
- **Decision Required:** Confirm whether the standard agency baseline is 24h, 48h, or configured dynamically per insurer.

### Q-OWNER-02: Investigator Productivity Metric (Half vs Full Case Weights)
- **Context:** Legacy `app.js:2965-2971` awarded `0.5` case count if an investigator was in only one slot (`inv1` or `inv2`), and `1.0` if in both slots (`inv1 === name && inv2 === name`).
- **Safest Assumption Used:** Retain proportional slot weighting (1.0 / $N$ assigned investigators) in performance scorecards.
- **Decision Required:** In the new multi-investigator system ($N$ investigators), should workload/scorecard count be divided equally ($1/N$) or count as a full investigation assignment for each investigator?

### Q-OWNER-03: Withdrawn Case Payout & Expense Exception Policy
- **Context:** Legacy SQL (`20_fix_financial_triggers_and_data_cleanup.sql:24`) zeroes `fee1`, `fee2`, `ta1`, `ta2` when a case is marked `'Withdrawn'`. However, in real field investigations, an operative who already travelled 60 km before insurer cancellation is often reimbursed their fuel/travel allowance.
- **Safest Assumption Used:** Case fee is zeroed by default, but travel allowances (TA) and approved vouchers can be optionally approved by manager override.
- **Decision Required:** Confirm whether Withdrawn cases should strictly zero out TA or allow manager-approved travel expense reimbursement.

### Q-OWNER-04: Data Entry Scope: `OWN_ENTERED` vs Agency-wide Read
- **Context:** In Part A9, default scope for Data Entry is `OWN_ENTERED`, with an optional agency setting switching to `ALL` (read-only).
- **Safest Assumption Used:** Strict `OWN_ENTERED` enforced in RLS until agency setting toggle is explicitly enabled.
- **Decision Required:** Confirm default setting for DNA Professional Investigation Agency.

---

## 2. Questions for Chartered Accountant (CA-VERIFY) (Tax & Compliance)

> [!CAUTION]
> AI models and software engineers are not statutory tax authorities. All tax calculations in Vericlaim are marked `CA-VERIFY` until formal sign-off by a qualified Indian Chartered Accountant.

### Q-CA-01: Profit Definition & Treatment of GST Collected (CRITICAL)
- **Context:** Legacy `calculate_case_financials` trigger used:
  `profit := (received + tds_deducted) - total_payable`
  If an invoice is billed for ₹10,000 + 18% GST = ₹11,800, and client remits ₹11,800, counting `received` as income counts the government's ₹1,800 GST liability as agency profit.
- **Safest Assumption Used:**
  - `Gross Billed Amount` = ₹11,800 (Taxable ₹10,000 + GST ₹1,800)
  - `Output GST Liability` = ₹1,800 (Balance sheet liability, not income)
  - `Net Service Revenue` = ₹10,000 (P&L revenue)
  - `Direct Investigation Cost` = `total_investigator_payable`
  - `Agency Gross Margin` = `Net Service Revenue - Direct Investigation Cost`
- **CA Verification Required:** Confirm exact accounting ledger representation for agency P&L and GST output liability.

### Q-CA-02: Client TDS Deduction on GST Component (Section 194J vs CBDT Circular 23/2017)
- **Context:** CBDT Circular No. 23/2017 states TDS under Chapter XVII-B should be deducted on the amount credited/paid without including the GST component, provided GST is indicated separately. However, legacy `dna-bugfixes.js:525` and `company-recovery.js:516` specifically accommodated insurers who deduct 10% on the *gross billed amount* (including GST).
- **Safest Assumption Used:** System accepts both 10% on taxable base and 10% on gross total with a ±₹2 tolerance for auto-detection, but flags gross deductions as "Client Excess TDS Deduction" for reconciliation.
- **CA Verification Required:** Confirm the correct reconciliation workflow for excess TDS withheld by insurers contrary to Circular 23/2017.

### Q-CA-03: Statutory TDS Withholding on Investigator Payouts (Section 194C vs 194J)
- **Context:** Legacy supported two conflicting deduction bases (`app.js:7255`):
  1. `'fees_only'`: TDS deducted only on investigation service fee.
  2. `'all'`: TDS deducted on (Fee + Travel Allowance + Reimbursement Vouchers).
- **Safest Assumption Used:** Pure travel/fuel reimbursements supported by original vouchers are non-taxable expense reimbursements, while consolidated fees are subject to TDS under 194C (1% individual / 2% non-individual) or 194J (2% or 10%).
- **CA Verification Required:** Does reimbursing outstation conveyance (TA) attract TDS under 194C/194J if paid without formal separate expense bills? Confirm threshold limits (e.g. ₹30,000 single transaction / ₹1,00,000 aggregate per FY under 194C).

### Q-CA-04: Gapless Invoice Numbering & Financial Year Reset Policy
- **Context:** Section 31 of CGST Act requires consecutive serial numbering unique for a Financial Year (April 1 to March 31).
- **Safest Assumption Used:** Vericlaim allocates gapless sequential numbering per agency per FY inside a serializable PostgreSQL transaction (e.g. `DNA/2026-27/0001`). Voided invoices require a Credit Note, never re-use of an invoice number.
- **CA Verification Required:** Confirm mandatory prefix/format conventions for Indian insurance claims investigation invoices.

### Q-CA-05: Services Accounting Code (SAC) Classification for Insurance Claims Investigation
- **Context:** Claims investigation spans multiple potential SAC codes: `998311` (Management consulting and management services / business consulting), `998312` (Business consulting services), or `99713` (Auxiliary services to insurance, e.g. insurance claims settlement services, survey and loss assessment).
- **Safest Assumption Used:** Default SAC is set to `998311` with a tax rate of 18%, but configurable per line item and per case type master.
- **CA Verification Required:** Confirm whether insurance investigation and fraud detection services must strictly use `99713` (Auxiliary insurance services) or `998311` (Investigation / consulting) for correct GST return reporting (GSTR-1 HSN/SAC summary).

### Q-CA-06: Reverse Charge Mechanism (RCM) on Services Provided to Insurance Companies
- **Context:** Under Notification No. 13/2017-Central Tax (Rate), services provided by an insurance agent to any person carrying on insurance business are taxable under Reverse Charge (tax payable by the insurer).
- **Safest Assumption Used:** Independent investigation agencies are classified as separate corporate/firm service providers (forward charge) rather than individual "insurance agents" under IRDAI regulations. However, the system supports an `is_reverse_charge` flag on invoice drafting to suppress output GST collection when RCM applies.
- **CA Verification Required:** Confirm whether investigation agencies ever fall under RCM when billing General Insurance or Health Insurance companies directly.

### Q-CA-07: Special Economic Zone (SEZ) Supplies with or without LUT
- **Context:** Supplies to SEZ developers/units are treated as zero-rated inter-state supplies under Section 16 of IGST Act. They can be supplied either with payment of IGST (with subsequent refund claim) or under Letter of Undertaking (LUT) / bond without payment of IGST.
- **Safest Assumption Used:** System supports `is_sez` flag; when zero-rated without tax, tax rate is computed as 0.00% and flagged as zero-rated supply.
- **CA Verification Required:** Confirm mandatory invoice declaration text required on SEZ investigation invoices ("SUPPLY MEANT FOR SEZ UNIT FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX").
