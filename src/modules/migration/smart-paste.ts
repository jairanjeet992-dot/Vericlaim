import {
  LegacyCaseRow,
  SmartPasteDiffPreview,
  SmartPasteDiffRow
} from './types';

export interface ExistingCaseSnapshot {
  doc_code: string;
  claim_no: string;
  insured_name: string;
  client_name: string;
  investigators: string[];
  total_payable: number;
  outcome?: string;
  received?: number;
  tds_deducted?: number;
  invoice_amount?: number;
}

export class SmartPasteParser {
  /**
   * Parses TSV or CSV string into LegacyCaseRow objects
   */
  public static parsePastedText(
    rawText: string,
    delimiter: '\t' | ',' | ';' = '\t',
    hasHeaders = true
  ): LegacyCaseRow[] {
    const lines = rawText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) return [];

    let headerMap: Record<string, number> = {};
    let dataLines = lines;

    if (hasHeaders) {
      const rawHeaderRow = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/[^\w]/g, ''));
      headerMap = this.mapHeaderIndices(rawHeaderRow);
      dataLines = lines.slice(1);
    } else {
      // Default standard order
      headerMap = {
        doc_code: 0,
        claim_no: 1,
        insured_name: 2,
        company: 3,
        inv1: 4,
        fee1: 5,
        ta1: 6,
        outcome: 7,
        received: 8,
        tds_deducted: 9
      };
    }

    const parsedRows: LegacyCaseRow[] = [];

    dataLines.forEach((line, idx) => {
      const parts = line.split(delimiter).map(p => p.trim());
      if (parts.length === 0 || (parts.length === 1 && !parts[0])) return;

      const getVal = (field: string): string => {
        const index = headerMap[field];
        if (index !== undefined && index < parts.length) {
          return parts[index];
        }
        return '';
      };

      const docCode = getVal('doc_code') || `PASTE-${idx + 1}`;
      const claimNo = getVal('claim_no') || `CLM-${idx + 1}`;
      const insuredName = getVal('insured_name') || 'Unnamed Insured';
      const company = getVal('company') || 'Unknown Client';

      const parseNum = (val: string): number | undefined => {
        if (!val) return undefined;
        const clean = val.replace(/[^\d.-]/g, '');
        const n = parseFloat(clean);
        return isNaN(n) ? undefined : n;
      };

      const row: LegacyCaseRow = {
        doc_code: docCode,
        claim_no: claimNo,
        insured_name: insuredName,
        company: company,
        case_type: getVal('case_type') || undefined,
        location: getVal('location') || undefined,
        hospital: getVal('hospital') || undefined,
        inv1: getVal('inv1') || undefined,
        fee1: parseNum(getVal('fee1')),
        ta1: parseNum(getVal('ta1')),
        inv2: getVal('inv2') || undefined,
        fee2: parseNum(getVal('fee2')),
        ta2: parseNum(getVal('ta2')),
        outcome: getVal('outcome') || undefined,
        received: parseNum(getVal('received')),
        tds_deducted: parseNum(getVal('tds_deducted')),
        invoice_amount: parseNum(getVal('invoice_amount')),
        date: getVal('date') || undefined
      };

      parsedRows.push(row);
    });

    return parsedRows;
  }

  /**
   * Intelligently maps flexible header labels to canonical field keys
   */
  private static mapHeaderIndices(headers: string[]): Record<string, number> {
    const map: Record<string, number> = {};

    headers.forEach((h, idx) => {
      if (h.includes('doccode') || h === 'doc' || h === 'code') map['doc_code'] = idx;
      else if (h.includes('claim') || h === 'claimno' || h === 'clm') map['claim_no'] = idx;
      else if (h.includes('insured') || h.includes('patient') || h === 'name') map['insured_name'] = idx;
      else if (h.includes('company') || h.includes('client') || h.includes('insurer')) map['company'] = idx;
      else if (h.includes('casetype') || h === 'type') map['case_type'] = idx;
      else if (h.includes('location') || h === 'city') map['location'] = idx;
      else if (h.includes('hospital')) map['hospital'] = idx;
      else if (h === 'inv1' || h.includes('investigator1') || h === 'investigator') map['inv1'] = idx;
      else if (h === 'fee1' || h.includes('fee') || h === 'investigatorfee') map['fee1'] = idx;
      else if (h === 'ta1' || h.includes('ta') || h.includes('travel')) map['ta1'] = idx;
      else if (h === 'inv2' || h.includes('investigator2')) map['inv2'] = idx;
      else if (h === 'fee2') map['fee2'] = idx;
      else if (h === 'ta2') map['ta2'] = idx;
      else if (h.includes('outcome') || h.includes('status')) map['outcome'] = idx;
      else if (h.includes('received') || h.includes('paidamount')) map['received'] = idx;
      else if (h.includes('tds')) map['tds_deducted'] = idx;
      else if (h.includes('invoice') || h.includes('billamount')) map['invoice_amount'] = idx;
      else if (h.includes('date') || h === 'allocationdate') map['date'] = idx;
    });

    return map;
  }

  /**
   * Computes a live Diff Preview comparing pasted rows against existing cases
   */
  public static generateDiffPreview(
    pastedRows: LegacyCaseRow[],
    existingCases: Map<string, ExistingCaseSnapshot> // key = doc_code or claim_no
  ): SmartPasteDiffPreview {
    let newCasesCount = 0;
    let updateCasesCount = 0;
    let errorCount = 0;

    const diffRows: SmartPasteDiffRow[] = [];

    pastedRows.forEach((row, idx) => {
      const rowIndex = idx + 1;
      const docCodeKey = (row.doc_code || '').trim().toUpperCase();
      const claimNoKey = (row.claim_no || '').trim().toUpperCase();

      const existing = existingCases.get(docCodeKey) || existingCases.get(claimNoKey);
      const isNewCase = !existing;

      const diffFields: Record<string, { old_val: any; new_val: any }> = {};
      const messages: string[] = [];
      let status: 'VALID' | 'WARNING' | 'ERROR' = 'VALID';

      const investigators = [row.inv1, row.inv2].filter(Boolean) as string[];
      const f1 = Number(row.fee1 || 0);
      const t1 = Number(row.ta1 || 0);
      const f2 = Number(row.fee2 || 0);
      const t2 = Number(row.ta2 || 0);
      const totalPayable = f1 + t1 + f2 + t2;

      if (isNewCase) {
        newCasesCount++;
        messages.push('New case entry to be inserted.');
      } else {
        updateCasesCount++;
        // Compare fields
        if (existing.insured_name !== row.insured_name) {
          diffFields['insured_name'] = { old_val: existing.insured_name, new_val: row.insured_name };
        }
        if (existing.client_name.toUpperCase() !== row.company.toUpperCase()) {
          diffFields['company'] = { old_val: existing.client_name, new_val: row.company };
        }
        if (row.outcome && existing.outcome !== row.outcome) {
          diffFields['outcome'] = { old_val: existing.outcome || '(none)', new_val: row.outcome };
        }
        if (existing.total_payable !== totalPayable) {
          diffFields['total_payable'] = { old_val: existing.total_payable, new_val: totalPayable };
        }
        if (row.received !== undefined && existing.received !== row.received) {
          diffFields['received'] = { old_val: existing.received ?? 0, new_val: row.received };
        }
        if (row.tds_deducted !== undefined && existing.tds_deducted !== row.tds_deducted) {
          diffFields['tds_deducted'] = { old_val: existing.tds_deducted ?? 0, new_val: row.tds_deducted };
        }

        const diffCount = Object.keys(diffFields).length;
        if (diffCount > 0) {
          status = 'WARNING';
          messages.push(`Case exists: updating ${diffCount} modified field(s).`);
        } else {
          messages.push('Identical to existing record (no changes).');
        }
      }

      if (!row.claim_no || !row.insured_name || !row.company) {
        status = 'ERROR';
        errorCount++;
        messages.push('Missing essential case identifiers.');
      }

      diffRows.push({
        row_index: rowIndex,
        doc_code: row.doc_code,
        claim_no: row.claim_no,
        insured_name: row.insured_name,
        client_name: row.company,
        investigator_names: investigators,
        total_payable: totalPayable,
        is_new_case: isNewCase,
        status,
        messages,
        diff_fields: diffFields
      });
    });

    return {
      total_pasted: pastedRows.length,
      new_cases_count: newCasesCount,
      update_cases_count: updateCasesCount,
      error_count: errorCount,
      rows: diffRows
    };
  }
}
