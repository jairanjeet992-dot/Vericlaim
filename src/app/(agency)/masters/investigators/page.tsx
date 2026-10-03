'use client';

import React, { useState, useEffect } from 'react';
import { MastersNav } from '../nav';

interface PaymentTerm {
  id: string;
  payment_type: 'PER_CASE' | 'SALARY';
  base_fee_or_salary: number;
  effective_from: string;
  effective_to?: string | null;
  created_at: string;
}

interface Investigator {
  id: string;
  code: string;
  full_name: string;
  phone: string;
  email: string;
  pan_display: string;
  bank_account_display: string;
  bank_name?: string;
  bank_ifsc?: string;
  state: string;
  district: string;
  city: string;
  pincodes: string[];
  coverage_radius_km: number;
  capacity_max_active: number;
  specialization: string[];
  is_available: boolean;
  is_active: boolean;
  investigator_payment_terms?: PaymentTerm[];
}

export default function InvestigatorsMasterPage() {
  const [investigators, setInvestigators] = useState<Investigator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedInvestigator, setSelectedInvestigator] = useState<Investigator | null>(null);
  const [showTermModal, setShowTermModal] = useState<Investigator | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form State - Profile
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pan, setPan] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [capacity, setCapacity] = useState(15);
  const [specializations, setSpecializations] = useState('THEFT, ACCIDENT, CASHLESS');

  // Form State - Coverage
  const [state, setState] = useState('Madhya Pradesh');
  const [district, setDistrict] = useState('Indore');
  const [city, setCity] = useState('Indore');
  const [pincodes, setPincodes] = useState('452001, 452010');
  const [radiusKm, setRadiusKm] = useState(40);

  // Form State - Initial Payment Term
  const [paymentType, setPaymentType] = useState<'PER_CASE' | 'SALARY'>('PER_CASE');
  const [baseFeeOrSalary, setBaseFeeOrSalary] = useState(1200);
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));

  // Add Term Modal State
  const [newTermType, setNewTermType] = useState<'PER_CASE' | 'SALARY'>('SALARY');
  const [newTermAmount, setNewTermAmount] = useState(25000);
  const [newTermEffectiveFrom, setNewTermEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const loadInvestigators = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/masters/investigators');
      const json = await res.json();
      if (json.success) setInvestigators(json.data || []);
    } catch {
      setError('Failed to load investigators');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvestigators();
  }, []);

  const handleCreateInvestigator = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const res = await fetch('/api/masters/investigators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          full_name: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          pan: pan.trim().toUpperCase(),
          bank_account_number: bankAccount.trim(),
          bank_name: bankName.trim(),
          bank_ifsc: bankIfsc.trim().toUpperCase(),
          state: state.trim(),
          district: district.trim(),
          city: city.trim(),
          pincodes: pincodes.split(',').map((p) => p.trim()).filter(Boolean),
          coverage_radius_km: Number(radiusKm),
          capacity_max_active: Number(capacity),
          specialization: specializations.split(',').map((s) => s.trim()).filter(Boolean),
          initial_payment_term: {
            payment_type: paymentType,
            base_fee_or_salary: Number(baseFeeOrSalary),
            effective_from: effectiveFrom,
          },
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`Investigator "${fullName}" (${code}) onboarded with encrypted credentials.`);
        setShowAddModal(false);
        setCode('');
        setFullName('');
        setPan('');
        setBankAccount('');
        loadInvestigators();
      } else {
        setError(json.error);
      }
    } catch {
      setError('Network error onboarding investigator.');
    }
  };

  const handleAddPaymentTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showTermModal) return;
    setError(null);

    try {
      const res = await fetch(`/api/masters/investigators/${showTermModal.id}/terms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_type: newTermType,
          base_fee_or_salary: Number(newTermAmount),
          effective_from: newTermEffectiveFrom,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`Payment term added for ${showTermModal.full_name} effective ${newTermEffectiveFrom}.`);
        setShowTermModal(null);
        loadInvestigators();
      } else {
        setError(json.error);
      }
    } catch {
      setError('Network error adding payment term.');
    }
  };

  return (
    <div className="space-y-6">
      <MastersNav />

      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Investigators & Effective-Dated Terms
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Investigator roster with AES-256-GCM encrypted PAN/Bank details, geographic coverage, capacity, and historical payment terms.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold uppercase tracking-wider rounded transition"
        >
          + Onboard Investigator
        </button>
      </div>

      {/* Security Callout per A7 */}
      <div className="p-3.5 bg-slate-900 text-white rounded text-xs flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="text-base text-amber-400">🛡️</span>
          <div>
            <span className="font-bold text-amber-300">Constitutional Security (A7):</span>
            <span className="ml-1 text-slate-300">
              PAN and Bank credentials are stored encrypted using AES-256-GCM with HMAC blind indexing. Never stored in plaintext.
            </span>
          </div>
        </div>
        <span className="text-[10px] px-2 py-0.5 bg-slate-800 text-slate-300 rounded font-mono-code border border-slate-700">
          DPDP Act 2023 Compliant
        </span>
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

      {/* Investigators Table */}
      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading investigators...</div>
        ) : investigators.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No investigators found. Click &quot;+ Onboard Investigator&quot; to begin.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Code / Name</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Location & Coverage</th>
                <th className="px-4 py-3">PAN (Masked)</th>
                <th className="px-4 py-3">Bank (Masked)</th>
                <th className="px-4 py-3">Active Term</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {investigators.map((inv) => {
                const terms = inv.investigator_payment_terms || [];
                const latestTerm = terms[terms.length - 1];

                return (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{inv.full_name}</div>
                      <div className="font-mono-code text-[11px] text-blue-700">{inv.code}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{inv.phone}</div>
                      <div className="text-[11px] text-slate-400">{inv.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{inv.city}, {inv.state}</div>
                      <div className="text-[11px] text-slate-500 font-mono-code">
                        Radius: {inv.coverage_radius_km}km • Cap: {inv.capacity_max_active} cases
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono-code font-bold text-slate-800">
                      {inv.pan_display}
                    </td>
                    <td className="px-4 py-3 font-mono-code text-slate-700">
                      {inv.bank_account_display}
                    </td>
                    <td className="px-4 py-3">
                      {latestTerm ? (
                        <div className="space-y-0.5">
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            latestTerm.payment_type === 'SALARY'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {latestTerm.payment_type}
                          </span>
                          <div className="font-mono-code font-semibold text-slate-900">
                            ₹{latestTerm.base_fee_or_salary}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono-code">
                            Eff: {latestTerm.effective_from}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">No terms</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1.5">
                      <button
                        onClick={() => setSelectedInvestigator(inv)}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] rounded font-semibold border border-slate-200"
                      >
                        Profile
                      </button>
                      <button
                        onClick={() => {
                          setShowTermModal(inv);
                          setNewTermAmount(latestTerm?.payment_type === 'SALARY' ? 25000 : 1500);
                        }}
                        className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] rounded font-semibold border border-blue-200"
                      >
                        + Term
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Investigator Profile Details Modal */}
      {selectedInvestigator && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900">{selectedInvestigator.full_name}</h3>
                <span className="font-mono-code text-xs text-blue-700 font-bold">{selectedInvestigator.code}</span>
              </div>
              <button
                onClick={() => setSelectedInvestigator(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded border border-slate-200">
                <div>
                  <span className="text-[10px] font-semibold text-slate-500 uppercase block">PAN (Encrypted)</span>
                  <span className="font-mono-code font-bold text-slate-900">{selectedInvestigator.pan_display}</span>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-slate-500 uppercase block">Bank Account</span>
                  <span className="font-mono-code font-bold text-slate-900">{selectedInvestigator.bank_account_display}</span>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-slate-500 uppercase block">Bank Name & IFSC</span>
                  <span>{selectedInvestigator.bank_name || 'HDFC'} • {selectedInvestigator.bank_ifsc || 'HDFC0001234'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-slate-500 uppercase block">Max Active Capacity</span>
                  <span className="font-mono-code font-bold">{selectedInvestigator.capacity_max_active} concurrent cases</span>
                </div>
              </div>

              {/* Coverage */}
              <div className="bg-slate-50 p-3 rounded border border-slate-200 space-y-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block">Geographic Coverage</span>
                <div><strong>Location:</strong> {selectedInvestigator.city}, {selectedInvestigator.district}, {selectedInvestigator.state}</div>
                <div><strong>Radius:</strong> {selectedInvestigator.coverage_radius_km} km</div>
                <div><strong>Pincodes:</strong> {selectedInvestigator.pincodes?.join(', ') || 'All'}</div>
              </div>

              {/* Payment Terms History (Golden Tests TEST-03, TEST-04 Parity) */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    Effective-Dated Payment Terms History
                  </span>
                  <button
                    onClick={() => {
                      setShowTermModal(selectedInvestigator);
                      setSelectedInvestigator(null);
                    }}
                    className="text-blue-600 hover:text-blue-800 font-semibold text-[11px]"
                  >
                    + Add New Term
                  </button>
                </div>

                <div className="border border-slate-200 rounded overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-semibold">
                      <tr>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Amount (INR)</th>
                        <th className="px-3 py-2">Effective From</th>
                        <th className="px-3 py-2">Effective To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedInvestigator.investigator_payment_terms?.length ? (
                        selectedInvestigator.investigator_payment_terms.map((t) => (
                          <tr key={t.id}>
                            <td className="px-3 py-2 font-bold font-mono-code">{t.payment_type}</td>
                            <td className="px-3 py-2 font-mono-code">₹{t.base_fee_or_salary}</td>
                            <td className="px-3 py-2 font-mono-code">{t.effective_from}</td>
                            <td className="px-3 py-2 font-mono-code text-slate-400">
                              {t.effective_to || 'Open (Current)'}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-center text-slate-400">
                            No payment terms recorded.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedInvestigator(null)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs rounded font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Payment Term Modal */}
      {showTermModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="font-bold text-sm text-slate-900">Add Payment Term</h3>
              <button
                onClick={() => setShowTermModal(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-[11px] text-slate-500 mt-2">
              Add effective-dated terms for <strong>{showTermModal.full_name}</strong>. Prior terms are grandfathered.
            </p>

            <form onSubmit={handleAddPaymentTerm} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Payment Model
                </label>
                <select
                  value={newTermType}
                  onChange={(e: any) => setNewTermType(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded bg-white"
                >
                  <option value="PER_CASE">Per Case (Fee per completed investigation)</option>
                  <option value="SALARY">Salary (Monthly fixed payroll)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  {newTermType === 'SALARY' ? 'Monthly Salary (INR)' : 'Base Fee per Case (INR)'}
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={newTermAmount}
                  onChange={(e) => setNewTermAmount(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Effective From (YYYY-MM-DD)
                </label>
                <input
                  type="date"
                  required
                  value={newTermEffectiveFrom}
                  onChange={(e) => setNewTermEffectiveFrom(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowTermModal(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded"
                >
                  Save Term
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Onboard Investigator Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="font-bold text-sm text-slate-900">Onboard Field Investigator</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateInvestigator} className="mt-4 space-y-4">
              {/* Profile */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Investigator Code * (e.g. INV-001)
                  </label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="INV-001"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code uppercase"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Rajesh Kumar Verma"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Phone *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9876543210"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="rajesh.verma@example.com"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              {/* Encrypted Financial Credentials */}
              <div className="border border-slate-200 rounded p-3 bg-slate-50 space-y-3">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Financial Credentials (AES-256-GCM Encrypted)
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">
                      PAN Number *
                    </label>
                    <input
                      type="text"
                      required
                      value={pan}
                      onChange={(e) => setPan(e.target.value)}
                      placeholder="ABCDE1234F"
                      className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded font-mono-code uppercase"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">
                      Bank Account Number *
                    </label>
                    <input
                      type="text"
                      required
                      value={bankAccount}
                      onChange={(e) => setBankAccount(e.target.value)}
                      placeholder="50100234567890"
                      className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded font-mono-code"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">
                      Bank IFSC *
                    </label>
                    <input
                      type="text"
                      required
                      value={bankIfsc}
                      onChange={(e) => setBankIfsc(e.target.value)}
                      placeholder="HDFC0001234"
                      className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded font-mono-code uppercase"
                    />
                  </div>
                </div>
              </div>

              {/* Coverage */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    State
                  </label>
                  <input
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    District
                  </label>
                  <input
                    type="text"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Operating Pincodes (Comma separated)
                  </label>
                  <input
                    type="text"
                    value={pincodes}
                    onChange={(e) => setPincodes(e.target.value)}
                    placeholder="452001, 452002"
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded font-mono-code"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Coverage Radius (KM)
                  </label>
                  <input
                    type="number"
                    min="5"
                    value={radiusKm}
                    onChange={(e) => setRadiusKm(Number(e.target.value))}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded font-mono-code"
                  />
                </div>
              </div>

              {/* Initial Payment Terms */}
              <div className="border border-slate-200 rounded p-3 bg-slate-50 space-y-3">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                  Initial Payment Term
                </span>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">
                      Model
                    </label>
                    <select
                      value={paymentType}
                      onChange={(e: any) => setPaymentType(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                    >
                      <option value="PER_CASE">Per Case</option>
                      <option value="SALARY">Salary</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">
                      {paymentType === 'SALARY' ? 'Monthly Salary' : 'Fee per Case'}
                    </label>
                    <input
                      type="number"
                      value={baseFeeOrSalary}
                      onChange={(e) => setBaseFeeOrSalary(Number(e.target.value))}
                      className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded font-mono-code"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">
                      Effective Date
                    </label>
                    <input
                      type="date"
                      value={effectiveFrom}
                      onChange={(e) => setEffectiveFrom(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded font-mono-code"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded"
                >
                  Complete Onboarding
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
