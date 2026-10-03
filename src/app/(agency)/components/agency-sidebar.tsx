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
  Building2,
  Settings2,
  Users2,
  ShieldCheck,
  LogOut,
  ChevronRight,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

interface AgencySidebarProps {
  context: {
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

export function AgencySidebar({ context, planTier }: AgencySidebarProps) {
  const pathname = usePathname();

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
    <aside className="w-64 bg-slate-950 text-slate-300 border-r border-slate-800/80 flex flex-col h-screen sticky top-0 select-none z-40">
      {/* Brand & Agency Header */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur">
        <div className="flex items-center space-x-2.5">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-blue-700 to-indigo-500 flex items-center justify-center font-black text-white shadow-lg shadow-blue-500/20 ring-1 ring-white/20">
            V
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-extrabold text-sm tracking-tight text-white">
                VERICLAIM
              </span>
              <span className="text-[9px] px-1.5 py-0.2 bg-blue-500/20 text-blue-400 font-mono-code font-bold rounded border border-blue-500/30">
                PRO
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-medium">
              Insurance Investigation SaaS
            </p>
          </div>
        </div>

        {/* Active Agency Card */}
        <div className="mt-3.5 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <div className="flex items-center space-x-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-bold text-white truncate block">
                {context.agency.name}
              </span>
            </div>
            <div className="flex items-center space-x-1 mt-0.5">
              <span className="text-[9px] font-mono-code font-bold text-blue-400 bg-blue-950/80 px-1 py-0.2 rounded border border-blue-800/50">
                {context.agency.code}
              </span>
              <span className="text-[10px] text-slate-400">Tenant #1</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[9px] font-mono-code px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded font-semibold border border-slate-700">
              {planTier.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Vertical Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navGroups.map((group) => (
          <div key={group.group} className="space-y-1">
            <div className="px-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              {group.group}
            </div>
            <div className="space-y-0.5 mt-1">
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(item.href));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-blue-600/15 text-white font-semibold border-l-2 border-blue-500 shadow-sm shadow-blue-500/5'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 truncate">
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-colors ${
                          isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </div>

                    {item.badge ? (
                      <span
                        className={`text-[9px] font-mono-code font-bold px-1.5 py-0.5 rounded border ${item.badgeColor}`}
                      >
                        {item.badge}
                      </span>
                    ) : isActive ? (
                      <ChevronRight className="h-3 w-3 text-blue-400 shrink-0" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* User Card & Sign Out */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/80">
        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-xs text-white shadow-inner shrink-0">
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
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-md transition"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
