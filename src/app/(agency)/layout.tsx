import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext, getAgencyBranding } from '@/modules/tenancy/service';
import { PwaRegister } from '@/app/pwa-register';

export default async function AgencyShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <PwaRegister />
      {/* Top Dense Nav Bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <span className="h-6 w-6 bg-blue-600 rounded flex items-center justify-center font-bold text-xs text-white">
              V
            </span>
            <span className="font-bold tracking-tight text-white text-sm">
              VERICLAIM
            </span>
          </div>

          <div className="h-4 w-px bg-slate-700" />

          {/* Agency Identification Badge */}
          <div className="flex items-center space-x-2">
            <span className="font-mono-code font-bold bg-slate-800 text-blue-300 px-2 py-0.5 rounded border border-slate-700">
              {context.agency.code}
            </span>
            <span className="font-medium text-slate-300 text-xs hidden sm:inline">
              {context.agency.name}
            </span>
          </div>
        </div>

        {/* Global Navigation Links */}
        <nav className="hidden md:flex items-center space-x-4 font-semibold text-slate-300 text-xs">
          <Link href="/dashboard" className="hover:text-white transition">
            Dashboard
          </Link>
          <Link href="/command-center" className="hover:text-white transition text-blue-400 font-bold">
            Command Center
          </Link>
          <Link href="/cases" className="hover:text-white transition">
            Cases
          </Link>
          <Link href="/investigator" className="hover:text-white transition text-emerald-400 font-bold">
            Field PWA
          </Link>
          <Link href="/masters/clients" className="hover:text-white transition">
            Masters
          </Link>
          <Link href="/reports" className="hover:text-white transition">
            Reports
          </Link>
          <Link href="/invoicing" className="hover:text-white transition text-amber-300 font-semibold">
            Invoicing & GST
          </Link>
          <Link href="/hardcopy" className="hover:text-white transition">
            Hardcopy
          </Link>
          <Link href="/finance" className="hover:text-white transition">
            Finance
          </Link>
          <Link href="/team" className="hover:text-white transition">
            Team
          </Link>
          <Link href="/settings" className="hover:text-white transition">
            Settings
          </Link>
          <Link href="/audit" className="hover:text-white transition">
            Audit
          </Link>
        </nav>

        {/* User Badge & Scope Indicator */}
        <div className="flex items-center space-x-3">
          <div className="text-right">
            <div className="font-medium text-white">{context.full_name}</div>
            <div className="text-[10px] text-slate-400 flex items-center justify-end space-x-1">
              <span className="font-mono-code uppercase">{context.roles[0] || 'User'}</span>
              <span>•</span>
              <span className="px-1 py-0.2 bg-slate-800 text-amber-300 font-mono-code rounded">
                SCOPE: {context.scope}
              </span>
            </div>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="text-slate-400 hover:text-white transition text-xs px-2 py-1 bg-slate-800 rounded hover:bg-slate-700"
            >
              Sign Out
            </button>
          </form>
        </div>
      </header>

      {/* Main Agency Workspace */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {children}
      </main>

      {/* Agency Footer: show_branding_footer enforcement */}
      <footer className="bg-white border-t border-slate-200 px-6 py-3 text-xs text-slate-500 flex items-center justify-between">
        <div>
          <span>{context.agency.name}</span>
          <span className="mx-2 text-slate-300">•</span>
          <span className="font-mono-code">GSTIN: Active</span>
        </div>

        {/* Branding Footer per A10 */}
        {branding?.show_branding_footer ? (
          <div className="text-slate-400 font-medium text-[11px] flex items-center space-x-1">
            <span>Powered by</span>
            <span className="font-semibold text-slate-600">Vericlaim SaaS</span>
          </div>
        ) : (
          <div className="text-[10px] text-slate-300">White-label Enterprise</div>
        )}
      </footer>
    </div>
  );
}
