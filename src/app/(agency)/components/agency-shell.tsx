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
    <div className="min-h-screen bg-[var(--bg)] text-[var(--txt)] flex font-sans selection:bg-[#4b7bec] selection:text-white relative">
      {/* Aurora Ambient Blurred Background */}
      <div className="aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      {/* Left Vertical Sidebar Navigation */}
      <AgencySidebar
        context={context}
        planTier={planTier}
      />

      {/* Main Workspace (Expands smoothly when sidebar collapses) */}
      <div
        className={`flex-1 flex flex-col min-w-0 text-[var(--txt)] min-h-screen overflow-x-hidden transition-all duration-300 ${
          isCollapsed ? 'ml-0' : 'ml-0'
        }`}
      >
        {/* Top Header Bar with Theme Toggle & Sidebar Trigger */}
        <AgencyHeader />

        {/* Content Body */}
        <main className="flex-1 p-3 sm:p-5 w-full max-w-[1700px] mx-auto transition-all duration-300">
          {children}
        </main>

        {/* Agency Footer: Rule A10 show_branding_footer enforcement */}
        <footer className="glass border-t border-[var(--edge)] mx-4 mb-3 px-6 py-2.5 text-xs text-[var(--mut)] flex flex-col sm:flex-row items-center justify-between gap-2 rounded-2xl shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--txt)]">
              {context.agency.name}
            </span>
            <span className="text-[var(--line)]">•</span>
            <span className="font-mono-code text-[11px] text-[var(--mut)]">
              Agency Code: {context.agency.code}
            </span>
            <span className="text-[var(--line)]">•</span>
            <span className="text-[var(--ok)] font-medium text-[11px] flex items-center space-x-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)] animate-pulse" />
              <span>Multi-Tenant RLS Active</span>
            </span>
          </div>

          {branding?.show_branding_footer ? (
            <div className="text-[var(--mut)] font-medium text-[11px] flex items-center space-x-1.5">
              <span>Powered by</span>
              <span className="font-semibold text-[var(--txt)]">
                Vericlaim SaaS
              </span>
            </div>
          ) : (
            <div className="text-[10px] text-[var(--mut)]">
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
