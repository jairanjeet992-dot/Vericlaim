# Golden Test Vectors (Legacy Parity & Domain Rules)

These 17 test vectors are hand-computed reference specifications covering financial calculations, salary transitions, GST splits, TDS auto-detection, monthly payouts, scorecard performance metrics, and SLA states. Every test vector defines explicit inputs, legacy logic, and the expected authoritative output for Vericlaim.

---

## 1. Case Financial Calculations

### TEST-01: Standard Two-Investigator Fee & Settlement
- **Scenario:** Standard reimbursement case with two active field investigators and full insurer settlement without TDS deduction.
- **Inputs:**
  - `fee1`: 500.00
  - `ta1`: 150.00
  - `fee2`: 400.00
  - `ta2`: 100.00
  - `received`: 3,500.00
  - `tds_deducted`: 0.00
  - `exception_type`: null
  - `inv1_payment_type`: 'Per Case'
  - `inv2_payment_type`: 'Per Case'
- **Hand Computation:**
  - `effectiveFee1` = 500.00, `effectiveTa1` = 150.00
  - `effectiveFee2` = 400.00, `effectiveTa2` = 100.00
  - `total_payable` = 500.00 + 150.00 + 400.00 + 100.00 = **1,150.00**
  - `profit` = (3,500.00 + 0.00) - 1,150.00 = **2,350.00**
- **Expected Output:**
  - `total_payable`: `1150.00`
  - `profit`: `2350.00`

### TEST-02: Insurer Partial Payment with Withheld TDS
- **Scenario:** Cashless investigation billed at ₹4,000 where insurer withheld 10% TDS and deposited remainder into bank.
- **Inputs:**
  - `fee1`: 600.00, `ta1`: 200.00
  - `fee2`: 0.00, `ta2`: 0.00
  - `received`: 3,600.00
  - `tds_deducted`: 400.00
  - `exception_type`: null
- **Hand Computation:**
  - `total_payable` = 600.00 + 200.00 = **800.00**
  - `settled_amount` = 3,600.00 + 400.00 = **4,000.00**
  - `profit` = (3,600.00 + 400.00) - 800.00 = **3,200.00**
- **Expected Output:**
  - `total_payable`: `800.00`
  - `profit`: `3200.00`

---

## 2. Salary vs Per-Case Transitions & Effective Dating

### TEST-03: Salaried Investigator Assigned AFTER Salary Start Date
- **Scenario:** Investigator "Vikram Singh" converted to Salary on 2026-08-01. Case assigned on 2026-08-15.
- **Inputs:**
  - Investigator: `payment_type = 'Salary'`, `payment_type_changed_at = '2026-08-01T00:00:00Z'`
  - Case Date: `'2026-08-15'`
  - Entered `fee1`: 750.00, `ta1`: 250.00
  - `fee2`: 0.00, `ta2`: 0.00
  - `received`: 2,500.00, `tds_deducted`: 0.00
  - `exception_type`: null
- **Hand Computation:**
  - `caseDate` (2026-08-15) >= `payment_type_changed_at` (2026-08-01) -> `effectiveFee1` = 0.00
  - Outstation travel reimbursement preserved -> `effectiveTa1` = 250.00
  - `total_payable` = 0.00 + 250.00 = **250.00**
  - `profit` = 2,500.00 - 250.00 = **2,250.00**
- **Expected Output:**
  - `effectiveFee1`: `0.00`
  - `effectiveTa1`: `250.00`
  - `total_payable`: `250.00`
  - `profit`: `2250.00`

### TEST-04: Salaried Investigator Assigned BEFORE Salary Start Date (Grandfathered)
- **Scenario:** Same investigator "Vikram Singh" on Salary effective 2026-08-01, but case is from 2026-07-20 (prior month).
- **Inputs:**
  - Investigator: `payment_type = 'Salary'`, `payment_type_changed_at = '2026-08-01T00:00:00Z'`
  - Case Date: `'2026-07-20'`
  - Entered `fee1`: 750.00, `ta1`: 250.00
  - `received`: 2,500.00, `tds_deducted`: 0.00
- **Hand Computation:**
  - `caseDate` (2026-07-20) < `payment_type_changed_at` (2026-08-01) -> `effectiveFee1` = 750.00 (retained)
  - `effectiveTa1` = 250.00
  - `total_payable` = 750.00 + 250.00 = **1,000.00**
  - `profit` = 2,500.00 - 1,000.00 = **1,500.00**
- **Expected Output:**
  - `effectiveFee1`: `750.00`
  - `total_payable`: `1000.00`
  - `profit`: `1500.00`

---

## 3. Case Exceptions

