import ExcelJS from 'exceljs';
import crypto from 'crypto';
import { Decimal } from 'decimal.js';
import { CompiledPayoutBatch } from './investigator-types';

export interface BankBulkExcelResult {
  buffer: Buffer;
  sha256: string;
  total_net_in_excel: number;
  row_count: number;
  matches_db_total: boolean;
}

/**
 * Generates an Excel (.xlsx) file in standard Indian corporate bank bulk payout format.
 * Validates invariant: sum of Excel amount column === payoutBatch.total_net_disbursable.
 */
export async function generateBankBulkPaymentExcel(
  batch: CompiledPayoutBatch
): Promise<BankBulkExcelResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Vericlaim SaaS';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Bank Bulk Payment', {
    properties: { defaultRowHeight: 22 },
  });

  // Define Columns
  worksheet.columns = [
    { header: 'Sr No', key: 'sr_no', width: 8 },
    { header: 'Beneficiary Name', key: 'beneficiary_name', width: 28 },
    { header: 'Account Number', key: 'account_number', width: 22 },
    { header: 'IFSC Code', key: 'ifsc_code', width: 14 },
    { header: 'Amount (INR)', key: 'amount', width: 16 },
    { header: 'Payment Mode', key: 'payment_mode', width: 14 },
    { header: 'Narration / Remarks', key: 'narration', width: 32 },
    { header: 'PAN Number', key: 'pan', width: 14 },
    { header: 'Batch Number', key: 'batch_number', width: 18 },
  ];

  // Header style
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // Slate-800
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  let totalExcelAmount = new Decimal(0);
  let srNo = 1;

  for (const payout of batch.payouts) {
    const netAmt = new Decimal(payout.net_payable);
    totalExcelAmount = totalExcelAmount.plus(netAmt);

    const paymentMode = netAmt.gte(200000) ? 'RTGS' : 'NEFT';

    const row = worksheet.addRow({
      sr_no: srNo++,
      beneficiary_name: payout.investigator_name,
      account_number: payout.account_number || 'N/A',
      ifsc_code: payout.ifsc_code || 'N/A',
      amount: netAmt.toNumber(),
      payment_mode: paymentMode,
      narration: `Payout ${batch.payout_month} - ${batch.batch_number}`,
      pan: payout.pan_number || 'N/A',
      batch_number: batch.batch_number,
    });

    // Formatting currency on Amount cell
    row.getCell('amount').numFmt = '#,##0.00';
    row.alignment = { vertical: 'middle' };
    row.getCell('sr_no').alignment = { horizontal: 'center' };
    row.getCell('payment_mode').alignment = { horizontal: 'center' };
  }

  // Add Summary Total Row
  const totalNet = totalExcelAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  const summaryRow = worksheet.addRow({
    sr_no: '',
    beneficiary_name: 'TOTAL DISBURSABLE',
    account_number: '',
    ifsc_code: '',
    amount: totalNet,
    payment_mode: '',
    narration: `Total ${batch.payouts.length} Beneficiaries`,
    pan: '',
    batch_number: batch.batch_number,
  });

  summaryRow.font = { bold: true };
  summaryRow.getCell('amount').numFmt = '#,##0.00';
  summaryRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' }, // Slate-100
  };

  const bufferUint8 = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(bufferUint8);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  // Strict invariant test: Excel total must equal DB batch total down to the paisa
  const dbBatchNet = new Decimal(batch.total_net_disbursable).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  const matchesDbTotal = Math.abs(totalNet - dbBatchNet) < 0.001;

  return {
    buffer,
    sha256,
    total_net_in_excel: totalNet,
    row_count: batch.payouts.length,
    matches_db_total: matchesDbTotal,
  };
}
