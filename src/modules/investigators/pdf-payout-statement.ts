import crypto from 'crypto';
import { CompiledInvestigatorPayout } from './investigator-types';

export interface AgencyStatementDetails {
  name: string;
  code: string;
  address?: string;
  email?: string;
  phone?: string;
  pan?: string;
  gstin?: string;
}

export interface GeneratePayoutStatementInput {
  agency: AgencyStatementDetails;
  payout: CompiledInvestigatorPayout;
  batchNumber: string;
  paymentReference?: string;
  paidAt?: string;
}

export interface GeneratedStatementResult {
  buffer: Buffer;
  mimeType: string;
  sha256: string;
  htmlContent: string;
}

export function generatePayoutStatementDocument(input: GeneratePayoutStatementInput): GeneratedStatementResult {
  const { agency, payout, batchNumber, paymentReference, paidAt } = input;

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Investigator Payout Statement - ${payout.investigator_name} - ${payout.payout_month}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.4; color: #1e293b; margin: 0; padding: 12px; }
    .statement-card { border: 1px solid #cbd5e1; border-radius: 4px; padding: 16px; max-width: 800px; margin: 0 auto; background: #fff; }
    .header { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-start; }
    .title { font-size: 18px; font-weight: bold; color: #0f172a; margin: 0; }
    .subtitle { font-size: 10px; color: #64748b; margin-top: 2px; }
    .section-title { font-size: 12px; font-weight: bold; color: #0f172a; margin: 12px 0 6px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    .grid-2 { display: flex; gap: 16px; margin-bottom: 12px; }
    .col { flex: 1; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th { background: #f8fafc; text-align: left; padding: 6px 8px; font-size: 10px; font-weight: 600; border-bottom: 1px solid #cbd5e1; }
    td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 10px; }
    .text-right { text-align: right; }
    .font-bold { font-weight: bold; }
    .summary-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px; margin-top: 8px; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 9px; font-weight: 600; background: #e2e8f0; color: #334155; }
    .footer { margin-top: 20px; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; text-align: center; }
  </style>
</head>
<body>
  <div class="statement-card">
    <div class="header">
      <div>
        <h1 class="title">${agency.name}</h1>
        <div class="subtitle">Agency Code: ${agency.code} ${agency.gstin ? `| GSTIN: ${agency.gstin}` : ''}</div>
        <div class="subtitle">${agency.address || ''}</div>
      </div>
      <div style="text-align: right;">
        <span class="badge">MONTHLY DISBURSAL STATEMENT</span>
        <div style="font-size: 14px; font-weight: bold; margin-top: 4px; color: #0f172a;">${payout.payout_month}</div>
        <div class="subtitle">Batch: ${batchNumber}</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="col">
        <div class="section-title">Investigator Details</div>
        <div><strong>Name:</strong> ${payout.investigator_name}</div>
        <div><strong>Payment Type:</strong> ${payout.payment_type}</div>
        <div><strong>PAN:</strong> ${payout.pan_number || 'NOT PROVIDED (Sec 206AA Penal TDS Applied)'}</div>
      </div>
      <div class="col">
        <div class="section-title">Remittance & Bank Details</div>
        <div><strong>Bank:</strong> ${payout.bank_name || 'N/A'}</div>
        <div><strong>A/C No:</strong> ${payout.account_number ? '••••' + payout.account_number.slice(-4) : 'N/A'}</div>
        <div><strong>IFSC:</strong> ${payout.ifsc_code || 'N/A'}</div>
        ${paymentReference ? `<div><strong>Bank Reference / UTR:</strong> ${paymentReference}</div>` : ''}
        ${paidAt ? `<div><strong>Paid Date:</strong> ${paidAt.slice(0, 10)}</div>` : ''}
      </div>
    </div>

    <div class="section-title">Earnings Breakdown</div>
    <table>
      <thead>
        <tr>
          <th>Item / Case / Reference</th>
          <th>Type</th>
          <th class="text-right">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${payout.payment_type === 'SALARY' ? `
          <tr>
            <td>Base Monthly Retainer / Salary</td>
            <td>Retainer</td>
            <td class="text-right">${payout.base_salary_or_fee.toFixed(2)}</td>
          </tr>
        ` : ''}
        ${payout.items.filter(i => !i.is_deduction).map(item => `
          <tr>
            <td>${item.description}</td>
            <td>${item.item_type}</td>
            <td class="text-right">${item.amount.toFixed(2)}</td>
          </tr>
        `).join('')}
        <tr class="font-bold" style="background: #f1f5f9;">
          <td colspan="2">Total Gross Payable</td>
          <td class="text-right">₹${payout.gross_payable.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div class="section-title">Statutory & Advance Deductions</div>
    <table>
      <thead>
        <tr>
          <th>Deduction Item</th>
          <th>Section / Basis</th>
          <th class="text-right">Rate</th>
          <th class="text-right">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Tax Deducted at Source (TDS)</td>
          <td>Section ${payout.tds_section}</td>
          <td class="text-right">${payout.tds_rate.toFixed(2)}%</td>
          <td class="text-right font-bold" style="color: #dc2626;">- ₹${payout.tds_amount.toFixed(2)}</td>
        </tr>
        ${payout.items.filter(i => i.is_deduction).map(item => `
          <tr>
            <td>${item.description}</td>
            <td>${item.item_type}</td>
            <td class="text-right">-</td>
            <td class="text-right" style="color: #dc2626;">- ₹${item.amount.toFixed(2)}</td>
          </tr>
        `).join('')}
        <tr class="font-bold" style="background: #fef2f2;">
          <td colspan="3">Total Deductions (TDS + Advances + Adjustments)</td>
          <td class="text-right" style="color: #dc2626;">- ₹${(payout.tds_amount + payout.total_deductions).toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div class="summary-box" style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-size: 10px; color: #64748b;">NET DISBURSABLE AMOUNT</div>
        <div style="font-size: 11px; font-style: italic; color: #334155;">Verified against bank bulk disbursal ledger</div>
      </div>
      <div style="font-size: 20px; font-weight: bold; color: #047857;">
        ₹${payout.net_payable.toFixed(2)}
      </div>
    </div>

    <div class="footer">
      Generated automatically by Vericlaim SaaS. Secure audit document. All records append-only.
    </div>
  </div>
</body>
</html>`;

  const buffer = Buffer.from(htmlContent, 'utf-8');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    buffer,
    mimeType: 'text/html',
    sha256,
    htmlContent,
  };
}