### TEST-05: Withdrawn Case Zero-Payable Rule
- **Scenario:** Case cancelled/withdrawn by insurer after field investigator was already allotted ₹500 fee + ₹100 TA.
- **Inputs:**
  - `fee1`: 500.00, `ta1`: 100.00, `fee2`: 0.00, `ta2`: 0.00
  - `received`: 0.00, `tds_deducted`: 0.00
  - `exception_type`: `'Withdrawn'`
- **Hand Computation:**
  - `exception_type = 'Withdrawn'` forces `total_payable` = 0.00
  - `profit` = 0.00 - 0.00 = 0.00
- **Expected Output:**
  - `total_payable`: `0.00`
  - `profit`: `0.00`
  - `balanceDue`: `0.00`

---

## 4. GST Invoicing & Tax Calculations

### TEST-06: Intra-State GST Invoicing (Forward Calculation)
- **Scenario:** Agency in Madhya Pradesh (State code: 23). Insurer branch in Indore, Madhya Pradesh (State code: 23).
- **Inputs:**
  - `agency_state_code`: '23'
  - `client_branch_state_code`: '23'
  - `fee`: 3,000.00
  - `expense` (TAT/Conveyance): 500.00
  - `gst_rate`: 18.00%
- **Hand Computation:**
  - `taxable` = 3,000.00 + 500.00 = **3,500.00**
  - `isIntraState` = (23 === 23) -> true (CGST + SGST split)
  - `total_gst` = Math.round(3,500.00 * 0.18 * 100) / 100 = **630.00**
  - `cgst_rate` = 9.00%, `cgst_amount` = Math.round(630.00 / 2 * 100) / 100 = **315.00**
  - `sgst_rate` = 9.00%, `sgst_amount` = Math.round(630.00 / 2 * 100) / 100 = **315.00**
  - `igst_rate` = 0.00%, `igst_amount` = **0.00**
  - `total_invoice` = 3,500.00 + 630.00 = **4,130.00**
- **Expected Output:**
  - `taxable`: `3500.00`
  - `cgst`: `315.00`
  - `sgst`: `315.00`
  - `igst`: `0.00`
  - `total`: `4130.00`

### TEST-07: Inter-State GST Invoicing (Forward Calculation)
- **Scenario:** Agency in Madhya Pradesh (State code: 23). Insurer central processing hub in Mumbai, Maharashtra (State code: 27).
- **Inputs:**
  - `agency_state_code`: '23'
  - `client_branch_state_code`: '27'
  - `fee`: 4,500.00
  - `expense`: 250.00
  - `gst_rate`: 18.00%
- **Hand Computation:**
  - `taxable` = 4,500.00 + 250.00 = **4,750.00**
  - `isIntraState` = (23 === 27) -> false (IGST)
  - `cgst` = 0.00, `sgst` = 0.00
  - `igst_rate` = 18.00%
  - `igst_amount` = Math.round(4,750.00 * 0.18 * 100) / 100 = **855.00**
  - `total_invoice` = 4,750.00 + 855.00 = **5,605.00**
- **Expected Output:**
  - `taxable`: `4750.00`
  - `cgst`: `0.00`
  - `sgst`: `0.00`
  - `igst`: `855.00`
  - `total`: `5605.00`

### TEST-08: Backward Calculation from Grand Total (Legacy Case Parity)
- **Scenario:** Legacy imported case has flat grand total ₹2,950.00 entered. System back-calculates taxable and 18% GST.
- **Inputs:**
  - `total_invoice`: 2,950.00
  - `gst_rate`: 18.00%
  - `agency_state_code`: '23', `client_branch_state_code`: '23'
- **Hand Computation:**
  - `taxable` = Math.round((2,950.00 / 1.18) * 100) / 100 = Math.round(2500.00 * 100) / 100 = **2,500.00**
  - `total_gst` = 2,950.00 - 2,500.00 = **450.00**
  - `cgst` = Math.round((450.00 / 2) * 100) / 100 = **225.00**
  - `sgst` = Math.round((450.00 / 2) * 100) / 100 = **225.00**
- **Expected Output:**
  - `taxable`: `2500.00`
  - `cgst`: `225.00`
  - `sgst`: `225.00`
  - `total`: `2950.00`

---

## 5. Short-Settlement TDS Auto-Detection

### TEST-09: Exact 10% TDS Deducted on Taxable Base
- **Scenario:** Invoice issued for ₹4,130 (₹3,500 taxable + ₹630 GST). Client pays ₹3,780.00 (withheld ₹350 = exactly 10% of ₹3,500 base under Section 194J).
- **Inputs:**
  - `invoice_amount`: 4,130.00
  - `received`: 3,780.00
  - `existing_tds_deducted`: 0.00
