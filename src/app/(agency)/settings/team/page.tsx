'use client';

import React, { useState, useEffect } from 'react';

interface TeamMember {
  id: string;
  username: string;
  full_name: string;
  scope: string;
  reports_to_id: string | null;
  is_active: boolean;
  user_roles: Array<{ roles: { id: string; name: string } }>;
}

interface ManagerScope {
  id: string;
  manager_id: string;
  client_id: string;
  case_type: string;
  is_default: boolean;
  users: { id: string; full_name: string; username: string };
  clients: { id: string; name: string; code: string };
}

export default function TeamSettingsPage() {
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'scopes'>('hierarchy');
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [scopes, setScopes] = useState<ManagerScope[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [managers, setManagers] = useState<Array<{ id: string; full_name: string; username: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<string | null>(null);

  // Transfer Wizard State
  const [showTransferModal, setShowTransferModal] = useState<TeamMember | null>(null);
  const [successorManagerId, setSuccessorManagerId] = useState('');
  const [transferReason, setTransferReason] = useState('');

  // Add Scope Form State
  const [selectedManagerId, setSelectedManagerId] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedCaseType, setSelectedCaseType] = useState('PA');
  const [isDefaultScope, setIsDefaultScope] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [teamRes, scopesRes] = await Promise.all([
        fetch('/api/settings/team'),
        fetch('/api/settings/team/manager-scopes'),
      ]);

      const teamJson = await teamRes.json();
      const scopesJson = await scopesRes.json();

      if (teamJson.success) setTeam(teamJson.data || []);
      if (scopesJson.success) {
        setScopes(scopesJson.data.scopes || []);
        setClients(scopesJson.data.clients || []);
        setManagers(scopesJson.data.managers || []);
      }
    } catch {
      setNotification('Failed to load team and routing configuration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showTransferModal || !successorManagerId) return;

    try {
      const res = await fetch('/api/settings/team/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_manager_id: showTransferModal.id,
          new_manager_id: successorManagerId,
          reason: transferReason,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(
          `Manager Transfer Wizard completed successfully. Migrated ${json.data.transferred_cases} open cases and ${json.data.transferred_staff} staff members.`
        );
        setShowTransferModal(null);
        setSuccessorManagerId('');
        setTransferReason('');
        loadData();
      } else {
        setNotification(`Transfer failed: ${json.error}`);
      }
    } catch {
      setNotification('Error executing transfer wizard.');
    }
  };

  const handleAddScope = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings/team/manager-scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manager_id: selectedManagerId,
          client_id: selectedClientId,
          case_type: selectedCaseType,
          is_default: isDefaultScope,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification('Routing scope registered successfully.');
        setSelectedManagerId('');
        setSelectedClientId('');
        setIsDefaultScope(false);
        loadData();
      } else {
        setNotification(`Failed to register scope: ${json.error}`);
      }
    } catch {
      setNotification('Error adding manager scope.');
    }
  };

  const handleDeleteScope = async (scopeId: string) => {
    try {
      const res = await fetch(`/api/settings/team/manager-scopes?id=${scopeId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setNotification('Scope removed.');
        loadData();
      }
    } catch {
      setNotification('Error removing scope.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Team Hierarchy & Routing Scopes
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Manage manager subtree reporting, client intake routing rules, and safe manager offboarding.
          </p>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => setActiveTab('hierarchy')}
            className={`px-3 py-1.5 text-xs font-semibold rounded uppercase tracking-wider transition ${
              activeTab === 'hierarchy'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            Subtree Hierarchy
          </button>
          <button
            onClick={() => setActiveTab('scopes')}
            className={`px-3 py-1.5 text-xs font-semibold rounded uppercase tracking-wider transition ${
              activeTab === 'scopes'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            Manager Scopes ({scopes.length})
          </button>
        </div>
      </div>

      {notification && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded">
          {notification}
        </div>
      )}

      {/* Tab 1: Subtree Hierarchy */}
      {activeTab === 'hierarchy' && (
        <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center text-xs">
            <span className="font-bold uppercase tracking-wider text-slate-700">
              Agency Staff & Reporting Tree
            </span>
            <span className="text-slate-500 font-mono-code">{team.length} staff members</span>
          </div>

          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5">Staff Member</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Scope</th>
                <th className="px-4 py-2.5">Reports To</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Loading team tree...
                  </td>
                </tr>
              ) : team.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No team members found.
                  </td>
                </tr>
              ) : (
                team.map((member) => {
                  const manager = team.find((t) => t.id === member.reports_to_id);
                  const isManagerRole = member.scope === 'ALL' || member.scope === 'TEAM';

                  return (
                    <tr key={member.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{member.full_name}</div>
                        <div className="text-[11px] font-mono-code text-slate-400">@{member.username}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 border border-slate-200 font-medium">
                          {member.user_roles[0]?.roles?.name || 'Staff'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono-code font-semibold text-blue-700">
                        {member.scope}
                      </td>
                      <td className="px-4 py-3">
                        {manager ? (
                          <span className="font-medium text-slate-800">{manager.full_name}</span>
                        ) : (
                          <span className="text-slate-400 italic">Direct / Root</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {member.is_active ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-200 text-slate-600 font-bold">
                            DEACTIVATED
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isManagerRole && member.is_active && (
                          <button
                            onClick={() => setShowTransferModal(member)}
                            className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded text-[11px] font-semibold"
                          >
                            Transfer & Offboard
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Manager Scopes (Routing Engine Rules) */}
      {activeTab === 'scopes' && (
        <div className="space-y-6">
          {/* Add Scope Form Card */}
          <div className="bg-white border border-slate-200 rounded p-4 shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
              Add Case Routing Scope Rule
            </h2>
            <form onSubmit={handleAddScope} className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 font-semibold mb-1 uppercase tracking-wider">
                  Manager
                </label>
                <select
                  required
                  value={selectedManagerId}
                  onChange={(e) => setSelectedManagerId(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded"
                >
                  <option value="">Select manager...</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1 uppercase tracking-wider">
                  Client
                </label>
                <select
                  required
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded"
                >
                  <option value="">Select client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1 uppercase tracking-wider">
                  Case Type
                </label>
                <select
                  value={selectedCaseType}
                  onChange={(e) => setSelectedCaseType(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded"
                >
                  <option value="PA">PA (Personal Accident)</option>
                  <option value="Cashless">Cashless</option>
                  <option value="Reimbursement">Reimbursement</option>
                  <option value="MB">MB (Mediclaim Bill)</option>
                  <option value="FVR">FVR (Field Verification)</option>
                  <option value="Spot">Spot Investigation</option>
                  <option value="Project">Project Investigation</option>
                  <option value="Hospicash">Hospicash</option>
                  <option value="Post Facto">Post Facto</option>
                </select>
              </div>

              <div className="flex items-center space-x-2 pt-4">
                <input
                  type="checkbox"
                  id="defaultCheck"
                  checked={isDefaultScope}
                  onChange={(e) => setIsDefaultScope(e.target.checked)}
                  className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                />
                <label htmlFor="defaultCheck" className="text-slate-700 font-semibold cursor-pointer">
                  Default Manager
                </label>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={!selectedManagerId || !selectedClientId}
                  className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold uppercase tracking-wider disabled:opacity-50"
                >
                  + Add Scope
                </button>
              </div>
            </form>
          </div>

          {/* Active Scopes List */}
          <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Case Type</th>
                  <th className="px-4 py-2.5">Assigned Manager</th>
                  <th className="px-4 py-2.5">Routing Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {scopes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      No routing scopes configured. Cases will be sent to the Unrouted Queue.
                    </td>
                  </tr>
                ) : (
                  scopes.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {s.clients?.name} <span className="font-mono-code text-slate-400">({s.clients?.code})</span>
                      </td>
                      <td className="px-4 py-3 font-mono-code">{s.case_type}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{s.users?.full_name}</td>
                      <td className="px-4 py-3">
                        {s.is_default ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 font-mono-code">
                            DEFAULT MATCH
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">
                            Eligible
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDeleteScope(s.id)}
                          className="text-red-600 hover:text-red-800 font-medium"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Manager Transfer Wizard */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 w-full max-w-md rounded-lg p-6 space-y-4 shadow-xl">
            <div>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold uppercase rounded font-mono-code">
                Constitutional Rule A9
              </span>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mt-1">
                Manager Transfer Wizard
              </h2>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Departing manager <span className="font-bold text-slate-900">{showTransferModal.full_name}</span>{' '}
              cannot be deactivated while open cases or subordinates exist. Select a successor manager to atomically
              reassign all open dockets, reporting staff, and routing scopes.
            </p>

            <form onSubmit={handleExecuteTransfer} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                  Successor Manager
                </label>
                <select
                  required
                  value={successorManagerId}
                  onChange={(e) => setSuccessorManagerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                >
                  <option value="">Select successor manager...</option>
                  {team
                    .filter((t) => t.id !== showTransferModal.id && t.is_active && (t.scope === 'ALL' || t.scope === 'TEAM'))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} (@{m.username})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                  Transfer Reason
                </label>
                <textarea
                  required
                  rows={2}
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="e.g. Employee resignation - Handover of open Star Health cases to North Region Manager"
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(null)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!successorManagerId || transferReason.length < 5}
                  className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded font-semibold uppercase tracking-wider disabled:opacity-50"
                >
                  Confirm & Deactivate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
