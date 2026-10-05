'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Activity,
  FolderKanban,
  Smartphone,
  FileCheck2,
  Package,
  Receipt,
  CreditCard,
  Wallet,
  Building2,
  Settings2,
  Users2,
  ShieldCheck,
  BarChart3,
  ChevronRight,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  UploadCloud,
} from 'lucide-react';
import { useSidebar } from '@/components/sidebar-context';

interface AgencySidebarProps {
  context: {
    id: string;
    agency_id: string;
    agency: {
      code: string;
      name: string;
      is_active?: boolean;
    };
    full_name: string;
    roles: string[];
    scope: string;
  };
  planTier: string;
}

export function AgencySidebar({ context }: AgencySidebarProps) {
  const pathname = usePathname();
  const { isCollapsed, toggleSidebar } = useSidebar();

  const navGroups = [
    {
      group: 'OPERATIONS',
      items: [
        {
          label: 'Executive Dashboard',
          href: '/dashboard',
          icon: LayoutDashboard,
        },
        {
          label: 'Command Center',
          href: '/command-center',
          icon: Activity,
          badge: 'LIVE',
          badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        },
        {
          label: 'Case Intake & Roster',
          href: '/cases',
          icon: FolderKanban,
        },
        {
          label: 'Field Investigator (PWA)',
          href: '/investigator',
          icon: Smartphone,
          badge: 'MOBILE',
          badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        },
      ],
    },
    {
      group: 'QUALITY & EVIDENCE',
      items: [
        {
          label: 'Report Review & QC',
          href: '/reports',
          icon: FileCheck2,
        },
        {
          label: 'Hardcopy Logistics',
          href: '/hardcopy',
          icon: Package,
        },
        {
          label: 'Management Analytics',
          href: '/analytics',
          icon: BarChart3,
          badge: 'PHASE-9A',
          badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
        },
      ],
    },
    {
      group: 'FINANCE & TAXATION',
      items: [
        {
          label: 'Invoicing & GST Ledger',
          href: '/invoicing',
          icon: Receipt,
          badge: 'CA-VERIFY',
          badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        },
        {
          label: 'Payments, TDS & Recovery',
          href: '/payments',
          icon: CreditCard,
          badge: 'CA-VERIFY',
          badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        },
        {
          label: 'Investigator Payouts & SLA',
          href: '/investigator-finance',
          icon: Wallet,
          badge: 'PHASE-8',
          badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
        },
      ],
    },
    {
      group: 'MASTERS & GOVERNANCE',
      items: [
        {
          label: 'Clients & Branches',
          href: '/masters/clients',
          icon: Building2,
        },
        {
          label: 'Masters Registry',
          href: '/masters',
          icon: Settings2,
        },
        {
          label: 'Team Hierarchy',
          href: '/settings/team',
          icon: Users2,
        },
        {
          label: 'Legacy Import & Parity',
          href: '/import',
          icon: UploadCloud,
          badge: 'PHASE-9B',
          badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        },
        {
          label: 'Security & Audit Vault',
          href: '/audit',
          icon: ShieldCheck,
        },
      ],
    },
  ];

  return (
    <aside
      className={`glass sticky top-3 my-3 ml-3 h-[calc(100vh-24px)] flex flex-col select-none z-40 transition-all duration-300 ease-in-out shrink-0 ${
        isCollapsed ? 'w-16 p-2' : 'w-[242px] p-3'
      }`}
    >
      {/* Brand & Agency Header */}
      <div className={`flex items-center justify-between pb-3.5 border-b border-[var(--line)] ${isCollapsed ? 'px-1' : 'px-2'}`}>
        <div className="flex items-center space-x-2.5 min-w-0">
          <Link
            href="/dashboard"
            className="w-[34px] h-[34px] rounded-[11px] bg-gradient-to-br from-[#f3dba6] via-[#a8802f] to-[#6d511a] flex items-center justify-center font-bold text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),0_6px_14px_-4px_rgba(150,110,30,0.6)] shrink-0 transition-transform hover:scale-105"
            title="Vericlaim SaaS"
          >
            <span className="text-sm font-black text-[#2a1d05] drop-shadow-xs">V</span>
          </Link>
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="flex items-center space-x-1.5">
                <span className="text-[14px] font-bold tracking-tight text-[var(--txt)]">
                  Vericlaim
                </span>
                <span className="text-[9px] font-mono-code bg-[var(--glass2)] text-[var(--gold)] px-1.5 py-0.5 rounded-full border border-[var(--edge)] font-bold">
                  {context.agency.code}
                </span>
              </div>
              <div className="text-[11px] text-[var(--mut)] truncate max-w-[130px]" title={context.agency.name}>
                Agency console
              </div>
            </div>
          )}
        </div>

        {/* Quick Collapse Button inside Sidebar Header */}
        {!isCollapsed && (
          <button
            onClick={toggleSidebar}
            title="Collapse Sidebar"
            className="p-1.5 rounded-full text-[var(--mut)] hover:text-[var(--txt)] hover:bg-[var(--glass2)] transition"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Navigation Group Items */}
      <div className="flex-1 overflow-y-auto py-2.5 space-y-3.5 -mx-1 px-1">
        {navGroups.map((group, groupIdx) => (
          <div key={groupIdx} className="space-y-1">
            {!isCollapsed ? (
              <div className="px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-wider text-[var(--mut)] opacity-80">
                {group.group}
              </div>
            ) : (
              <div className="my-1.5 border-t border-[var(--line)] mx-1" />
            )}

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(item.href));

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={isCollapsed ? item.label : undefined}
                    className={`group relative flex items-center rounded-xl text-xs transition-all duration-200 ${
                      isCollapsed
                        ? 'justify-center p-2'
                        : 'justify-between px-2.5 py-2'
                    } ${
                      isActive
                        ? 'bg-[var(--glass2)] text-[var(--txt)] font-semibold shadow-[inset_0_1px_0_var(--edge),0_0_0_1px_var(--line)]'
                        : 'text-[var(--mut)] hover:text-[var(--txt)] hover:bg-[var(--glass2)] hover:translate-x-0.5'
                    }`}
                  >
                    <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-2.5 min-w-0'}`}>
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-colors duration-200 ${
                          isActive
                            ? 'text-[var(--gold)]'
                            : 'text-[var(--mut)] group-hover:text-[var(--txt)]'
                        }`}
                      />
                      {!isCollapsed && (
                        <span className="truncate">{item.label}</span>
                      )}
                    </div>

                    {!isCollapsed ? (
                      item.badge ? (
                        <span
                          className={`text-[9px] font-mono-code font-bold px-1.5 py-0.5 rounded-full border ${item.badgeColor}`}
                        >
                          {item.badge}
                        </span>
                      ) : isActive ? (
                        <ChevronRight className="h-3 w-3 text-[var(--gold)] shrink-0" />
                      ) : null
                    ) : item.badge ? (
                      <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom User Profile Card & Sign Out */}
      <div className="pt-2 border-t border-[var(--line)]">
        {!isCollapsed ? (
          <div className="p-2 rounded-2xl bg-[var(--glass2)] border border-[var(--line)] flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0">
              <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-[#3b63d6] to-[#b48a3c] flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-xs">
                {context.full_name?.charAt(0) || 'U'}
              </div>
              <div className="min-w-0 pr-1">
                <div className="text-[12px] font-semibold text-[var(--txt)] truncate leading-tight">
                  {context.full_name}
                </div>
                <div className="flex items-center space-x-1.5 mt-0.5">
                  <span className="text-[10px] text-[var(--mut)] capitalize">
                    {context.roles[0] || 'User'}
                  </span>
                  <span className="text-[var(--line)]">•</span>
                  <span className="text-[9px] font-mono-code text-[var(--gold)] font-bold">
                    {context.scope}
                  </span>
                </div>
              </div>
            </div>

            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                title="Sign Out"
                className="p-1.5 text-[var(--mut)] hover:text-[var(--bad)] hover:bg-[var(--glass)] rounded-full transition"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-2">
            <div
              className="h-8 w-8 rounded-full bg-gradient-to-tr from-[#3b63d6] to-[#b48a3c] flex items-center justify-center font-bold text-xs text-white shadow-xs cursor-pointer"
              title={`${context.full_name} (${context.roles[0] || 'User'})`}
              onClick={toggleSidebar}
            >
              {context.full_name?.charAt(0) || 'U'}
            </div>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                title="Sign Out"
                className="p-1.5 text-[var(--mut)] hover:text-[var(--bad)] hover:bg-[var(--glass)] rounded-full transition"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