- **Hand Computation:**
  - `diff` = 4,130.00 - 3,780.00 = 350.00
  - `base10` = Math.round((4,130.00 / 1.18) * 0.10) = Math.round(3,500.00 * 0.10) = 350.00
  - `Math.abs(diff - base10)` = |350.00 - 350.00| = 0.00 <= 2.00 -> MATCH!
- **Expected Output:**
  - `is_tds_auto_match`: `true`
  - `tds_deducted`: `350.00`
  - `match_type`: `'base_10_percent'`

### TEST-10: Exact 10% TDS Deducted on Gross Billed Total
- **Scenario:** Invoice issued for ₹3,000.00 flat. Client accounts department erroneously deducts 10% on gross total = ₹300, remits ₹2,700.00.
- **Inputs:**
  - `invoice_amount`: 3,000.00
  - `received`: 2,700.00
  - `existing_tds_deducted`: 0.00
- **Hand Computation:**
  - `diff` = 3,000.00 - 2,700.00 = 300.00
  - `gross10` = Math.round(3,000.00 * 0.10) = 300.00
  - `Math.abs(diff - gross10)` = |300.00 - 300.00| = 0.00 <= 2.00 -> MATCH!
- **Expected Output:**
  - `is_tds_auto_match`: `true`
  - `tds_deducted`: `300.00`
  - `match_type`: `'gross_10_percent'`

### TEST-11: Non-Matching Difference (Disallowed TA or Genuine Default)
- **Scenario:** Invoice issued for ₹4,500.00. Insurer remits ₹3,800.00 (shortfall ₹700, due to rejected travel bill).
- **Inputs:**
  - `invoice_amount`: 4,500.00
  - `received`: 3,800.00
- **Hand Computation:**
  - `diff` = 700.00
  - `base10` = Math.round((4,500.00 / 1.18) * 0.10) = Math.round(381.36) = 381.00
  - `gross10` = Math.round(4,500.00 * 0.10) = 450.00
  - `|700 - 381| = 319 > 2`, `|700 - 450| = 250 > 2` -> NO MATCH!
- **Expected Output:**
  - `is_tds_auto_match`: `false`
  - `tds_deducted`: `0.00` (remains outstanding in Recovery Hub as `partially_paid` with `balanceDue = 700.00`).

---

## 6. Monthly Investigator Payout & Statutory TDS Ledger

### TEST-12: Contractor TDS Deduction (Section 194C @ 1%)
- **Scenario:** Non-individual / individual contractor investigator completed 12 cases in month.
- **Inputs:**
  - `totalCases`: 12.0
  - `totalFees`: 6,000.00
  - `totalTA`: 1,800.00
  - `expenseVouchers`: 450.00 (courier + printing)
  - `tds_section`: '1% — Contractor (194C)'
  - `tds_rate`: 1.00%
  - `tds_base`: 'fees_only'
- **Hand Computation:**
  - `taxableBase` = 6,000.00 (fees only)
  - `tdsAmount` = Math.round(6,000.00 * 0.01) = **60.00**
  - `grossTotal` = 6,000.00 + 1,800.00 + 450.00 = **8,250.00**
  - `netDisbursable` = 8,250.00 - 60.00 = **8,190.00**
- **Expected Output:**
  - `gross_total`: `8250.00`
  - `taxable_base`: `6000.00`
  - `tds_amount`: `60.00`
  - `net_disbursable`: `8190.00`

### TEST-13: Professional TDS Deduction (Section 194J @ 10% on Gross All)
- **Scenario:** Professional investigator under Section 194J with TDS applied across all payables.
- **Inputs:**
  - `totalCases`: 15.0
  - `totalFees`: 12,000.00
  - `totalTA`: 3,000.00
  - `expenseVouchers`: 1,000.00 (special allowance)
  - `tds_section`: '10% — Professional (194J)'
  - `tds_rate`: 10.00%
  - `tds_base`: 'all'
- **Hand Computation:**
  - `taxableBase` = 12,000.00 + 3,000.00 + 1,000.00 = **16,000.00**
  - `tdsAmount` = Math.round(16,000.00 * 0.10) = **1,600.00**
  - `grossTotal` = **16,000.00**
  - `netDisbursable` = 16,000.00 - 1,600.00 = **14,400.00**
- **Expected Output:**
  - `taxable_base`: `16000.00`
  - `tds_amount`: `1600.00`
  - `net_disbursable`: `14400.00`

---

## 7. Investigator Performance Scorecard

