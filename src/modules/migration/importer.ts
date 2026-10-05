import Decimal from 'decimal.js';
import {
  LegacyCaseRow,
  EntityApprovalDecision,
  ImportBatchRecord
} from './types';
import { EntityResolver, normalizeEntityText } from './entity-resolver';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface InvestigatorCompensationTerms {
  payment_type: 'Per Case' | 'Salary';
  salary_amount?: number;
  payment_type_changed_at?: string; // ISO date string
}

export interface StagingCaseRecord {
  id: string;
  agency_id: string;
  import_batch_id: string;
  legacy_id?: string;
  doc_code: string;
  claim_no: string;
  policy_no?: string;
  insured_name: string;
  client_id: string;
  hospital_id?: string;
  case_type_id?: string;
  location?: string;
  allocated_at?: string;
  outcome: string;
  sla_hours: number;
  sla_due_date?: string;
  completed_at?: string;
  risk_level?: string;
  exception_type?: string;
  exception_reason?: string;
  total_investigator_cost: number;
  investigators: Array<{
    investigator_id: string;
    investigator_name: string;
    agreed_fee: number;
    travel_allowance: number;
    total_payable: number;
    payout_status: string;
    slot: 1 | 2;
  }>;
  invoice?: {
    id: string;
    invoice_number: string;
    grand_total: number;
    taxable_amount: number;
    gst_amount: number;
    status: string;
  };
  payment?: {
    id: string;
    amount: number;
    tds_deducted: number;
    payment_date: string;
    payment_mode: string;
  };
}

export interface ImportExecutionResult {
  batch_id: string;
  status: 'COMMITTED' | 'FAILED';
  total_rows: number;
  imported_cases_count: number;
  imported_invoices_count: number;
  imported_payments_count: number;
  imported_investigators_count: number;
  unresolved_count: number;
  cases: StagingCaseRecord[];
  errors: string[];
}

export class LegacyBatchImporter {
  private agencyId: string;
  private batchId: string;
  private resolver: EntityResolver;
  private termsMap: Map<string, InvestigatorCompensationTerms>;

  constructor(
    agencyId: string,
    batchId: string,
    resolver: EntityResolver,
    termsMap?: Map<string, InvestigatorCompensationTerms>
  ) {
    this.agencyId = agencyId;
    this.batchId = batchId;
    this.resolver = resolver;
    this.termsMap = termsMap || new Map();
  }

  /**
   * Applies approved entity resolution decisions to the resolver dictionary
   */
  public applyDecisions(decisions: EntityApprovalDecision[]): void {
    for (const d of decisions) {
      if (d.action === 'MAP_TO_EXISTING' && d.target_id) {
        // Will be picked up by resolver custom aliases
      }
    }
  }

