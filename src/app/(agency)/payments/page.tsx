'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  FileCheck2,
  AlertCircle,
  Building2,
  Calendar,
  DollarSign,
  Download,
  Filter,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  TrendingUp,
  FileSpreadsheet,
  ShieldCheck,
  Split,
  Percent,
} from 'lucide-react';

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<'REMITTANCES' | 'TDS_26AS' | 'AGING_LEDGER' | 'RECOVERY_HUB' | 'PROFIT_PNL'>('REMITTANCES');
  const [loading, setLoading] = useState(true);

  // Data states
  const [payments, setPayments] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [tdsRecords, setTdsRecords] = useState<any[]>([]);
  const [agingSummary, setAgingSummary] = useState<any>(null);
  const [recoveryItems, setRecoveryItems] = useState<any[]>([]);
  const [profitReport, setProfitReport] = useState<any>(null);
  const [clients, setClients] = useState<any[]>([]);

  // Modals
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [showTdsModal, setShowTdsModal] = useState(false);
  const [show26asModal, setShow26asModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);

  // Form states
  const [clientId, setClientId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('NEFT');
  const [utrNumber, setUtrNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [isAdvance, setIsAdvance] = useState(false);
  const [referenceNote, setReferenceNote] = useState('');

  // Allocation form
  const [targetInvoiceId, setTargetInvoiceId] = useState('');
  const [allocationAmount, setAllocationAmount] = useState('');

  // TDS form
  const [tdsInvoiceId, setTdsInvoiceId] = useState('');
  const [tdsSection, setTdsSection] = useState('194J');
  const [tdsRate, setTdsRate] = useState('10.00');
  const [tdsAmount, setTdsAmount] = useState('');
  const [certNumber, setCertNumber] = useState('');

  // 26AS form
  const [fy26as, setFy26as] = useState('2026-27');
  const [tan26as, setTan26as] = useState('');
  const [deductorName26as, setDeductorName26as] = useState('');
  const [amountPaid26as, setAmountPaid26as] = useState('');
  const [tdsDeducted26as, setTdsDeducted26as] = useState('');

  // Short settlement suggestion prompt
  const [shortSettlementAlert, setShortSettlementAlert] = useState<any>(null);
  const [legacyProfitView, setLegacyProfitView] = useState(false);

  // Fetch initial data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch payments
      const payRes = await fetch('/api/payments');
      const payJson = await payRes.json();
      if (payJson.success) setPayments(payJson.data || []);

      // 2. Fetch invoices
      const invRes = await fetch('/api/invoices');
      const invJson = await invRes.json();
      if (invJson.success) setInvoices(invJson.data || []);

      // 3. Fetch TDS records
      const tdsRes = await fetch('/api/payments/tds');
      const tdsJson = await tdsRes.json();
      if (tdsJson.success) setTdsRecords(tdsJson.data || []);

      // 4. Fetch Aging
      const agingRes = await fetch('/api/payments/aging');
      const agingJson = await agingRes.json();
      if (agingJson.success) setAgingSummary(agingJson.data);

      // 5. Fetch Recovery
      const recRes = await fetch('/api/payments/recovery');
      const recJson = await recRes.json();
      if (recJson.success) setRecoveryItems(recJson.data || []);

      // 6. Fetch Profit
      const profRes = await fetch('/api/payments/profit?include_legacy=true');
      const profJson = await profRes.json();
      if (profJson.success) setProfitReport(profJson.data);

      // 7. Fetch Clients
      const cliRes = await fetch('/api/masters/clients');
      const cliJson = await cliRes.json();
      if (cliJson.success) setClients(cliJson.data || []);
    } catch (err) {
      console.error('Failed to load payments data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handlers
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || !paymentAmount) {
      alert('Please select a client and enter amount');
      return;
    }

    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          amount: paymentAmount,
          payment_mode: paymentMode,
          utr_number: utrNumber || null,
          bank_name: bankName || null,
          is_advance: isAdvance,
          reference_note: referenceNote || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to record payment');

      alert('Remittance recorded successfully!');
      setShowPaymentModal(false);
      setPaymentAmount('');
      setUtrNumber('');
      setBankName('');
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleAllocatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPayment || !targetInvoiceId || !allocationAmount) {
      alert('Please fill all allocation details');
      return;
    }

    try {
      // Check for short settlement first
      const shortCheckRes = await fetch(
        `/api/payments/short-settlement?invoice_id=${targetInvoiceId}&received_amount=${allocationAmount}`
      );
      const shortJson = await shortCheckRes.json();

      if (shortJson.success && shortJson.suggestion?.isShortSettlement) {
        setShortSettlementAlert({
          ...shortJson.suggestion,
          invoiceId: targetInvoiceId,
          paymentId: selectedPayment.id,
          allocatedAmount: allocationAmount,
        });
      }

      const res = await fetch('/api/payments/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_id: selectedPayment.id,
          invoice_id: targetInvoiceId,
          allocated_amount: allocationAmount,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Allocation failed');

      if (!shortJson.suggestion?.isShortSettlement) {
        alert('Allocation applied successfully!');
        setShowAllocateModal(false);
      }
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleConfirmShortSettlementTds = async () => {
    if (!shortSettlementAlert) return;
    try {
      const res = await fetch('/api/payments/tds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: selectedPayment?.client_id || clientId,
          invoice_id: shortSettlementAlert.invoiceId,
          payment_id: shortSettlementAlert.paymentId,
          section: shortSettlementAlert.suggestedSection,
          rate: shortSettlementAlert.suggestedRate,
          amount: shortSettlementAlert.suggestedTdsAmount,
          is_valid: true,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to record TDS');

      alert('TDS Receivable recorded and matched with remittance!');
      setShortSettlementAlert(null);
      setShowAllocateModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRecordManualTds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tdsInvoiceId || !tdsAmount) {
      alert('Please select an invoice and enter TDS amount');
      return;
    }

    try {
      const inv = invoices.find((i) => i.id === tdsInvoiceId);
      const res = await fetch('/api/payments/tds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: inv?.client_id || clientId,
          invoice_id: tdsInvoiceId,
          section: tdsSection,
          rate: tdsRate,
          amount: tdsAmount,
          is_valid: true,
          certificate_number: certNumber || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to record TDS');

      alert('TDS record created successfully!');
      setShowTdsModal(false);
      setTdsAmount('');
      setCertNumber('');
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleImport26as = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tan26as || !tdsDeducted26as) {
      alert('Please enter Deductor TAN and TDS Deducted');
      return;
    }

    try {
      const res = await fetch('/api/payments/26as/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          financial_year: fy26as,
          deductor_tan: tan26as.toUpperCase(),
          deductor_name: deductorName26as || null,
          records: [
            {
              section: '194J',
              amount_paid: amountPaid26as || '0.00',
              tds_deducted: tdsDeducted26as,
            },
          ],
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '26AS Import failed');

      alert(
        `26AS Reconciliation complete: ${json.data.matchedCount} matched, ${json.data.unmatchedCount} unmatched.`
      );
      setShow26asModal(false);
      setTan26as('');
      setTdsDeducted26as('');
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Export recovery items to CSV
  const handleExportRecoveryCsv = () => {
    if (recoveryItems.length === 0) {
      alert('No recovery items to export');
      return;
    }

    const headers = ['Category', 'Client', 'Branch', 'Doc/Case #', 'Days Pending', 'Amount (INR)', 'Status'];
    const rows = recoveryItems.map((r) => [
      r.category,
      `"${r.clientName}"`,
      `"${r.branchName || ''}"`,
      r.invoiceNumber || r.caseNumber || '',
      r.daysPending,
      r.amount,
      r.status,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Vericlaim_Recovery_Sheet_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Compute KPI totals
  const totalReceived = payments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const totalUnapplied = payments.reduce((acc, p) => acc + Number(p.unapplied_amount || 0), 0);
  const totalTdsWithheld = tdsRecords
    .filter((t) => t.is_valid)
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);
  const totalOutstanding = agingSummary?.totalOutstanding || '0.00';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <CreditCard className="w-6 h-6 text-emerald-500" />
              Payments, TDS & Recovery Hub
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              PHASE 7B
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              CA-VERIFY
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Bank remittances, Section 194J/194C TDS, 26AS reconciliation, aging ledgers & statutory gross margin.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShow26asModal(true)}
            className="px-3.5 py-2 rounded-xl text-sm font-medium border border-border/60 bg-background/50 hover:bg-muted transition-colors flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4 text-cyan-400" />
            Import 26AS / AIS
          </button>
          <button
            onClick={() => setShowPaymentModal(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-500 hover:to-teal-500 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Record Remittance
          </button>
        </div>
      </div>

      {/* 4 Luxury 3D Glass KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Outstanding */}
        <div className="glass-kpi-3d p-5 rounded-2xl relative overflow-hidden group">
          <div className="ambient-glow-emerald" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Outstanding
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
              ₹{Number(totalOutstanding).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Formula: Billed - Received - Valid TDS
            </p>
          </div>
        </div>

        {/* Card 2: Valid TDS Withheld */}
        <div className="glass-kpi-3d p-5 rounded-2xl relative overflow-hidden group">
          <div className="ambient-glow-blue" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              TDS Withheld (194J/C)
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
              ₹{totalTdsWithheld.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              {tdsRecords.filter((t) => t.is_valid).length} valid TDS credits from insurers
            </p>
          </div>
        </div>

        {/* Card 3: Unapplied Advance Remittances */}
        <div className="glass-kpi-3d p-5 rounded-2xl relative overflow-hidden group">
          <div className="ambient-glow-amber" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Unapplied Advances
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
              ₹{totalUnapplied.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              Available to allocate to upcoming invoices
            </p>
          </div>
        </div>

        {/* Card 4: Statutory Profit & Gross Margin */}
        <div className="glass-kpi-3d p-5 rounded-2xl relative overflow-hidden group">
          <div className="ambient-glow-purple" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Statutory Gross Profit
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-mono tracking-tight text-emerald-400">
              ₹{profitReport ? Number(profitReport.grossProfit).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
            </span>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
              Margin: {profitReport?.grossMarginPercentage || '0.00%'} (Excludes GST)
            </p>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-border/50 pb-2">
        <button
          onClick={() => setActiveTab('REMITTANCES')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'REMITTANCES'
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Remittances & Allocations
        </button>
        <button
          onClick={() => setActiveTab('TDS_26AS')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'TDS_26AS'
              ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          TDS Register & 26AS Matcher
        </button>
        <button
          onClick={() => setActiveTab('AGING_LEDGER')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'AGING_LEDGER'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Aging & Client Ledger
        </button>
        <button
          onClick={() => setActiveTab('RECOVERY_HUB')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'RECOVERY_HUB'
              ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Recovery Hub ({recoveryItems.length})
        </button>
        <button
          onClick={() => setActiveTab('PROFIT_PNL')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'PROFIT_PNL'
              ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          P&L & Statutory Profit (Q-CA-01)
        </button>
      </div>

      {/* TAB 1: REMITTANCES & ALLOCATIONS */}
      {activeTab === 'REMITTANCES' && (
        <div className="glass-card-subtle p-6 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-400" />
              Recorded Remittances & Bank Transfers
            </h3>
            <span className="text-xs text-muted-foreground">
              Showing {payments.length} remittance records
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Mode / UTR</th>
                  <th className="py-3 px-4">Bank</th>
                  <th className="py-3 px-4 text-right">Total Remittance</th>
                  <th className="py-3 px-4 text-right">Unapplied Balance</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      No payments recorded yet. Click &quot;Record Remittance&quot; to begin.
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3.5 px-4 font-mono text-xs">{p.payment_date}</td>
                      <td className="py-3.5 px-4 font-medium">{p.clients?.name || 'Client'}</td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-muted text-foreground border border-border/50">
                          {p.payment_mode}
                        </span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {p.utr_number || 'N/A'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">{p.bank_name || 'N/A'}</td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-emerald-400">
                        ₹{Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-medium">
                        {Number(p.unapplied_amount) > 0 ? (
                          <span className="text-amber-400">
                            ₹{Number(p.unapplied_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">₹0.00</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {Number(p.unapplied_amount) > 0 ? (
                          <button
                            onClick={() => {
                              setSelectedPayment(p);
                              setAllocationAmount(p.unapplied_amount);
                              setShowAllocateModal(true);
                            }}
                            className="px-3 py-1 rounded-lg text-xs font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                          >
                            Allocate
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            Fully Applied
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: TDS REGISTER & 26AS MATCHER */}
      {activeTab === 'TDS_26AS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Percent className="w-4 h-4 text-blue-400" />
              Client TDS Receivable Register (Section 194J & 194C)
            </h3>
            <button
              onClick={() => setShowTdsModal(true)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Add TDS Deduction
            </button>
          </div>

          <div className="glass-card-subtle p-6 rounded-2xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Section</th>
                  <th className="py-3 px-4">Rate</th>
                  <th className="py-3 px-4 text-right">TDS Withheld</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">26AS Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {tdsRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      No TDS records registered yet.
                    </td>
                  </tr>
                ) : (
                  tdsRecords.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3.5 px-4 font-mono text-xs">{t.invoices?.invoice_number || 'N/A'}</td>
                      <td className="py-3.5 px-4 font-medium">{t.clients?.name || 'Client'}</td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          {t.section}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs">{t.rate}%</td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-blue-400">
                        ₹{Number(t.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {t.is_valid ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-300">
                            Valid
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-rose-500/20 text-rose-300">
                            Disputed
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            t.form_26as_status === 'MATCHED'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {t.form_26as_status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: AGING ANALYSIS & CLIENT LEDGER */}
      {activeTab === 'AGING_LEDGER' && (
        <div className="space-y-6">
          {/* Aging Buckets Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="glass-card-subtle p-5 rounded-2xl border-l-4 border-l-emerald-500">
              <span className="text-xs uppercase font-semibold text-muted-foreground">0 - 30 Days (Current)</span>
              <p className="text-xl font-bold font-mono text-foreground mt-2">
                ₹{Number(agingSummary?.buckets?.b0_30?.totalOutstanding || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {agingSummary?.buckets?.b0_30?.invoiceCount || 0} invoices
              </p>
            </div>

            <div className="glass-card-subtle p-5 rounded-2xl border-l-4 border-l-blue-500">
              <span className="text-xs uppercase font-semibold text-muted-foreground">31 - 60 Days</span>
              <p className="text-xl font-bold font-mono text-foreground mt-2">
                ₹{Number(agingSummary?.buckets?.b31_60?.totalOutstanding || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {agingSummary?.buckets?.b31_60?.invoiceCount || 0} invoices
              </p>
            </div>

            <div className="glass-card-subtle p-5 rounded-2xl border-l-4 border-l-amber-500">
              <span className="text-xs uppercase font-semibold text-muted-foreground">61 - 90 Days</span>
              <p className="text-xl font-bold font-mono text-foreground mt-2">
                ₹{Number(agingSummary?.buckets?.b61_90?.totalOutstanding || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {agingSummary?.buckets?.b61_90?.invoiceCount || 0} invoices
              </p>
            </div>

            <div className="glass-card-subtle p-5 rounded-2xl border-l-4 border-l-rose-500">
              <span className="text-xs uppercase font-semibold text-muted-foreground">90+ Days (Overdue)</span>
              <p className="text-xl font-bold font-mono text-rose-400 mt-2">
                ₹{Number(agingSummary?.buckets?.b90_plus?.totalOutstanding || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {agingSummary?.buckets?.b90_plus?.invoiceCount || 0} invoices requiring recovery
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: RECOVERY HUB */}
      {activeTab === 'RECOVERY_HUB' && (
        <div className="glass-card-subtle p-6 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400" />
                Recovery Hub: Company-wise Pending Receivables
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Billed unpaid invoices, unbilled approved cases, and short-settlement recovery follow-ups.
              </p>
            </div>
            <button
              onClick={handleExportRecoveryCsv}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors flex items-center gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              Export Recovery Sheet (Excel/CSV)
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Doc / Case #</th>
                  <th className="py-3 px-4 text-center">Days Pending</th>
                  <th className="py-3 px-4 text-right">Amount (₹)</th>
                  <th className="py-3 px-4">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {recoveryItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground">
                      No overdue or pending recovery items detected. All accounts current!
                    </td>
                  </tr>
                ) : (
                  recoveryItems.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            item.category === 'billable_unpaid'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : item.category === 'unbilled_approved'
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {item.category.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium">{item.clientName}</td>
                      <td className="py-3 px-4 font-mono text-xs">
                        {item.invoiceNumber || item.caseNumber || 'N/A'}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-xs">
                        <span
                          className={
                            item.daysPending > 60
                              ? 'text-rose-400 font-bold'
                              : item.daysPending > 30
                              ? 'text-amber-400'
                              : 'text-muted-foreground'
                          }
                        >
                          {item.daysPending}d
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                        ₹{Number(item.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">{item.remarks}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: STATUTORY P&L & PROFIT (Q-CA-01) */}
      {activeTab === 'PROFIT_PNL' && (
        <div className="glass-card-subtle p-6 rounded-2xl space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                Statutory Agency Profit & Loss Statement (Q-CA-01)
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Indian Accounting Standard: Revenue strictly excludes GST collected. GST is a government liability, never income.
              </p>
            </div>
            <button
              onClick={() => setLegacyProfitView(!legacyProfitView)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              {legacyProfitView ? 'Hide Legacy Comparison' : 'Compare Legacy Formula'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Statutory Breakdown */}
            <div className="space-y-4 p-5 rounded-xl bg-background/40 border border-border/40">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Statutory Profit & Loss (Indian Accounting Standard)
              </h4>

              <div className="flex justify-between items-center py-2 border-b border-border/20 text-sm">
                <span className="text-muted-foreground">Gross Invoiced Total (Billed to Clients)</span>
                <span className="font-mono font-semibold">
                  ₹{profitReport ? (Number(profitReport.netServiceRevenue) + Number(profitReport.gstCollectedLiability)).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-border/20 text-sm">
                <span className="text-amber-400 font-medium">Less: GST Output Tax Liability (CGST + SGST + IGST)</span>
                <span className="font-mono text-amber-400">
                  - ₹{profitReport ? Number(profitReport.gstCollectedLiability).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-border/20 text-sm font-semibold">
                <span className="text-foreground">Net Service Revenue (P&L Revenue)</span>
                <span className="font-mono text-emerald-400">
                  ₹{profitReport ? Number(profitReport.netServiceRevenue).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-border/20 text-sm">
                <span className="text-rose-400 font-medium">Less: Direct Investigation Costs (Investigator Fees & TA)</span>
                <span className="font-mono text-rose-400">
                  - ₹{profitReport ? Number(profitReport.directInvestigationCosts).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                </span>
              </div>

              <div className="flex justify-between items-center py-3 bg-emerald-500/10 rounded-xl px-4 text-base font-bold">
                <span className="text-emerald-400">Statutory Gross Margin</span>
                <span className="font-mono text-emerald-400">
                  ₹{profitReport ? Number(profitReport.grossProfit).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'} ({profitReport?.grossMarginPercentage})
                </span>
              </div>
            </div>

            {/* Right: Balance Sheet & Legacy Comparison */}
            <div className="space-y-4 p-5 rounded-xl bg-background/40 border border-border/40">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Balance Sheet & Compliance Disclosures
              </h4>

              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 space-y-1">
                <p className="font-semibold">Statutory GST Safeguard (Rule A6):</p>
                <p>
                  GST collected (₹{profitReport?.gstCollectedLiability || '0.00'}) is tracked as a statutory liability to the Government of India in GSTR-1 and GSTR-3B, strictly outside operating income.
                </p>
              </div>

              {legacyProfitView && profitReport?.legacyProfitComparison && (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 space-y-2 text-xs">
                  <span className="font-semibold text-rose-400">Legacy Flawed Formula Comparison:</span>
                  <p className="font-mono text-sm text-foreground">
                    Formula: (Received + TDS) - Total Payable = ₹{profitReport.legacyProfitComparison.legacyProfitAmount}
                  </p>
                  <p className="text-rose-300">
                    {profitReport.legacyProfitComparison.warning}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: RECORD REMITTANCE */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-background border border-border/80 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-foreground">Record Client Remittance / Advance</h3>
            <form onSubmit={handleRecordPayment} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Client Insurance Company</label>
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm"
                  required
                >
                  <option value="">Select client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Amount (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="11800.00"
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Payment Mode</label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm"
                  >
                    <option value="NEFT">NEFT</option>
                    <option value="RTGS">RTGS</option>
                    <option value="IMPS">IMPS</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="UPI">UPI</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Bank UTR / Transaction Reference</label>
                <input
                  type="text"
                  value={utrNumber}
                  onChange={(e) => setUtrNumber(e.target.value)}
                  placeholder="e.g. HDFCN12345678"
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Bank Name</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. HDFC Bank, Fort Branch"
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="advance_toggle"
                  checked={isAdvance}
                  onChange={(e) => setIsAdvance(e.target.checked)}
                  className="rounded border-border"
                />
                <label htmlFor="advance_toggle" className="text-xs font-medium text-muted-foreground cursor-pointer">
                  Mark as Unapplied Advance (held for future billing)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  className="px-4 py-2 rounded-xl text-sm border border-border/60 hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  Save Remittance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ALLOCATE PAYMENT */}
      {showAllocateModal && selectedPayment && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-background border border-border/80 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-foreground">Allocate Remittance to Invoice</h3>
            <p className="text-xs text-muted-foreground">
              Unapplied Balance: ₹{Number(selectedPayment.unapplied_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>

            <form onSubmit={handleAllocatePayment} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Select Outstanding Invoice</label>
                <select
                  value={targetInvoiceId}
                  onChange={(e) => {
                    setTargetInvoiceId(e.target.value);
                    const inv = invoices.find((i) => i.id === e.target.value);
                    if (inv) {
                      setAllocationAmount(
                        Math.min(Number(selectedPayment.unapplied_amount), Number(inv.total_amount)).toFixed(2)
                      );
                    }
                  }}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm"
                  required
                >
                  <option value="">Select invoice...</option>
                  {invoices
                    .filter((i) => i.status !== 'PAID' && i.status !== 'CANCELLED')
                    .map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} - Total ₹{inv.total_amount} ({inv.status})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Allocation Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={allocationAmount}
                  onChange={(e) => setAllocationAmount(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm font-mono"
                  required
                />
              </div>

              {shortSettlementAlert && (
                <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-xs space-y-2">
                  <p className="font-semibold text-amber-300">Short-settlement TDS Detected (10%):</p>
                  <p className="text-muted-foreground">{shortSettlementAlert.rationale}</p>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleConfirmShortSettlementTds}
                      className="px-3 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-semibold hover:bg-amber-500/30"
                    >
                      Confirm ₹{shortSettlementAlert.suggestedTdsAmount} TDS
                    </button>
                    <button
                      type="button"
                      onClick={() => setShortSettlementAlert(null)}
                      className="px-3 py-1 rounded-lg text-muted-foreground hover:bg-muted"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAllocateModal(false)}
                  className="px-4 py-2 rounded-xl text-sm border border-border/60 hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  Confirm Allocation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: IMPORT 26AS */}
      {show26asModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-background border border-border/80 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-foreground">Import Form 26AS / AIS Record</h3>
            <form onSubmit={handleImport26as} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Financial Year</label>
                  <input
                    type="text"
                    value={fy26as}
                    onChange={(e) => setFy26as(e.target.value)}
                    placeholder="2026-27"
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Deductor TAN</label>
                  <input
                    type="text"
                    value={tan26as}
                    onChange={(e) => setTan26as(e.target.value)}
                    placeholder="MUMB12345A"
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm font-mono uppercase"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Deductor Name (Insurer)</label>
                <input
                  type="text"
                  value={deductorName26as}
                  onChange={(e) => setDeductorName26as(e.target.value)}
                  placeholder="ICICI Lombard General Insurance Co"
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Gross Paid (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={amountPaid26as}
                    onChange={(e) => setAmountPaid26as(e.target.value)}
                    placeholder="10000.00"
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">TDS Deducted (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={tdsDeducted26as}
                    onChange={(e) => setTdsDeducted26as(e.target.value)}
                    placeholder="1000.00"
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm font-mono"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShow26asModal(false)}
                  className="px-4 py-2 rounded-xl text-sm border border-border/60 hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 text-white"
                >
                  Reconcile Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
