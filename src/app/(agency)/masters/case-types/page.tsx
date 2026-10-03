'use client';

import React, { useState, useEffect } from 'react';
import { MastersNav } from '../nav';
import { CustomFieldDefinition, compileCustomFieldsSchema } from '@/modules/masters/case-types';

interface CaseType {
  id: string;
  code: string;
  name: string;
  default_sla_hours: number;
  default_fee_rule: {
    base_fee: number;
    extra_km_rate?: number;
  };
  custom_field_definitions: CustomFieldDefinition[];
  is_active: boolean;
}

export default function CaseTypesMasterPage() {
  const [caseTypes, setCaseTypes] = useState<CaseType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedCaseType, setSelectedCaseType] = useState<CaseType | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [slaHours, setSlaHours] = useState(48);
  const [baseFee, setBaseFee] = useState(1500);
  const [extraKmRate, setExtraKmRate] = useState(8);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);

  // Add field sub-state
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<'text' | 'number' | 'date' | 'select' | 'boolean'>('text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState('');

  const loadCaseTypes = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/masters/case-types');
      const json = await res.json();
      if (json.success) setCaseTypes(json.data || []);
    } catch {
      setError('Failed to load case types');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCaseTypes();
  }, []);

  const handleAddField = () => {
    if (!newFieldName.trim() || !newFieldLabel.trim()) {
      alert('Field Name and Label are required');
      return;
    }

    const cleanName = newFieldName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const fieldDef: CustomFieldDefinition = {
      name: cleanName,
      label: newFieldLabel.trim(),
      type: newFieldType,
      required: newFieldRequired,
      options: newFieldType === 'select' ? newFieldOptions.split(',').map((o) => o.trim()).filter(Boolean) : undefined,
    };

    setCustomFields([...customFields, fieldDef]);
    setNewFieldName('');
    setNewFieldLabel('');
    setNewFieldType('text');
    setNewFieldRequired(false);
    setNewFieldOptions('');
  };

  const handleRemoveField = (index: number) => {
    setCustomFields(customFields.filter((_, i) => i !== index));
  };

  const handleCreateCaseType = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Verify dynamic schema compilation before saving
    try {
      compileCustomFieldsSchema(customFields);
    } catch (compileErr: any) {
      setError(`Custom fields schema compilation error: ${compileErr.message}`);
      return;
    }

    try {
      const res = await fetch('/api/masters/case-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          default_sla_hours: Number(slaHours),
          default_fee_rule: {
            base_fee: Number(baseFee),
            extra_km_rate: Number(extraKmRate),
          },
          custom_field_definitions: customFields,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`Case type "${name}" created successfully.`);
        setShowModal(false);
        setCode('');
        setName('');
        setCustomFields([]);
        loadCaseTypes();
      } else {
        setError(json.error);
      }
    } catch {
      setError('Network error creating case type.');
    }
  };

  return (
    <div className="space-y-6">
      <MastersNav />

      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Case Types & Custom Field Definitions
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Admin-configurable case categories without code changes. JSON custom field schemas validated dynamically by Zod.
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold uppercase tracking-wider rounded transition"
        >
          + Add Case Type
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

      {/* Case Types Table */}
      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading case types...</div>
        ) : caseTypes.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No case types configured. Click &quot;+ Add Case Type&quot; to configure your agency categories.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Default SLA</th>
                <th className="px-4 py-3">Base Fee (INR)</th>
                <th className="px-4 py-3">Custom Fields</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {caseTypes.map((ct) => (
                <tr key={ct.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono-code font-bold text-blue-700">{ct.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{ct.name}</td>
                  <td className="px-4 py-3 font-mono-code">{ct.default_sla_hours}h</td>
                  <td className="px-4 py-3 font-mono-code">₹{ct.default_fee_rule?.base_fee ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700 font-mono-code">
                      {ct.custom_field_definitions?.length || 0} fields
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-bold">
                      ACTIVE
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedCaseType(ct)}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] rounded font-semibold border border-slate-200"
                    >
                      View Fields
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Field Inspection Drawer / Modal */}
      {selectedCaseType && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  {selectedCaseType.name} ({selectedCaseType.code})
                </h3>
                <p className="text-[11px] text-slate-500">JSON-driven intake field schema</p>
              </div>
              <button
                onClick={() => setSelectedCaseType(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
              {selectedCaseType.custom_field_definitions?.length === 0 ? (
                <div className="text-xs text-slate-400 py-4 text-center">
                  Standard case fields only. No custom fields defined.
                </div>
              ) : (
                selectedCaseType.custom_field_definitions.map((def, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded border border-slate-200 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">{def.label}</span>
                      <span className="font-mono-code text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded uppercase font-bold">
                        {def.type}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 font-mono-code">
                      Field key: <span className="text-slate-700">{def.name}</span>
                      {def.required && <span className="ml-2 text-rose-600 font-semibold">• Required</span>}
                    </div>
                    {def.options && def.options.length > 0 && (
                      <div className="mt-1 text-[10px] text-slate-500">
                        Options: {def.options.join(', ')}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedCaseType(null)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs rounded font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Case Type Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="font-bold text-sm text-slate-900">Create Configurable Case Type</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCaseType} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Code * (e.g. THEFT)
                  </label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="THEFT"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code uppercase focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Display Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Vehicle Theft Investigation"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Default SLA (Hours)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={slaHours}
                    onChange={(e) => setSlaHours(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Base Fee (INR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={baseFee}
                    onChange={(e) => setBaseFee(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Extra KM Rate
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={extraKmRate}
                    onChange={(e) => setExtraKmRate(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded font-mono-code"
                  />
                </div>
              </div>

              {/* Dynamic Custom Fields Builder */}
              <div className="border border-slate-200 rounded p-4 bg-slate-50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Custom Intake Fields (Dynamic Schema)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {customFields.length} configured
                  </span>
                </div>

                {/* Existing added fields */}
                {customFields.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {customFields.map((f, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-white border border-slate-200 rounded text-xs">
                        <div>
                          <span className="font-semibold text-slate-800">{f.label}</span>
                          <span className="ml-2 font-mono-code text-[10px] text-slate-500">({f.name})</span>
                          <span className="ml-2 text-[10px] uppercase font-bold text-blue-600">[{f.type}]</span>
                          {f.required && <span className="ml-1 text-[10px] text-rose-500 font-bold">*</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveField(i)}
                          className="text-red-500 hover:text-red-700 font-bold text-xs"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* New field row */}
                <div className="p-3 bg-white border border-slate-200 rounded space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Field Key (e.g. fir_number)"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      className="text-xs px-2.5 py-1.5 border border-slate-300 rounded font-mono-code"
                    />
                    <input
                      type="text"
                      placeholder="Label (e.g. Police FIR Number)"
                      value={newFieldLabel}
                      onChange={(e) => setNewFieldLabel(e.target.value)}
                      className="text-xs px-2.5 py-1.5 border border-slate-300 rounded"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 items-center">
                    <select
                      value={newFieldType}
                      onChange={(e: any) => setNewFieldType(e.target.value)}
                      className="text-xs px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="select">Dropdown</option>
                      <option value="boolean">Yes/No</option>
                    </select>

                    <label className="flex items-center space-x-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newFieldRequired}
                        onChange={(e) => setNewFieldRequired(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>Required</span>
                    </label>

                    <button
                      type="button"
                      onClick={handleAddField}
                      className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded"
                    >
                      + Add Field
                    </button>
                  </div>

                  {newFieldType === 'select' && (
                    <input
                      type="text"
                      placeholder="Options comma-separated (e.g. Low, Medium, High)"
                      value={newFieldOptions}
                      onChange={(e) => setNewFieldOptions(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded"
                    />
                  )}
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
                  Save Case Type
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
