'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface CaseItem {
  id: string;
  doc_code: string;
  claim_no?: string;
  claim_number?: string;
  insured_name?: string;
  clients?: { name: string; code: string };
  case_types?: { name: string; code: string };
  case_type?: string;
  status: string;
  outcome: string;
  risk_level: string;
  owner_manager_id: string;
  created_at: string;
}

interface ClientOption {
  id: string;
  name: string;
  code: string;
}

interface CaseTypeOption {
  id: string;
  name: string;
  code: string;
  custom_field_definitions?: any[];
}

export default function CasesPage() {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Intake Modal
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [caseTypes, setCaseTypes] = useState<CaseTypeOption[]>([]);

  // Form State
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedCaseTypeId, setSelectedCaseTypeId] = useState('');
  const [claimNo, setClaimNo] = useState('');
  const [policyNo, setPolicyNo] = useState('');
  const [insuredName, setInsuredName] = useState('');
  const [patientName, setPatientName] = useState('');
  const [hospitalName, setHospitalName] = useState('');
  const [hospitalCity, setHospitalCity] = useState('');
  const [claimAmount, setClaimAmount] = useState(50000);
  const [riskLevel, setRiskLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('LOW');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});

  const loadCases = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`/api/cases?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setCases(json.data || []);
      } else {
        setError(json.error || 'Failed to query cases');
      }
    } catch {
      setError('Network error fetching scoped cases');
    } finally {
      setLoading(false);
    }
  };

  const loadMasters = async () => {
    try {
      const [resClients, resTypes] = await Promise.all([
        fetch('/api/masters/clients'),
        fetch('/api/masters/case-types'),
      ]);
      const jsonClients = await resClients.json();
      const jsonTypes = await resTypes.json();
      if (jsonClients.success) setClients(jsonClients.data || []);
      if (jsonTypes.success) setCaseTypes(jsonTypes.data || []);
    } catch {
      // masters load silently
    }
  };

  useEffect(() => {
    loadCases();
    loadMasters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const selectedCaseTypeObj = caseTypes.find((t) => t.id === selectedCaseTypeId);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: selectedClientId,
          case_type_id: selectedCaseTypeId,
          claim_no: claimNo.trim(),
          policy_no: policyNo.trim(),
          insured_name: insuredName.trim(),
          patient_name: patientName.trim() || undefined,
          hospital_name: hospitalName.trim() || undefined,
          hospital_city: hospitalCity.trim() || undefined,
          claim_amount: Number(claimAmount),
          risk_level: riskLevel,
          custom_fields: customFieldValues,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`Case intake successful! Allocated Doc Code: ${json.data.doc_code}`);
        setShowIntakeModal(false);
        setClaimNo('');
        setPolicyNo('');
        setInsuredName('');
        setCustomFieldValues({});
        loadCases();
      } else {
        setError(json.error);
      }
    } catch {
      setError('Network error during case intake.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Cases Ledger & Operational Pipeline
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            End-to-end investigation cases governed by workflow state machine, optimistic locking, and scope security.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              if (clients.length > 0 && !selectedClientId) setSelectedClientId(clients[0].id);
              if (caseTypes.length > 0 && !selectedCaseTypeId) setSelectedCaseTypeId(caseTypes[0].id);
              setShowIntakeModal(true);
            }}
            className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold uppercase tracking-wider rounded transition"
          >
            + New Case Intake
          </button>
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

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-white/10 rounded-xl">
        <div className="flex items-center space-x-3 flex-1 min-w-[240px]">
          <input
            type="text"
            placeholder="Search by Doc Code or Claim Number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadCases()}
            className="text-xs px-3 py-1.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 rounded-lg w-full max-w-sm font-mono-code focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={loadCases}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700"
          >
            Search
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 focus:outline-none"
          >
            <option value="">All Statuses</option>
            <option value="DATA_ENTRY">Data Entry</option>
            <option value="VERIFICATION">Verification</option>
            <option value="ASSIGNMENT">Assignment</option>
            <option value="FIELD_INVESTIGATION">Field Investigation</option>
            <option value="REPORT_REVIEW">Report Review</option>
            <option value="APPROVED">Approved</option>
            <option value="CLOSED">Closed</option>
            <option value="WITHDRAWN">Withdrawn (Exception)</option>
          </select>
        </div>
      </div>

      {/* Cases Table */}
      <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-950/90 border-b border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">Doc Code</th>
              <th className="px-4 py-3">Claim / Policy</th>
              <th className="px-4 py-3">Insured / Subject</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Case Type</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-slate-700 dark:text-slate-300">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  Loading cases ledger...
                </td>
              </tr>
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  No cases found matching criteria. Click &quot;+ New Case Intake&quot; to register a claim.
                </td>
              </tr>
            ) : (
              cases.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition">
                  <td className="px-4 py-3 font-mono-code font-bold text-blue-700 dark:text-blue-400">
                    <Link href={`/cases/${c.id}`} className="hover:underline">
                      {c.doc_code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono-code font-semibold text-slate-900 dark:text-white">{c.claim_no || c.claim_number}</div>
                    <div className="font-mono-code text-[10px] text-slate-400 dark:text-slate-500">Claim ID</div>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {c.insured_name || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-slate-800">{c.clients?.name || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 font-mono-code text-slate-700 font-bold">
                      {c.case_types?.code || c.case_type || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      c.risk_level === 'CRITICAL'
                        ? 'bg-rose-100 text-rose-800'
                        : c.risk_level === 'HIGH'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}>
                      {c.risk_level}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      c.status === 'APPROVED' || c.status === 'CLOSED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : c.status === 'WITHDRAWN'
                        ? 'bg-rose-100 text-rose-800'
                        : c.status === 'REPORT_REVIEW'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono-code text-[11px] font-semibold text-slate-700">
                      {c.outcome || 'PENDING'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/cases/${c.id}`}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold rounded border border-slate-200"
                    >
                      Open Case →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* New Case Intake Modal */}
      {showIntakeModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="font-bold text-sm text-slate-900">New Investigation Case Intake</h3>
              <button
                onClick={() => setShowIntakeModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCase} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Client / Insurer *
                  </label>
                  <select
                    required
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded bg-white"
                  >
                    {clients.map((cl) => (
                      <option key={cl.id} value={cl.id}>
                        {cl.name} ({cl.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Case Category *
                  </label>
                  <select
                    required
                    value={selectedCaseTypeId}
                    onChange={(e) => {
                      setSelectedCaseTypeId(e.target.value);
                      setCustomFieldValues({});
                    }}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded bg-white"
                  >
                    {caseTypes.map((ct) => (
                      <option key={ct.id} value={ct.id}>
                        {ct.name} ({ct.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Claim Number * (Normalized Unique)
                  </label>
                  <input
                    type="text"
                    required
                    value={claimNo}
                    onChange={(e) => setClaimNo(e.target.value)}
                    placeholder="CLM-2026-98124"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code uppercase"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Policy Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={policyNo}
                    onChange={(e) => setPolicyNo(e.target.value)}
                    placeholder="POL-887766-01"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Insured Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={insuredName}
                    onChange={(e) => setInsuredName(e.target.value)}
                    placeholder="Suresh Chandra Gupta"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Patient / Claimant Name
                  </label>
                  <input
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder="Rohan Gupta"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Hospital / Entity
                  </label>
                  <input
                    type="text"
                    value={hospitalName}
                    onChange={(e) => setHospitalName(e.target.value)}
                    placeholder="CHL Hospital"
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={hospitalCity}
                    onChange={(e) => setHospitalCity(e.target.value)}
                    placeholder="Indore"
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Claim Amount (INR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={claimAmount}
                    onChange={(e) => setClaimAmount(Number(e.target.value))}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded font-mono-code"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Risk Level
                </label>
                <div className="flex space-x-3">
                  {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((lvl) => (
                    <label key={lvl} className="flex items-center space-x-1.5 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="risk"
                        checked={riskLevel === lvl}
                        onChange={() => setRiskLevel(lvl)}
                      />
                      <span>{lvl}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Dynamic Custom Fields from Master */}
              {selectedCaseTypeObj?.custom_field_definitions && selectedCaseTypeObj.custom_field_definitions.length > 0 && (
                <div className="border border-slate-200 rounded p-3 bg-slate-50 space-y-3">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                    Category Specific Fields ({selectedCaseTypeObj.name})
                  </span>

                  <div className="grid grid-cols-2 gap-3">
                    {selectedCaseTypeObj.custom_field_definitions.map((def: any) => (
                      <div key={def.name}>
                        <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">
                          {def.label} {def.required && <span className="text-rose-500">*</span>}
                        </label>
                        {def.type === 'select' ? (
                          <select
                            required={def.required}
                            value={customFieldValues[def.name] || ''}
                            onChange={(e) =>
                              setCustomFieldValues({ ...customFieldValues, [def.name]: e.target.value })
                            }
                            className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                          >
                            <option value="">Select...</option>
                            {def.options?.map((opt: string) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : def.type === 'boolean' ? (
                          <label className="flex items-center space-x-2 text-xs cursor-pointer pt-1">
                            <input
                              type="checkbox"
                              checked={Boolean(customFieldValues[def.name])}
                              onChange={(e) =>
                                setCustomFieldValues({ ...customFieldValues, [def.name]: e.target.checked })
                              }
                            />
                            <span>Yes</span>
                          </label>
                        ) : (
                          <input
                            type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
                            required={def.required}
                            value={customFieldValues[def.name] || ''}
                            onChange={(e) =>
                              setCustomFieldValues({ ...customFieldValues, [def.name]: e.target.value })
                            }
                            className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowIntakeModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded"
                >
                  Register Case
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
