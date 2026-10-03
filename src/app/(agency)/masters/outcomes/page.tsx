'use client';

import React, { useState, useEffect } from 'react';
import { MastersNav } from '../nav';

interface Outcome {
  id: string;
  code: string;
  name: string;
  category: string;
  financial_rule: {
    investigator_payable_percent?: number;
    client_billable?: boolean;
    requires_fraud_reason?: boolean;
  };
  is_active: boolean;
}

export default function OutcomesMasterPage() {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'GENUINE' | 'FRAUD' | 'SUSPICIOUS' | 'REPUDIATED' | 'EXCEPTION' | 'PENDING'>('EXCEPTION');
  const [payablePercent, setPayablePercent] = useState(0);
  const [clientBillable, setClientBillable] = useState(true);
  const [requiresFraudReason, setRequiresFraudReason] = useState(false);

  const loadOutcomes = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/masters/outcomes');
      const json = await res.json();
      if (json.success) setOutcomes(json.data || []);
    } catch {
      setError('Failed to load outcomes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOutcomes();
  }, []);

  const handleCreateOutcome = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const res = await fetch('/api/masters/outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          category,
          financial_rule: {
            investigator_payable_percent: Number(payablePercent),
            client_billable: Boolean(clientBillable),
            requires_fraud_reason: Boolean(requiresFraudReason),
          },
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`Outcome "${name}" (${code}) saved with financial rule.`);
        setShowModal(false);
        setCode('');
        setName('');
        setPayablePercent(100);
        loadOutcomes();
      } else {
        setError(json.error);
      }
    } catch {
      setError('Network error creating outcome.');
    }
  };

  return (
    <div className="space-y-6">
      <MastersNav />

      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Outcomes, Exceptions & Financial Rules
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure investigation outcomes and exception lifecycle with automated financial triggers (e.g., Withdrawn → investigator payable 0).
          </p>
        </div>

        <button
          onClick={() => {
            setShowModal(true);
            setPayablePercent(100);
          }}
          className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold uppercase tracking-wider rounded transition"
        >
          + Add Outcome / Rule
        </button>
      </div>

      {/* Financial Rule Callout per A12 / TEST-05 */}
      <div className="p-3.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900 flex items-start space-x-3">
        <span className="font-bold text-base text-blue-700">⚖️</span>
        <div>
          <span className="font-bold">Constitutional Rule (TEST-05):</span>
          <span className="ml-1 text-blue-800">
            When a case outcome or exception is configured with <code>investigator_payable_percent: 0</code> (e.g. <strong>WITHDRAWN</strong>),
            the investigator payable calculation is zeroed automatically during fee resolution, preserving exact audit history.
          </span>
        </div>
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

      {/* Outcomes Table */}
      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading outcomes...</div>
        ) : outcomes.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No outcomes configured. Click &quot;+ Add Outcome / Rule&quot; to configure.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Outcome Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Investigator Payable</th>
                <th className="px-4 py-3">Client Billable</th>
                <th className="px-4 py-3">Fraud Reason Required</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {outcomes.map((out) => {
                const payable = out.financial_rule?.investigator_payable_percent ?? 100;
                const isZero = payable === 0;

                return (
                  <tr key={out.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono-code font-bold text-slate-900">{out.code}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{out.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        out.category === 'FRAUD'
                          ? 'bg-rose-100 text-rose-800'
                          : out.category === 'GENUINE'
                          ? 'bg-emerald-100 text-emerald-800'
                          : out.category === 'EXCEPTION'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-800'
                      }`}>
                        {out.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-mono-code font-bold ${isZero ? 'text-rose-600' : 'text-slate-800'}`}>
                        {payable}%
                      </span>
                      {isZero && (
                        <span className="ml-1.5 px-1.5 py-0.2 bg-rose-50 text-rose-700 text-[10px] font-semibold border border-rose-200 rounded">
                          ZERO FEE
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {out.financial_rule?.client_billable !== false ? (
                        <span className="text-emerald-700 font-semibold">Yes</span>
                      ) : (
                        <span className="text-slate-400">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {out.financial_rule?.requires_fraud_reason ? (
                        <span className="text-amber-700 font-semibold">Mandatory</span>
                      ) : (
                        <span className="text-slate-400">Optional</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-bold">
                        ACTIVE
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Outcome Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="font-bold text-sm text-slate-900">Configure Outcome / Exception</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOutcome} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Outcome Code * (e.g. WITHDRAWN)
                </label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="WITHDRAWN"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code uppercase focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Outcome Display Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Withdrawn by Insurer / Insured"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e: any) => setCategory(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded bg-white"
                >
                  <option value="GENUINE">Genuine</option>
                  <option value="FRAUD">Fraud</option>
                  <option value="SUSPICIOUS">Suspicious</option>
                  <option value="REPUDIATED">Repudiated</option>
                  <option value="EXCEPTION">Exception</option>
                  <option value="PENDING">Pending</option>
                </select>
              </div>

              {/* Financial Rule Config */}
              <div className="border border-slate-200 rounded p-3 bg-slate-50 space-y-3">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                  Financial Trigger Rules
                </span>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] font-semibold text-slate-600">
                      Investigator Payable Percentage (%)
                    </label>
                    <span className="font-mono-code text-xs font-bold text-blue-700">
                      {payablePercent}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="25"
                    value={payablePercent}
                    onChange={(e) => setPayablePercent(Number(e.target.value))}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono-code">
                    <span>0% (Zero Fee)</span>
                    <span>50%</span>
                    <span>100% (Full Fee)</span>
                  </div>
                </div>

                <div className="pt-2 space-y-2 border-t border-slate-200">
                  <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={clientBillable}
                      onChange={(e) => setClientBillable(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Billable to Client</span>
                  </label>

                  <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requiresFraudReason}
                      onChange={(e) => setRequiresFraudReason(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Requires Categorized Fraud Reason</span>
                  </label>
                </div>
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
                  Save Outcome
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
