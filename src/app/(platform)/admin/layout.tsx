import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyPlatformAdmin } from '@/modules/platform/service';

export default async function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const isPlatformAdmin = await verifyPlatformAdmin(supabase, user.id);
  if (!isPlatformAdmin) {
    // Agency users cannot view or reach super-admin
    redirect('/login?error=unauthorized_platform_access');
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Platform Super-Admin Top Nav */}
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="h-6 w-6 bg-red-600 rounded flex items-center justify-center font-bold text-xs text-white">
              S
            </span>
            <span className="font-bold text-sm tracking-wider uppercase text-white">
              Vericlaim Super-Admin
            </span>
          </div>
          <span className="text-xs px-2 py-0.5 bg-red-950 text-red-400 border border-red-800 rounded font-mono-code">
            PLATFORM ROOT
          </span>
        </div>

        <nav className="flex items-center space-x-6 text-xs font-semibold">
          <Link href="/admin" className="text-slate-300 hover:text-white transition">
            Agencies & Tenants
          </Link>
          <Link href="/admin/plans" className="text-slate-400 hover:text-white transition">
            Plans & Limits
          </Link>
          <Link href="/admin/audit" className="text-slate-400 hover:text-white transition">
            Audit Ledger
          </Link>
          <div className="h-4 w-px bg-slate-800" />
          <span className="text-slate-400 font-mono-code text-[11px]">{user.email}</span>
        </nav>
      </header>

      {/* Main Admin Content */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {children}
      </main>

      <footer className="bg-slate-950 border-t border-slate-800 px-6 py-3 text-xs text-slate-500 flex justify-between">
        <span>Platform Security Isolation Active</span>
        <span>Row Level Security (RLS) & Multi-Tenant Partitioning</span>
      </footer>
    </div>
  );
}
