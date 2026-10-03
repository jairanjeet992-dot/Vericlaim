import React from 'react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext, getAgencyBranding } from '@/modules/tenancy/service';

export default async function AgencyDashboardPage() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const context = user ? await getUserContext(supabase, user.id) : null;
  const branding = context ? await getAgencyBranding(supabase, context.agency_id) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Agency Operations Console
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Welcome, <span className="font-semibold text-slate-700">{context?.full_name}</span>. 
            Logged into <span className="font-semibold text-slate-700">{context?.agency.name}</span>.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono-code px-2 py-1 bg-slate-100 border border-slate-200 rounded text-slate-700">
            PLAN: {branding?.plan_tier.toUpperCase() || 'FREE'}
          </span>
          <span className="text-xs font-mono-code px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded">
            SCOPE: {context?.scope || 'OWN_ENTERED'}
          </span>
        </div>
      </div>

      {/* Operational Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 border border-slate-200 rounded shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Active Cases
          </div>
          <div className="text-2xl font-bold font-mono-code text-slate-900 mt-1">0</div>
          <div className="text-[11px] text-slate-400 mt-1">Ready for Phase 2 intake</div>
        </div>

        <div className="bg-white p-4 border border-slate-200 rounded shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Field Enquiries
          </div>
          <div className="text-2xl font-bold font-mono-code text-slate-900 mt-1">0</div>
          <div className="text-[11px] text-slate-400 mt-1">Investigation stage</div>
        </div>

        <div className="bg-white p-4 border border-slate-200 rounded shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Pending Reviews
          </div>
          <div className="text-2xl font-bold font-mono-code text-slate-900 mt-1">0</div>
          <div className="text-[11px] text-slate-400 mt-1">Quality assurance</div>
        </div>

        <div className="bg-white p-4 border border-slate-200 rounded shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Finance & Invoicing
          </div>
          <div className="text-2xl font-bold font-mono-code text-slate-900 mt-1">₹0.00</div>
          <div className="text-[11px] text-slate-400 mt-1">Closed billable dockets</div>
        </div>
      </div>

      {/* Operational Quick Launcher */}
      <div className="bg-white border border-slate-200 rounded p-4 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
          Agency System Ready (Phase 1 Foundation)
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
          Tenant isolation, role-based access control, scope enforcement, and immutable audit logs are fully active. 
          All tenant data operations are partitioned by agency code with strict PostgreSQL Row-Level Security.
        </p>
      </div>
    </div>
  );
}
