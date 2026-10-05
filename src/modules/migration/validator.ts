import {
  LegacyCaseRow,
  DryRunValidationError,
  DryRunValidationResult,
  UnresolvedEntityReport
} from './types';
import { EntityResolver, calculateSimilarity } from './entity-resolver';

export const CANONICAL_OUTCOMES = [
  'Pending',
  'Genuine',
  'Fraud',
  'Suspicious',
  'Repudiated',
  'Untraceable',
  'Settled'
] as const;

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export class LegacyImportValidator {
  private existingClaimNumbers: Set<string>; // normalized (client + claim_no)
  private existingDocCodes: Set<string>;

  constructor(existingClaimKeys?: string[], existingDocCodes?: string[]) {
    this.existingClaimNumbers = new Set(existingClaimKeys?.map(k => k.toUpperCase().trim()) || []);
    this.existingDocCodes = new Set(existingDocCodes?.map(d => d.toUpperCase().trim()) || []);
  }

  /**
   * Validate Indian GSTIN format
   */
  public static isValidGstin(gstin: string | null | undefined): boolean {
    if (!gstin) return true; // optional
    const clean = gstin.trim().toUpperCase();
    return GSTIN_REGEX.test(clean);
  }

  /**
   * Finds closest canonical outcome for a typo
   */
  public static findClosestOutcome(val: string): { closest: string; similarity: number } | null {
    if (!val) return null;
    let bestScore = 0;
    let bestMatch = '';

    for (const outcome of CANONICAL_OUTCOMES) {
      const score = calculateSimilarity(val, outcome);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = outcome;
      }
    }

    if (bestScore >= 0.6) {
      return { closest: bestMatch, similarity: bestScore };
    }
    return null;
  }

  /**
   * Runs comprehensive dry-run validation on the batch of legacy rows
   */
  public validateBatch(
    rows: LegacyCaseRow[],
    agencyId: string,
    batchId: string,
    resolver: EntityResolver
  ): DryRunValidationResult {
    const errors: DryRunValidationError[] = [];
    const batchClaimKeys = new Set<string>();
    const batchDocCodes = new Set<string>();

    rows.forEach((row, idx) => {
      const rowIndex = idx + 1;
      const docCode = (row.doc_code || '').trim().toUpperCase();
      const claimNo = (row.claim_no || '').trim().toUpperCase();
      const company = (row.company || '').trim();

      // 1. Mandatory Fields
      if (!docCode) {
        errors.push({
          row_index: rowIndex,
          doc_code: row.doc_code || `ROW_${rowIndex}`,
          claim_no: claimNo,
          field: 'doc_code',
          value: row.doc_code,
          error_type: 'MISSING_FIELD',
          message: `Row ${rowIndex}: 'doc_code' is mandatory but missing.`
        });
      }

      if (!claimNo) {
        errors.push({
          row_index: rowIndex,
          doc_code: docCode,
          claim_no: row.claim_no || `ROW_${rowIndex}`,
          field: 'claim_no',
          value: row.claim_no,
          error_type: 'MISSING_FIELD',
          message: `Row ${rowIndex} (${docCode}): 'claim_no' is mandatory but missing.`
        });
      }

      if (!row.insured_name || !row.insured_name.trim()) {
        errors.push({
          row_index: rowIndex,
          doc_code: docCode,
          claim_no: claimNo,
          field: 'insured_name',
          value: row.insured_name,
          error_type: 'MISSING_FIELD',
          message: `Row ${rowIndex} (${docCode}): 'insured_name' is mandatory but missing.`
        });
      }

      if (!company) {
        errors.push({
          row_index: rowIndex,
          doc_code: docCode,
          claim_no: claimNo,
          field: 'company',
          value: row.company,
          error_type: 'MISSING_FIELD',
          message: `Row ${rowIndex} (${docCode}): 'company' is mandatory but missing.`
        });
      }

      // 2. Duplicate Doc Codes
      if (docCode) {
        if (this.existingDocCodes.has(docCode)) {
          errors.push({
            row_index: rowIndex,
            doc_code: docCode,
            claim_no: claimNo,
            field: 'doc_code',
            value: docCode,
            error_type: 'DUPLICATE_CLAIM',
            message: `Row ${rowIndex}: Doc code '${docCode}' already exists in this agency.`
          });
        } else if (batchDocCodes.has(docCode)) {
          errors.push({
            row_index: rowIndex,
            doc_code: docCode,
            claim_no: claimNo,
            field: 'doc_code',
            value: docCode,
            error_type: 'DUPLICATE_CLAIM',
            message: `Row ${rowIndex}: Duplicate doc code '${docCode}' appears multiple times in this import file.`
          });
        } else {
          batchDocCodes.add(docCode);
        }
      }

      // 3. Duplicate Claim Numbers per Company
      if (company && claimNo) {
        const claimKey = `${company.toUpperCase()}:::${claimNo}`;
        if (this.existingClaimNumbers.has(claimKey)) {
          errors.push({
            row_index: rowIndex,
            doc_code: docCode,
            claim_no: claimNo,
            field: 'claim_no',
            value: claimNo,
            error_type: 'DUPLICATE_CLAIM',
            message: `Row ${rowIndex} (${docCode}): Claim number '${claimNo}' for '${company}' already exists in database.`
          });
        } else if (batchClaimKeys.has(claimKey)) {
          errors.push({
            row_index: rowIndex,
            doc_code: docCode,
            claim_no: claimNo,
            field: 'claim_no',
            value: claimNo,
            error_type: 'DUPLICATE_CLAIM',
            message: `Row ${rowIndex} (${docCode}): Duplicate claim number '${claimNo}' for '${company}' repeated within import file.`
          });
        } else {
          batchClaimKeys.add(claimKey);
        }
      }

      // 4. Negative Monetary Amounts
      const moneyFields: Array<{ name: string; val: any }> = [
        { name: 'fee1', val: row.fee1 },
        { name: 'ta1', val: row.ta1 },
        { name: 'fee2', val: row.fee2 },
        { name: 'ta2', val: row.ta2 },
        { name: 'total_payable', val: row.total_payable },
        { name: 'invoice_amount', val: row.invoice_amount },
        { name: 'received', val: row.received },
        { name: 'tds_deducted', val: row.tds_deducted },
      ];

      for (const mf of moneyFields) {
        if (mf.val !== undefined && mf.val !== null && mf.val !== '') {
          const num = typeof mf.val === 'number' ? mf.val : parseFloat(String(mf.val).replace(/[^\d.-]/g, ''));
          if (isNaN(num)) {
            errors.push({
              row_index: rowIndex,
              doc_code: docCode,
              claim_no: claimNo,
              field: mf.name,
              value: mf.val,
              error_type: 'INVALID_AMOUNT',
              message: `Row ${rowIndex} (${docCode}): Monetary field '${mf.name}' has non-numeric value '${mf.val}'.`
            });
          } else if (num < 0) {
            errors.push({
              row_index: rowIndex,
              doc_code: docCode,
              claim_no: claimNo,
              field: mf.name,
              value: mf.val,
              error_type: 'INVALID_AMOUNT',
              message: `Row ${rowIndex} (${docCode}): Monetary field '${mf.name}' cannot be negative (${num}).`
            });
          }
        }
      }

      // 5. Outcome Typo Validation
      if (row.outcome && row.outcome.trim()) {
        const rawOutcome = row.outcome.trim();
        const isExactMatch = CANONICAL_OUTCOMES.some(
          o => o.toLowerCase() === rawOutcome.toLowerCase()
        );
        if (!isExactMatch) {
          const closest = LegacyImportValidator.findClosestOutcome(rawOutcome);
          errors.push({
            row_index: rowIndex,
            doc_code: docCode,
            claim_no: claimNo,
            field: 'outcome',
            value: row.outcome,
            error_type: 'OUTCOME_TYPO',
            message: `Row ${rowIndex} (${docCode}): Outcome '${rawOutcome}' is invalid. Allowed: ${CANONICAL_OUTCOMES.join(', ')}.`,
            suggested_fix: closest?.closest
          });
        }
      }

      // 6. GSTIN Validation (if provided in custom_data or row)
      const gstinVal = row.gstin || row.custom_data?.gstin;
      if (gstinVal && !LegacyImportValidator.isValidGstin(gstinVal)) {
        errors.push({
          row_index: rowIndex,
          doc_code: docCode,
          claim_no: claimNo,
          field: 'gstin',
          value: gstinVal,
          error_type: 'BAD_GSTIN',
          message: `Row ${rowIndex} (${docCode}): GSTIN '${gstinVal}' does not conform to 15-character Indian GST format.`
        });
      }
    });

    // Generate Entity Resolution Report
    const unresolvedReport: UnresolvedEntityReport = resolver.generateUnresolvedReport(
      agencyId,
      batchId,
      rows
    );

    const errorCount = errors.length;
    const warningCount = unresolvedReport.exceptions.length;
    const isValid = errorCount === 0 && warningCount === 0;

    return {
      is_valid: isValid,
      total_rows: rows.length,
      valid_rows_count: Math.max(0, rows.length - errorCount),
      error_count: errorCount,
      warning_count: warningCount,
      errors,
      normalized_sample: rows.slice(0, 5),
      unresolved_report: unresolvedReport
    };
  }
}
