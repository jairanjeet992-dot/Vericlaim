'use client';

import React, { useState, useEffect } from 'react';
import { validateGstin, INDIAN_STATE_CODES } from '@/lib/validation/gstin';
import { MastersNav } from '../nav';

interface ClientBranch {
  id: string;
  branch_name: string;
  branch_code: string;
  legal_name: string;
  gstin: string;
  state: string;
  state_code: string;
  is_default: boolean;
}

interface Client {
  id: string;
  name: string;
  code: string;
  type: string;
  default_payment_terms_days: number;
  default_sla_hours: number;
  client_branches?: ClientBranch[];
}

export default function ClientsMasterPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState<Client | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Client Form State
  const [clientName, setClientName] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [clientType, setClientType] = useState('INSURER');
  const [slaHours, setSlaHours] = useState(48);
  const [termsDays, setTermsDays] = useState(30);

  // Branch Form State
  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('23');
  const [isDefaultBranch, setIsDefaultBranch] = useState(false);
  const [gstinFeedback, setGstinFeedback] = useState<{ isValid: boolean; message: string } | null>(null);

  const loadClients = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/masters/clients');
      const json = await res.json();
      if (json.success) setClients(json.data || []);
    } catch {
      setError('Failed to load clients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/masters/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clientName.trim(),
          code: clientCode.trim().toUpperCase(),
          type: clientType,
          default_sla_hours: Number(slaHours),
          default_payment_terms_days: Number(termsDays),
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`Client ${clientName} created successfully.`);
        setShowClientModal(false);
        setClientName('');
        setClientCode('');
        loadClients();
      } else {
        setError(json.error);
      }
    } catch {
      setError('Network error creating client.');
    }
  };

  const handleGstinChange = (val: string) => {
    const clean = val.toUpperCase().trim();
    setGstin(clean);
    if (clean.length === 15) {
      const result = validateGstin(clean, stateCode);
      if (result.isValid) {
        setGstinFeedback({ isValid: true, message: `Valid GSTIN: ${result.stateName} (PAN: ${result.pan})` });
      } else {
        setGstinFeedback({ isValid: false, message: result.error || 'Invalid GSTIN' });
      }
    } else {
      setGstinFeedback(null);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showBranchModal) return;
    setError(null);

    const validation = validateGstin(gstin, stateCode);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid GSTIN');
      return;
    }

    try {
      const res = await fetch(`/api/masters/clients/${showBranchModal.id}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_name: branchName.trim(),
          branch_code: branchCode.trim().toUpperCase(),
          legal_name: legalName.trim(),
          gstin: gstin.trim().toUpperCase(),
          state: INDIAN_STATE_CODES[stateCode] || 'Madhya Pradesh',
          state_code: stateCode,
          is_default: isDefaultBranch,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`Branch ${branchName} added with verified GSTIN.`);
        setShowBranchModal(null);
        setBranchName('');
        setBranchCode('');
        setGstin('');
        setLegalName('');
        loadClients();
      } else {
        setError(json.error);
      }
    } catch {
      setError('Network error adding branch.');
    }
  };

  return (
    <div className="space-y-6">
      <MastersNav />

      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Clients & GSTIN Branch Master
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Maintain insurance companies, TPAs, branches with GSTIN checksum validation, and billing profiles.
          </p>
        </div>

        <button
          onClick={() => setShowClientModal(true)}
          className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold uppercase tracking-wider rounded transition"
        >
          + Add Client
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

      {/* Clients List */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white p-8 text-center text-xs text-slate-400 border border-slate-200 rounded">
            Loading clients...
          </div>
        ) : clients.length === 0 ? (
          <div className="bg-white p-8 text-center text-xs text-slate-400 border border-slate-200 rounded">
            No clients created. Click &quot;+ Add Client&quot; to begin.
          </div>
        ) : (
          clients.map((client) => (
            <div key={client.id} className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sm text-slate-900">{client.name}</span>
                    <span className="font-mono-code text-xs px-2 py-0.5 bg-slate-200 text-slate-800 rounded font-semibold">
                      {client.code}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-800 rounded uppercase font-semibold">
                      {client.type}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex space-x-4">
                    <span>Default SLA: <strong className="text-slate-700 font-mono-code">{client.default_sla_hours}h</strong></span>
                    <span>Payment Terms: <strong className="text-slate-700 font-mono-code">{client.default_payment_terms_days} days</strong></span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setShowBranchModal(client);
                    setLegalName(client.name);
                  }}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded border border-slate-300 transition"
                >
                  + Add Branch (GSTIN)
                </button>
              </div>

              {/* Branches Table */}
              <div className="p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Operating Branches ({client.client_branches?.length || 0})
                </div>
                {client.client_branches && client.client_branches.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2">Branch Name</th>
                        <th className="px-3 py-2">Branch Code</th>
                        <th className="px-3 py-2">GSTIN</th>
                        <th className="px-3 py-2">State</th>
                        <th className="px-3 py-2">Legal Entity Name</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {client.client_branches.map((b) => (
                        <tr key={b.id}>
                          <td className="px-3 py-2 font-semibold text-slate-900">{b.branch_name}</td>
                          <td className="px-3 py-2 font-mono-code">{b.branch_code}</td>
                          <td className="px-3 py-2 font-mono-code font-bold text-blue-700">{b.gstin}</td>
                          <td className="px-3 py-2">{b.state} ({b.state_code})</td>
                          <td className="px-3 py-2 text-slate-500">{b.legal_name}</td>
                          <td className="px-3 py-2">
                            {b.is_default && (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-bold">
                                DEFAULT
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-slate-400 italic">No branches registered yet. Add at least one branch with GSTIN for invoicing.</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal: Add Client */}
      {showClientModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 w-full max-w-sm rounded-lg p-6 space-y-4 shadow-xl">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              Add Insurer / Corporate Client
            </h2>
            <form onSubmit={handleCreateClient} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                  Client Name
                </label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Star Health & Allied Insurance"
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                    Client Code
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={16}
                    value={clientCode}
                    onChange={(e) => setClientCode(e.target.value.toUpperCase())}
                    placeholder="e.g. STAR"
                    className="w-full px-3 py-2 border border-slate-300 rounded uppercase font-mono-code focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                    Client Type
                  </label>
                  <select
                    value={clientType}
                    onChange={(e) => setClientType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                  >
                    <option value="INSURER">Insurer</option>
                    <option value="TPA">TPA (Third Party)</option>
                    <option value="CORPORATE">Corporate</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                    Default SLA (Hours)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={slaHours}
                    onChange={(e) => setSlaHours(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded font-mono-code focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                    Payment Terms (Days)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={termsDays}
                    onChange={(e) => setTermsDays(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded font-mono-code focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowClientModal(false)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold"
                >
                  Save Client
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Branch with GSTIN Validation */}
      {showBranchModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 w-full max-w-md rounded-lg p-6 space-y-4 shadow-xl">
            <div>
              <span className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-mono-code font-bold">
                {showBranchModal.code}
              </span>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mt-1">
                Add Branch with Verified GSTIN
              </h2>
            </div>

            <form onSubmit={handleCreateBranch} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    required
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="e.g. Indore Regional Office"
                    className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                    Branch Code
                  </label>
                  <input
                    type="text"
                    required
                    value={branchCode}
                    onChange={(e) => setBranchCode(e.target.value.toUpperCase())}
                    placeholder="e.g. IND-01"
                    className="w-full px-3 py-2 border border-slate-300 rounded uppercase font-mono-code focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                  Legal Invoicing Name
                </label>
                <input
                  type="text"
                  required
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="e.g. Star Health & Allied Insurance Co Ltd"
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                    GST State Code
                  </label>
                  <select
                    value={stateCode}
                    onChange={(e) => {
                      setStateCode(e.target.value);
                      if (gstin.length === 15) {
                        const res = validateGstin(gstin, e.target.value);
                        setGstinFeedback(res.isValid ? { isValid: true, message: `Valid GSTIN: ${res.stateName}` } : { isValid: false, message: res.error || 'Invalid' });
                      }
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900 font-mono-code"
                  >
                    {Object.entries(INDIAN_STATE_CODES).map(([code, name]) => (
                      <option key={code} value={code}>
                        {code} - {name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                    15-Digit GSTIN
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={15}
                    value={gstin}
                    onChange={(e) => handleGstinChange(e.target.value)}
                    placeholder="23AAAAA0000A1Z5"
                    className="w-full px-3 py-2 border border-slate-300 rounded uppercase font-mono-code focus:outline-none focus:border-slate-900 font-bold"
                  />
                </div>
              </div>

              {gstinFeedback && (
                <div
                  className={`p-2 rounded text-[11px] font-medium ${
                    gstinFeedback.isValid
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}
                >
                  {gstinFeedback.message}
                </div>
              )}

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="defaultBranchCheck"
                  checked={isDefaultBranch}
                  onChange={(e) => setIsDefaultBranch(e.target.checked)}
                  className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                />
                <label htmlFor="defaultBranchCheck" className="text-slate-700 font-semibold cursor-pointer">
                  Set as Primary Invoicing Branch
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBranchModal(null)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!gstinFeedback?.isValid}
                  className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold disabled:opacity-50"
                >
                  Save Branch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
