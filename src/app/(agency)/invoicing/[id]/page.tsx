'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Lock,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Download,
  AlertTriangle,
  PlusCircle,
  FileCheck,
} from 'lucide-react';

export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [dossier, setDossier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Credit Note Modal
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditReason, setCreditReason] = useState('');
  const [creditAmount, setCreditAmount] = useState(500);

  // Cancellation Modal
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const fetchInvoice = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${params.id}`);
      const json = await res.json();
      if (json.success) {
        setDossier(json.data);
      }
    } catch (err) {
      console.error('Failed to load invoice', err);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const handleIssueInvoice = async () => {
    if (!confirm('Issue this invoice formally? A gapless sequence number will be allocated and the invoice will become permanently IMMUTABLE.')) {
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/invoices/${params.id}/issue`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.success) {
        fetchInvoice();
      } else {
        alert(json.error || 'Failed to issue invoice');
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      const res = await fetch(`/api/invoices/${params.id}/pdf`);
      const json = await res.json();
      if (json.success && json.data.downloadUrl) {
        window.open(json.data.downloadUrl, '_blank');
      } else {
        alert(json.error || 'Could not retrieve PDF download link');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCancelInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelReason.trim()) {
      alert('Mandatory cancellation explanation is required');
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/invoices/${params.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancellation_reason: cancelReason }),
      });
      const json = await res.json();
      if (json.success) {
        setShowCancelModal(false);
        fetchInvoice();
      } else {
        alert(json.error || 'Failed to cancel invoice');
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateCreditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditReason.trim()) {
      alert('Credit note reason is required');
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/invoices/${params.id}/credit-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: creditReason,
          taxable_amount: creditAmount,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowCreditModal(false);
        fetchInvoice();
      } else {
        alert(json.error || 'Failed to create credit note');
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading invoice details...</div>;
  }

  if (!dossier) {
    return (
      <div className="p-8 text-center text-rose-500">
        Invoice not found or access denied.
      </div>
    );
  }

  const { invoice: inv, items, taxes, creditNotes, client, clientBranch, agency } = dossier;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back and Status Bar */}
      <div className="flex justify-between items-center">
        <Link
          href="/invoicing"
          className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center space-x-1"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Invoices</span>
        </Link>

        <div className="flex items-center space-x-3">
          {inv.is_immutable && (
            <span className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-xs font-bold">
              <Lock className="h-3.5 w-3.5" />
              <span>LOCKED & IMMUTABLE (A6)</span>
            </span>
          )}

          {inv.status === 'DRAFT' && (
            <button
              onClick={handleIssueInvoice}
              disabled={actionLoading}
              className="px-4 py-1.5 bg-emerald-600 text-white rounded text-xs font-bold hover:bg-emerald-700 transition flex items-center space-x-1.5 shadow-sm"
            >
              <FileCheck className="h-4 w-4" />
              <span>Issue Tax Invoice</span>
            </button>
          )}

          {inv.pdf_r2_key && (
            <button
              onClick={handleDownloadPdf}
              className="px-3 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded text-xs font-semibold flex items-center space-x-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download PDF</span>
            </button>
          )}

          {inv.status === 'ISSUED' && (
            <>
              <button
                onClick={() => setShowCreditModal(true)}
                className="px-3 py-1.5 bg-slate-800 text-white rounded text-xs font-semibold hover:bg-slate-700 transition flex items-center space-x-1.5"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                <span>Credit Note</span>
              </button>
              <button
                onClick={() => setShowCancelModal(true)}
                className="px-3 py-1.5 border border-rose-200 text-rose-700 hover:bg-rose-50 rounded text-xs font-semibold"
              >
                Cancel Invoice
              </button>
            </>
          )}
        </div>
      </div>

      {/* Invoice Document Preview Card */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm space-y-6">
        {/* Document Header */}
        <div className="flex justify-between items-start border-b border-slate-200 pb-4">
          <div>
            <div className="text-xl font-black text-slate-900 uppercase tracking-wide">
              {agency.name}
            </div>
            <div className="text-xs text-slate-500">{agency.address}</div>
            <div className="text-xs text-slate-600 mt-1">
              GSTIN: <span className="font-mono font-bold">{agency.gstin || 'UNREGISTERED'}</span> | State Code: <span className="font-mono">{agency.state_code}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-base font-extrabold text-blue-700">TAX INVOICE</div>
            <div className="text-sm font-mono font-bold text-slate-900 mt-0.5">{inv.invoice_number}</div>
            <div className="text-xs text-slate-500">Date: {inv.issue_date}</div>
            <div className="text-xs text-slate-400 font-mono">FY: {inv.financial_year}</div>
          </div>
        </div>

        {/* Parties Box */}
        <div className="grid grid-cols-2 gap-4 border border-slate-200 rounded p-4 text-xs bg-slate-50">
          <div>
            <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
              Billed To (Client Branch)
            </div>
            <div className="font-bold text-slate-900 text-sm">{clientBranch.legal_name || client.name}</div>
            <div className="text-slate-600">{clientBranch.billing_address}</div>
            <div className="text-slate-600">State: {clientBranch.state} (Code: <span className="font-mono">{clientBranch.state_code}</span>)</div>
            <div className="text-slate-700 font-semibold mt-1">
              GSTIN: <span className="font-mono font-bold">{clientBranch.gstin}</span>
            </div>
          </div>
          <div>
            <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
              Tax Supply Details
            </div>
            <div>Place of Supply: <strong>Code {inv.place_of_supply_state_code}</strong></div>
            <div>
              Supply Nature: <strong>{inv.is_intra_state ? 'INTRA-STATE (CGST + SGST)' : 'INTER-STATE (IGST)'}</strong>
            </div>
            <div>Reverse Charge: <strong>{inv.is_reverse_charge ? 'YES' : 'NO'}</strong></div>
            <div>SEZ Zero-Rated: <strong>{inv.is_sez ? 'YES' : 'NO'}</strong></div>
            <div>Calculation Mode: <span className="font-mono">{inv.calculation_mode}</span></div>
          </div>
        </div>

        {/* Items Table */}
        <div className="border border-slate-200 rounded overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b text-slate-600 font-semibold uppercase">
              <tr>
                <th className="py-2 px-3">#</th>
                <th className="py-2 px-3">Description</th>
                <th className="py-2 px-3 text-center">SAC</th>
                <th className="py-2 px-3 text-right">Qty</th>
                <th className="py-2 px-3 text-right">Rate</th>
                <th className="py-2 px-3 text-right">Taxable</th>
                <th className="py-2 px-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it: any, idx: number) => (
                <tr key={it.id || idx}>
                  <td className="py-2 px-3 text-center">{idx + 1}</td>
                  <td className="py-2 px-3 font-medium text-slate-800">{it.description}</td>
                  <td className="py-2 px-3 text-center font-mono">{it.sac_code}</td>
                  <td className="py-2 px-3 text-right font-mono">{it.quantity}</td>
                  <td className="py-2 px-3 text-right font-mono">₹{it.unit_rate}</td>
                  <td className="py-2 px-3 text-right font-mono font-semibold">₹{it.taxable_amount}</td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">₹{it.total_amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals & Taxes Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-xs italic">
              Amount in Words:<br />
              <strong className="text-slate-800 not-italic">{inv.amount_in_words}</strong>
            </div>

            {inv.pdf_sha256 && (
              <div className="text-[10px] text-slate-400 font-mono break-all">
                SHA-256 (R2 Vault): {inv.pdf_sha256}
              </div>
            )}
          </div>

          <div className="border border-slate-200 rounded p-3 bg-slate-50 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal Taxable:</span>
              <span className="font-mono">₹{inv.subtotal_amount}</span>
            </div>
            {Number(inv.discount_amount) > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>Discount:</span>
                <span className="font-mono">-₹{inv.discount_amount}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-slate-800 border-t pt-1">
              <span>Net Taxable Base:</span>
              <span className="font-mono">₹{inv.taxable_amount}</span>
            </div>
            {inv.is_intra_state ? (
              <>
                <div className="flex justify-between text-slate-600">
                  <span>CGST (9%):</span>
                  <span className="font-mono">₹{inv.cgst_amount}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>SGST (9%):</span>
                  <span className="font-mono">₹{inv.sgst_amount}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-slate-600">
                <span>IGST (18%):</span>
                <span className="font-mono">₹{inv.igst_amount}</span>
              </div>
            )}
            <div className="flex justify-between font-extrabold text-sm text-slate-900 border-t border-slate-300 pt-1.5">
              <span>Total Invoice Amount:</span>
              <span className="font-mono">₹{inv.total_amount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Credit / Debit Notes Section */}
      {creditNotes && creditNotes.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-3 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span>Associated Credit / Debit Notes</span>
          </h3>

          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase">
              <tr>
                <th className="py-2 px-3">Note Number</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Reason</th>
                <th className="py-2 px-3 text-right">Taxable</th>
                <th className="py-2 px-3 text-right">GST Adjustment</th>
                <th className="py-2 px-3 text-right">Total Adjustment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {creditNotes.map((cn: any) => (
                <tr key={cn.id}>
                  <td className="py-2 px-3 font-mono font-bold text-slate-900">{cn.note_number}</td>
                  <td className="py-2 px-3 font-semibold">{cn.note_type}</td>
                  <td className="py-2 px-3 text-slate-600">{cn.reason}</td>
                  <td className="py-2 px-3 text-right font-mono">₹{cn.taxable_amount}</td>
                  <td className="py-2 px-3 text-right font-mono">
                    ₹{(Number(cn.cgst_amount) + Number(cn.sgst_amount) + Number(cn.igst_amount)).toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-rose-600">
                    ₹{cn.total_amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Credit Note Modal */}
      {showCreditModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-sm font-bold text-slate-900">Issue Credit Note</h2>
              <button onClick={() => setShowCreditModal(false)} className="text-slate-400">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCreditNote} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Reason for Credit Adjustment</label>
                <textarea
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  placeholder="e.g. Disallowed outstation conveyance or rate revision"
                  required
                  rows={2}
                  className="w-full border rounded p-2"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Taxable Adjustment Amount (₹)</label>
                <input
                  type="number"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(Number(e.target.value))}
                  required
                  min={1}
                  className="w-full border rounded p-2 font-mono"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowCreditModal(false)}
                  className="px-3 py-1.5 border rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-1.5 bg-slate-800 text-white rounded font-bold hover:bg-slate-700"
                >
                  Issue Credit Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancellation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-sm font-bold text-rose-700">Cancel Tax Invoice</h2>
              <button onClick={() => setShowCancelModal(false)} className="text-slate-400">
                ✕
              </button>
            </div>

            <form onSubmit={handleCancelInvoice} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Mandatory Cancellation Reason
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Invoiced to wrong client branch or duplicate billing"
                  required
                  rows={3}
                  className="w-full border border-slate-300 rounded p-2"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  className="px-3 py-1.5 border rounded"
                >
                  Abort
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-1.5 bg-rose-600 text-white rounded font-bold hover:bg-rose-700"
                >
                  Confirm Cancellation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
