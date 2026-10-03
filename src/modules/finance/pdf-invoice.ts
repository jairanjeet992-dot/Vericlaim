/**
 * Server-Side Tax Invoice & Credit Note Document Generator (Rule A3 & A8)
 * Produces structured printable PDF/HTML document and computes SHA-256 hash
 * for immutable archiving in Cloudflare R2.
 *
 * Mark: CA-VERIFY
 */

import crypto from 'crypto';
import { GstCalculationResult } from './gst-engine';

export interface InvoicePartyDetails {
  name: string;
  legalName?: string;
  gstin?: string;
  pan?: string;
  address: string;
  city?: string;
  state: string;
  stateCode: string;
  phone?: string;
  email?: string;
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    branchName?: string;
  };
}

export interface InvoicePdfMetadata {
  invoiceNumber: string;
  financialYear: string;
  issueDate: string;
  dueDate?: string;
  docType?: 'TAX_INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  originalInvoiceNumber?: string;
  originalInvoiceDate?: string;
  reasonForNote?: string;
  notes?: string;
  terms?: string;
}

export interface GenerateInvoicePdfInput {
  metadata: InvoicePdfMetadata;
  supplier: InvoicePartyDetails;
  recipient: InvoicePartyDetails;
  calculation: GstCalculationResult;
}

export interface GeneratedPdfResult {
  buffer: Buffer;
  mimeType: string;
  sha256: string;
  htmlContent: string;
}

/**
 * Generates an authoritative server-side printable document representation
 * and calculates its SHA-256 integrity hash.
 */
