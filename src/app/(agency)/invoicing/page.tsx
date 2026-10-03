'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  FileText,
  Plus,
  Layers,
  Lock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Download,
  Eye,
  Filter,
  RefreshCw,
  Building,
} from 'lucide-react';
import { calculateGst } from '@/modules/finance/gst-engine';

export default function InvoicingPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);

  // Form states
  const [clients, setClients] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [calcMode, setCalcMode] = useState<'FORWARD' | 'TOTAL_INCLUSIVE'>('FORWARD');
  const [isReverseCharge, setIsReverseCharge] = useState(false);
  const [notes, setNotes] = useState('');

  // Line items for manual invoice
  const [lineItems, setLineItems] = useState<
    Array<{ description: string; sac_code: string; amount: number; tax_rate: number }>
  >([
    { description: 'Insurance Claim Investigation Fee', sac_code: '998311', amount: 3500, tax_rate: 18 },
  ]);

  // Bulk eligible cases
  const [eligibleCases, setEligibleCases] = useState<any[]>([]);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [feePerCase, setFeePerCase] = useState(3500);

  const fetchInvoices = React.useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter === 'ALL' ? '/api/invoices' : `/api/invoices?status=${statusFilter}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setInvoices(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch invoices', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchClients = React.useCallback(async () => {
    try {
      const res = await fetch('/api/masters/clients');
      const json = await res.json();
      if (json.success) {
        setClients(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch clients', err);
    }
  }, []);

  const fetchBranches = async (clientId: string) => {
    if (!clientId) {
      setBranches([]);
      return;
    }
    try {
      const res = await fetch(`/api/masters/clients/${clientId}/branches`);
      const json = await res.json();
      if (json.success) {
        setBranches(json.data || []);
        if (json.data?.length > 0) {
          setSelectedBranchId(json.data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch branches', err);
    }
  };

  const fetchEligibleCases = async (clientId: string) => {
    if (!clientId) {
      setEligibleCases([]);
      return;
    }
    try {
      const res = await fetch(`/api/invoices/eligible-cases?client_id=${clientId}`);
      const json = await res.json();
      if (json.success) {
        setEligibleCases(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch eligible cases', err);
    }
  };

  useEffect(() => {
    fetchInvoices();
    fetchClients();
  }, [fetchInvoices, fetchClients]);

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    fetchBranches(clientId);
    fetchEligibleCases(clientId);
  };

  // Preview GST Calculation
  const selectedBranch = branches.find((b) => b.id === selectedBranchId);
  const gstPreview = selectedBranch
    ? calculateGst(
        lineItems.map((i) => ({
          description: i.description,
          sacCode: i.sac_code,
          amount: i.amount || 0,
          taxRate: i.tax_rate,
        })),
        {
          supplierStateCode: '23', // Agency state MP
          recipientStateCode: selectedBranch.state_code || '23',
          calculationMode: calcMode,
          isReverseCharge,
        }
      )
    : null;

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !selectedBranchId) {
      alert('Please select both Client and Branch');
      return;
    }

    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: selectedClientId,
          client_branch_id: selectedBranchId,
          calculation_mode: calcMode,
          is_reverse_charge: isReverseCharge,
          notes,
          items: lineItems,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setShowCreateModal(false);
        fetchInvoices();
      } else {
        alert(json.error || 'Failed to create invoice');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleBulkInvoiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !selectedBranchId || selectedCaseIds.length === 0) {
      alert('Please select client, branch, and at least one case.');
      return;
    }

    try {
      const res = await fetch('/api/invoices/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: selectedClientId,
          client_branch_id: selectedBranchId,
          case_ids: selectedCaseIds,
          fee_per_case: feePerCase,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setShowBulkModal(false);
        setSelectedCaseIds([]);
        fetchInvoices();
      } else {
        alert(json.error || 'Failed to generate bulk invoice');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Metrics summary
  const totalTaxable = invoices.reduce((sum, inv) => sum + Number(inv.taxable_amount || 0), 0);
  const totalTaxes = invoices.reduce((sum, inv) => sum + Number(inv.total_tax_amount || 0), 0);
  const totalGross = invoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <FileText className="h-6 w-6 text-amber-600" />
            <span>Tax Invoicing & GST Engine</span>
            <span className="text-xs font-semibold px-2 py-0.5 bg-amber-100 text-amber-800 rounded">
              CA-VERIFY
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Compliant Indian GST invoicing, Place-of-Supply determination, gapless FY numbering, and immutable R2 PDF archive.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowBulkModal(true)}
            className="px-3 py-1.5 bg-slate-800 text-white rounded text-xs font-semibold hover:bg-slate-700 transition flex items-center space-x-1.5"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Bulk Case Invoice</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-semibold hover:bg-amber-700 transition flex items-center space-x-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Tax Invoice</span>
          </button>
        </div>
      </div>

      {/* Financial Telemetry Banner - 3D KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="kpi-card-3d p-4">
          <div className="text-[11px] text-slate-500 font-extrabold uppercase tracking-wider">
            Total Invoices
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono-code">
            {invoices.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Dockets & bills in ledger
          </div>
        </div>
        <div className="kpi-card-3d p-4">
          <div className="text-[11px] text-slate-500 font-extrabold uppercase tracking-wider">
            Taxable Service Value
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono-code">
            ₹{totalTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Base investigation fees
          </div>
        </div>
        <div className="kpi-card-3d p-4">
          <div className="text-[11px] text-blue-600 font-extrabold uppercase tracking-wider">
            GST Output Tax
          </div>
          <div className="text-2xl font-black text-blue-600 mt-1 font-mono-code">
            ₹{totalTaxes.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-blue-500/80 mt-1">
            Statutory tax liability
          </div>
        </div>
        <div className="kpi-card-3d p-4">
          <div className="text-[11px] text-emerald-600 font-extrabold uppercase tracking-wider">
            Gross Billed Total
          </div>
          <div className="text-2xl font-black text-emerald-600 mt-1 font-mono-code">
            ₹{totalGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-emerald-500/80 mt-1">
            Total receivable from clients
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-200 pb-2">
        <Filter className="h-4 w-4 text-slate-400" />
        {['ALL', 'DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED'].map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1 rounded text-xs font-semibold transition ${
              statusFilter === st
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      {/* Invoices Ledger Table */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
            <tr>
              <th className="py-2.5 px-3">Invoice No</th>
              <th className="py-2.5 px-3">Date & FY</th>
              <th className="py-2.5 px-3">Client & Branch</th>
              <th className="py-2.5 px-3">Place of Supply</th>
              <th className="py-2.5 px-3 text-right">Taxable</th>
              <th className="py-2.5 px-3 text-right">Taxes</th>
              <th className="py-2.5 px-3 text-right">Grand Total</th>
              <th className="py-2.5 px-3 text-center">Status</th>
              <th className="py-2.5 px-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">
                  Loading invoices...
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">
                  No invoices found matching current filter.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50 transition">
                  <td className="py-2.5 px-3 font-mono font-bold text-slate-900 flex items-center space-x-1.5">
                    {inv.is_immutable && <Lock className="h-3 w-3 text-emerald-600" />}
                    <span>{inv.invoice_number}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <div>{inv.issue_date}</div>
                    <div className="text-[10px] text-slate-400 font-mono">FY {inv.financial_year}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-slate-800">{inv.clients?.name || 'Client'}</div>
                    <div className="text-[10px] text-slate-500">
                      {inv.client_branches?.branch_name} ({inv.client_branches?.state})
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        inv.is_intra_state
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-purple-50 text-purple-700 border border-purple-200'
                      }`}
                    >
                      {inv.is_intra_state ? 'INTRA (CGST+SGST)' : 'INTER (IGST)'}
                    </span>
                    <div className="text-[10px] text-slate-400 mt-0.5">Code {inv.place_of_supply_state_code}</div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold">
                    ₹{Number(inv.taxable_amount).toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                    ₹{Number(inv.total_tax_amount).toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                    ₹{Number(inv.total_amount).toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        inv.status === 'ISSUED'
                          ? 'bg-blue-100 text-blue-800'
                          : inv.status === 'PAID'
                          ? 'bg-emerald-100 text-emerald-800'
                          : inv.status === 'CANCELLED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <div className="flex items-center justify-center space-x-1.5">
                      <Link
                        href={`/invoicing/${inv.id}`}
                        className="p-1 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded"
                        title="View Invoice"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Generate Tax Invoice (CA-VERIFY)</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateDraft} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Insurance Client</label>
                  <select
                    value={selectedClientId}
                    onChange={(e) => handleClientChange(e.target.value)}
                    required
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                  >
                    <option value="">Select Insurance Client</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Client Branch (Recipient GSTIN)</label>
                  <select
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    required
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                  >
                    <option value="">Select Branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.branch_name} ({b.state} - {b.gstin})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Calculation Mode</label>
                  <select
                    value={calcMode}
                    onChange={(e) => setCalcMode(e.target.value as any)}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                  >
                    <option value="FORWARD">Standard FORWARD (Taxable + GST)</option>
                    <option value="TOTAL_INCLUSIVE">TOTAL_INCLUSIVE (Back-calculate from Gross)</option>
                  </select>
                </div>
                <div className="flex items-center space-x-2 pt-5">
                  <input
                    type="checkbox"
                    id="rcm"
                    checked={isReverseCharge}
                    onChange={(e) => setIsReverseCharge(e.target.checked)}
                    className="rounded text-amber-600"
                  />
                  <label htmlFor="rcm" className="text-slate-700 font-medium">
                    Reverse Charge Applicable (RCM)
                  </label>
                </div>
              </div>

              {/* Line Items */}
              <div className="border border-slate-200 rounded p-3 bg-slate-50 space-y-2">
                <div className="font-semibold text-slate-800">Line Items</div>
                {lineItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Description"
                      value={item.description}
                      onChange={(e) => {
                        const copy = [...lineItems];
                        copy[idx].description = e.target.value;
                        setLineItems(copy);
                      }}
                      className="col-span-6 border rounded px-2 py-1 bg-white"
                      required
                    />
                    <input
                      type="text"
                      placeholder="SAC"
                      value={item.sac_code}
                      onChange={(e) => {
                        const copy = [...lineItems];
                        copy[idx].sac_code = e.target.value;
                        setLineItems(copy);
                      }}
                      className="col-span-2 border rounded px-2 py-1 bg-white text-center font-mono"
                      required
                    />
                    <input
                      type="number"
                      placeholder="Amount"
                      value={item.amount}
                      onChange={(e) => {
                        const copy = [...lineItems];
                        copy[idx].amount = Number(e.target.value);
                        setLineItems(copy);
                      }}
                      className="col-span-2 border rounded px-2 py-1 bg-white text-right font-mono"
                      required
                    />
                    <div className="col-span-2 text-right font-mono font-semibold text-slate-700">
                      @ {item.tax_rate}%
                    </div>
                  </div>
                ))}
              </div>

              {/* Live GST Engine Preview */}
              {gstPreview && (
                <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-1">
                  <div className="font-bold text-amber-900 flex justify-between">
                    <span>Tax Engine Summary:</span>
                    <span>{gstPreview.isIntraState ? 'INTRA-STATE (CGST+SGST)' : 'INTER-STATE (IGST)'}</span>
                  </div>
                  <div className="flex justify-between text-slate-700">
                    <span>Taxable Base:</span>
                    <span className="font-mono">₹{gstPreview.taxableAmount}</span>
                  </div>
                  {gstPreview.isIntraState ? (
                    <>
                      <div className="flex justify-between text-slate-700">
                        <span>CGST (9%):</span>
                        <span className="font-mono">₹{gstPreview.cgstAmount}</span>
                      </div>
                      <div className="flex justify-between text-slate-700">
                        <span>SGST (9%):</span>
                        <span className="font-mono">₹{gstPreview.sgstAmount}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-slate-700">
                      <span>IGST (18%):</span>
                      <span className="font-mono">₹{gstPreview.igstAmount}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-slate-900 border-t border-amber-300 pt-1">
                    <span>Grand Total:</span>
                    <span className="font-mono">₹{gstPreview.totalAmount}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 italic mt-1">{gstPreview.amountInWords}</div>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-1.5 border border-slate-300 rounded text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-600 text-white rounded font-semibold hover:bg-amber-700 transition"
                >
                  Save Draft Invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Case Invoice Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Bulk Invoicing for Closed Cases</h2>
              <button
                onClick={() => setShowBulkModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleBulkInvoiceSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Insurance Client</label>
                  <select
                    value={selectedClientId}
                    onChange={(e) => handleClientChange(e.target.value)}
                    required
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                  >
                    <option value="">Select Insurance Client</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Client Branch</label>
                  <select
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    required
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                  >
                    <option value="">Select Branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.branch_name} ({b.state} - {b.gstin})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Fee Per Case (₹)</label>
                <input
                  type="number"
                  value={feePerCase}
                  onChange={(e) => setFeePerCase(Number(e.target.value))}
                  className="w-full border rounded px-2.5 py-1.5 font-mono"
                  required
                />
              </div>

              <div className="border border-slate-200 rounded p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-800">
                    Eligible Cases Ready for Billing ({eligibleCases.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedCaseIds(eligibleCases.map((c) => c.id))}
                    className="text-blue-600 hover:underline font-semibold"
                  >
                    Select All
                  </button>
                </div>

                {eligibleCases.length === 0 ? (
                  <div className="text-center py-4 text-slate-400">
                    No eligible closed/approved cases found for this client.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {eligibleCases.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center space-x-2 p-1.5 hover:bg-slate-100 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCaseIds.includes(c.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCaseIds([...selectedCaseIds, c.id]);
                            } else {
                              setSelectedCaseIds(selectedCaseIds.filter((id) => id !== c.id));
                            }
                          }}
                          className="rounded text-amber-600"
                        />
                        <span className="font-mono font-bold text-slate-800">{c.docket_no}</span>
                        <span className="text-slate-600">
                          Claim #{c.claim_no} ({c.insured_name})
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-1.5 border border-slate-300 rounded text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={selectedCaseIds.length === 0}
                  className="px-4 py-1.5 bg-slate-800 text-white rounded font-semibold hover:bg-slate-700 transition disabled:opacity-50"
                >
                  Generate Bulk Invoice ({selectedCaseIds.length} Cases)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
