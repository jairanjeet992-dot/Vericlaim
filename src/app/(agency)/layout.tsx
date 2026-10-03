import React from 'react';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext, getAgencyBranding } from '@/modules/tenancy/service';
import { PwaRegister } from '@/app/pwa-register';
import { AgencySidebar } from './components/agency-sidebar';
import { AgencyHeader } from './components/agency-header';

export default async function AgencyShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const context = await getUserContext(supabase, user.id);
  if (!context) {
    redirect('/login?error=user_not_found');
  }

  if (!context.agency.is_active) {
    redirect('/login?error=agency_suspended');
  }

  const branding = await getAgencyBranding(supabase, context.agency_id);

  return (
    <div className="min-h-screen bg-slate-950 flex font-sans">
      <PwaRegister />

      {/* Left Vertical Sidebar Navigation */}
      <AgencySidebar
        context={context}
        planTier={branding?.plan_tier || 'free'}
      />

      {/* Main Workspace (Scrollable Content Container) */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50/90 text-slate-900 min-h-screen overflow-x-hidden">
        {/* Top Header Bar */}
        <AgencyHeader />

        {/* Content Body */}
        <main className="flex-1 p-6 w-full max-w-7xl mx-auto">
          {children}
        </main>

        {/* Agency Footer: Rule A10 show_branding_footer enforcement */}
        <footer className="bg-white border-t border-slate-200/90 px-6 py-3 text-xs text-slate-500 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-700">
              {context.agency.name}
            </span>
            <span className="text-slate-300">•</span>
            <span className="font-mono-code text-[11px] text-slate-500">
              Agency Code: {context.agency.code}
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-emerald-700 font-medium text-[11px] flex items-center space-x-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Multi-Tenant RLS Active</span>
            </span>
          </div>

          {branding?.show_branding_footer ? (
            <div className="text-slate-400 font-medium text-[11px] flex items-center space-x-1">
              <span>Powered by</span>
              <span className="font-semibold text-slate-700">
                Vericlaim SaaS
              </span>
            </div>
          ) : (
            <div className="text-[10px] text-slate-300">
              White-label Enterprise
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