export function generateInvoiceDocument(input: GenerateInvoicePdfInput): GeneratedPdfResult {
  const { metadata, supplier, recipient, calculation } = input;
  const isCreditOrDebit = metadata.docType === 'CREDIT_NOTE' || metadata.docType === 'DEBIT_NOTE';
  const title = metadata.docType === 'CREDIT_NOTE' ? 'CREDIT NOTE' : metadata.docType === 'DEBIT_NOTE' ? 'DEBIT NOTE' : 'TAX INVOICE';

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} - ${metadata.invoiceNumber}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.4; color: #1e293b; margin: 0; padding: 12px; }
    .invoice-card { border: 1px solid #cbd5e1; border-radius: 4px; padding: 16px; max-width: 800px; margin: 0 auto; background: #fff; }
    .header-table { width: 100%; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 12px; }
    .agency-title { font-size: 18px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }
    .doc-badge { font-size: 14px; font-weight: 800; color: #0369a1; text-align: right; text-transform: uppercase; }
    .meta-table { width: 100%; margin-bottom: 14px; border-collapse: collapse; }
    .meta-box { width: 50%; vertical-align: top; padding: 8px; border: 1px solid #e2e8f0; font-size: 10.5px; }
    .meta-title { font-size: 11px; font-weight: 700; color: #334155; text-transform: uppercase; margin-bottom: 4px; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    .items-table th { background: #f8fafc; border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 10px; font-weight: 700; text-align: left; text-transform: uppercase; }
    .items-table td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 10px; }
    .items-table .text-right { text-align: right; }
    .items-table .text-center { text-align: center; }
    .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    .summary-box { width: 55%; vertical-align: top; padding-right: 12px; }
    .total-box { width: 45%; vertical-align: top; }
    .total-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 10.5px; border-bottom: 1px dashed #e2e8f0; }
    .total-row.grand { font-size: 13px; font-weight: 800; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; padding: 6px 0; color: #0f172a; }
    .words-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; font-style: italic; font-weight: 600; font-size: 10px; margin-bottom: 12px; }
    .bank-box { border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; font-size: 10px; background: #fafafa; }
    .footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; }
    .mono { font-family: 'Courier New', Courier, monospace; }
  </style>
</head>
<body>
  <div class="invoice-card">
    <table class="header-table">
      <tr>
        <td>
          <div class="agency-title">${supplier.name}</div>
          <div style="font-size: 10px; color: #475569;">${supplier.address}, ${supplier.city || ''} (${supplier.state})</div>
          <div style="font-size: 10px; color: #475569;">GSTIN: <span class="mono"><strong>${supplier.gstin || 'UNREGISTERED'}</strong></span> | State Code: <span class="mono">${supplier.stateCode}</span></div>
          ${supplier.phone ? `<div style="font-size: 10px; color: #475569;">Phone: ${supplier.phone} | Email: ${supplier.email || ''}</div>` : ''}
        </td>
        <td style="vertical-align: top;">
          <div class="doc-badge">${title}</div>
          <div style="text-align: right; font-size: 11px; font-weight: 700;">No: <span class="mono">${metadata.invoiceNumber}</span></div>
          <div style="text-align: right; font-size: 10px; color: #64748b;">Date: <span class="mono">${metadata.issueDate}</span></div>
          <div style="text-align: right; font-size: 10px; color: #64748b;">FY: <span class="mono">${metadata.financialYear}</span></div>
          ${metadata.dueDate ? `<div style="text-align: right; font-size: 10px; color: #64748b;">Due Date: <span class="mono">${metadata.dueDate}</span></div>` : ''}
        </td>
      </tr>
    </table>

    ${
      isCreditOrDebit && metadata.originalInvoiceNumber
        ? `<div style="background: #fef3c7; border: 1px solid #fde68a; padding: 6px 10px; margin-bottom: 12px; font-size: 10px; border-radius: 4px;">
            <strong>Linked Original Invoice:</strong> ${metadata.originalInvoiceNumber} (${metadata.originalInvoiceDate || 'N/A'}) | <strong>Reason:</strong> ${metadata.reasonForNote || 'Price adjustment / Correction'}
          </div>`
        : ''
    }

    <table class="meta-table">
      <tr>
        <td class="meta-box" style="border-right: none;">
          <div class="meta-title">Details of Recipient (Billed To)</div>
          <div><strong>${recipient.legalName || recipient.name}</strong></div>
          <div>${recipient.address}</div>
          <div>State: ${recipient.state} (Code: <span class="mono">${recipient.stateCode}</span>)</div>
          <div>GSTIN: <span class="mono"><strong>${recipient.gstin || 'UNREGISTERED'}</strong></span></div>
          ${recipient.pan ? `<div>PAN: <span class="mono">${recipient.pan}</span></div>` : ''}
        </td>
        <td class="meta-box">
          <div class="meta-title">Tax & Supply Parameters</div>
          <div>Place of Supply: <strong>${calculation.placeOfSupplyStateName} (Code: ${calculation.placeOfSupplyStateCode})</strong></div>
          <div>Supply Type: <strong>${calculation.isIntraState ? 'INTRA-STATE (CGST + SGST)' : 'INTER-STATE (IGST)'}</strong></div>
          <div>Reverse Charge: <strong>${calculation.isReverseCharge ? 'YES (Recipient liable)' : 'NO'}</strong></div>
          <div>SEZ / Export: <strong>${calculation.isSez ? 'YES (Zero-Rated)' : 'NO'}</strong></div>
          <div>Calculation Mode: <strong>${calculation.calculationMode}</strong></div>
        </td>
      </tr>
    </table>

    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 5%;">#</th>
          <th style="width: 45%;">Description of Service / Docket Ref</th>
          <th style="width: 10%;" class="text-center">SAC</th>
          <th style="width: 8%;" class="text-right">Qty</th>
          <th style="width: 14%;" class="text-right">Rate (₹)</th>
          <th style="width: 18%;" class="text-right">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${calculation.items
          .map(
            (item, index) => `
          <tr>
            <td class="text-center">${index + 1}</td>
            <td>
              <strong>${item.description}</strong>
              ${item.caseId ? `<div style="font-size: 9px; color: #64748b;">Case Ref: ${item.caseId}</div>` : ''}
            </td>
            <td class="text-center mono">${item.sacCode}</td>
            <td class="text-right mono">${item.quantity}</td>
            <td class="text-right mono">${item.unitRate}</td>
            <td class="text-right mono"><strong>${item.taxableAmount}</strong></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>

    <table class="summary-table">
      <tr>
        <td class="summary-box">
          <div class="words-box">
            Amount Chargeable (in words):<br>
            <strong>${calculation.amountInWords}</strong>
          </div>

          ${
            supplier.bankDetails
              ? `<div class="bank-box">
                  <div style="font-weight: 700; text-transform: uppercase; margin-bottom: 4px; color: #334155;">Bank Details for Electronic Remittance</div>
                  <div>Bank Name: <strong>${supplier.bankDetails.bankName}</strong></div>
                  <div>A/C Number: <span class="mono"><strong>${supplier.bankDetails.accountNumber}</strong></span></div>
                  <div>IFSC Code: <span class="mono"><strong>${supplier.bankDetails.ifscCode}</strong></span></div>
                  ${supplier.bankDetails.branchName ? `<div>Branch: ${supplier.bankDetails.branchName}</div>` : ''}
                </div>`
              : ''
          }
        </td>
        <td class="total-box">
          <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 10px; background: #f8fafc;">
            <div class="total-row">
              <span>Subtotal Taxable:</span>
              <span class="mono">₹${calculation.subtotalAmount}</span>
            </div>
            ${
              Number(calculation.discountAmount) > 0
                ? `<div class="total-row" style="color: #dc2626;">
                    <span>Trade Discount:</span>
                    <span class="mono">- ₹${calculation.discountAmount}</span>
                  </div>`
                : ''
            }
            <div class="total-row">
              <span>Net Taxable Value:</span>
              <span class="mono"><strong>₹${calculation.taxableAmount}</strong></span>
            </div>
            ${
              calculation.isIntraState
                ? `<div class="total-row">
                    <span>CGST (${(Number(calculation.defaultTaxRate) / 2).toFixed(1)}%):</span>
                    <span class="mono">₹${calculation.cgstAmount}</span>
                  </div>
                  <div class="total-row">
                    <span>SGST (${(Number(calculation.defaultTaxRate) / 2).toFixed(1)}%):</span>
                    <span class="mono">₹${calculation.sgstAmount}</span>
                  </div>`
                : `<div class="total-row">
                    <span>IGST (${Number(calculation.defaultTaxRate).toFixed(1)}%):</span>
                    <span class="mono">₹${calculation.igstAmount}</span>
                  </div>`
            }
            <div class="total-row grand">
              <span>Grand Total:</span>
              <span class="mono">₹${calculation.totalAmount}</span>
            </div>
          </div>
        </td>
      </tr>
    </table>

    <div style="font-size: 9.5px; color: #475569; margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
      <div><strong>Terms & Conditions:</strong> ${metadata.terms || 'Payment due within 30 days of invoice receipt. Subject to jurisdiction of local courts.'}</div>
      ${metadata.notes ? `<div><strong>Notes:</strong> ${metadata.notes}</div>` : ''}
    </div>

    <div class="footer">
      <div>Computer Generated Document (Vericlaim SaaS Platform) | CA-VERIFY</div>
      <div style="text-align: right; font-weight: 700;">For ${supplier.name}<br><br><span style="border-top: 1px solid #0f172a; padding-top: 2px;">Authorized Signatory</span></div>
    </div>
  </div>
</body>
</html>`;

  // Standardize buffer output and compute cryptographic SHA-256 hash
  const buffer = Buffer.from(htmlContent, 'utf-8');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    buffer,
    mimeType: 'text/html', // Pure self-contained HTML/PDF document per Rule A3
    sha256,
    htmlContent,
  };
}
