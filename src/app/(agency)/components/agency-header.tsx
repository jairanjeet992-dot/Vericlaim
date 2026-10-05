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
    <header className="glass sticky top-3 z-30 my-3 mx-3 sm:mx-4 px-4 py-2 flex items-center justify-between shadow-sm transition-all duration-300">
      {/* Left side: Sidebar Toggle & Search Input Bar */}
      <div className="flex items-center space-x-3 flex-1 max-w-xl">
        {/* Sidebar Collapse/Expand Toggle Button */}
        <button
          onClick={toggleSidebar}
          type="button"
          title={`Toggle Sidebar (Ctrl+B) - Currently ${isCollapsed ? 'Collapsed' : 'Expanded'}`}
          className="p-1.5 rounded-full text-[var(--mut)] hover:text-[var(--txt)] hover:bg-[var(--glass2)] border border-[var(--line)] transition-all duration-200 shrink-0"
          aria-label="Toggle Navigation Sidebar"
        >
          {isCollapsed ? (
            <PanelLeft className="h-4 w-4 text-[var(--ice)]" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>

        {/* Global Case Search Input Pill */}
        <div ref={searchRef} className="relative flex-1 max-w-md">
          <form onSubmit={handleSearchSubmit} className="relative flex items-center">
            <Search className="absolute left-3 h-3.5 w-3.5 text-[var(--mut)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setShowSearchDropdown(true);
              }}
              placeholder="Search case, claim, policy, UTR, AWB..."
              className="w-full pl-9 pr-14 py-1.5 bg-transparent text-xs text-[var(--txt)] placeholder:text-[var(--mut)] rounded-full focus:outline-none focus:ring-1 focus:ring-[var(--ice)] transition font-sans"
            />
            <div className="absolute right-2 text-[10px] font-mono-code font-semibold px-1.5 py-0.5 border border-[var(--line)] rounded-md text-[var(--mut)] shadow-2xs pointer-events-none">
              ⌘K
            </div>
          </form>

          {/* Real-time Global Search Dropdown */}
          {showSearchDropdown && (
            <div className="absolute left-0 right-0 top-full mt-2 glass rounded-2xl shadow-2xl overflow-hidden z-50 py-1.5 max-h-96 overflow-y-auto">
              {isSearching ? (
                <div className="p-3 text-xs text-[var(--mut)] text-center flex items-center justify-center space-x-1.5">
                  <div className="h-3 w-3 border-2 border-[var(--ice)] border-t-transparent rounded-full animate-spin" />
                  <span>Searching agency database...</span>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-3 text-xs text-[var(--mut)] text-center">
                  No matching records found for &quot;{searchQuery}&quot;
                </div>
              ) : (
                <>
                  <div className="px-3 py-1 text-[10px] font-bold text-[var(--mut)] uppercase tracking-wider border-b border-[var(--line)]">
                    Results ({searchResults.length})
                  </div>
                  {searchResults.map((item) => (
                    <button
                      key={`${item.entity_type}-${item.entity_id}`}
                      onClick={() => handleSelectResult(item)}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--glass2)] flex items-center justify-between text-xs transition border-b border-[var(--line)] last:border-none"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center space-x-1.5">
                          <EntityBadge type={item.entity_type} />
                          <span className="font-semibold text-[var(--txt)] truncate">
                            {item.title}
                          </span>
                          {item.doc_code && (
                            <span className="font-mono-code text-[11px] text-[var(--gold)] font-bold">
                              [{item.doc_code}]
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--mut)] truncate mt-0.5">{item.subtitle}</p>
                      </div>
                      <ExternalLink className="h-3 w-3 text-[var(--mut)] shrink-0" />
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Middle Operations Live Indicator (Hidden on mobile) */}
      <div className="hidden lg:flex items-center space-x-2 text-xs">
        <div className="flex items-center space-x-1.5 px-3 py-1 bg-[var(--glass2)] border border-[var(--line)] rounded-full text-[var(--mut)] font-mono-code text-[11px]">
          <Clock className="h-3 w-3 text-[var(--ice)]" />
          <span className="font-semibold text-[var(--txt)]">IST:</span>
          <span>{time || '--:--:--'}</span>
        </div>

        <div className="flex items-center space-x-1.5 px-3 py-1 bg-[var(--glass2)] border border-[var(--line)] rounded-full text-[var(--ok)] text-[11px] font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)] animate-pulse" />
          <span>Tenancy &amp; RLS Enforced</span>
        </div>
      </div>

      {/* Right side: Notifications, Dark Mode Toggle & Quick Action Buttons */}
      <div className="flex items-center space-x-2">
        {/* Notification Bell Dropdown */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-full text-[var(--mut)] hover:text-[var(--txt)] bg-[var(--glass2)] border border-[var(--line)] hover:bg-[var(--glass)] transition"
            title="Notifications"
          >
            <Bell className="h-3.5 w-3.5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 bg-[var(--bad)] text-white rounded-full text-[9px] font-bold flex items-center justify-center animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Notifications Dropdown Panel */}
          {showNotifications && (
            <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 glass rounded-2xl shadow-2xl z-50 overflow-hidden">
              <div className="p-3 border-b border-[var(--line)] flex items-center justify-between bg-[var(--glass2)]">
                <div className="flex items-center space-x-1.5">
                  <span className="text-xs font-bold text-[var(--txt)]">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.2 bg-[var(--ice)] text-white rounded-full text-[10px] font-semibold">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-[11px] text-[var(--ice)] hover:underline font-medium"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-[var(--line)]">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--mut)]">No notifications yet</div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => markSingleRead(n.id, n.action_url)}
                      className={`p-3 text-xs cursor-pointer hover:bg-[var(--glass2)] transition ${
                        !n.is_read ? 'bg-[var(--glass2)]' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className={`font-semibold ${!n.is_read ? 'text-[var(--ice)]' : 'text-[var(--txt)]'}`}>
                          {n.title}
                        </span>
                        {!n.is_read && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ice)] shrink-0 mt-1" />
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--mut)] mt-0.5 line-clamp-2">
                        {n.message}
                      </p>
                      <span className="text-[9px] text-[var(--mut)] mt-1 block">
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

        {/* Theme Switch */}
        <ThemeToggle />

        <Link
          href="/invoicing"
          className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 bg-[var(--glass2)] hover:bg-[var(--glass)] text-[var(--txt)] border border-[var(--line)] rounded-full text-xs font-semibold transition"
        >
          <Receipt className="h-3.5 w-3.5 text-[var(--gold)]" />
          <span>Invoice</span>
        </Link>

        <Link
          href="/cases"
          className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-gradient-to-r from-[#e9cd8d] to-[#b48a3c] text-[#2a1d05] rounded-full text-xs font-bold shadow-[0_6px_14px_-4px_rgba(180,138,60,0.6)] hover:brightness-105 transition"
        >
          <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
          <span>Intake</span>
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
