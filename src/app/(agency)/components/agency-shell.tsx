'use client';

import React from 'react';
import { SidebarProvider, useSidebar } from '@/components/sidebar-context';
import { AgencySidebar } from './agency-sidebar';
import { AgencyHeader } from './agency-header';

interface AgencyShellProps {
  context: any;
  planTier: string;
  branding: any;
  children: React.ReactNode;
}

function AgencyShellContent({
  context,
  planTier,
  branding,
  children,
}: AgencyShellProps) {
  const { isCollapsed } = useSidebar();

  return (
    <div className="min-h-screen bg-slate-950 flex font-sans selection:bg-blue-600 selection:text-white">
      {/* Left Vertical Sidebar Navigation */}
      <AgencySidebar
        context={context}
        planTier={planTier}
      />

      {/* Main Workspace (Expands smoothly when sidebar collapses) */}
      <div
        className={`flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen overflow-x-hidden transition-all duration-300 ${
          isCollapsed ? 'ml-0' : 'ml-0'
        }`}
      >
        {/* Top Header Bar with Theme Toggle & Sidebar Trigger */}
        <AgencyHeader />

        {/* Content Body */}
        <main className="flex-1 p-4 md:p-6 w-full max-w-[1700px] mx-auto transition-all duration-300">
          {children}
        </main>

        {/* Agency Footer: Rule A10 show_branding_footer enforcement */}
        <footer className="bg-white/80 dark:bg-slate-900/80 backdrop-blur border-t border-slate-200/90 dark:border-slate-800/90 px-6 py-3 text-xs text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {context.agency.name}
            </span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span className="font-mono-code text-[11px] text-slate-500 dark:text-slate-400">
              Agency Code: {context.agency.code}
            </span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-medium text-[11px] flex items-center space-x-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Multi-Tenant RLS Active</span>
            </span>
          </div>

          {branding?.show_branding_footer ? (
            <div className="text-slate-400 dark:text-slate-500 font-medium text-[11px] flex items-center space-x-1.5">
              <span>Powered by</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Vericlaim SaaS
              </span>
            </div>
          ) : (
            <div className="text-[10px] text-slate-300 dark:text-slate-700">
              White-label Enterprise
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

export function AgencyShell(props: AgencyShellProps) {
  return (
    <SidebarProvider>
      <AgencyShellContent {...props} />
    </SidebarProvider>
  );
}
