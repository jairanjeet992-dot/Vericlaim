'use client';

import React, { useState, useEffect } from 'react';
import { MastersNav } from '../nav';

interface SlaPolicy {
  id: string;
  name: string;
  target_hours: number;
  warning_threshold_percent: number;
  is_agency_default: boolean;
  is_active: boolean;
}

export default function SlaMasterPage() {
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [targetHours, setTargetHours] = useState(48);
  const [warningThreshold, setWarningThreshold] = useState(75);
  const [isAgencyDefault, setIsAgencyDefault] = useState(false);

  const presets = [
    { label: '12h (Spot / Urgent)', hours: 12 },
    { label: '24h (Express Cashless)', hours: 24 },
    { label: '48h (Standard PA)', hours: 48 },
    { label: '72h (Reimbursement)', hours: 72 },
    { label: '120h (Complex / Post Facto)', hours: 120 },
  ];

  const loadPolicies = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/masters/sla');
      const json = await res.json();
      if (json.success) setPolicies(json.data || []);
    } catch {
      setError('Failed to load SLA policies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolicies();
  }, []);

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const res = await fetch('/api/masters/sla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          target_hours: Number(targetHours),
          warning_threshold_percent: Number(warningThreshold),
          is_agency_default: Boolean(isAgencyDefault),
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`SLA Policy "${name}" (${targetHours}h) created successfully.`);
        setShowModal(false);
        setName('');
        setTargetHours(48);
        setIsAgencyDefault(false);
        loadPolicies();
      } else {
        setError(json.error);
      }
    } catch {
      setError('Network error creating SLA policy.');
    }
  };

  return (
    <div className="space-y-6">
      <MastersNav />

      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            SLA Policies Master
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure turnaround time (TAT) targets (12h, 24h, 48h, 72h, 120h, or custom). Exactly one agency default is designated.
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold uppercase tracking-wider rounded transition"
        >
          + Add SLA Policy
        </button>
      </div>

      {notification && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded">
          {notification}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
          {error}
        </div>
      )}

      {/* SLA Policies Table */}
      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading SLA policies...</div>
        ) : policies.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No SLA policies configured. Click &quot;+ Add SLA Policy&quot; to configure.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Policy Name</th>
                <th className="px-4 py-3">Target TAT</th>
                <th className="px-4 py-3">Warning At</th>
                <th className="px-4 py-3">Default Policy</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {policies.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{p.name}</td>
                  <td className="px-4 py-3 font-mono-code font-bold text-blue-700">
                    {p.target_hours} hours
                  </td>
                  <td className="px-4 py-3 font-mono-code text-amber-700">
                    {p.warning_threshold_percent}% ({Math.round((p.target_hours * p.warning_threshold_percent) / 100)}h)
                  </td>
                  <td className="px-4 py-3">
                    {p.is_agency_default ? (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-blue-100 text-blue-800 font-bold border border-blue-200">
                        ★ AGENCY DEFAULT
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-bold">
                      ACTIVE
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add SLA Policy Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="font-bold text-sm text-slate-900">Add SLA Policy</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePolicy} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Policy Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Standard 48-Hour SLA"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  Target Turnaround Time (Hours)
                </label>
                {/* Presets */}
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  {presets.map((preset) => (
                    <button
                      key={preset.hours}
                      type="button"
                      onClick={() => setTargetHours(preset.hours)}
                      className={`px-2 py-1 text-[11px] rounded border text-left font-medium transition ${
                        targetHours === preset.hours
                          ? 'bg-blue-50 border-blue-500 text-blue-800 font-bold'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="1"
                  max="720"
                  required
                  value={targetHours}
                  onChange={(e) => setTargetHours(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Warning Threshold (% of Target Hours)
                </label>
                <div className="flex items-center space-x-3">
                  <input
                    type="range"
                    min="50"
                    max="95"
                    step="5"
                    value={warningThreshold}
                    onChange={(e) => setWarningThreshold(Number(e.target.value))}
                    className="flex-1 accent-blue-600 cursor-pointer"
                  />
                  <span className="font-mono-code text-xs font-bold text-amber-700 w-12 text-right">
                    {warningThreshold}%
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Alert trigger at {Math.round((targetHours * warningThreshold) / 100)} hours elapsed.
                </p>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAgencyDefault}
                    onChange={(e) => setIsAgencyDefault(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span className="font-semibold">Set as Agency Default SLA</span>
                </label>
                <p className="text-[10px] text-slate-400 mt-0.5 ml-6">
                  Cases created without an explicit client SLA rule will inherit this policy.
                </p>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded"
                >
                  Save Policy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