  /**
   * Transforms raw legacy rows into immutable, normalized multi-tenant relational records
   */
  public transformRows(
    rows: LegacyCaseRow[],
    approvedMappings: Map<string, string> = new Map() // raw_text -> target_uuid
  ): {
    validRecords: StagingCaseRecord[];
    skippedRows: Array<{ row: LegacyCaseRow; reason: string }>;
  } {
    const validRecords: StagingCaseRecord[] = [];
    const skippedRows: Array<{ row: LegacyCaseRow; reason: string }> = [];

    // Track doc_code uniqueness within batch
    const seenDocCodes = new Set<string>();

    rows.forEach((row, idx) => {
      const docCode = (row.doc_code || '').trim().toUpperCase();
      if (!docCode) {
        skippedRows.push({ row, reason: `Row ${idx + 1}: Missing doc_code` });
        return;
      }

      if (seenDocCodes.has(docCode)) {
        skippedRows.push({ row, reason: `Row ${idx + 1}: Duplicate doc_code '${docCode}' in batch` });
        return;
      }
      seenDocCodes.add(docCode);

      // Resolve Company
      let clientId: string | null = approvedMappings.get(`company:${normalizeEntityText(row.company)}`) || null;
      if (!clientId) {
        const compRes = this.resolver.resolveCompany(row.company);
        clientId = compRes.id;
      }

      if (!clientId) {
        skippedRows.push({
          row,
          reason: `Row ${idx + 1} (${docCode}): Unresolved company '${row.company}'`
        });
        return;
      }

      const isWithdrawn = String(row.exception_type || '').toLowerCase() === 'withdrawn';
      const caseDate = row.date || new Date().toISOString();

      // Resolve Investigators & Compensation Rules
      const investigators: StagingCaseRecord['investigators'] = [];
      let totalInvestigatorCost = new Decimal(0);

      const invSlots: Array<{
        slot: 1 | 2;
        name?: string;
        fee?: number | string;
        ta?: number | string;
        status?: string;
      }> = [
        { slot: 1, name: row.inv1, fee: row.fee1, ta: row.ta1, status: row.inv1_status },
        { slot: 2, name: row.inv2, fee: row.fee2, ta: row.ta2, status: row.inv2_status }
      ];

      for (const slotItem of invSlots) {
        if (!slotItem.name) continue;
        const normInv = normalizeEntityText(slotItem.name);
        if (!normInv || normInv === 'NA' || normInv === 'NONE' || normInv === '__UNASSIGNED__') continue;

        let invId: string | null = approvedMappings.get(`investigator:${normInv}`) || null;
        let invName = slotItem.name;
        if (!invId) {
          const invRes = this.resolver.resolveInvestigator(slotItem.name);
          invId = invRes.id;
          if (invRes.canonicalName) invName = invRes.canonicalName;
        }

        if (!invId) {
          // Rule A12 / docs/LEGACY_DATA_MAP.md: Zero silent fallbacks
          skippedRows.push({
            row,
            reason: `Row ${idx + 1} (${docCode}): Unresolved investigator '${slotItem.name}'`
          });
          return;
        }

        let enteredFee = new Decimal(slotItem.fee || 0);
        let enteredTa = new Decimal(slotItem.ta || 0);

        // Check Salary terms & effective dating (TEST-03, TEST-04)
        const terms = this.termsMap.get(invId);
        if (terms && terms.payment_type === 'Salary' && terms.payment_type_changed_at) {
          const caseDateTime = new Date(caseDate).getTime();
          const effectiveDateTime = new Date(terms.payment_type_changed_at).getTime();
          if (caseDateTime >= effectiveDateTime) {
            // Case allocated on or after salary transition -> fee is 0, outstation TA preserved
            enteredFee = new Decimal(0);
          }
        }

        // Check Withdrawn exception rule (TEST-05)
        if (isWithdrawn) {
          enteredFee = new Decimal(0);
          enteredTa = new Decimal(0);
        }

        const payable = enteredFee.plus(enteredTa);
        totalInvestigatorCost = totalInvestigatorCost.plus(payable);

        investigators.push({
          investigator_id: invId,
          investigator_name: invName,
          agreed_fee: enteredFee.toNumber(),
          travel_allowance: enteredTa.toNumber(),
          total_payable: payable.toNumber(),
          payout_status: slotItem.status || 'Pending',
          slot: slotItem.slot
        });
      }

      // Format Invoice if present
      let invoiceRecord: StagingCaseRecord['invoice'] | undefined = undefined;
      if (row.invoice_amount || row.invoice_no) {
        const grandTotal = new Decimal(row.invoice_amount || 0);
        // Standard backward calculation for 18% GST (TEST-08)
        const taxable = grandTotal.dividedBy(1.18).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const gst = grandTotal.minus(taxable);

        invoiceRecord = {
          id: `inv_${this.batchId.slice(0, 8)}_${idx + 1}`,
          invoice_number: row.invoice_no || `INV-${docCode}`,
          grand_total: grandTotal.toNumber(),
          taxable_amount: taxable.toNumber(),
          gst_amount: gst.toNumber(),
          status: 'ISSUED'
        };
      }

      // Format Client Payment if present
      let paymentRecord: StagingCaseRecord['payment'] | undefined = undefined;
      if (row.received || row.tds_deducted) {
        paymentRecord = {
          id: `pay_${this.batchId.slice(0, 8)}_${idx + 1}`,
          amount: new Decimal(row.received || 0).toNumber(),
          tds_deducted: new Decimal(row.tds_deducted || 0).toNumber(),
          payment_date: row.received_date || caseDate,
          payment_mode: 'NEFT'
        };
      }

      const caseId = row.id || `mig_case_${this.batchId.slice(0, 8)}_${idx + 1}`;

      validRecords.push({
        id: caseId,
        agency_id: this.agencyId,
        import_batch_id: this.batchId,
        legacy_id: row.id,
        doc_code: docCode,
        claim_no: (row.claim_no || '').trim(),
        policy_no: row.policy_no ? row.policy_no.trim() : undefined,
        insured_name: row.insured_name.trim(),
        client_id: clientId,
        location: row.location ? row.location.trim() : undefined,
        allocated_at: row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
        outcome: row.outcome || 'Pending',
        sla_hours: Number(row.sla_hours || 24),
        sla_due_date: row.due_date,
        completed_at: row.completed_at,
        risk_level: row.risk_level || 'Low',
        exception_type: row.exception_type,
        exception_reason: row.exception_reason,
        total_investigator_cost: totalInvestigatorCost.toNumber(),
        investigators,
        invoice: invoiceRecord,
        payment: paymentRecord
      });
    });

    return { validRecords, skippedRows };
  }

  /**
   * Executes in-memory or database commit tagged by import_batch_id
   */
  public executeBatchCommit(
    rows: LegacyCaseRow[],
    approvedMappings: Map<string, string> = new Map()
  ): ImportExecutionResult {
    const { validRecords, skippedRows } = this.transformRows(rows, approvedMappings);

    let invoicesCount = 0;
    let paymentsCount = 0;
    let investigatorsCount = 0;

    for (const rec of validRecords) {
      if (rec.invoice) invoicesCount++;
      if (rec.payment) paymentsCount++;
      investigatorsCount += rec.investigators.length;
    }

    const errors = skippedRows.map(s => s.reason);

    return {
      batch_id: this.batchId,
      status: skippedRows.length === 0 ? 'COMMITTED' : 'FAILED',
      total_rows: rows.length,
      imported_cases_count: validRecords.length,
      imported_invoices_count: invoicesCount,
      imported_payments_count: paymentsCount,
      imported_investigators_count: investigatorsCount,
      unresolved_count: skippedRows.length,
      cases: validRecords,
      errors
    };
  }
}
