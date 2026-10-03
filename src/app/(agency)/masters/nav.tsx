'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function MastersNav() {
  const pathname = usePathname();

  const tabs = [
    { href: '/masters/clients', label: 'Clients & Branches (GSTIN)' },
    { href: '/masters/case-types', label: 'Case Types & Fields' },
    { href: '/masters/outcomes', label: 'Outcomes & Financial Rules' },
    { href: '/masters/sla', label: 'SLA Policies' },
    { href: '/masters/investigators', label: 'Investigators & Terms' },
  ];

  return (
    <div className="border-b border-slate-200 mb-6">
      <nav className="flex space-x-2 -mb-px overflow-x-auto text-xs font-medium">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`pb-2.5 px-3 border-b-2 whitespace-nowrap transition ${
                isActive
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
