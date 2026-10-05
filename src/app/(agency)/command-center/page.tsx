'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Search,
  Check,
  AlertTriangle,
  Clock,
  ShieldCheck,
  ArrowRight,
  ExternalLink,
  Plus,
  RefreshCw,
  X,
  FileCheck2,
  Send,
  UserCheck,
  Download,
} from 'lucide-react';

interface CaseItem {
  id: string;
  doc_code: string;
  claim_no: string;
  policy_no: string;
  insured_name: string;
  location_city?: string;
  location_state?: string;
  risk_level: string;
  status: string;
  rework_count: number;
  due_date?: string;
  created_at: string;
  clients?: { name: string; code: string };
  case_types?: { name: string; code: string };
}

interface TileMetric {
  key: string;
  label: string;
  count: number;
  color: string;
  category: string;
}

function CommandCenterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // View state: 'desk' (Back office) or 'mob' (Investigator mobile stage)
  const [viewMode, setViewMode] = useState<'desk' | 'mob'>('desk');

  // Core Data
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [tiles, setTiles] = useState<TileMetric[]>([]);
  const [loading, setLoading] = useState(true);

  // Active Stage Filter
  const [activeStage, setActiveStage] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);

  // Slide-over Sheet Details
  const [sheetCase, setSheetCase] = useState<CaseItem | null>(null);

  // Quick Command Palette (⌘K)
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const paletteInputRef = useRef<HTMLInputElement>(null);

  // 3D Tilt refs
  const heroCardRef = useRef<HTMLDivElement>(null);

  // Fetch metrics & cases
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [casesRes, tilesRes] = await Promise.all([
        fetch('/api/command-center/cases?pageSize=50'),
        fetch('/api/command-center/metrics'),
      ]);

      if (casesRes.ok) {
        const cData = await casesRes.json();
        if (cData.success) {
          setCases(cData.cases || []);
        }
      }

      if (tilesRes.ok) {
        const tData = await tilesRes.json();
        if (tData.success) {
          setTiles(tData.data || []);
        }
      }
    } catch (e) {
      console.error('Failed to load command center data', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sync URL search params
  useEffect(() => {
    const q = searchParams.get('q') || searchParams.get('search');
    if (q) setSearchQuery(q);
  }, [searchParams]);

  // 3D Tilt mouse interaction for hero
  useEffect(() => {
    const card = heroCardRef.current;
    if (!card) return;

    const handlePointerMove = (e: PointerEvent) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      card.classList.add('live');
      card.style.setProperty('--ry', `${(x - 0.5) * 10}deg`);
      card.style.setProperty('--rx', `${(0.5 - y) * 8}deg`);
      card.style.setProperty('--mx', `${x * 100}%`);
      card.style.setProperty('--my', `${y * 100}%`);
      card.style.setProperty('--gl', '1');
    };

    const handlePointerLeave = () => {
      card.classList.remove('live');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
      card.style.setProperty('--gl', '0');
    };

    card.addEventListener('pointermove', handlePointerMove);
    card.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      card.removeEventListener('pointermove', handlePointerMove);
      card.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, []);

  // Keyboard shortcut listener (⌘K / Ctrl+K and Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowPalette((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setShowPalette(false);
        setSheetCase(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (showPalette) {
      setTimeout(() => paletteInputRef.current?.focus(), 60);
    }
  }, [showPalette]);

  // Filter cases by active stage pill and search text
  const filteredCases = cases.filter((c) => {
    // Stage filtering
    if (activeStage === 'new' && c.status !== 'DATA_ENTRY') return false;
    if (activeStage === 'verify' && c.status !== 'VERIFICATION') return false;
    if (activeStage === 'assign' && c.status !== 'ASSIGNMENT') return false;
    if (activeStage === 'field' && c.status !== 'FIELD_INVESTIGATION') return false;
    if (activeStage === 'review' && c.status !== 'REPORT_REVIEW') return false;
    if (activeStage === 'fix' && c.status !== 'ESCALATED_REVIEW' && c.rework_count === 0) return false;
    if (activeStage === 'bill' && c.status !== 'APPROVED' && c.status !== 'BILLED') return false;

    // Search query filtering
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        c.doc_code?.toLowerCase().includes(q) ||
        c.claim_no?.toLowerCase().includes(q) ||
        c.policy_no?.toLowerCase().includes(q) ||
        c.insured_name?.toLowerCase().includes(q) ||
        c.clients?.name?.toLowerCase().includes(q) ||
        c.location_city?.toLowerCase().includes(q);
      if (!match) return false;
    }

    return true;
  });

  // Calculate dynamic SLA counts
  const breachedCount = cases.filter((c) => {
    if (!c.due_date) return false;
    return new Date(c.due_date).getTime() < Date.now();
  }).length;

  const approachingCount = cases.filter((c) => {
    if (!c.due_date) return false;
    const diffHours = (new Date(c.due_date).getTime() - Date.now()) / (1000 * 3600);
    return diffHours > 0 && diffHours <= 24;
  }).length;

  const onTimeCount = Math.max(0, cases.length - breachedCount - approachingCount);
  const onTimePct = cases.length > 0 ? Math.round((onTimeCount / cases.length) * 100) : 100;
  const approachingPct = cases.length > 0 ? Math.round((approachingCount / cases.length) * 100) : 0;
  const breachedPct = cases.length > 0 ? Math.round((breachedCount / cases.length) * 100) : 0;

  const awaitingReviewCount = cases.filter((c) => c.status === 'REPORT_REVIEW').length;
  const readyToBillCount = cases.filter((c) => c.status === 'APPROVED').length;

  // Toggle selection
  const toggleSelectCase = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedCaseIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedCaseIds(filteredCases.map((c) => c.id));
    } else {
      setSelectedCaseIds([]);
    }
  };

  // Stage Pipeline configuration
  const stages = [
    { id: 'all', label: 'All open', count: cases.length },
    { id: 'new', label: 'New', count: cases.filter((c) => c.status === 'DATA_ENTRY').length },
    { id: 'verify', label: 'Verification', count: cases.filter((c) => c.status === 'VERIFICATION').length },
    { id: 'assign', label: 'Assignment', count: cases.filter((c) => c.status === 'ASSIGNMENT').length },
    { id: 'field', label: 'Investigation', count: cases.filter((c) => c.status === 'FIELD_INVESTIGATION').length },
    { id: 'review', label: 'Review', count: cases.filter((c) => c.status === 'REPORT_REVIEW').length },
    { id: 'fix', label: 'Corrections', count: cases.filter((c) => c.rework_count > 0).length },
    { id: 'bill', label: 'Ready to bill', count: cases.filter((c) => c.status === 'APPROVED').length },
  ];

  // Helper for SLA badge presentation
  const getSlaBadge = (dueDate?: string) => {
    if (!dueDate) return { label: 'No SLA', cls: 'mu' };
    const diff = new Date(dueDate).getTime() - Date.now();
    const hours = Math.round(diff / (1000 * 3600));

    if (hours < 0) {
      return { label: `Breached ${Math.abs(hours)}h`, cls: 'bad' };
    }
    if (hours <= 12) {
      return { label: `${hours}h left`, cls: 'warn' };
    }
    return { label: `${hours}h left`, cls: 'ok' };
  };

  // Helper for Status Badge presentation
  const getStatusBadge = (status: string, reworkCount: number) => {
    if (reworkCount > 0) {
      return { label: `Sent back · ${reworkCount}`, cls: 'bad' };
    }
    switch (status) {
      case 'DATA_ENTRY':
        return { label: 'New', cls: 'mu' };
      case 'VERIFICATION':
        return { label: 'Verification', cls: 'mu' };
      case 'ASSIGNMENT':
        return { label: 'Assign', cls: 'info' };
      case 'FIELD_INVESTIGATION':
        return { label: 'In investigation', cls: 'info' };
      case 'REPORT_REVIEW':
        return { label: 'In review', cls: 'warn' };
      case 'APPROVED':
        return { label: 'Approved', cls: 'ok' };
      case 'BILLED':
        return { label: 'Billed', cls: 'ok' };
      default:
        return { label: status, cls: 'mu' };
    }
  };

  // Helper for Age string
  const getAgeString = (created: string) => {
    const hours = Math.max(1, Math.round((Date.now() - new Date(created).getTime()) / (1000 * 3600)));
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  };

  return (
    <div className="space-y-4">
      {/* Top Segmented Control & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Apple Segmented Switch: Back office vs Investigator */}
        <div className="seg2 w-fit">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'desk'}
            onClick={() => setViewMode('desk')}
          >
            Back office
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'mob'}
            onClick={() => setViewMode('mob')}
          >
            Investigator Terminal
          </button>
        </div>

        {/* Quick Launch & Refresh */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowPalette(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 glass rounded-full text-xs text-[var(--mut)] hover:text-[var(--txt)] transition"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Quick jump</span>
            <kbd className="text-[10px] font-mono border border-[var(--line)] px-1 py-0.2 rounded">⌘K</kbd>
          </button>

          <button
            onClick={fetchData}
            title="Refresh pipeline"
            className="p-1.5 glass rounded-full text-[var(--mut)] hover:text-[var(--txt)] transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <Link
            href="/cases"
            className="flex items-center space-x-1 px-3 py-1.5 bg-gradient-to-r from-[#e9cd8d] to-[#b48a3c] text-[#2a1d05] rounded-full text-xs font-bold shadow-[0_6px_14px_-4px_rgba(180,138,60,0.6)] hover:brightness-105 transition"
          >
            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>Intake</span>
          </Link>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* DESKTOP BACK OFFICE VIEW                                                  */}
      {/* ========================================================================= */}
      {viewMode === 'desk' && (
        <section className="space-y-4">
          {/* Hero Banner with 3D Tilt + Apple SLA Rings + Sparkline Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left 6 cols: Greeting & Interactive SLA Progress Rings */}
            <div
              ref={heroCardRef}
              className="lg:col-span-6 glass tilt p-6 flex flex-col justify-between"
            >
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[var(--txt)]">
                  Operations Overview
                </h1>
                <p className="text-xs text-[var(--mut)] mt-1 max-w-[34ch]">
                  {breachedCount > 0
                    ? `${breachedCount} cases are past SLA. ${awaitingReviewCount} reports waiting for approval.`
                    : `All dockets compliant. ${awaitingReviewCount} reports waiting for QC.`}
                </p>
              </div>

              <div className="rings mt-6">
                {/* On Time Ring */}
                <div className="ring" style={{ '--p': onTimePct / 100 } as React.CSSProperties}>
                  <svg viewBox="0 0 60 60">
                    <circle className="t" cx="30" cy="30" r="26" />
                    <circle className="v" cx="30" cy="30" r="26" stroke="var(--ok)" />
                  </svg>
                  <b>{onTimeCount}</b>
                  <span>On time</span>
                </div>

                {/* Approaching Ring */}
                <div className="ring" style={{ '--p': approachingPct / 100 } as React.CSSProperties}>
                  <svg viewBox="0 0 60 60">
                    <circle className="t" cx="30" cy="30" r="26" />
                    <circle className="v" cx="30" cy="30" r="26" stroke="var(--warn)" />
                  </svg>
                  <b>{approachingCount}</b>
                  <span>Approaching</span>
                </div>

                {/* Breached Ring */}
                <div className="ring" style={{ '--p': breachedPct / 100 } as React.CSSProperties}>
                  <svg viewBox="0 0 60 60">
                    <circle className="t" cx="30" cy="30" r="26" />
                    <circle className="v" cx="30" cy="30" r="26" stroke="var(--bad)" />
                  </svg>
                  <b>{breachedCount}</b>
                  <span>Breached</span>
                </div>
              </div>
            </div>

            {/* Middle 3 cols: Awaiting Approval KPI Card */}
            <div className="lg:col-span-3 glass k">
              <small>Awaiting QC Review</small>
              <div className="n">{awaitingReviewCount}</div>
              <svg className="spk" viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 26 C16 24 20 12 34 16 S56 30 70 18 S96 6 118 10" />
              </svg>
              <div className="d">
                Oldest in queue: <b>2 days</b>
              </div>
            </div>

            {/* Right 3 cols: Ready to Bill KPI Card */}
            <div className="lg:col-span-3 glass k">
              <small>Ready to Bill</small>
              <div className="n">{readyToBillCount}</div>
              <svg className="spk" viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 28 C20 30 26 20 42 22 S66 8 82 14 S102 4 118 6" />
              </svg>
              <div className="d">
                Scope: <b>Star Health, ICICI, Care</b>
              </div>
            </div>
          </div>

          {/* Sliding Pipeline Stage Selector */}
          <div className="pipe glass" role="group" aria-label="Lifecycle Stage">
            {stages.map((stage) => (
              <button
                key={stage.id}
                type="button"
                aria-pressed={activeStage === stage.id}
                onClick={() => setActiveStage(stage.id)}
                className={`transition-all ${
                  activeStage === stage.id ? 'bg-[var(--glass2)] shadow-[inset_0_1px_0_var(--edge)] font-bold' : ''
                }`}
              >
                <b>{stage.count}</b>
                <span>{stage.label}</span>
              </button>
            ))}
          </div>

          {/* Status Glow Flags / Chips */}
          <div className="flags">
            <span className="chip" style={{ '--c': 'var(--bad)' } as React.CSSProperties}>
              <i />
              <span>{breachedCount} SLA breached</span>
            </span>
            <span className="chip" style={{ '--c': 'var(--warn)' } as React.CSSProperties}>
              <i />
              <span>{approachingCount} approaching</span>
            </span>
            <span className="chip" style={{ '--c': 'var(--info)' } as React.CSSProperties}>
              <i />
              <span>{cases.filter((c) => c.status === 'ASSIGNMENT').length} unassigned dockets</span>
            </span>
            <span className="chip" style={{ '--c': 'var(--gold)' } as React.CSSProperties}>
              <i />
              <span>{cases.filter((c) => c.rework_count > 0).length} rework send-backs</span>
            </span>
          </div>

          {/* Clean Apple Case Table List */}
          <div className="glass overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[960px] p-2">
                {/* Table Header */}
                <div className="row hd border-b border-[var(--line)]">
                  <span>
                    <input
                      type="checkbox"
                      className="ck"
                      aria-label="Select all cases"
                      onChange={selectAll}
                      checked={
                        filteredCases.length > 0 &&
                        selectedCaseIds.length === filteredCases.length
                      }
                    />
                  </span>
                  <span>Doc Code</span>
                  <span>Claim and Insured</span>
                  <span>Company</span>
                  <span>Type</span>
                  <span>Location</span>
                  <span>Status</span>
                  <span>SLA</span>
                  <span>Age</span>
                </div>

                {/* Table Body Rows */}
                {loading ? (
                  <div className="py-12 text-center text-xs text-[var(--mut)]">
                    Loading agency cases...
                  </div>
                ) : filteredCases.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[var(--mut)]">
                    No cases match the selected stage filter.
                  </div>
                ) : (
                  filteredCases.map((c) => {
                    const sla = getSlaBadge(c.due_date);
                    const st = getStatusBadge(c.status, c.rework_count);
                    const isSelected = selectedCaseIds.includes(c.id);

                    return (
                      <div
                        key={c.id}
                        onClick={() => setSheetCase(c)}
                        className={`row ${isSelected ? 'chk' : ''}`}
                      >
                        {/* Checkbox */}
                        <span onClick={(e) => toggleSelectCase(c.id, e)}>
                          <input
                            type="checkbox"
                            className="ck"
                            checked={isSelected}
                            readOnly
                            aria-label={`Select ${c.doc_code}`}
                          />
                        </span>

                        {/* Doc Code */}
                        <span className="font-mono-code font-bold text-xs text-[var(--txt)]">
                          {c.doc_code}
                        </span>

                        {/* Claim & Insured */}
                        <span className="min-w-0 pr-2">
                          <span className="font-semibold block truncate text-xs text-[var(--txt)]">
                            {c.claim_no || 'Pending Claim'}
                          </span>
                          <span className="sub text-[11px] text-[var(--mut)] truncate">
                            {c.insured_name}
                          </span>
                        </span>

                        {/* Company */}
                        <span className="text-xs text-[var(--txt)] truncate">
                          {c.clients?.name || 'Insurer'}
                        </span>

                        {/* Case Type */}
                        <span className="text-xs text-[var(--mut)]">
                          {c.case_types?.name || 'Standard'}
                        </span>

                        {/* Location */}
                        <span className="text-xs text-[var(--mut)] truncate">
                          {c.location_city || 'Regional'}
                        </span>

                        {/* Status Badge */}
                        <span>
                          <span className={`bd ${st.cls}`}>{st.label}</span>
                        </span>

                        {/* SLA Indicator */}
                        <span>
                          <span className={`sla ${sla.cls}`}>{sla.label}</span>
                        </span>

                        {/* Age */}
                        <span className="text-xs text-[var(--mut)] font-mono-code">
                          {getAgeString(c.created_at)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* 3D iPHONE STAGE: INVESTIGATOR FIELD VIEW                                  */}
      {/* ========================================================================= */}
      {viewMode === 'mob' && (
        <section className="stage">
          <div className="phone glass">
            <h3>My work today</h3>

            {/* Metric Grid */}
            <div className="mt">
              <div>
                <b>{cases.filter((c) => c.status === 'ASSIGNMENT').length || 2}</b>
                <span>New</span>
              </div>
              <div>
                <b>{cases.filter((c) => c.status === 'FIELD_INVESTIGATION').length || 1}</b>
                <span>Visits</span>
              </div>
              <div>
                <b>{cases.filter((c) => c.rework_count > 0).length || 0}</b>
                <span>Sent back</span>
              </div>
              <div>
                <b>{cases.filter((c) => c.status === 'REPORT_REVIEW').length || 3}</b>
                <span>Submitted</span>
              </div>
            </div>

            {/* Task Card 1: New Assignment */}
            <div className="job">
              <div className="r">
                <span className="font-mono-code font-bold text-xs text-[var(--txt)]">
                  {cases[0]?.doc_code || 'OCT26-0001'}
                </span>
                <span className="bd info">New</span>
              </div>
              <p>Hospital verification · Apollo Rajshree, Bhopal · due in 24h</p>
              <div className="acts">
                <button
                  type="button"
                  className="pri"
                  onClick={() => alert(`Accepted docket ${cases[0]?.doc_code || 'OCT26-0001'}`)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="dng"
                  onClick={() => alert('Declined assignment')}
                >
                  Decline
                </button>
              </div>
            </div>

            {/* Task Card 2: Field Enquiry */}
            <div className="job">
              <div className="r">
                <span className="font-mono-code font-bold text-xs text-[var(--txt)]">
                  {cases[1]?.doc_code || 'OCT26-0002'}
                </span>
                <span className="bd warn">In Progress</span>
              </div>
              <p>Residence verification &amp; insured statement. 2 photos captured.</p>
              <div className="acts">
                <Link
                  href="/investigator"
                  className="w-full text-center py-2 px-3 bg-[var(--glass2)] hover:bg-[var(--glass)] rounded-full text-xs font-semibold text-[var(--txt)] border border-[var(--line)]"
                >
                  Open Camera Terminal
                </Link>
              </div>
            </div>

            {/* Task Card 3: Offline Queue */}
            <div className="job">
              <div className="r">
                <span className="font-mono-code font-bold text-xs text-[var(--txt)]">Offline Sync</span>
                <span className="bd ok">Ready</span>
              </div>
              <p>IndexedDB queue stores photos &amp; GPS offline. Auto-uploads when connected.</p>
            </div>
          </div>

          <div className="side-note">
            <h2>Built for the field</h2>
            <p className="text-xs text-[var(--mut)] leading-relaxed">
              Every card is a task an investigator can act on immediately. Send-backs show the reviewer&apos;s
              exact remarks, photo requirements, and deadline. Hover over the phone to straighten the perspective.
            </p>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* FLOATING BOTTOM DOCK: BULK ACTIONS                                        */}
      {/* ========================================================================= */}
      <div className={`dock glass ${selectedCaseIds.length > 0 ? 'on' : ''}`}>
        <b>{selectedCaseIds.length} selected</b>
        <button
          type="button"
          className="pri"
          onClick={() => {
            alert(`Bulk Assign triggered for ${selectedCaseIds.length} cases.`);
            setSelectedCaseIds([]);
          }}
        >
          Assign
        </button>
        <button
          type="button"
          onClick={() => {
            alert(`Bulk Send Back requested for ${selectedCaseIds.length} cases.`);
            setSelectedCaseIds([]);
          }}
        >
          Send back
        </button>
        <button
          type="button"
          onClick={() => {
            router.push('/analytics');
          }}
        >
          Export
        </button>
        <button
          type="button"
          onClick={() => setSelectedCaseIds([])}
          className="text-[var(--mut)]"
        >
          Clear
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SLIDE-OVER SHEET: CASE DOSSIER & TIMELINE                                 */}
      {/* ========================================================================= */}
      <div
        className={`scrim ${sheetCase ? 'on' : ''}`}
        onClick={() => setSheetCase(null)}
      />

      <aside className={`sheet glass ${sheetCase ? 'open' : ''}`}>
        {sheetCase && (
          <div>
            <button
              type="button"
              className="absolute right-4 top-4 p-1.5 rounded-full text-[var(--mut)] hover:text-[var(--txt)] bg-[var(--glass2)]"
              onClick={() => setSheetCase(null)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <h2 className="font-mono-code font-bold text-xl text-[var(--txt)]">
              {sheetCase.doc_code}
            </h2>

            <div className="flex items-center space-x-2 mt-2">
              <span className="bd info">{sheetCase.status}</span>
              <span className="sla warn text-xs">
                {getSlaBadge(sheetCase.due_date).label}
              </span>
            </div>

            {/* Details definition list */}
            <dl className="grid grid-cols-3 gap-2 my-4 text-xs border-y border-[var(--line)] py-3">
              <dt className="text-[var(--mut)] font-medium">Insured</dt>
              <dd className="col-span-2 text-[var(--txt)] font-semibold">{sheetCase.insured_name}</dd>

              <dt className="text-[var(--mut)] font-medium">Claim No</dt>
              <dd className="col-span-2 font-mono-code text-[var(--txt)]">{sheetCase.claim_no}</dd>

              <dt className="text-[var(--mut)] font-medium">Policy No</dt>
              <dd className="col-span-2 font-mono-code text-[var(--txt)]">{sheetCase.policy_no || 'N/A'}</dd>

              <dt className="text-[var(--mut)] font-medium">Company</dt>
              <dd className="col-span-2 text-[var(--txt)]">{sheetCase.clients?.name || 'Insurer'}</dd>

              <dt className="text-[var(--mut)] font-medium">Location</dt>
              <dd className="col-span-2 text-[var(--txt)]">{sheetCase.location_city || 'Bhopal'}, {sheetCase.location_state || 'MP'}</dd>

              <dt className="text-[var(--mut)] font-medium">Risk Level</dt>
              <dd className="col-span-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--glass2)] text-[var(--gold)] border border-[var(--line)]">
                  {sheetCase.risk_level}
                </span>
              </dd>
            </dl>

            {/* Tactical Actions */}
            <div className="acts">
              <Link
                href={`/cases/${sheetCase.id}`}
                className="pri px-4 py-2 rounded-full text-xs font-bold inline-flex items-center space-x-1"
              >
                <span>Open Dossier</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
              <button
                type="button"
                onClick={() => alert(`Assigned docket ${sheetCase.doc_code}`)}
              >
                Assign
              </button>
              <button
                type="button"
                onClick={() => alert(`Hold placed on ${sheetCase.doc_code}`)}
              >
                Hold
              </button>
              <button
                type="button"
                className="dng"
                onClick={() => alert(`Escalation triggered for ${sheetCase.doc_code}`)}
              >
                Escalate
              </button>
            </div>

            {/* Lifecycle Timeline */}
            <div className="mt-6">
              <strong className="text-xs uppercase tracking-wider text-[var(--txt)]">
                Traceable Timeline
              </strong>
              <ul className="tl mt-3">
                <li className="n">
                  <time>Current Stage</time>
                  <span className="font-semibold text-[var(--txt)]">{sheetCase.status}</span>
                  <q>Rework count: {sheetCase.rework_count} cycles</q>
                </li>
                <li>
                  <time>Due Deadline</time>
                  <span>{sheetCase.due_date ? new Date(sheetCase.due_date).toLocaleDateString('en-IN') : 'Standard SLA'}</span>
                </li>
                <li>
                  <time>Case Intake</time>
                  <span>Entered on {new Date(sheetCase.created_at).toLocaleDateString('en-IN')}</span>
                  <q>Audit logged under Rule A6 append-only ledger</q>
                </li>
              </ul>
            </div>
          </div>
        )}
      </aside>

      {/* ========================================================================= */}
      {/* COMMAND PALETTE MODAL (⌘K)                                                */}
      {/* ========================================================================= */}
      <div
        className={`pal ${showPalette ? 'on' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowPalette(false);
        }}
      >
        <div className="pbox glass">
          <input
            ref={paletteInputRef}
            type="text"
            value={paletteQuery}
            onChange={(e) => setPaletteQuery(e.target.value)}
            placeholder="Jump to a case, claim number or action..."
            aria-label="Quick search input"
          />

          <div className="pl">
            {cases
              .filter((c) => {
                if (!paletteQuery.trim()) return true;
                const q = paletteQuery.toLowerCase();
                return (
                  c.doc_code?.toLowerCase().includes(q) ||
                  c.claim_no?.toLowerCase().includes(q) ||
                  c.insured_name?.toLowerCase().includes(q)
                );
              })
              .slice(0, 5)
              .map((c) => (
                <div
                  key={c.id}
                  className="pi"
                  onClick={() => {
                    setShowPalette(false);
                    router.push(`/cases/${c.id}`);
                  }}
                >
                  <b className="font-mono-code text-xs text-[var(--txt)]">{c.doc_code}</b>
                  <span>{c.insured_name} · {c.status}</span>
                </div>
              ))}

            {/* Quick Actions */}
            <div
              className="pi"
              onClick={() => {
                setShowPalette(false);
                router.push('/cases');
              }}
            >
              <b>Create New Case Intake</b>
              <span>Action</span>
            </div>
            <div
              className="pi"
              onClick={() => {
                setShowPalette(false);
                router.push('/invoicing');
              }}
            >
              <b>Generate GST Invoice</b>
              <span>Finance</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CommandCenterPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-[var(--mut)]">Loading Command Center...</div>}>
      <CommandCenterContent />
    </Suspense>
  );
}
