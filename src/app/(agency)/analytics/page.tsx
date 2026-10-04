'use client';

import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Download,
  Calendar,
  Building,
  TrendingUp,
  FileSpreadsheet,
  FileText,
  FileDown,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  CreditCard,
  Truck,
  Package,
  Layers,
  Search,
  RefreshCw,
  Users,
  MapPin,
} from 'lucide-react';
import { OperationalMetrics, FinancialMetrics, PhysicalLogisticsMetrics, ExportLogRecord } from '@/modules/reports/analytics-types';

export default function AnalyticsDashboardPage() {
  const [activeTab, setActiveTab] = useState<'operations' | 'financial' | 'logistics' | 'exports'>('operations');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Metrics states
  const [opsMetrics, setOpsMetrics] = useState<OperationalMetrics | null>(null);
  const [finMetrics, setFinMetrics] = useState<FinancialMetrics | null>(null);
  const [logMetrics, setLogMetrics] = useState<PhysicalLogisticsMetrics | null>(null);
  const [exportLogs, setExportLogs] = useState<ExportLogRecord[]>([]);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.set('start_date', startDate);
      if (endDate) queryParams.set('end_date', endDate);

      const [opsRes, finRes, logRes, logsRes] = await Promise.all([
        fetch(`/api/reports/operations?${queryParams.toString()}`).then((r) => r.json()),
        fetch(`/api/reports/financial?${queryParams.toString()}`).then((r) => r.json()),
        fetch(`/api/reports/logistics`).then((r) => r.json()),
        fetch(`/api/export-logs`).then((r) => (r.ok ? r.json() : { data: [] })),
      ]);

      if (opsRes.success) setOpsMetrics(opsRes.data);
      if (finRes.success) setFinMetrics(finRes.data);
      if (logRes.success) setLogMetrics(logRes.data);
      if (logsRes.success) setExportLogs(logsRes.data);
    } catch (err) {
      console.error('Failed to load metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const handleExport = async (
    exportType: 'CASES_LIST' | 'INVOICES_LIST' | 'PAYMENTS_LIST' | 'OPERATIONS' | 'FINANCIAL' | 'LOGISTICS',
    format: 'CSV' | 'EXCEL' | 'PDF'
  ) => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          export_type: exportType,
          format,
          filter_params: { start_date: startDate, end_date: endDate },
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Export request failed');
      }

      // Download file blob
      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      let filename = `vericlaim_export.${format === 'EXCEL' ? 'xlsx' : format.toLowerCase()}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      // Refresh export logs
      const logsRes = await fetch('/api/export-logs').then((r) => r.json());
      if (logsRes.success) setExportLogs(logsRes.data);
    } catch (err: any) {
      setExportError(err.message || 'Export error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <BarChart3 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Management Reports & Analytics
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time operational velocity, statutory GST separation, financial margins, and physical chain of custody.
          </p>
        </div>

        {/* Filters & Export Triggers */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center space-x-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-slate-700 dark:text-slate-200 outline-none text-xs"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-slate-700 dark:text-slate-200 outline-none text-xs"
            />
          </div>

          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Refresh Metrics"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          </button>

          {/* Quick Export Actions */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => handleExport(activeTab === 'financial' ? 'INVOICES_LIST' : 'CASES_LIST', 'EXCEL')}
              disabled={exporting}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Excel Export</span>
            </button>
            <button
              onClick={() => handleExport(activeTab === 'financial' ? 'INVOICES_LIST' : 'CASES_LIST', 'CSV')}
              disabled={exporting}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold shadow-xs transition"
            >
              <Download className="h-3.5 w-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>
      </div>

      {exportError && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
            <span>{exportError}</span>
          </div>
          <button onClick={() => setExportError(null)} className="text-xs font-semibold underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex space-x-1 border-b border-slate-200 dark:border-slate-800">
        {[
          { key: 'operations', label: 'Operations & SLA', icon: Layers },
          { key: 'financial', label: 'Financial & GST Separation', icon: Receipt },
          { key: 'logistics', label: 'Physical Custody & Transit', icon: Truck },
          { key: 'exports', label: 'Export Audit Logs', icon: FileCheck2Icon },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-medium border-b-2 transition -mb-px ${
                isActive
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: OPERATIONS */}
      {activeTab === 'operations' && (
        <div className="space-y-6">
          {/* Operations KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <KpiCard
              label="Total Cases"
              value={opsMetrics?.total_cases ?? 0}
              subtext="Intake in Period"
              color="text-slate-900 dark:text-slate-100"
            />
            <KpiCard
              label="Active Pipeline"
              value={opsMetrics?.open_cases ?? 0}
              subtext="In Progress"
              color="text-blue-600 dark:text-blue-400"
            />
            <KpiCard
              label="Closed Cases"
              value={opsMetrics?.closed_cases ?? 0}
              subtext="Completed"
              color="text-emerald-600 dark:text-emerald-400"
            />
            <KpiCard
              label="SLA Compliance"
              value={`${opsMetrics?.sla_metrics.compliance_rate ?? 100}%`}
              subtext={`${opsMetrics?.sla_metrics.met_sla_count ?? 0} on track / met`}
              color="text-purple-600 dark:text-purple-400"
            />
            <KpiCard
              label="Rework Cycles"
              value={opsMetrics?.rework_count ?? 0}
              subtext={`${opsMetrics?.escalated_count ?? 0} Escalated (N≥3)`}
              color="text-amber-600 dark:text-amber-400"
            />
            <KpiCard
              label="Avg Closure TAT"
              value={`${opsMetrics?.tat_metrics.avg_overall_closure_hours ?? 0}h`}
              subtext="Intake to Closed"
              color="text-cyan-600 dark:text-cyan-400"
            />
          </div>

          {/* Breakdown Tables & TAT Velocity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Client Breakdown */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center space-x-1.5">
                <Building className="h-4 w-4 text-blue-600" />
                <span>Volume by Insurer / Client</span>
              </h2>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {opsMetrics?.by_company.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">No cases found in period</p>
                ) : (
                  opsMetrics?.by_company.map((c) => (
                    <div
                      key={c.client_id}
                      className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-xs"
                    >
                      <span className="font-medium text-slate-700 dark:text-slate-300 truncate max-w-[180px]">
                        {c.client_name}
                      </span>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono-code font-bold text-slate-900 dark:text-slate-100">
                          {c.count}
                        </span>
                        <span className="text-[10px] text-slate-400">({c.percentage}%)</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Outcome Breakdown */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center space-x-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>Investigation Outcome Distribution</span>
              </h2>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {opsMetrics?.by_outcome.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">No cases found in period</p>
                ) : (
                  opsMetrics?.by_outcome.map((o) => (
                    <div
                      key={o.outcome}
                      className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-xs"
                    >
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {o.outcome}
                      </span>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono-code font-bold text-slate-900 dark:text-slate-100">
                          {o.count}
                        </span>
                        <span className="text-[10px] text-slate-400">({o.percentage}%)</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Turnaround Time Stage Breakdown */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center space-x-1.5">
                <Clock className="h-4 w-4 text-amber-600" />
                <span>Stage TAT Velocity (Hours)</span>
              </h2>
              <div className="space-y-2.5 text-xs">
                <TatRow label="Intake → Verification" hours={opsMetrics?.tat_metrics.avg_intake_to_verification_hours ?? 0} />
                <TatRow label="Verification → Assigned" hours={opsMetrics?.tat_metrics.avg_verification_to_assignment_hours ?? 0} />
                <TatRow label="Field Investigation" hours={opsMetrics?.tat_metrics.avg_field_investigation_hours ?? 0} />
                <TatRow label="Report Review & Approval" hours={opsMetrics?.tat_metrics.avg_report_review_hours ?? 0} />
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                  <TatRow
                    label="Overall End-to-End Closure"
                    hours={opsMetrics?.tat_metrics.avg_overall_closure_hours ?? 0}
                    isTotal
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: FINANCIAL INTELLIGENCE */}
      {activeTab === 'financial' && (
        <div className="space-y-6">
          {/* Statutory GST Separation Banner (Rule A1, A6, A12 & CA-VERIFY Q-CA-01) */}
          <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl flex items-start space-x-3 text-xs text-amber-900 dark:text-amber-200">
            <Receipt className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-sm">Statutory GST & Revenue Separation Active (CA-VERIFY):</span>
              <p className="mt-0.5 text-amber-800/90 dark:text-amber-300/80">
                GST collected is recognized as statutory government liability, strictly excluded from agency service income.
                Gross Margin is computed purely as Taxable Service Revenue minus Direct Investigator Payables & Approved Expenses.
              </p>
            </div>
          </div>

          {/* Financial KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <KpiCard
              label="Gross Invoiced"
              value={`₹${(finMetrics?.total_billed_gross ?? 0).toLocaleString('en-IN')}`}
              subtext="Total with GST"
              color="text-slate-900 dark:text-slate-100"
            />
            <KpiCard
              label="Taxable Service Revenue"
              value={`₹${(finMetrics?.total_billed_taxable ?? 0).toLocaleString('en-IN')}`}
              subtext="Net Service Base"
              color="text-blue-600 dark:text-blue-400"
            />
            <KpiCard
              label="Output GST Liability"
              value={`₹${(finMetrics?.statutory_gst.total_output_gst_collected ?? 0).toLocaleString('en-IN')}`}
              subtext="Statutory (Not Profit)"
              color="text-amber-600 dark:text-amber-400"
            />
            <KpiCard
              label="Remittances Received"
              value={`₹${(finMetrics?.total_collections_received ?? 0).toLocaleString('en-IN')}`}
              subtext="Total Bank Inflow"
              color="text-emerald-600 dark:text-emerald-400"
            />
            <KpiCard
              label="Outstanding Balance"
              value={`₹${(finMetrics?.total_outstanding ?? 0).toLocaleString('en-IN')}`}
              subtext="Receivables Pending"
              color="text-rose-600 dark:text-rose-400"
            />
            <KpiCard
              label="Gross Profit Margin"
              value={`${finMetrics?.profitability.gross_margin_percentage ?? 0}%`}
              subtext={`₹${(finMetrics?.profitability.gross_profit ?? 0).toLocaleString('en-IN')}`}
              color="text-purple-600 dark:text-purple-400"
            />
          </div>

          {/* Aging Buckets & Direct Costs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Receivables Aging Buckets */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center space-x-1.5">
                <CreditCard className="h-4 w-4 text-rose-600" />
                <span>Receivables Aging Schedule (Outstanding ₹{(finMetrics?.total_outstanding ?? 0).toLocaleString('en-IN')})</span>
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-center">
                  <div className="text-slate-400 text-[11px]">Current (0-30 Days)</div>
                  <div className="text-sm font-bold font-mono-code text-slate-800 dark:text-slate-200 mt-1">
                    ₹{(finMetrics?.aging_buckets.current_0_30 ?? 0).toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 text-center">
                  <div className="text-amber-600 dark:text-amber-400 text-[11px]">31-60 Days</div>
                  <div className="text-sm font-bold font-mono-code text-amber-700 dark:text-amber-300 mt-1">
                    ₹{(finMetrics?.aging_buckets.aging_31_60 ?? 0).toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-orange-50/60 dark:bg-orange-950/30 text-center">
                  <div className="text-orange-600 dark:text-orange-400 text-[11px]">61-90 Days</div>
                  <div className="text-sm font-bold font-mono-code text-orange-700 dark:text-orange-300 mt-1">
                    ₹{(finMetrics?.aging_buckets.aging_61_90 ?? 0).toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 text-center">
                  <div className="text-rose-600 dark:text-rose-400 text-[11px]">Over 90 Days</div>
                  <div className="text-sm font-bold font-mono-code text-rose-700 dark:text-rose-300 mt-1">
                    ₹{(finMetrics?.aging_buckets.over_90 ?? 0).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
            </div>

            {/* Direct Investigation Cost & Profit Breakdown */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center space-x-1.5">
                <TrendingUp className="h-4 w-4 text-purple-600" />
                <span>Statutory Profit & Loss Summary</span>
              </h2>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Taxable Service Revenue (Base):</span>
                  <span className="font-mono-code font-semibold">
                    ₹{(finMetrics?.profitability.net_service_revenue ?? 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">(-) Direct Investigator Fees:</span>
                  <span className="font-mono-code text-rose-600">
                    -₹{(finMetrics?.direct_costs.investigator_case_fees_payable ?? 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">(-) Approved Field Travel & Expenses:</span>
                  <span className="font-mono-code text-rose-600">
                    -₹{(finMetrics?.direct_costs.investigator_approved_expenses ?? 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 font-bold text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 px-2 rounded-lg">
                  <span>Gross Operating Profit:</span>
                  <span className="font-mono-code text-emerald-600 dark:text-emerald-400">
                    ₹{(finMetrics?.profitability.gross_profit ?? 0).toLocaleString('en-IN')} ({finMetrics?.profitability.gross_margin_percentage ?? 0}%)
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LOGISTICS */}
      {activeTab === 'logistics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Packets Inwarded"
              value={logMetrics?.total_packets_inwarded ?? 0}
              subtext="Total Received"
              color="text-slate-900 dark:text-slate-100"
            />
            <KpiCard
              label="In Archive Vault"
              value={logMetrics?.packets_in_archive ?? 0}
              subtext="Stored in Rack/Box"
              color="text-blue-600 dark:text-blue-400"
            />
            <KpiCard
              label="In Transit (Dispatched)"
              value={logMetrics?.packets_in_transit ?? 0}
              subtext="With Courier Partner"
              color="text-amber-600 dark:text-amber-400"
            />
            <KpiCard
              label="Delivered to Client"
              value={logMetrics?.packets_delivered ?? 0}
              subtext={`${logMetrics?.delivery_acknowledgment_rate ?? 100}% Acknowledged`}
              color="text-emerald-600 dark:text-emerald-400"
            />
          </div>

          {/* Courier Performance Table */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center space-x-1.5">
              <Truck className="h-4 w-4 text-blue-600" />
              <span>Courier Partner Turnaround Performance</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="p-3">Courier Partner</th>
                    <th className="p-3">Dockets Dispatched</th>
                    <th className="p-3">Delivered</th>
                    <th className="p-3">Avg Delivery Transit (Days)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {logMetrics?.courier_performance.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-slate-400">
                        No courier dockets recorded
                      </td>
                    </tr>
                  ) : (
                    logMetrics?.courier_performance.map((cp) => (
                      <tr key={cp.courier_partner} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">{cp.courier_partner}</td>
                        <td className="p-3 font-mono-code">{cp.docket_count}</td>
                        <td className="p-3 font-mono-code text-emerald-600">{cp.delivered_count}</td>
                        <td className="p-3 font-mono-code">{cp.avg_delivery_days} days</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: EXPORT AUDIT LOGS */}
      {activeTab === 'exports' && (
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center space-x-1.5">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              <span>Immutable Export Audit Trail (Gate 4 Verified)</span>
            </h2>
            <span className="text-xs text-slate-400">All download and denied export attempts logged</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Export Type</th>
                  <th className="p-3">Format</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Rows</th>
                  <th className="p-3">SHA-256 Hash</th>
                  <th className="p-3">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {exportLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-slate-400">
                      No export events logged yet
                    </td>
                  </tr>
                ) : (
                  exportLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-mono-code text-slate-500">
                        {new Date(log.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </td>
                      <td className="p-3 font-medium text-slate-800 dark:text-slate-200">{log.export_type}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-mono-code font-bold">
                          {log.format}
                        </span>
                      </td>
                      <td className="p-3">
                        {log.status === 'COMPLETED' ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400 rounded text-[10px] font-semibold">
                            COMPLETED
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-400 rounded text-[10px] font-semibold" title={log.denial_reason}>
                            DENIED
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-mono-code">{log.row_count}</td>
                      <td className="p-3 font-mono-code text-[11px] text-slate-400 truncate max-w-[120px]" title={log.sha256}>
                        {log.sha256 ? `${log.sha256.substring(0, 10)}...` : 'N/A'}
                      </td>
                      <td className="p-3 font-mono-code text-slate-500">{log.ip_address || '127.0.0.1'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  subtext,
  color,
}: {
  label: string;
  value: string | number;
  subtext: string;
  color?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">{label}</div>
      <div className={`text-lg font-bold font-mono-code mt-1 truncate ${color || 'text-slate-900 dark:text-slate-100'}`}>
        {value}
      </div>
      <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{subtext}</div>
    </div>
  );
}

function TatRow({ label, hours, isTotal }: { label: string; hours: number; isTotal?: boolean }) {
  return (
    <div className={`flex justify-between py-1 ${isTotal ? 'font-bold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>
      <span>{label}</span>
      <span className="font-mono-code">{hours} hrs ({Number((hours / 24).toFixed(1))} d)</span>
    </div>
  );
}

function FileCheck2Icon(props: any) {
  return <ShieldCheck {...props} />;
}
