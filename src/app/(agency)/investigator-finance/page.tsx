'use client';

import React, { useState, useEffect } from 'react';
import { 
  Wallet, 
  FileSpreadsheet, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle, 
  ShieldAlert, 
  Download, 
  PlusCircle, 
  TrendingUp, 
  Award,
  Building,
  RefreshCw
} from 'lucide-react';

export default function InvestigatorFinancePage() {
  const [activeTab, setActiveTab] = useState<'batches' | 'expenses' | 'scorecards' | 'hospitals'>('batches');
  const [batches, setBatches] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [scorecards, setScorecards] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [isCompileModalOpen, setIsCompileModalOpen] = useState(false);
  const [compileMonth, setCompileMonth] = useState(new Date().toISOString().slice(0, 7));
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [utrReference, setUtrReference] = useState('');
  const [rejectionModal, setRejectionModal] = useState<{ open: boolean; expenseId: string | null; reason: string }>({
    open: false,
    expenseId: null,
    reason: '',
  });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [expRes, scoreRes] = await Promise.all([
        fetch('/api/investigators/expenses'),
        fetch('/api/investigators/scorecard'),
      ]);
      const expData = await expRes.json();
      const scoreData = await scoreRes.json();
      setExpenses(expData.expenses || []);
      setScorecards(scoreData.scorecards || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApproveExpense = async (id: string) => {
    try {
      const res = await fetch(`/api/investigators/expenses/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_notes: 'Approved via Quick Action Queue' }),
      });
      if (res.ok) {
        await loadData();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to approve');
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleRejectExpense = async () => {
    if (!rejectionModal.expenseId || !rejectionModal.reason.trim()) {
      alert('Rejection reason is required');
      return;
    }
    try {
      const res = await fetch(`/api/investigators/expenses/${rejectionModal.expenseId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejection_reason: rejectionModal.reason }),
      });
      if (res.ok) {
        setRejectionModal({ open: false, expenseId: null, reason: '' });
        await loadData();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to reject');
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleCompilePayout = async () => {
    try {
      const res = await fetch('/api/investigators/payouts/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payout_month: compileMonth }),
      });
      const data = await res.json();
      if (res.ok) {
        setIsCompileModalOpen(false);
        alert(`Successfully compiled payout batch ${data.batch?.batch_number}! Total net: ₹${data.batch?.total_net_disbursable}`);
        await loadData();
      } else {
        alert(data.error || 'Failed to compile');
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleMarkBatchPaid = async () => {
    if (!selectedBatchId || !utrReference.trim()) {
      alert('Payment UTR / Reference is required');
      return;
    }
    try {
      const res = await fetch(`/api/investigators/payouts/${selectedBatchId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_reference: utrReference }),
      });
      const data = await res.json();
      if (res.ok) {
        setIsPayModalOpen(false);
        setUtrReference('');
        alert('Payout batch successfully settled and marked as PAID!');
        await loadData();
      } else {
        alert(data.error || 'Failed to mark paid');
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-indigo-600" />
            Investigator Finance, Disbursals & Scorecards
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Per-case & salary terms, expense/TA workflows, Excel bulk payments, SLA tracking and fraud heatmaps.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCompileModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm transition"
          >
            <PlusCircle className="w-4 h-4" />
            Compile Monthly Payout
          </button>
          <button
            onClick={loadData}
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pending Expense Claims</div>
          <div className="text-2xl font-bold font-mono text-amber-600 mt-1">
            {expenses.filter(e => e.status === 'SUBMITTED' || e.status === 'REVIEW').length}
          </div>
          <div className="text-xs text-slate-500 mt-1">Awaiting admin review & approval</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Approved Expenses Ready</div>
          <div className="text-2xl font-bold font-mono text-emerald-600 mt-1">
            ₹{expenses.filter(e => e.status === 'APPROVED').reduce((acc, curr) => acc + Number(curr.amount), 0).toFixed(2)}
          </div>
          <div className="text-xs text-slate-500 mt-1">Ready for monthly payout batch</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Roster Investigators</div>
          <div className="text-2xl font-bold font-mono text-indigo-600 mt-1">
            {scorecards.length}
          </div>
          <div className="text-xs text-slate-500 mt-1">Active field investigators</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Average Roster SLA</div>
          <div className="text-2xl font-bold font-mono text-blue-600 mt-1">
            92.4%
          </div>
          <div className="text-xs text-slate-500 mt-1">Target turnaround compliance</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="flex space-x-6">
          <button
            onClick={() => setActiveTab('batches')}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition ${
              activeTab === 'batches'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Monthly Payout Batches & Excel
          </button>
          <button
            onClick={() => setActiveTab('expenses')}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition ${
              activeTab === 'expenses'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Expense & TA Approval Queue ({expenses.filter(e => e.status === 'SUBMITTED').length})
          </button>
          <button
            onClick={() => setActiveTab('scorecards')}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition ${
              activeTab === 'scorecards'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Investigator Scorecards & Tiers
          </button>
          <button
            onClick={() => setActiveTab('hospitals')}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition ${
              activeTab === 'hospitals'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Hospital Fraud Heatmap & Warnings
          </button>
        </nav>
      </div>

      {/* Tab 1: Payout Batches */}
      {activeTab === 'batches' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-indigo-500" />
              Corporate Bank Disbursal Batches (.xlsx)
            </h2>
            <span className="text-xs text-slate-500">
              One open batch per month; supplements via adjustments. Paid batches permanently immutable.
            </span>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm text-slate-600 dark:text-slate-400 flex items-center justify-between">
            <div>
              <strong>Current Period:</strong> {compileMonth} | 
              <span className="ml-2 font-mono">Status: READY FOR COMPILE</span>
            </div>
            <button
              onClick={() => setIsCompileModalOpen(true)}
              className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded font-medium hover:bg-indigo-700"
            >
              Run Batch Disbursal Generator
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: Expenses Approval Queue */}
      {activeTab === 'expenses' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Travel Allowance (TA) & Operational Expense Claims
            </h2>
            <span className="text-xs text-slate-500">
              One-click admin verification queue. Receipts verified via Private R2.
            </span>
          </div>

          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <tr>
                <th className="p-3">Investigator</th>
                <th className="p-3">Case</th>
                <th className="p-3">Type</th>
                <th className="p-3">Amount (₹)</th>
                <th className="p-3">Receipt</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500">
                    No expense claims recorded yet.
                  </td>
                </tr>
              ) : (
                expenses.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                    <td className="p-3 font-medium text-slate-900 dark:text-slate-100">
                      {e.investigator?.full_name || 'Investigator'}
                    </td>
                    <td className="p-3 font-mono text-xs text-slate-500">
                      {e.case?.case_number || 'General Field Expense'}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {e.expense_type}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                      ₹{Number(e.amount).toFixed(2)}
                    </td>
                    <td className="p-3 text-xs">
                      {e.receipt_r2_key ? (
                        <span className="text-emerald-600 font-medium">✓ Uploaded</span>
                      ) : e.requires_receipt ? (
                        <span className="text-red-500 font-medium">Required</span>
                      ) : (
                        <span className="text-slate-400">N/A</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        e.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                        e.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        e.status === 'PAID' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {e.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {e.status === 'SUBMITTED' && (
                        <div className="inline-flex gap-2">
                          <button
                            onClick={() => handleApproveExpense(e.id)}
                            className="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setRejectionModal({ open: true, expenseId: e.id, reason: '' })}
                            className="px-2.5 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: Investigator Scorecards */}
      {activeTab === 'scorecards' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-500" />
              Investigator Scorecard & Performance Tiers
            </h2>
            <span className="text-xs text-slate-500">
              Weights: TAT (35%), Fraud Detection (25%), Quality/Rework (25%), Volume (15%)
            </span>
          </div>

          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <tr>
                <th className="p-3">Investigator</th>
                <th className="p-3">Scorecard Tier</th>
                <th className="p-3 font-mono">TAT Score</th>
                <th className="p-3 font-mono">Fraud Rigor</th>
                <th className="p-3 font-mono">Quality / Rework</th>
                <th className="p-3 font-mono">Composite Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {scorecards.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No active investigators found.
                  </td>
                </tr>
              ) : (
                scorecards.map((s, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                    <td className="p-3 font-medium text-slate-900 dark:text-slate-100">
                      {s.investigator.full_name} ({s.investigator.code})
                    </td>
                    <td className="p-3">
                      <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                        s.scorecard.tier === 'ELITE' ? 'bg-purple-100 text-purple-700 border border-purple-300' :
                        s.scorecard.tier === 'PROFICIENT' ? 'bg-emerald-100 text-emerald-700' :
                        s.scorecard.tier === 'AVERAGE' ? 'bg-blue-100 text-blue-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {s.scorecard.tier}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-slate-700 dark:text-slate-300">
                      {s.scorecard.tat_score}/100
                    </td>
                    <td className="p-3 font-mono text-slate-700 dark:text-slate-300">
                      {s.scorecard.fraud_score}/100
                    </td>
                    <td className="p-3 font-mono text-slate-700 dark:text-slate-300">
                      {s.scorecard.quality_score}/100
                    </td>
                    <td className="p-3 font-mono font-bold text-base text-indigo-600">
                      {s.scorecard.composite_score}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 4: Hospital Fraud Heatmap */}
      {activeTab === 'hospitals' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-600" />
              Hospital Fraud Heatmap & Dispatch-Time Warnings
            </h2>
            <span className="text-xs text-slate-500">
              Thresholds: Critical (&gt;=40%), High (&gt;=25%), Medium (&gt;=10%)
            </span>
          </div>

          <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-red-800 dark:text-red-200">
                Automated Dispatch Warning Active
              </div>
              <div className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                When investigators are dispatched to hospitals marked HIGH or CRITICAL risk, Vericlaim automatically issues an alert banner requiring treating doctor verification, IPD indoor register photography, and manager override for blacklisted institutions.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compile Payout Modal */}
      {isCompileModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Compile Monthly Investigator Payout
            </h3>
            <p className="text-xs text-slate-500">
              Aggregates base fees, effective-dated salary retainers, approved TA/expenses, deducts TDS (Section 194J/194C/206AA) and advances.
            </p>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Payout Month (YYYY-MM)
              </label>
              <input
                type="month"
                value={compileMonth}
                onChange={e => setCompileMonth(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsCompileModalOpen(false)}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCompilePayout}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"
              >
                Compile & Finalize Batch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectionModal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Reject Expense Claim
            </h3>
            <p className="text-xs text-slate-500">
              State the reason for rejecting this travel allowance or operational expense claim.
            </p>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Rejection Reason *
              </label>
              <textarea
                value={rejectionModal.reason}
                onChange={e => setRejectionModal({ ...rejectionModal, reason: e.target.value })}
                placeholder="e.g. Missing valid fuel receipt or travel outside assigned jurisdiction"
                rows={3}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRejectionModal({ open: false, expenseId: null, reason: '' })}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectExpense}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