### TEST-14: High Performer Scorecard Vector
- **Scenario:** Investigator "Rahul Verma" performance evaluation for month.
- **Inputs:**
  - Total Assigned Cases: 10
  - Paid/Completed Cases: 9 (`completionPct` = 90%)
  - Paid Dates Available: 9 cases, Average turnaround `avgDays` = 4.2 days
  - Hardcopy Received Cases: 8 (`hcPct` = 80%)
  - Total Case Payable: ₹6,500.00
  - Total Received from Client: ₹6,500.00 (`receivedPct` = 100%)
- **Hand Computation:**
  - `completionScore` = 90 * 0.25 = **22.50**
  - `speedScore` = Math.max(0, 100 - (4.2 * 3)) = 100 - 12.6 = 87.40; Weighted = 87.40 * 0.25 = **21.85**
  - `hardcopyScore` = 80 * 0.15 = **12.00**
  - `receivedScore` = 100 * 0.20 = **20.00**
  - `volumeScore` = Math.min(100, 10 * 8) = 80; Weighted = 80 * 0.15 = **12.00**
  - `totalScore` = Math.round(22.50 + 21.85 + 12.00 + 20.00 + 12.00) = Math.round(88.35) = **88**
- **Expected Output:**
  - `score`: `88`
  - `completionPct`: `90`
  - `avgDays`: `4`
  - `hcPct`: `80`
  - `receivedPct`: `100`

### TEST-15: Low Performer / Slow Turnaround Scorecard Vector
- **Scenario:** Investigator with slow TAT and overdue hardcopies.
- **Inputs:**
  - Total Assigned Cases: 4
  - Paid/Completed Cases: 1 (`completionPct` = 25%)
  - Average Turnaround: 22.0 days
  - Hardcopy Received Cases: 1 (`hcPct` = 25%)
  - Total Payable: ₹2,000.00, Total Received: ₹500.00 (`receivedPct` = 25%)
- **Hand Computation:**
  - `completionScore` = 25 * 0.25 = **6.25**
  - `speedScore` = Math.max(0, 100 - (22 * 3)) = 100 - 66 = 34.00; Weighted = 34 * 0.25 = **8.50**
  - `hardcopyScore` = 25 * 0.15 = **3.75**
  - `receivedScore` = 25 * 0.20 = **5.00**
  - `volumeScore` = Math.min(100, 4 * 8) = 32; Weighted = 32 * 0.15 = **4.80**
  - `totalScore` = Math.round(6.25 + 8.50 + 3.75 + 5.00 + 4.80) = Math.round(28.30) = **28**
- **Expected Output:**
  - `score`: `28`

---

## 8. SLA / TAT State Machine

### TEST-16: SLA State Calculation Boundary Checks
- **Reference Time (`now`):** `2026-10-02T12:00:00Z`
- **Sub-Tests:**
  1. `due_date: '2026-10-02T08:00:00Z'` -> `diffHours` = -4.0h (< 0) -> **`BREACHED`** (4h overdue)
  2. `due_date: '2026-10-02T20:00:00Z'` -> `diffHours` = +8.0h (<= 12h) -> **`CRITICAL`** (8h remaining)
  3. `due_date: '2026-10-03T06:00:00Z'` -> `diffHours` = +18.0h (<= 24h) -> **`APPROACHING`** (18h remaining)
  4. `due_date: '2026-10-05T12:00:00Z'` -> `diffHours` = +72.0h (> 24h) -> **`ON_TRACK`** (3.0d)
  5. `outcome: 'Genuine'`, `due_date: '2026-10-01T00:00:00Z'` -> **`COMPLETED`** (Overdue time ignored once outcome is resolved)

---

## 9. Hospital Fraud Heatmap Risk Scoring

### TEST-17: Hospital Heatmap Risk Score & High-Risk Threshold
- **Inputs:**
  - Hospital: `"CITY CARE HOSPITAL"`
  - Total Cases: 10
  - Fraud Outcomes: 2
  - Suspicious Outcomes: 1
  - Genuine Outcomes: 3
  - Pending Outcomes: 4
- **Hand Computation:**
  - `resolvedCases` = fraud (2) + genuine (3) + suspicious (1) = **6** (Pending cases excluded)
  - `riskScore` = Math.round(((2 + 1) / 6) * 100) = Math.round((3 / 6) * 100) = **50%**
  - `isHighRisk` = (`riskScore >= 30` && `resolvedCases >= 2`) -> (50 >= 30 && 6 >= 2) -> **`true`**
- **Expected Output:**
  - `riskScore`: `50`
  - `isHighRisk`: `true`
  - `statusBadge`: `'HIGH RISK'`
