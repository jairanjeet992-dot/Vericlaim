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
  ChevronRight,
  LogOut,
  PanelLeftClose,
  PanelLeft,
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
          label: 'Security & Audit Vault',
          href: '/audit',
          icon: ShieldCheck,
        },
      ],
    },
  ];

  return (
    <aside
      className={`bg-slate-950/95 text-slate-300 border-r border-slate-800/80 dark:border-white/10 flex flex-col h-screen sticky top-0 select-none z-40 transition-all duration-300 ease-in-out ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Brand & Agency Header */}
      <div className="p-3.5 border-b border-slate-800/80 dark:border-white/10 bg-slate-950/60 backdrop-blur flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <Link
            href="/dashboard"
            className="h-9 w-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-indigo-500 flex items-center justify-center font-black text-white shadow-lg shadow-blue-500/20 ring-1 ring-white/20 shrink-0"
            title="Vericlaim SaaS"
          >
            V
          </Link>
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="flex items-center space-x-1.5">
                <span className="text-sm font-black tracking-tight text-white">
                  VERICLAIM
                </span>
                <span className="text-[9px] font-mono-code bg-blue-500/20 text-blue-400 px-1 py-0.2 rounded border border-blue-500/30 font-bold">
                  {context.agency.code}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 truncate max-w-[130px]" title={context.agency.name}>
                {context.agency.name}
              </div>
            </div>
          )}
        </div>

        {/* Quick Collapse Button inside Sidebar Header */}
        {!isCollapsed && (
          <button
            onClick={toggleSidebar}
            title="Collapse Sidebar (Ctrl+B)"
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation Group Items */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {navGroups.map((group, groupIdx) => (
          <div key={groupIdx} className="space-y-1">
            {!isCollapsed ? (
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {group.group}
              </div>
            ) : (
              <div className="my-2 border-t border-slate-800/80 mx-1" />
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
                        ? 'justify-center p-2.5'
                        : 'justify-between px-2.5 py-2'
                    } ${
                      isActive
                        ? 'bg-gradient-to-r from-blue-600/20 via-blue-500/10 to-transparent text-white font-semibold border-l-2 border-blue-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                    }`}
                  >
                    <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-2.5 min-w-0'}`}>
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-105 ${
                          isActive
                            ? 'text-blue-400'
                            : 'text-slate-500 group-hover:text-slate-300'
                        }`}
                      />
                      {!isCollapsed && (
                        <span className="truncate">{item.label}</span>
                      )}
                    </div>

                    {!isCollapsed ? (
                      item.badge ? (
                        <span
                          className={`text-[9px] font-mono-code font-bold px-1.5 py-0.5 rounded border ${item.badgeColor}`}
                        >
                          {item.badge}
                        </span>
                      ) : isActive ? (
                        <ChevronRight className="h-3 w-3 text-blue-400 shrink-0" />
                      ) : null
                    ) : item.badge ? (
                      <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-slate-950" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom User Profile Card & Sign Out */}
      <div className="p-2 border-t border-slate-800/80 dark:border-white/10 bg-slate-950/80">
        {!isCollapsed ? (
          <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center space-x-2.5 min-w-0">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-600 flex items-center justify-center font-bold text-xs text-white shadow-inner shrink-0">
                {context.full_name?.charAt(0) || 'U'}
              </div>
              <div className="min-w-0 pr-1">
                <div className="text-xs font-semibold text-white truncate leading-tight">
                  {context.full_name}
                </div>
                <div className="flex items-center space-x-1.5 mt-0.5">
                  <span className="text-[10px] text-slate-400 capitalize">
                    {context.roles[0] || 'User'}
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="text-[9px] font-mono-code bg-slate-800 text-amber-300 px-1 py-0.2 rounded border border-slate-700">
                    {context.scope}
                  </span>
                </div>
              </div>
            </div>

            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                title="Sign Out"
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-2">
            <div
              className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-xs text-white shadow-inner cursor-pointer"
              title={`${context.full_name} (${context.roles[0] || 'User'})`}
              onClick={toggleSidebar}
            >
              {context.full_name?.charAt(0) || 'U'}
            </div>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                title="Sign Out"
                className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-900 rounded-lg transition"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
