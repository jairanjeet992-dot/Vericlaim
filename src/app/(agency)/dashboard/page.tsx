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
  const agencyId = context?.agency_id;

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
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-200 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">
              Operations Intelligence
            </h1>
            <span className="text-[10px] font-mono-code font-bold px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full border border-blue-200">
              LIVE CONSOLE
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Agency telemetry for{' '}
            <span className="font-semibold text-slate-800">
              {context?.agency.name}
            </span>{' '}
            (Tenant Code:{' '}
            <span className="font-mono-code text-blue-600 font-bold">
              {context?.agency.code}
            </span>
            )
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <Link
            href="/cases"
            className="btn-3d flex items-center space-x-1.5 px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold shadow-md shadow-blue-500/10 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Intake</span>
          </Link>
          <Link
            href="/command-center"
            className="btn-3d flex items-center space-x-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-lg text-xs font-bold shadow-xs transition"
          >
            <Activity className="h-3.5 w-3.5 text-blue-600" />
            <span>Command Center</span>
          </Link>
        </div>
      </div>

      {/* 3D KPI TACTILE HERO METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Active Cases */}
        <Link href="/cases" className="kpi-card-3d p-4 block group">
          <div className="flex items-start justify-between">
            <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-inner group-hover:scale-110 transition-transform">
              <FolderKanban className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-mono-code font-bold px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full border border-blue-200">
              INVENTORY
            </span>
          </div>

          <div className="mt-3">
            <div className="text-3xl font-black font-mono-code text-slate-900 tracking-tight">
              {activeCasesCount ?? 0}
            </div>
            <div className="text-xs font-semibold text-slate-600 mt-0.5">
              Active Investigation Cases
            </div>
            <div className="flex items-center space-x-1 text-[11px] text-blue-600 font-medium mt-2">
              <span>View all dockets</span>
              <ArrowUpRight className="h-3 w-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </div>
          </div>
        </Link>

        {/* KPI 2: Field Inquiries */}
        <Link href="/investigator" className="kpi-card-3d p-4 block group">
          <div className="flex items-start justify-between">
            <div className="h-10 w-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-inner group-hover:scale-110 transition-transform">
              <Activity className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-mono-code font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
              FIELD LIVE
            </span>
          </div>

          <div className="mt-3">
            <div className="text-3xl font-black font-mono-code text-slate-900 tracking-tight">
              {activeActivitiesCount ?? 0}
            </div>
            <div className="text-xs font-semibold text-slate-600 mt-0.5">
              Field Enquiries in Progress
            </div>
            <div className="flex items-center space-x-1 text-[11px] text-emerald-600 font-medium mt-2">
              <span>Investigator PWA portal</span>
              <ArrowUpRight className="h-3 w-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </div>
          </div>
        </Link>

        {/* KPI 3: Quality Reviews & Reworks */}
        <Link href="/reports" className="kpi-card-3d p-4 block group">
          <div className="flex items-start justify-between">
            <div className="h-10 w-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-inner group-hover:scale-110 transition-transform">
              <FileCheck2 className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-mono-code font-bold px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full border border-amber-200">
              QC REVIEW
            </span>
          </div>

          <div className="mt-3">
            <div className="text-3xl font-black font-mono-code text-slate-900 tracking-tight">
              {reviewReportsCount ?? 0}
            </div>
            <div className="text-xs font-semibold text-slate-600 mt-0.5">
              Reports Awaiting Approval
            </div>
            <div className="flex items-center space-x-1 text-[11px] text-amber-700 font-medium mt-2">
              <span>Quality control queue</span>
              <ArrowUpRight className="h-3 w-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </div>
          </div>
        </Link>

        {/* KPI 4: Financial Volume (Phase 7A) */}
        <Link href="/invoicing" className="kpi-card-3d p-4 block group">
          <div className="flex items-start justify-between">
            <div className="h-10 w-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 shadow-inner group-hover:scale-110 transition-transform">
              <Receipt className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-mono-code font-bold px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full border border-purple-200">
              GST INVOICING
            </span>
          </div>

          <div className="mt-3">
            <div className="text-3xl font-black font-mono-code text-slate-900 tracking-tight truncate">
              {formatCurrency(totalBilled)}
            </div>
            <div className="text-xs font-semibold text-slate-600 mt-0.5">
              Total Invoiced Revenue
            </div>
            <div className="flex items-center space-x-1 text-[11px] text-purple-700 font-medium mt-2">
              <span>View tax ledger & bills</span>
              <ArrowUpRight className="h-3 w-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </div>
          </div>
        </Link>
      </div>

      {/* OPERATIONS LIFECYCLE 3D PIPELINE */}
      <div className="kpi-card-3d p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Investigation Operations Lifecycle
            </h2>
            <p className="text-[11px] text-slate-500">
              Standard operating procedure from intake to financial recovery
            </p>
          </div>
          <span className="text-[10px] font-mono-code text-slate-400 font-medium">
            Rule A1 Flow
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center text-xs">
          <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200/80">
            <div className="font-bold text-blue-900 text-xs">1. Case Intake</div>
            <div className="text-[10px] text-blue-700 mt-0.5">Registration</div>
          </div>
          <div className="p-3 rounded-lg bg-indigo-50/70 border border-indigo-200/80">
            <div className="font-bold text-indigo-900 text-xs">2. Verification</div>
            <div className="text-[10px] text-indigo-700 mt-0.5">Manager Routing</div>
          </div>
          <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200/80">
            <div className="font-bold text-emerald-900 text-xs">3. Field Inquiry</div>
            <div className="text-[10px] text-emerald-700 mt-0.5">Evidence & PWA</div>
          </div>
          <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200/80">
            <div className="font-bold text-amber-900 text-xs">4. Report QC</div>
            <div className="text-[10px] text-amber-700 mt-0.5">Rework Cycles</div>
          </div>
          <div className="p-3 rounded-lg bg-cyan-50/70 border border-cyan-200/80">
            <div className="font-bold text-cyan-900 text-xs">5. Hardcopy</div>
            <div className="text-[10px] text-cyan-700 mt-0.5">Courier AWB</div>
          </div>
          <div className="p-3 rounded-lg bg-purple-50/70 border border-purple-200/80">
            <div className="font-bold text-purple-900 text-xs">6. GST Billing</div>
            <div className="text-[10px] text-purple-700 mt-0.5">Gapless Invoice</div>
          </div>
        </div>
      </div>

      {/* TWO COLUMN GRID: RECENT DOCKETS & QUICK LAUNCH */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Recent Active Cases Ledger */}
        <div className="lg:col-span-2 kpi-card-3d p-5">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Recent Investigation Dockets
              </h2>
              <p className="text-[11px] text-slate-500">
                Latest insurance claims in active pipeline
              </p>
            </div>
            <Link
              href="/cases"
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center space-x-1"
            >
              <span>View all cases</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase font-bold text-slate-400">
                  <th className="pb-2">Docket No</th>
                  <th className="pb-2">Claim / Insured</th>
                  <th className="pb-2">Case Type</th>
                  <th className="pb-2">Risk</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentCases && recentCases.length > 0 ? (
                  recentCases.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 font-mono-code font-bold text-blue-700">
                        {c.doc_code}
                      </td>
                      <td className="py-2.5">
                        <div className="font-semibold text-slate-800">
                          {c.insured_name}
                        </div>
                        <div className="text-[10px] font-mono-code text-slate-400">
                          {c.claim_no}
                        </div>
                      </td>
                      <td className="py-2.5 font-medium text-slate-600">
                        {c.case_type}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            c.risk_level === 'HIGH'
                              ? 'bg-rose-100 text-rose-800'
                              : c.risk_level === 'MEDIUM'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {c.risk_level}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <span className="text-[10px] font-mono-code font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {c.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <Link
                          href={`/cases/${c.id}`}
                          className="text-[11px] font-bold text-blue-600 hover:text-blue-800"
                        >
                          Open →
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-400">
                      No cases registered yet. Click &ldquo;+ New Intake&rdquo; to begin.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Quick Operations & Governance Vault */}
        <div className="space-y-4">
          {/* Quick Launchpad */}
          <div className="kpi-card-3d p-5">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 mb-3">
              Operational Quick Actions
            </h2>
            <div className="space-y-2">
              <Link
                href="/cases"
                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 hover:bg-blue-50/70 border border-slate-200 hover:border-blue-300 transition text-xs group"
              >
                <div className="flex items-center space-x-2.5">
                  <div className="h-7 w-7 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                    +
                  </div>
                  <span className="font-semibold text-slate-800">
                    Register New Case Intake
                  </span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600 transition" />
              </Link>

              <Link
                href="/invoicing"
                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 hover:bg-amber-50/70 border border-slate-200 hover:border-amber-300 transition text-xs group"
              >
                <div className="flex items-center space-x-2.5">
                  <div className="h-7 w-7 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                    ₹
                  </div>
                  <span className="font-semibold text-slate-800">
                    Bulk Invoice Generator
                  </span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-amber-600 transition" />
              </Link>

              <Link
                href="/hardcopy"
                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 hover:bg-cyan-50/70 border border-slate-200 hover:border-cyan-300 transition text-xs group"
              >
                <div className="flex items-center space-x-2.5">
                  <Package className="h-5 w-5 text-cyan-600" />
                  <span className="font-semibold text-slate-800">
                    Dispatch Courier Manifest
                  </span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-cyan-600 transition" />
              </Link>
            </div>
          </div>

          {/* System Security & Compliance Badge */}
          <div className="kpi-card-3d p-4 bg-gradient-to-br from-slate-900 to-slate-950 text-white border-slate-800">
            <div className="flex items-center space-x-2 text-xs font-bold text-blue-400">
              <ShieldCheck className="h-4 w-4" />
              <span>Security Constitution (A1-A12)</span>
            </div>
            <p className="text-[11px] text-slate-300 mt-2 leading-relaxed">
              Multi-tenant agency isolation active with PostgreSQL RLS. Private Cloudflare R2 evidence vault with SHA-256 verification and immutable audit logs.
            </p>
            <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono-code">
              <span>TENANT: {context?.agency.code}</span>
              <span className="text-emerald-400 font-bold">COMPLIANT</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
