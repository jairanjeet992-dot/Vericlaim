import React from 'react';
import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext, getAgencyBranding } from '@/modules/tenancy/service';
import {
  FolderKanban,
  Activity,
  FileCheck2,
  Receipt,
  ArrowUpRight,
  TrendingUp,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Building,
  CheckCircle2,
  Package,
  Plus,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

export default async function AgencyDashboardPage() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const context = user ? await getUserContext(supabase, user.id) : null;
  const branding = context
    ? await getAgencyBranding(supabase, context.agency_id)
    : null;

  // Real Database Telemetry for Current Agency
  // 1. Total Active Cases
  const { count: activeCasesCount } = await supabase
    .from('cases')
    .select('*', { count: 'exact', head: true })
    .neq('status', 'CLOSED');

  // 2. Field Activities In Progress
  const { count: activeActivitiesCount } = await supabase
    .from('investigation_activities')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'IN_PROGRESS');

  // 3. Reports Under Review / Sent Back
  const { count: reviewReportsCount } = await supabase
    .from('reports')
    .select('*', { count: 'exact', head: true })
    .in('status', ['UNDER_REVIEW', 'SENT_BACK', 'SUBMITTED']);

  // 4. Invoices Issued / Billed Total
  const { data: invoiceRows } = await supabase
    .from('invoices')
    .select('total_amount, status');

  const totalBilled = (invoiceRows || []).reduce(
    (acc, inv) => acc + (inv.status !== 'CANCELLED' ? Number(inv.total_amount || 0) : 0),
    0
  );

  // 5. Recent 5 Cases
  const { data: recentCases } = await supabase
    .from('cases')
    .select('id, doc_code, claim_no, insured_name, case_type, status, risk_level, due_date, client_id, clients(name)')
    .order('created_at', { ascending: false })
    .limit(5);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Status Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-200/80 dark:border-white/10 gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Operations Intelligence
            </h1>
            <span className="text-[10px] font-mono-code font-bold px-2 py-0.5 bg-blue-100/80 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 rounded-full border border-blue-200/80 dark:border-blue-800/80 flex items-center space-x-1 shadow-2xs">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
              <span>LIVE TELEMETRY</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Agency telemetry for{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {context?.agency.name}
            </span>{' '}
            (Tenant Code:{' '}
            <span className="font-mono-code text-blue-600 dark:text-blue-400 font-bold">
              {context?.agency.code}
            </span>
            ) • Indian Insurance Investigation Architecture
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Link
            href="/cases"
            className="btn-3d flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-500/20 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Intake Case</span>
          </Link>
          <Link
            href="/command-center"
            className="btn-3d flex items-center space-x-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-white/10 rounded-xl text-xs font-semibold shadow-2xs transition"
          >
            <Activity className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>Command Center</span>
          </Link>
        </div>
      </div>

      {/* LUXURY 3D GLASS KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Active Claims Portfolio */}
        <div className="glass-kpi-3d ambient-glow-blue p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Active Claim Docket
            </span>
            <div className="h-8 w-8 rounded-xl bg-blue-500/10 dark:bg-blue-400/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <FolderKanban className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              {activeCasesCount || 0}
            </div>
            <div className="flex items-center space-x-1.5 mt-1.5">
              <span className="text-[10px] font-mono-code font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.2 rounded border border-blue-200/60 dark:border-blue-800/60">
                100% AUDITED
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Open in pipeline
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100/80 dark:border-white/5 flex items-center justify-between text-[11px]">
            <Link
              href="/cases"
              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-semibold inline-flex items-center space-x-1 group"
            >
              <span>View Roster</span>
              <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <span className="text-slate-400 font-mono-code text-[10px]">Scope-Guarded</span>
          </div>
        </div>

        {/* KPI 2: Live Field Enquiries */}
        <div className="glass-kpi-3d ambient-glow-emerald p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
              Field Enquiries Live
            </span>
            <div className="h-8 w-8 rounded-xl bg-emerald-500/10 dark:bg-emerald-400/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-3xl font-black text-emerald-700 dark:text-emerald-300 tracking-tight">
              {activeActivitiesCount || 0}
            </div>
            <div className="flex items-center space-x-1.5 mt-1.5">
              <span className="text-[10px] font-mono-code font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-200/60 dark:border-emerald-800/60">
                GPS + SHA-256
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                PWA field sync
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100/80 dark:border-white/5 flex items-center justify-between text-[11px]">
            <Link
              href="/investigator"
              className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-semibold inline-flex items-center space-x-1 group"
            >
              <span>Field Terminal</span>
              <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <span className="text-slate-400 font-mono-code text-[10px]">Offline Queue</span>
          </div>
        </div>

        {/* KPI 3: Quality Control & QC Review */}
        <div className="glass-kpi-3d ambient-glow-purple p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
              QC Review Queue
            </span>
            <div className="h-8 w-8 rounded-xl bg-purple-500/10 dark:bg-purple-400/10 border border-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <FileCheck2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-3xl font-black text-purple-700 dark:text-purple-300 tracking-tight">
              {reviewReportsCount || 0}
            </div>
            <div className="flex items-center space-x-1.5 mt-1.5">
              <span className="text-[10px] font-mono-code font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 px-1.5 py-0.2 rounded border border-purple-200/60 dark:border-purple-800/60">
                REWORK ENGINE
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Dockets pending QC
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100/80 dark:border-white/5 flex items-center justify-between text-[11px]">
            <Link
              href="/reports"
              className="text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-semibold inline-flex items-center space-x-1 group"
            >
              <span>Review Reports</span>
              <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <span className="text-slate-400 font-mono-code text-[10px]">Immutable Gate</span>
          </div>
        </div>

        {/* KPI 4: Net Invoiced Revenue */}
        <div className="glass-kpi-3d ambient-glow-amber p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              Net Invoiced Revenue
            </span>
            <div className="h-8 w-8 rounded-xl bg-amber-500/10 dark:bg-amber-400/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Receipt className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-amber-700 dark:text-amber-300 tracking-tight">
              {formatCurrency(totalBilled)}
            </div>
            <div className="flex items-center space-x-1.5 mt-1.5">
              <span className="text-[10px] font-mono-code font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-200/60 dark:border-amber-800/60">
                GST / SAC 998311
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                FY 2026-27 Monotonic
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100/80 dark:border-white/5 flex items-center justify-between text-[11px]">
            <Link
              href="/invoicing"
              className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-semibold inline-flex items-center space-x-1 group"
            >
              <span>Finance Console</span>
              <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <span className="text-slate-400 font-mono-code text-[10px]">CA-VERIFY</span>
          </div>
        </div>
      </div>

      {/* OPERATIONAL LIFECYCLE PIPELINE */}
      <div className="glass-kpi-3d p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              End-to-End Investigation Lifecycle
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Deterministic state machine enforced by Postgres RLS triggers (Rule A1 & A6)
            </p>
          </div>
          <span className="text-[10px] font-mono-code px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded font-semibold border border-slate-200 dark:border-slate-700">
            6 STAGES
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { step: '01', title: 'Case Intake', desc: 'Data entry & OCR check', color: 'border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/30' },
            { step: '02', title: 'Verification', desc: 'Scope & claim routing', color: 'border-indigo-500/30 text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30' },
            { step: '03', title: 'Field Enquiries', desc: 'PWA evidence with hash', color: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/30' },
            { step: '04', title: 'Review & QC', desc: 'Rework cycle engine', color: 'border-purple-500/30 text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-950/30' },
            { step: '05', title: 'Hardcopy Track', desc: 'AWB courier chain', color: 'border-teal-500/30 text-teal-600 dark:text-teal-400 bg-teal-50/50 dark:bg-teal-950/30' },
            { step: '06', title: 'GST Billing', desc: 'Gapless tax invoices', color: 'border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/30' },
          ].map((stage, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-xl border ${stage.color} flex flex-col justify-between transition-transform hover:-translate-y-0.5`}
            >
              <div className="flex items-center justify-between text-[10px] font-mono-code font-bold opacity-80">
                <span>{stage.step}</span>
                <span>•</span>
              </div>
              <div className="my-2">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-tight">
                  {stage.title}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                  {stage.desc}
                </div>
              </div>
              <div className="text-[9px] font-mono-code uppercase opacity-75 font-semibold">
                Traceable
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RECENT CLAIM DOCKETS TABLE & LAUNCHPAD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Recent Cases Roster */}
        <div className="lg:col-span-2 glass-kpi-3d p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Recent Claim Dockets
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Live case stream filtered by your authorized scope ({context?.scope || 'ALL'})
              </p>
            </div>
            <Link
              href="/cases"
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 inline-flex items-center space-x-1"
            >
              <span>All Cases</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/70 dark:bg-slate-900/80 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-200/80 dark:border-white/10">
                <tr>
                  <th className="py-2.5 px-3">Doc Code</th>
                  <th className="py-2.5 px-3">Insured & Claim</th>
                  <th className="py-2.5 px-3">Client</th>
                  <th className="py-2.5 px-3">Risk Level</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {!recentCases || recentCases.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                      No cases registered yet. Click &quot;Intake Case&quot; to begin.
                    </td>
                  </tr>
                ) : (
                  recentCases.map((c: any) => (
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-900/60 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono-code font-bold text-slate-800 dark:text-slate-200">
                        {c.doc_code}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {c.insured_name}
                        </div>
                        <div className="font-mono-code text-[11px] text-slate-400 dark:text-slate-500">
                          {c.claim_no || 'Pending Claim #'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                        {c.clients?.name || 'Insurer'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`text-[10px] font-mono-code font-bold px-1.5 py-0.5 rounded border ${
                            c.risk_level === 'CRITICAL'
                              ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300/80'
                              : c.risk_level === 'HIGH'
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300/80'
                              : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300/80'
                          }`}
                        >
                          {c.risk_level || 'LOW'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] font-mono-code bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-semibold">
                          {c.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Link
                          href={`/cases/${c.id}`}
                          className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 inline-flex items-center space-x-0.5"
                        >
                          <span>Open</span>
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 1 Col: Quick Action Launchpad */}
        <div className="glass-kpi-3d p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
              Operations Launchpad
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Tactical actions for investigation coordinators
            </p>

            <div className="space-y-2.5">
              <Link
                href="/cases"
                className="group p-3 rounded-xl border border-slate-200/80 dark:border-white/10 hover:border-blue-500/40 bg-white/60 dark:bg-slate-900/60 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 flex items-center justify-between transition-all"
              >
                <div className="flex items-center space-x-3">
                  <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <Plus className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      New Case Intake
                    </div>
                    <div className="text-[11px] text-slate-400">OCR & Duplicate Claim Check</div>
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
              </Link>

              <Link
                href="/command-center"
                className="group p-3 rounded-xl border border-slate-200/80 dark:border-white/10 hover:border-indigo-500/40 bg-white/60 dark:bg-slate-900/60 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 flex items-center justify-between transition-all"
              >
                <div className="flex items-center space-x-3">
                  <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <Activity className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                      Command Center
                    </div>
                    <div className="text-[11px] text-slate-400">13-Queue Telemetry & SLA Hub</div>
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
              </Link>

              <Link
                href="/reports"
                className="group p-3 rounded-xl border border-slate-200/80 dark:border-white/10 hover:border-purple-500/40 bg-white/60 dark:bg-slate-900/60 hover:bg-purple-50/50 dark:hover:bg-purple-950/30 flex items-center justify-between transition-all"
              >
                <div className="flex items-center space-x-3">
                  <div className="h-8 w-8 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <FileCheck2 className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                      Report Review & QC
                    </div>
                    <div className="text-[11px] text-slate-400">Multi-cycle Rework Engine</div>
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-purple-600 dark:group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all" />
              </Link>

              <Link
                href="/invoicing"
                className="group p-3 rounded-xl border border-slate-200/80 dark:border-white/10 hover:border-amber-500/40 bg-white/60 dark:bg-slate-900/60 hover:bg-amber-50/50 dark:hover:bg-amber-950/30 flex items-center justify-between transition-all"
              >
                <div className="flex items-center space-x-3">
                  <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                    <Receipt className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400">
                      GST Tax Invoicing
                    </div>
                    <div className="text-[11px] text-slate-400">Monotonic FY Sequences</div>
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-amber-600 dark:group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
              </Link>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100/80 dark:border-white/10 flex items-center justify-between text-[11px] text-slate-400">
            <span>Vericlaim SaaS Core</span>
            <span className="font-mono-code">v0.1.0-alpha</span>
          </div>
        </div>
      </div>
    </div>
  );
}
