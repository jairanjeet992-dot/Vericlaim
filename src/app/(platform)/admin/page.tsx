'use client';

import React, { useState, useEffect } from 'react';

interface Agency {
  id: string;
  code: string;
  name: string;
  slug: string;
  state_code: string;
  is_active: boolean;
  created_at: string;
  agency_subscriptions?: Array<{
    plan_id: string;
    status: string;
    plans?: {
      id: string;
      name: string;
      tier: string;
      max_users: number;
      max_cases_per_month: number;
    };
  }>;
}

export default function PlatformAdminDashboard() {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOwnerModal, setShowOwnerModal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Agency Create Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [slug, setSlug] = useState('');
  const [stateCode, setStateCode] = useState('23');
  const [gstin, setGstin] = useState('');

  // Owner Form State
  const [ownerUsername, setOwnerUsername] = useState('admin');
  const [ownerFullName, setOwnerFullName] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');

  const loadAgencies = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/platform/agencies');
      const json = await res.json();
      if (json.success) {
        setAgencies(json.data || []);
      } else {
        setError(json.error || 'Failed to load agencies');
      }
    } catch {
      setError('Network error fetching agency tenants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgencies();
  }, []);

  const handleCreateAgency = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setActionSuccess(null);

    try {
      const res = await fetch('/api/platform/agencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code: code.trim().toUpperCase(),
          slug: slug.trim().toLowerCase(),
          state_code: stateCode,
          gstin: gstin ? gstin.trim() : null,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setActionSuccess(`Agency ${name} (${code}) created successfully.`);
        setShowCreateModal(false);
        setName('');
        setCode('');
        setSlug('');
        setGstin('');
        loadAgencies();
      } else {
        setError(json.error || 'Failed to create agency');
      }
    } catch {
      setError('Network error creating agency');
    }
  };

  const handleToggleSuspend = async (agency: Agency) => {
    const reason = window.prompt(
      `Enter reason for ${agency.is_active ? 'suspending' : 'activating'} agency ${agency.code}:`
    );
    if (!reason) return;

    try {
      const res = await fetch(`/api/platform/agencies/${agency.id}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: !agency.is_active,
          reason,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setActionSuccess(`Agency ${agency.code} status updated.`);
        loadAgencies();
      } else {
        setError(json.error || 'Failed to update agency status');
      }
    } catch {
      setError('Network error updating agency status');
    }
  };

  const handleCreateOwner = async (agencyId: string) => {
    setError(null);
    setActionSuccess(null);

    try {
      const res = await fetch(`/api/platform/agencies/${agencyId}/owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: ownerUsername.trim().toLowerCase(),
          full_name: ownerFullName.trim(),
          password: ownerPassword,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setActionSuccess(`First Owner (${ownerUsername}) provisioned successfully.`);
        setShowOwnerModal(null);
        setOwnerPassword('');
        setOwnerFullName('');
      } else {
        setError(json.error || 'Failed to provision owner');
      }
    } catch {
      setError('Network error provisioning owner');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Tenants & Agencies</h1>
          <p className="text-xs text-slate-400 mt-1">
            Super-admin isolation portal. Create, configure, and monitor agency tenants.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold uppercase tracking-wider rounded transition"
        >
          + Create Agency
        </button>
      </div>

      {actionSuccess && (
        <div className="p-3 bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs rounded">
          {actionSuccess}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-950 border border-red-800 text-red-300 text-xs rounded">
          {error}
        </div>
      )}

      {/* Metrics Banner */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-950 p-4 border border-slate-800 rounded">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Total Agencies</div>
          <div className="text-2xl font-bold font-mono-code text-white mt-1">{agencies.length}</div>
        </div>
        <div className="bg-slate-950 p-4 border border-slate-800 rounded">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Active Tenants</div>
          <div className="text-2xl font-bold font-mono-code text-emerald-400 mt-1">
            {agencies.filter((a) => a.is_active).length}
          </div>
        </div>
        <div className="bg-slate-950 p-4 border border-slate-800 rounded">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Suspended</div>
          <div className="text-2xl font-bold font-mono-code text-red-400 mt-1">
            {agencies.filter((a) => !a.is_active).length}
          </div>
        </div>
        <div className="bg-slate-950 p-4 border border-slate-800 rounded">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Free Tier Ratio</div>
          <div className="text-2xl font-bold font-mono-code text-blue-400 mt-1">
            {agencies.length > 0
              ? `${Math.round(
                  (agencies.filter((a) => a.agency_subscriptions?.[0]?.plans?.tier === 'free').length /
                    agencies.length) *
                    100
                )}%`
              : '0%'}
          </div>
        </div>
      </div>

      {/* Agencies Table */}
      <div className="bg-slate-950 border border-slate-800 rounded overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-center">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Registered Agency Tenants</span>
          <button
            onClick={loadAgencies}
            className="text-xs text-slate-400 hover:text-white transition"
          >
            Refresh
          </button>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
            <tr>
              <th className="px-4 py-2.5">Code</th>
              <th className="px-4 py-2.5">Agency Name</th>
              <th className="px-4 py-2.5">Plan</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-300">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Loading agencies...
                </td>
              </tr>
            ) : agencies.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No agencies registered. Click &quot;+ Create Agency&quot; to provision Tenant #1.
                </td>
              </tr>
            ) : (
              agencies.map((agency) => {
                const sub = agency.agency_subscriptions?.[0];
                const plan = sub?.plans;

                return (
                  <tr key={agency.id} className="hover:bg-slate-900/50">
                    <td className="px-4 py-3 font-mono-code font-bold text-white">{agency.code}</td>
                    <td className="px-4 py-3 font-medium">{agency.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300 border border-slate-700">
                        {plan?.name || 'Free Starter'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {agency.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-red-950 text-red-400 border border-red-800">
                          SUSPENDED
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono-code text-slate-500">
                      {new Date(agency.created_at).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => setShowOwnerModal(agency.id)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold"
                      >
                        + Owner
                      </button>
                      <button
                        onClick={() => handleToggleSuspend(agency)}
                        className={`px-2 py-1 rounded text-[11px] font-semibold ${
                          agency.is_active
                            ? 'bg-red-950 hover:bg-red-900 text-red-300 border border-red-800'
                            : 'bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800'
                        }`}
                      >
                        {agency.is_active ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Create Agency */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-lg p-6 space-y-4">
            <h2 className="text-base font-bold text-white tracking-tight">Create Agency Tenant</h2>
            <form onSubmit={handleCreateAgency} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                  Agency Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slug) {
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                    }
                  }}
                  placeholder="e.g. DNA Professional Investigation Agency"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                    Agency Code
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={16}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="e.g. DNA"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono-code uppercase"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                    Slug
                  </label>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    placeholder="e.g. dna-investigation"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono-code lowercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                    State Code (GST)
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={stateCode}
                    onChange={(e) => setStateCode(e.target.value)}
                    placeholder="23 (MP)"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono-code"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                    GSTIN (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={15}
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="23AAAAA0000A1Z5"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono-code uppercase"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-semibold"
                >
                  Create Agency
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create First Owner */}
      {showOwnerModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-lg p-6 space-y-4">
            <h2 className="text-base font-bold text-white tracking-tight">Provision First Agency Owner</h2>
            <p className="text-xs text-slate-400">
              Creates the root Owner account for this agency tenant with scope=ALL and full administrative permissions.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateOwner(showOwnerModal);
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={ownerUsername}
                  onChange={(e) => setOwnerUsername(e.target.value.toLowerCase())}
                  placeholder="admin"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono-code lowercase"
                />
              </div>

              <div>
                <label className="block text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={ownerFullName}
                  onChange={(e) => setOwnerFullName(e.target.value)}
                  placeholder="e.g. Agency Managing Director"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                  Initial Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono-code"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOwnerModal(null)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-semibold"
                >
                  Provision Owner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
