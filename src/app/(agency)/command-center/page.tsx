'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface TileMetric {
  key: string;
  label: string;
  count: number;
  color: string;
  category: string;
}

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

interface SavedFilter {
  id: string;
  name: string;
  filter_criteria: any;
  is_default: boolean;
}

function CommandCenterContent() {
  const searchParams = useSearchParams();
  const [tiles, setTiles] = useState<TileMetric[]>([]);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);

  // Filter States
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [pendingAge, setPendingAge] = useState<number | null>(null);

  // Saved Filters
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [showSaveFilterModal, setShowSaveFilterModal] = useState(false);
  const [newFilterName, setNewFilterName] = useState('');

  // Bulk Action State
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  // Fetch Tiles
  const fetchTiles = useCallback(async () => {
    try {
      const res = await fetch('/api/command-center/metrics');
      const data = await res.json();
      if (data.success) {
        setTiles(data.data);
      }
    } catch (e) {
      console.error('Failed to load tiles', e);
    }
  }, []);

  // Fetch Cases with Filters
  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedTile) params.set('tile', selectedTile);
      if (searchQuery) params.set('q', searchQuery);
      if (riskLevel) params.set('risk_level', riskLevel);
      if (locationCity) params.set('location_city', locationCity);
      if (pendingAge) params.set('pending_age_days', pendingAge.toString());
      params.set('page', page.toString());
      params.set('pageSize', '25');

      const res = await fetch(`/api/command-center/cases?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setCases(data.cases || []);
        setTotalCount(data.totalCount || 0);
      }
    } catch (e) {
      console.error('Failed to load cases', e);
    } finally {
      setLoading(false);
    }
  }, [selectedTile, searchQuery, riskLevel, locationCity, pendingAge, page]);

  // Fetch Saved Filters
  const fetchSavedFilters = useCallback(async () => {
    try {
      const res = await fetch('/api/command-center/saved-filters');
      const data = await res.json();
      if (data.success) {
        setSavedFilters(data.data || []);
      }
    } catch (e) {
      console.error('Failed to load saved filters', e);
    }
  }, []);

  useEffect(() => {
    fetchTiles();
    fetchSavedFilters();
  }, [fetchTiles, fetchSavedFilters]);

  useEffect(() => {
    const q = searchParams.get('q') || searchParams.get('search');
    const tile = searchParams.get('tile');
    if (q) setSearchQuery(q);
    if (tile) setSelectedTile(tile);
  }, [searchParams]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  // Bulk Actions Handler
  const handleBulkAction = async (action: 'BULK_VERIFY' | 'BULK_PRIORITY', payload: any = {}) => {
    if (selectedCaseIds.length === 0) return;
    setBulkActionLoading(true);
    setBulkMessage(null);
    try {
      const res = await fetch('/api/command-center/bulk-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          case_ids: selectedCaseIds,
          payload,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBulkMessage(`Bulk ${action}: ${data.data.succeeded} succeeded, ${data.data.failed} failed.`);
        setSelectedCaseIds([]);
        fetchCases();
        fetchTiles();
      } else {
        setBulkMessage(`Bulk action failed: ${data.error}`);
      }
    } catch (e: any) {
      setBulkMessage(`Error: ${e.message}`);
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Save Filter Preset
  const handleSaveFilter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilterName.trim()) return;
    try {
      const res = await fetch('/api/command-center/saved-filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFilterName.trim(),
          filter_criteria: {
            tile: selectedTile,
            searchQuery,
            riskLevel,
            locationCity,
            pendingAge,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowSaveFilterModal(false);
        setNewFilterName('');
        fetchSavedFilters();
      }
    } catch (e) {
      console.error('Failed to save filter preset', e);
    }
  };

  const applySavedFilter = (sf: SavedFilter) => {
    const c = sf.filter_criteria || {};
    setSelectedTile(c.tile || null);
    setSearchQuery(c.searchQuery || '');
    setRiskLevel(c.riskLevel || '');
    setLocationCity(c.locationCity || '');
    setPendingAge(c.pendingAge || null);
    setPage(1);
  };

  // Toggle select-all
  const toggleSelectAll = () => {
    if (selectedCaseIds.length === cases.length) {
      setSelectedCaseIds([]);
    } else {
      setSelectedCaseIds(cases.map((c) => c.id));
    }
  };

  const toggleSelectCase = (id: string) => {
    if (selectedCaseIds.includes(id)) {
      setSelectedCaseIds(selectedCaseIds.filter((cid) => cid !== id));
    } else {
      setSelectedCaseIds([...selectedCaseIds, id]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Back Office Command Center
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Real-time pipeline orchestration, multi-investigator workload, and SLA telemetry
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Saved Filters Dropdown */}
          {savedFilters.length > 0 && (
            <select
              aria-label="Filter Presets"
              onChange={(e) => {
                const sf = savedFilters.find((f) => f.id === e.target.value);
                if (sf) applySavedFilter(sf);
              }}
              defaultValue=""
              className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="" disabled>Saved Presets ({savedFilters.length})</option>
              {savedFilters.map((sf) => (
                <option key={sf.id} value={sf.id}>{sf.name}</option>
              ))}
            </select>
          )}

          <button
            onClick={() => setShowSaveFilterModal(true)}
            className="text-xs px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded text-slate-700 font-medium shadow-sm transition"
          >
            Save Current Filter
          </button>

          <Link
            href="/cases"
            className="text-xs px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded font-medium shadow-sm transition"
          >
            Intake Docket
          </Link>
        </div>
      </div>

      {/* 13 OPERATIONAL STATUS TILES - 3D KPI TILES */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 lg:grid-cols-13 gap-2">
        {tiles.map((tile) => {
          const isSelected = selectedTile === tile.key;
          return (
            <button
              key={tile.key}
              onClick={() => {
                setSelectedTile(isSelected ? null : tile.key);
                setPage(1);
              }}
              className={`p-2.5 rounded-xl text-left transition-all flex flex-col justify-between ${
                isSelected
                  ? 'border-2 border-blue-600 bg-gradient-to-b from-blue-50 to-blue-100/60 shadow-md shadow-blue-500/10 ring-2 ring-blue-500/20 translate-y-[-2px]'
                  : 'kpi-card-3d hover:translate-y-[-2px]'
              }`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <span className="text-[10px] font-extrabold tracking-wider text-slate-500 uppercase truncate">
                  {tile.label}
                </span>
                {tile.key === 'SLA_BREACHED' && tile.count > 0 ? (
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse ring-2 ring-rose-200" />
                ) : null}
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span
                  className={`text-lg font-black font-mono-code ${
                    tile.key === 'SLA_BREACHED' && tile.count > 0
                      ? 'text-rose-600'
                      : isSelected
                      ? 'text-blue-900'
                      : 'text-slate-900'
                  }`}
                >
                  {tile.count}
                </span>
                {isSelected && (
                  <span className="text-[9px] font-extrabold text-blue-600 uppercase bg-blue-100 px-1 py-0.2 rounded">
                    Active
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* FILTER & SEARCH CONTROL BAR */}
      <div className="p-3 bg-white border border-slate-200 rounded shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Search Docket</label>
            <input
              type="text"
              placeholder="Claim, Policy, Insured..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Priority / Risk</label>
            <select
              value={riskLevel}
              onChange={(e) => {
                setRiskLevel(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white text-slate-700"
            >
              <option value="">All Risk Levels</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Location City</label>
            <input
              type="text"
              placeholder="e.g. Indore, Bhopal..."
              value={locationCity}
              onChange={(e) => setLocationCity(e.target.value)}
              className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Pending Age</label>
            <select
              value={pendingAge || ''}
              onChange={(e) => {
                setPendingAge(e.target.value ? parseInt(e.target.value, 10) : null);
                setPage(1);
              }}
              className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white text-slate-700"
            >
              <option value="">All Ages</option>
              <option value="2">&gt; 2 Days Old</option>
              <option value="5">&gt; 5 Days Old</option>
              <option value="7">&gt; 7 Days Old</option>
              <option value="15">&gt; 15 Days Old</option>
            </select>
          </div>

          <div className="flex items-end space-x-2">
            <button
              onClick={() => {
                setSelectedTile(null);
                setSearchQuery('');
                setRiskLevel('');
                setLocationCity('');
                setPendingAge(null);
                setPage(1);
              }}
              className="w-full text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded border border-slate-300 transition"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {/* BULK ACTION BAR (Visible when items selected) */}
        {selectedCaseIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-900 text-white rounded text-xs animate-in fade-in duration-150">
            <div className="flex items-center space-x-2">
              <span className="font-bold px-2 py-0.5 bg-blue-600 rounded text-[11px]">
                {selectedCaseIds.length} Selected
              </span>
              <span className="text-slate-300 text-xs hidden sm:inline">Bulk operations ready</span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                disabled={bulkActionLoading}
                onClick={() => handleBulkAction('BULK_VERIFY')}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded text-xs transition disabled:opacity-50"
              >
                Verify Selected
              </button>

              <select
                aria-label="Set Priority for Selected Cases"
                disabled={bulkActionLoading}
                onChange={(e) => {
                  if (e.target.value) {
                    handleBulkAction('BULK_PRIORITY', { risk_level: e.target.value });
                    e.target.value = '';
                  }
                }}
                defaultValue=""
                className="px-2 py-1 bg-slate-800 border border-slate-700 text-white font-medium rounded text-xs focus:outline-none"
              >
                <option value="" disabled>Set Priority...</option>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>

              <button
                onClick={() => setSelectedCaseIds([])}
                className="px-2 py-1 text-slate-400 hover:text-white text-xs"
              >
                Deselect All
              </button>
            </div>
          </div>
        )}

        {bulkMessage && (
          <div className="p-2 bg-blue-50 border border-blue-200 text-blue-900 rounded text-xs font-medium">
            {bulkMessage}
          </div>
        )}
      </div>

      {/* DENSE CASES TABLE */}
      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 select-none">
              <tr>
                <th className="p-2.5 w-8">
                  <input
                    aria-label="Select All Cases"
                    type="checkbox"
                    checked={cases.length > 0 && selectedCaseIds.length === cases.length}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-blue-600 focus:ring-0"
                  />
                </th>
                <th className="p-2.5">Doc Code</th>
                <th className="p-2.5">Claim / Policy No</th>
                <th className="p-2.5">Insured & Patient</th>
                <th className="p-2.5">Client</th>
                <th className="p-2.5">Location</th>
                <th className="p-2.5">Risk Level</th>
                <th className="p-2.5">Status</th>
                <th className="p-2.5">SLA / Age</th>
                <th className="p-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    Loading command center telemetry...
                  </td>
                </tr>
              ) : cases.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    No cases match the active filter criteria.
                  </td>
                </tr>
              ) : (
                cases.map((c) => {
                  const isChecked = selectedCaseIds.includes(c.id);
                  const isBreached = c.due_date && new Date(c.due_date) < new Date();
                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-slate-50/80 transition ${isChecked ? 'bg-blue-50/40' : ''}`}
                    >
                      <td className="p-2.5">
                        <input
                          aria-label={`Select Case ${c.doc_code}`}
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectCase(c.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-0"
                        />
                      </td>
                      <td className="p-2.5 font-mono-code font-bold text-slate-900">
                        <Link href={`/cases/${c.id}`} className="hover:text-blue-600 hover:underline">
                          {c.doc_code}
                        </Link>
                      </td>
                      <td className="p-2.5">
                        <div className="font-mono-code font-medium text-slate-800">{c.claim_no}</div>
                        <div className="text-[10px] text-slate-400 font-mono-code">{c.policy_no}</div>
                      </td>
                      <td className="p-2.5 font-medium text-slate-800">
                        {c.insured_name}
                      </td>
                      <td className="p-2.5">
                        <span className="font-medium text-slate-700">{c.clients?.name || '—'}</span>
                        <div className="text-[10px] text-slate-400">{c.case_types?.name}</div>
                      </td>
                      <td className="p-2.5 text-slate-600">
                        {c.location_city || '—'}, {c.location_state || ''}
                      </td>
                      <td className="p-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono-code ${
                          c.risk_level === 'CRITICAL' ? 'bg-red-100 text-red-800' :
                          c.risk_level === 'HIGH' ? 'bg-amber-100 text-amber-800' :
                          c.risk_level === 'MEDIUM' ? 'bg-blue-100 text-blue-800' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {c.risk_level}
                        </span>
                      </td>
                      <td className="p-2.5">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                          {c.status.replace(/_/g, ' ')}
                        </span>
                        {c.rework_count > 0 && (
                          <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-mono-code">
                            R{c.rework_count}
                          </span>
                        )}
                      </td>
                      <td className="p-2.5">
                        {isBreached ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-100 text-red-800 rounded">
                            BREACHED
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-mono-code">
                            {new Date(c.created_at).toLocaleDateString()}
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-right">
                        <Link
                          href={`/cases/${c.id}`}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded text-[11px] transition"
                        >
                          View File
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION BAR */}
        <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <div>
            Showing {cases.length} of {totalCount} total cases
          </div>
          <div className="flex items-center space-x-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 bg-white border border-slate-300 rounded font-medium disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-2 font-mono-code font-bold text-slate-800">Page {page}</span>
            <button
              disabled={cases.length < 25}
              onClick={() => setPage((p) => p + 1)}
              className="px-2.5 py-1 bg-white border border-slate-300 rounded font-medium disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* SAVE FILTER PRESET MODAL */}
      {showSaveFilterModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 mb-2">Save Filter Preset</h3>
            <p className="text-xs text-slate-500 mb-3">
              Give this combination of status, territory, and risk filters a name for quick recall.
            </p>
            <form onSubmit={handleSaveFilter} className="space-y-3">
              <input
                type="text"
                required
                placeholder="e.g. Critical Indore In-Progress"
                value={newFilterName}
                onChange={(e) => setNewFilterName(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
              />
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSaveFilterModal(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-medium rounded hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded"
                >
                  Save Preset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommandCenterPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-slate-500">Loading Command Center...</div>}>
      <CommandCenterContent />
    </Suspense>
  );
}
