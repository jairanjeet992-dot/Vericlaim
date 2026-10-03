'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  Plus,
  Clock,
  CheckCircle2,
  FileSpreadsheet,
  Receipt,
  Bell,
  Sparkles,
  Shield,
} from 'lucide-react';

export function AgencyHeader() {
  const router = useRouter();
  const [time, setTime] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/command-center?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <header className="bg-white/85 backdrop-blur-md border-b border-slate-200/90 h-14 px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
      {/* Search Input Bar */}
      <form onSubmit={handleSearchSubmit} className="relative w-80 max-w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search Claim #, Policy #, Insured... (Enter)"
          className="w-full pl-9 pr-14 py-1.5 bg-slate-100/80 hover:bg-slate-100 focus:bg-white text-xs text-slate-800 placeholder:text-slate-400 rounded-lg border border-slate-200/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition font-sans"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono-code font-semibold px-1 py-0.5 bg-white border border-slate-200 rounded text-slate-400 shadow-2xs">
          ↵
        </div>
      </form>

      {/* Middle Operations Live Indicator */}
      <div className="hidden lg:flex items-center space-x-4 text-xs">
        <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-600 font-mono-code text-[11px]">
          <Clock className="h-3 w-3 text-blue-600 animate-spin-slow" />
          <span className="font-semibold text-slate-700">IST:</span>
          <span>{time || '--:--:--'}</span>
        </div>

        <div className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-50 border border-emerald-200/80 rounded-md text-emerald-700 text-[11px] font-medium">
          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
          <span>RLS & Tenancy Active</span>
        </div>
      </div>

      {/* Quick Action Buttons */}
      <div className="flex items-center space-x-2.5">
        <Link
          href="/invoicing"
          className="btn-3d flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100/80 text-amber-800 border border-amber-300 rounded-lg text-xs font-semibold transition"
        >
          <Receipt className="h-3.5 w-3.5 text-amber-700" />
          <span>New Invoice</span>
        </Link>

        <Link
          href="/cases"
          className="btn-3d flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Intake Case</span>
        </Link>
      </div>
    </header>
  );
}
