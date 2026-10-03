'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

export default function HardcopyLogisticsPage() {
  const [dockets, setDockets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [showManifestModal, setShowManifestModal] = useState(false);
  const [activeManifest, setActiveManifest] = useState<any | null>(null);
  const [showAckModal, setShowAckModal] = useState(false);
  const [selectedDocketId, setSelectedDocketId] = useState<string | null>(null);
  const [ackRecipient, setAckRecipient] = useState('');
  const [ackNotes, setAckNotes] = useState('');
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dispatch form state
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [courierPartner, setCourierPartner] = useState('Blue Dart');
  const [awbNumber, setAwbNumber] = useState('');
  const [pendingPackets, setPendingPackets] = useState<any[]>([]);
  const [selectedPacketIds, setSelectedPacketIds] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const resDockets = await fetch('/api/hardcopy/dockets');
      const jsonDockets = await resDockets.json();
      if (jsonDockets.success) {
        setDockets(jsonDockets.data);
      }

      const resClients = await fetch('/api/masters/clients');
      const jsonClients = await resClients.json();
      if (jsonClients.success) {
        setClients(jsonClients.data);
        if (jsonClients.data.length > 0 && !selectedClientId) {
          setSelectedClientId(jsonClients.data[0].id);
        }
      }
    } catch {
      setError('Failed to load logistics data');
    } finally {
      setLoading(false);
    }
  }, [selectedClientId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenManifest = async (docketId: string) => {
    try {
      const res = await fetch(`/api/hardcopy/dockets/${docketId}/manifest`);
      const json = await res.json();
      if (json.success) {
        setActiveManifest(json.data);
        setShowManifestModal(true);
      } else {
        setError(json.error || 'Failed to load manifest');
      }
    } catch {
      setError('Network error loading manifest');
    }
  };

  const handleAcknowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDocketId) return;

    try {
      const res = await fetch(`/api/hardcopy/dockets/${selectedDocketId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_name: ackRecipient,
          acknowledgement_notes: ackNotes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Proof of Delivery (POD) confirmed. Cases updated.');
        setShowAckModal(false);
        setAckRecipient('');
        setAckNotes('');
        loadData();
      } else {
        setError(json.error || 'Failed to acknowledge delivery');
      }
    } catch {
      setError('Network error acknowledging delivery');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200 gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            📦 Hardcopy Logistics, Archive & Courier Manifests
          </h1>
          <p className="text-xs text-slate-500">
            Physical document chain of custody: Rack/Shelf/Box storage, bulk courier dockets, AWB tracking, and printable manifests.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/reports"
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-semibold transition"
          >
            ← Back to Reports
          </Link>
        </div>
      </div>

      {notification && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded flex justify-between items-center">
          <span>{notification}</span>
          <button onClick={() => setNotification(null)} className="text-emerald-600 font-bold hover:text-emerald-900">✕</button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-600 font-bold hover:text-rose-900">✕</button>
        </div>
      )}

      {/* Dockets Ledger */}
      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Courier Manifests & Outward Dockets
          </h2>
          <span className="text-[11px] text-slate-500 font-mono-code">
            Total Dockets: {dockets.length}
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading logistics dockets...</div>
        ) : dockets.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No courier manifests dispatched yet. Dockets are created when hardcopy packets are handed over to couriers.
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <th className="p-2.5">Docket Number</th>
                <th className="p-2.5">Client & Branch</th>
                <th className="p-2.5">Courier & AWB</th>
                <th className="p-2.5">Dispatched</th>
                <th className="p-2.5">Delivery Status</th>
                <th className="p-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {dockets.map((dock) => (
                <tr key={dock.id} className="hover:bg-slate-50 transition">
                  <td className="p-2.5 font-mono-code font-bold text-blue-700">
                    {dock.docket_number}
                  </td>
                  <td className="p-2.5">
                    <div className="font-semibold text-slate-800">{dock.clients?.name || 'Client'}</div>
                    <div className="text-[11px] text-slate-500">{dock.client_branches?.branch_name || 'Main Branch'}</div>
                  </td>
                  <td className="p-2.5">
                    <div className="font-semibold text-slate-800">{dock.courier_partner}</div>
                    <div className="text-[11px] font-mono-code text-slate-600">AWB: {dock.awb_number}</div>
                  </td>
                  <td className="p-2.5 text-slate-600">
                    {new Date(dock.dispatched_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    <div className="text-[10px] text-slate-400">By: {dock.users?.full_name || 'Staff'}</div>
                  </td>
                  <td className="p-2.5">
                    {dock.delivery_status === 'DELIVERED' ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                        ✓ DELIVERED (POD)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                        🚚 IN TRANSIT
                      </span>
                    )}
                  </td>
                  <td className="p-2.5 text-right space-x-2">
                    <button
                      onClick={() => handleOpenManifest(dock.id)}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px] transition"
                    >
                      📄 Manifest
                    </button>
                    {dock.delivery_status !== 'DELIVERED' && (
                      <button
                        onClick={() => {
                          setSelectedDocketId(dock.id);
                          setShowAckModal(true);
                        }}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold text-[11px] transition"
                      >
                        Acknowledge POD
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Printable Manifest Modal */}
      {showManifestModal && activeManifest && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl p-6 text-xs text-slate-800 space-y-4">
            {/* Manifest Header */}
            <div className="border-b-2 border-slate-900 pb-3 flex justify-between items-start">
              <div>
                <h2 className="text-base font-bold text-slate-900 uppercase tracking-tight">
                  {activeManifest.agencyName}
                </h2>
                <p className="text-[11px] text-slate-600">Official Physical Courier Manifest & Chain of Custody Handover</p>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold font-mono-code text-blue-700">{activeManifest.docketNumber}</div>
                <div className="text-[10px] text-slate-500 font-mono-code">AWB: {activeManifest.awbNumber}</div>
              </div>
            </div>

            {/* Courier & Client Details */}
            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded border border-slate-200">
              <div>
                <span className="text-[10px] font-semibold text-slate-500 uppercase">Consignee (Insurer Client):</span>
                <div className="font-bold text-slate-900 mt-0.5">{activeManifest.clientName}</div>
                <div className="text-[11px] text-slate-600">{activeManifest.clientBranchName}</div>
              </div>
              <div>
                <span className="text-[10px] font-semibold text-slate-500 uppercase">Logistics Carrier:</span>
                <div className="font-bold text-slate-900 mt-0.5">{activeManifest.courierPartner}</div>
                <div className="text-[11px] text-slate-600">
                  Dispatched: {new Date(activeManifest.dispatchedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </div>
              </div>
            </div>

            {/* Packets & Inventory Breakdown */}
            <div>
              <div className="text-xs font-bold text-slate-800 mb-2 uppercase">
                Enclosed Physical Dossiers ({activeManifest.totalPackets} Packets, {activeManifest.totalDocs} Documents)
              </div>
              <table className="w-full text-left border-collapse border border-slate-200">
                <thead>
                  <tr className="bg-slate-100 font-bold border-b border-slate-200 text-[11px]">
                    <th className="p-2">Packet #</th>
                    <th className="p-2">Claim / Docket</th>
                    <th className="p-2">Insured Subject</th>
                    <th className="p-2 text-right">Bills</th>
                    <th className="p-2 text-right">Presc.</th>
                    <th className="p-2 text-right">Reports</th>
                    <th className="p-2 text-right">Photos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {activeManifest.packets?.map((p: any, idx: number) => (
                    <tr key={idx}>
                      <td className="p-2 font-mono-code font-bold text-blue-700">{p.packetNo}</td>
                      <td className="p-2 font-mono-code">{p.claimNo}</td>
                      <td className="p-2 font-medium">{p.insuredName}</td>
                      <td className="p-2 text-right font-mono-code">{p.itemCounts?.bills || 0}</td>
                      <td className="p-2 text-right font-mono-code">{p.itemCounts?.prescriptions || 0}</td>
                      <td className="p-2 text-right font-mono-code">{p.itemCounts?.reports || 0}</td>
                      <td className="p-2 text-right font-mono-code">{p.itemCounts?.photos || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Signatures & Seal */}
            <div className="grid grid-cols-3 gap-6 pt-6 border-t border-slate-200 text-center">
              <div>
                <div className="h-10 border-b border-dashed border-slate-400"></div>
                <div className="text-[10px] font-bold text-slate-600 mt-1">Dispatched By ({activeManifest.dispatchedByName})</div>
              </div>
              <div>
                <div className="h-10 border-b border-dashed border-slate-400"></div>
                <div className="text-[10px] font-bold text-slate-600 mt-1">Courier Pickup Signature & Seal</div>
              </div>
              <div>
                <div className="h-10 border-b border-dashed border-slate-400"></div>
                <div className="text-[10px] font-bold text-slate-600 mt-1">Client Consignee Acknowledged</div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                onClick={() => window.print()}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded font-bold text-xs"
              >
                🖨️ Print Manifest
              </button>
              <button
                onClick={() => setShowManifestModal(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Acknowledge POD Modal */}
      {showAckModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleAcknowledge} className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b pb-2">
              Acknowledge Proof of Delivery (POD)
            </h3>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Recipient / Receiver Name at Client Office *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Mr. Rajesh Sharma (Claims Desk)"
                value={ackRecipient}
                onChange={(e) => setAckRecipient(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Acknowledgement Remarks / Notes
              </label>
              <textarea
                rows={2}
                placeholder="All packet envelopes received intact with seals unbroken"
                value={ackNotes}
                onChange={(e) => setAckNotes(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowAckModal(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
              >
                Confirm Delivery (Close Dockets)
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
