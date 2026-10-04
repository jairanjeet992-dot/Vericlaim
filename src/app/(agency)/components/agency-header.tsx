'use client';

import React, { useState, useEffect, useRef } from 'react';
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
  Bell,
  Check,
  ExternalLink,
  X,
  FileText,
  CreditCard,
  Truck,
  User,
} from 'lucide-react';
import { useSidebar } from '@/components/sidebar-context';
import { ThemeToggle } from '@/components/theme-toggle';
import { SearchResultItem } from '@/modules/search/types';
import { NotificationRecord } from '@/modules/notifications/types';

export function AgencyHeader() {
  const router = useRouter();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const [time, setTime] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  // Notifications state
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

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

  // Fetch notifications periodically
  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setNotifications(json.data);
          const unread = json.data.filter((n: NotificationRecord) => !n.is_read).length;
          setUnreadCount(unread);
        }
      }
    } catch {
      // Quiet fail in background
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  // Click outside listener for dropdowns
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchDropdown(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Live search debounced
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=6`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setSearchResults(data.results || []);
            setShowSearchDropdown(true);
          }
        }
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setShowSearchDropdown(false);
      router.push(`/command-center?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleSelectResult = (item: SearchResultItem) => {
    setShowSearchDropdown(false);
    setSearchQuery('');
    if (item.entity_type === 'CASE') {
      router.push(`/cases/${item.entity_id}`);
    } else if (item.entity_type === 'INVOICE') {
      router.push(`/invoicing/${item.entity_id}`);
    } else if (item.entity_type === 'PAYMENT') {
      router.push(`/payments`);
    } else if (item.entity_type === 'COURIER_DOCKET') {
      router.push(`/hardcopy`);
    } else if (item.entity_type === 'INVESTIGATOR') {
      router.push(`/masters/investigators`);
    }
  };

  const markAllRead = async () => {
    try {
      const res = await fetch('/api/notifications/read-all', { method: 'POST' });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        setUnreadCount(0);
      }
    } catch {
      // Ignored
    }
  };

  const markSingleRead = async (id: string, actionUrl?: string | null) => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_ids: [id] }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      if (actionUrl) {
        setShowNotifications(false);
        router.push(actionUrl);
      }
    } catch {
      // Ignored
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
        <div ref={searchRef} className="relative w-80 max-w-full">
          <form onSubmit={handleSearchSubmit}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setShowSearchDropdown(true);
              }}
              placeholder="Search Claim #, Policy #, Insured... (Enter)"
              className="w-full pl-9 pr-14 py-1.5 bg-slate-100/80 dark:bg-slate-900/80 hover:bg-slate-100 dark:hover:bg-slate-900 focus:bg-white dark:focus:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl border border-slate-200/80 dark:border-slate-800 focus:border-blue-500 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition font-sans"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono-code font-semibold px-1 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-400 dark:text-slate-500 shadow-2xs">
              ↵
            </div>
          </form>

          {/* Real-time Global Search Dropdown */}
          {showSearchDropdown && (
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden z-50 py-1 max-h-96 overflow-y-auto">
              {isSearching ? (
                <div className="p-3 text-xs text-slate-400 text-center flex items-center justify-center space-x-1.5">
                  <div className="h-3 w-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <span>Searching across agency records...</span>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-3 text-xs text-slate-400 text-center">
                  No matching records found for &quot;{searchQuery}&quot;
                </div>
              ) : (
                <>
                  <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                    Results ({searchResults.length})
                  </div>
                  {searchResults.map((item) => (
                    <button
                      key={`${item.entity_type}-${item.entity_id}`}
                      onClick={() => handleSelectResult(item)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center justify-between text-xs transition border-b border-slate-50 dark:border-slate-800/40 last:border-none"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center space-x-1.5">
                          <EntityBadge type={item.entity_type} />
                          <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {item.title}
                          </span>
                          {item.doc_code && (
                            <span className="font-mono-code text-[11px] text-blue-600 dark:text-blue-400">
                              [{item.doc_code}]
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">{item.subtitle}</p>
                      </div>
                      <ExternalLink className="h-3 w-3 text-slate-400 shrink-0" />
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
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

      {/* Right side: Notifications, Dark Mode Toggle & Quick Action Buttons */}
      <div className="flex items-center space-x-2.5">
        {/* Notification Bell Dropdown */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 bg-slate-100/80 dark:bg-slate-900/80 hover:bg-slate-200/80 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-white/10 transition"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Notifications Dropdown Panel */}
          {showNotifications && (
            <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden">
              <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                <div className="flex items-center space-x-1.5">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.2 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 rounded text-[10px] font-semibold">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">No notifications yet</div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => markSingleRead(n.id, n.action_url)}
                      className={`p-3 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 transition ${
                        !n.is_read ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className={`font-semibold text-slate-800 dark:text-slate-200 ${!n.is_read ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                          {n.title}
                        </span>
                        {!n.is_read && (
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0 mt-1" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                        {n.message}
                      </p>
                      <span className="text-[9px] text-slate-400 mt-1 block">
                        {new Date(n.created_at).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

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

function EntityBadge({ type }: { type: string }) {
  if (type === 'CASE') {
    return (
      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 rounded text-[9px] font-bold">
        CASE
      </span>
    );
  }
  if (type === 'INVOICE') {
    return (
      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded text-[9px] font-bold">
        INV
      </span>
    );
  }
  if (type === 'PAYMENT') {
    return (
      <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded text-[9px] font-bold">
        PAY
      </span>
    );
  }
  if (type === 'COURIER_DOCKET') {
    return (
      <span className="px-1.5 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 rounded text-[9px] font-bold">
        AWB
      </span>
    );
  }
  if (type === 'INVESTIGATOR') {
    return (
      <span className="px-1.5 py-0.5 bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300 rounded text-[9px] font-bold">
        INV-R
      </span>
    );
  }
  return null;
}
