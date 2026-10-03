'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface ReportListItem {
  id: string;
  agency_id: string;
  case_id: string;
  title: string;
  status: string;
  current_version: number;
  is_immutable: boolean;
  author_id?: string;
  reviewer_id?: string;
  approved_at?: string;
  created_at: string;
  cases?: {
    id: string;
    doc_code: string;
    claim_no: string;
    insured_name: string;
    status: string;
    rework_count: number;
    clients?: { name: string };
    case_types?: { name: string };
  };
  users?: { full_name: string };
}

export default function ReportsIndexPage() {
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'ALL' | 'UNDER_REVIEW' | 'SENT_BACK' | 'ESCALATED' | 'APPROVED'>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function loadReports() {
      try {
        setLoading(true);
        const res = await fetch('/api/cases');
        const json = await res.json();
        if (json.success && json.data) {
          // For demo / agency view, synthesize case report items
          const list: ReportListItem[] = json.data.map((c: any) => ({
            id: `rep-${c.id}`,
            agency_id: c.agency_id,
            case_id: c.id,
            title: `Investigation Report - ${c.doc_code}`,
            status: c.status === 'APPROVED' || c.status === 'CLOSED' ? 'APPROVED'
              : c.status === 'ESCALATED_REVIEW' ? 'SENT_BACK'
              : c.status === 'REPORT_REVIEW' ? 'UNDER_REVIEW'
              : c.status === 'REPORT_DRAFTING' ? 'DRAFT' : 'DRAFT',
            current_version: (c.rework_count || 0) + 1,
            is_immutable: c.status === 'APPROVED' || c.status === 'CLOSED',
            created_at: c.created_at,
            cases: {
              id: c.id,
              doc_code: c.doc_code,
              claim_no: c.claim_no,
              insured_name: c.insured_name,
              status: c.status,
              rework_count: c.rework_count || 0,
              clients: c.clients,
              case_types: c.case_types,
            },
          }));
          setReports(list);
        }
      } catch (err) {
        console.error('Failed to load reports queue:', err);
      } finally {
        setLoading(false);
      }
    }
    loadReports();
  }, []);

  const filtered = reports.filter((r) => {
    if (filterTab === 'UNDER_REVIEW') return r.status === 'UNDER_REVIEW';
    if (filterTab === 'SENT_BACK') return r.status === 'SENT_BACK' && (r.cases?.rework_count || 0) < 3;
    if (filterTab === 'ESCALATED') return (r.cases?.rework_count || 0) >= 3 || r.cases?.status === 'ESCALATED_REVIEW';
    if (filterTab === 'APPROVED') return r.is_immutable || r.status === 'APPROVED';
    return true;
  }).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.cases?.doc_code.toLowerCase().includes(q) ||
      r.cases?.claim_no?.toLowerCase().includes(q) ||
      r.cases?.insured_name?.toLowerCase().includes(q)
    );
  });

  const underReviewCount = reports.filter((r) => r.status === 'UNDER_REVIEW').length;
  const sentBackCount = reports.filter((r) => r.status === 'SENT_BACK' && (r.cases?.rework_count || 0) < 3).length;
  const escalatedCount = reports.filter((r) => (r.cases?.rework_count || 0) >= 3 || r.cases?.status === 'ESCALATED_REVIEW').length;
  const approvedCount = reports.filter((r) => r.is_immutable || r.status === 'APPROVED').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200 gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            Investigation Reports & Quality Review Center
          </h1>
          <p className="text-xs text-slate-500">
            Phase 6 Quality Assurance: Version-controlled reports, anchored comments, rework engine with auto-escalation, and immutable approval.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/hardcopy"
            className="px-3 py-1.5 bg-slate-800 text-white rounded text-xs font-semibold hover:bg-slate-700 transition flex items-center gap-1.5"
          >
            📦 Hardcopy Logistics & Dispatch
          </Link>
        </div>
      </div>

      {/* KPI Status Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div
          onClick={() => setFilterTab('UNDER_REVIEW')}
          className={`p-3 rounded border cursor-pointer transition ${
            filterTab === 'UNDER_REVIEW' ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-400' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-[11px] font-semibold text-slate-500 uppercase">Under Review</div>
          <div className="text-2xl font-bold text-blue-600 font-mono-code mt-0.5">{underReviewCount}</div>
          <div className="text-[10px] text-slate-400 mt-1">Awaiting scrutiny & signoff</div>
        </div>

        <div
          onClick={() => setFilterTab('SENT_BACK')}
          className={`p-3 rounded border cursor-pointer transition ${
            filterTab === 'SENT_BACK' ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-400' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-[11px] font-semibold text-slate-500 uppercase">Active Rework</div>
          <div className="text-2xl font-bold text-amber-600 font-mono-code mt-0.5">{sentBackCount}</div>
          <div className="text-[10px] text-slate-400 mt-1">Corrections in progress (Cycle 1-2)</div>
        </div>

        <div
          onClick={() => setFilterTab('ESCALATED')}
          className={`p-3 rounded border cursor-pointer transition ${
            filterTab === 'ESCALATED' ? 'bg-rose-50 border-rose-400 ring-1 ring-rose-400' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-[11px] font-semibold text-slate-500 uppercase">Escalated (N &ge; 3)</div>
          <div className="text-2xl font-bold text-rose-600 font-mono-code mt-0.5">{escalatedCount}</div>
          <div className="text-[10px] text-rose-500 font-semibold mt-1">Requires Senior Admin Override</div>
        </div>

        <div
          onClick={() => setFilterTab('APPROVED')}
          className={`p-3 rounded border cursor-pointer transition ${
            filterTab === 'APPROVED' ? 'bg-emerald-50 border-emerald-400 ring-1 ring-emerald-400' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-[11px] font-semibold text-slate-500 uppercase">Approved & Sealed</div>
          <div className="text-2xl font-bold text-emerald-600 font-mono-code mt-0.5">{approvedCount}</div>
          <div className="text-[10px] text-slate-400 mt-1">Immutable final reports</div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-2.5 rounded border border-slate-200">
        <div className="flex items-center space-x-1 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {(['ALL', 'UNDER_REVIEW', 'SENT_BACK', 'ESCALATED', 'APPROVED'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`px-3 py-1 text-xs font-semibold rounded transition whitespace-nowrap ${
                filterTab === tab ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="w-full sm:w-72">
          <input
            type="text"
            placeholder="Search docket, claim, insured..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Reports Ledger */}
      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading reports ledger...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">No reports found matching criteria.</div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <th className="p-2.5">Docket Code</th>
                <th className="p-2.5">Claim & Insured</th>
                <th className="p-2.5">Client & Type</th>
                <th className="p-2.5">Version</th>
                <th className="p-2.5">Rework Cycles</th>
                <th className="p-2.5">Review Status</th>
                <th className="p-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((item) => {
                const reworkCount = item.cases?.rework_count || 0;
                const isEscalated = reworkCount >= 3;

                return (
                  <tr key={item.id} className="hover:bg-slate-50 transition">
                    <td className="p-2.5 font-mono-code font-bold text-blue-700">
                      <Link href={`/cases/${item.case_id}`} className="hover:underline">
                        {item.cases?.doc_code}
                      </Link>
                    </td>
                    <td className="p-2.5">
                      <div className="font-semibold text-slate-800">{item.cases?.insured_name}</div>
                      <div className="text-[11px] text-slate-500 font-mono-code">{item.cases?.claim_no}</div>
                    </td>
                    <td className="p-2.5">
                      <div className="text-slate-800">{item.cases?.clients?.name || 'Client'}</div>
                      <div className="text-[11px] text-slate-500">{item.cases?.case_types?.name || 'Case'}</div>
                    </td>
                    <td className="p-2.5 font-mono-code font-semibold">
                      v{item.current_version}
                    </td>
                    <td className="p-2.5">
                      {reworkCount === 0 ? (
                        <span className="text-slate-400">None (Cycle 0)</span>
                      ) : (
                        <span
                          className={`px-2 py-0.5 rounded font-mono-code text-[11px] font-bold ${
                            isEscalated
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {reworkCount} {isEscalated ? '(ESCALATED)' : 'Cycles'}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5">
                      {item.is_immutable ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] inline-flex items-center gap-1 border border-emerald-200">
                          🔒 APPROVED / SEALED
                        </span>
                      ) : item.status === 'UNDER_REVIEW' ? (
                        <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold text-[10px]">
                          UNDER REVIEW
                        </span>
                      ) : item.status === 'SENT_BACK' ? (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                          REWORK SENT BACK
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium text-[10px]">
                          {item.status}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 text-right">
                      <Link
                        href={`/cases/${item.case_id}`}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px] transition inline-flex items-center gap-1"
                      >
                        Open Docket →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
