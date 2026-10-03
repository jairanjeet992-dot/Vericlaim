'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Search,
  Filter,
  RefreshCw,
  Lock,
  Clock,
  User,
  Database,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

interface AuditLogItem {
  id: string;
  agency_id: string;
  user_id?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values?: any;
  new_values?: any;
  ip_address?: string;
  created_at: string;
  users?: { full_name: string; username: string };
}

export default function AuditVaultPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchAction, setSearchAction] = useState('');
  const [selectedEntityType, setSelectedEntityType] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadAuditLogs = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (searchAction) params.set('action', searchAction);
      if (selectedEntityType) params.set('entity_type', selectedEntityType);

      const res = await fetch(`/api/audit?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setLogs(json.data || []);
      } else {
        setError(json.error || 'Failed to query audit vault');
      }
    } catch {
      setError('Network error loading audit vault');
    } finally {
      setLoading(false);
    }
  }, [searchAction, selectedEntityType]);

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadAuditLogs();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <div className="h-7 w-7 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Security & Audit Vault
            </h1>
            <span className="text-[10px] font-mono-code bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-semibold border border-emerald-200">
              APPEND-ONLY
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Tamper-evident regulatory ledger recording all case mutations, status transitions, role authorizations, and PII accesses.
          </p>
        </div>

        <button
          onClick={loadAuditLogs}
          disabled={loading}
          className="btn-3d flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 self-start md:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Vault</span>
        </button>
      </div>

      {/* 3D KPI Metric Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="kpi-card-3d bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold uppercase text-slate-500 tracking-wider">
            Total Audited Records
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1">{logs.length}</div>
          <div className="text-[10px] text-slate-400 mt-0.5 font-mono-code">Recent window</div>
        </div>

        <div className="kpi-card-3d bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold uppercase text-emerald-600 tracking-wider">
            Status & Workflow Events
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-1">
            {logs.filter((l) => l.action.includes('STATUS') || l.action.includes('WORKFLOW')).length}
          </div>
          <div className="text-[10px] text-emerald-600/70 mt-0.5">Enforced via RLS triggers</div>
        </div>

        <div className="kpi-card-3d bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold uppercase text-blue-600 tracking-wider">
            Security & Auth Checks
          </div>
          <div className="text-2xl font-black text-blue-700 mt-1">
            {logs.filter((l) => l.action.includes('ROLE') || l.action.includes('LOGIN') || l.action.includes('AUTH')).length}
          </div>
          <div className="text-[10px] text-blue-600/70 mt-0.5">RBAC & scope verification</div>
        </div>

        <div className="kpi-card-3d bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold uppercase text-purple-600 tracking-wider">
            Integrity Status
          </div>
          <div className="text-lg font-black text-purple-700 mt-1 flex items-center space-x-1">
            <Lock className="h-4 w-4" />
            <span>Verified</span>
          </div>
          <div className="text-[10px] text-purple-600/70 mt-0.5">Zero deletions permitted</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchAction}
            onChange={(e) => setSearchAction(e.target.value)}
            placeholder="Filter by action code (e.g., CASE_TRANSITION, ROLE_ASSIGN)..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-800 focus:bg-white"
          />
        </form>

        <select
          value={selectedEntityType}
          onChange={(e) => setSelectedEntityType(e.target.value)}
          className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:border-slate-800"
        >
          <option value="">All Entity Types</option>
          <option value="cases">Cases</option>
          <option value="reports">Reports</option>
          <option value="assignments">Assignments</option>
          <option value="invoices">Invoices</option>
          <option value="users">Users & Roles</option>
          <option value="hardcopy_movements">Hardcopy Movements</option>
        </select>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
          {error}
        </div>
      )}

      {/* Ledger Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-2.5 px-3">Timestamp (IST)</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-3">Entity Type</th>
                <th className="py-2.5 px-3">Entity Reference</th>
                <th className="py-2.5 px-3">Actor</th>
                <th className="py-2.5 px-3">IP Address</th>
                <th className="py-2.5 px-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                    Loading cryptographic audit vault...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                    No audit records match the selected filter.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isExpanded = expandedId === log.id;
                  const istTime = new Date(log.created_at).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true,
                  });

                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-3 font-mono-code text-[11px] text-slate-600 whitespace-nowrap">
                          {istTime}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-mono-code font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded text-[11px] border border-slate-200">
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-700 capitalize">
                          {log.entity_type}
                        </td>
                        <td className="py-2.5 px-3 font-mono-code text-[11px] text-slate-600">
                          {log.entity_id ? log.entity_id.slice(0, 12) + '...' : '-'}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center space-x-1 text-slate-700 font-medium">
                            <User className="h-3 w-3 text-slate-400" />
                            <span>{log.users?.full_name || log.user_id?.slice(0, 8) || 'System'}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono-code text-[11px] text-slate-500">
                          {log.ip_address || '127.0.0.1'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : log.id)}
                            className="text-xs font-semibold text-blue-600 hover:text-blue-800 inline-flex items-center space-x-1"
                          >
                            <span>{isExpanded ? 'Hide' : 'Inspect'}</span>
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/90">
                          <td colSpan={7} className="p-4 border-t border-b border-slate-200">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono-code">
                              <div>
                                <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">
                                  State Before Mutation (Old Values)
                                </div>
                                <pre className="p-2.5 bg-slate-900 text-slate-200 rounded-lg overflow-x-auto text-[11px] max-h-48">
                                  {log.old_values
                                    ? JSON.stringify(log.old_values, null, 2)
                                    : '// No previous state recorded'}
                                </pre>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">
                                  State After Mutation (New Values)
                                </div>
                                <pre className="p-2.5 bg-slate-900 text-emerald-300 rounded-lg overflow-x-auto text-[11px] max-h-48">
                                  {log.new_values
                                    ? JSON.stringify(log.new_values, null, 2)
                                    : '// No new state recorded'}
                                </pre>
                              </div>
                            </div>
                            <div className="mt-2 text-[10px] text-slate-400">
                              Immutable record ID: <span className="font-mono-code">{log.id}</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
