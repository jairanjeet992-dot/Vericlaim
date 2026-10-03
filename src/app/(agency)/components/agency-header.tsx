'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  Plus,
  Clock,
  CheckCircle2,
  Receipt,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { useSidebar } from '@/components/sidebar-context';
import { ThemeToggle } from '@/components/theme-toggle';

export function AgencyHeader() {
  const router = useRouter();
  const { isCollapsed, toggleSidebar } = useSidebar();
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
      router.push(`/command-center?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <header className="bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/10 h-14 px-4 md:px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs transition-colors duration-200">
      {/* Left side: Sidebar Toggle & Search Input Bar */}
      <div className="flex items-center space-x-3 flex-1 max-w-xl">
        {/* Sidebar Collapse/Expand Toggle Button */}
        <button
          onClick={toggleSidebar}
          type="button"
          title={`Toggle Sidebar (Ctrl+B) - Currently ${isCollapsed ? 'Collapsed' : 'Expanded'}`}
          className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 bg-slate-100/80 dark:bg-slate-900/80 hover:bg-slate-200/80 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-white/10 transition-all duration-200 shrink-0"
          aria-label="Toggle Navigation Sidebar"
        >
          {isCollapsed ? (
            <PanelLeft className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>

        {/* Global Case Search Input */}
        <form onSubmit={handleSearchSubmit} className="relative w-80 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Claim #, Policy #, Insured... (Enter)"
            className="w-full pl-9 pr-14 py-1.5 bg-slate-100/80 dark:bg-slate-900/80 hover:bg-slate-100 dark:hover:bg-slate-900 focus:bg-white dark:focus:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl border border-slate-200/80 dark:border-slate-800 focus:border-blue-500 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition font-sans"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono-code font-semibold px-1 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-400 dark:text-slate-500 shadow-2xs">
            ↵
          </div>
        </form>
      </div>

      {/* Middle Operations Live Indicator (Hidden on mobile) */}
      <div className="hidden lg:flex items-center space-x-3 text-xs">
        <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-slate-50/90 dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-800/90 rounded-lg text-slate-600 dark:text-slate-300 font-mono-code text-[11px] shadow-2xs">
          <Clock className="h-3 w-3 text-blue-600 dark:text-blue-400" />
          <span className="font-semibold text-slate-700 dark:text-slate-200">IST:</span>
          <span>{time || '--:--:--'}</span>
        </div>

        <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-emerald-50/90 dark:bg-emerald-950/60 border border-emerald-200/90 dark:border-emerald-800/80 rounded-lg text-emerald-700 dark:text-emerald-400 text-[11px] font-medium shadow-2xs">
          <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          <span>Tenancy & RLS Enforced</span>
        </div>
      </div>

      {/* Right side: Dark Mode Toggle & Quick Action Buttons */}
      <div className="flex items-center space-x-2.5">
        {/* Luxury Dark Mode Switch */}
        <ThemeToggle />

        <Link
          href="/invoicing"
          className="btn-3d flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100/80 dark:hover:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-300/80 dark:border-amber-700/60 rounded-xl text-xs font-semibold transition"
        >
          <Receipt className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
          <span className="hidden sm:inline">New Invoice</span>
        </Link>

        <Link
          href="/cases"
          className="btn-3d flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm shadow-blue-500/25 transition"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Intake Case</span>
        </Link>
      </div>
    </header>
  );
}
