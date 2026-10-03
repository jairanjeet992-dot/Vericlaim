'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { HardcopyPacket, HardcopyMovement } from '@/modules/reports/types';

interface HardcopyTabProps {
  caseId: string;
  onRefreshCase: () => void;
}

export function HardcopyTab({ caseId, onRefreshCase }: HardcopyTabProps) {
  const [packets, setPackets] = useState<HardcopyPacket[]>([]);
  const [movements, setMovements] = useState<HardcopyMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Inward Packet Modal State
  const [showInwardModal, setShowInwardModal] = useState(false);
  const [packetNo, setPacketNo] = useState('');
  const [billsCount, setBillsCount] = useState(0);
  const [prescriptionsCount, setPrescriptionsCount] = useState(0);
  const [reportsCount, setReportsCount] = useState(0);
  const [photosCount, setPhotosCount] = useState(0);
  const [totalPagesCount, setTotalPagesCount] = useState(0);
  const [conditionNotes, setConditionNotes] = useState('');
  const [rack, setRack] = useState('R1');
  const [shelf, setShelf] = useState('S1');
  const [box, setBox] = useState('B1');

  // Relocate Modal State
  const [showRelocateModal, setShowRelocateModal] = useState(false);
  const [relocatingPacketId, setRelocatingPacketId] = useState<string | null>(null);
  const [newRack, setNewRack] = useState('R2');
  const [newShelf, setNewShelf] = useState('S1');
  const [newBox, setNewBox] = useState('B2');
  const [relocateMovementType, setRelocateMovementType] = useState<'STORED_IN_ARCHIVE' | 'RETRIEVED_FOR_REVIEW'>('STORED_IN_ARCHIVE');
  const [relocateNotes, setRelocateNotes] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const resPackets = await fetch(`/api/cases/${caseId}/hardcopy/packets`);
      const jsonPackets = await resPackets.json();
      if (jsonPackets.success) {
        setPackets(jsonPackets.data || []);
      }

      const resCustody = await fetch(`/api/cases/${caseId}/hardcopy/custody`);
      const jsonCustody = await resCustody.json();
      if (jsonCustody.success) {
        setMovements(jsonCustody.data || []);
      }
    } catch {
      setError('Failed to load hardcopy tracking data');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Inward Packet Submission
  const handleInward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packetNo.trim()) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/hardcopy/packets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packet_no: packetNo,
          item_counts: {
            bills: billsCount,
            prescriptions: prescriptionsCount,
            reports: reportsCount,
            photos: photosCount,
            total_pages: totalPagesCount,
          },
          condition_notes: conditionNotes,
          storage_location: {
            room: 'Main Archive',
            rack,
            shelf,
            box,
          },
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification(`Physical packet "${packetNo}" received and vaulted in Rack ${rack}/Shelf ${shelf}/Box ${box}.`);
        setShowInwardModal(false);
        setPacketNo('');
        setConditionNotes('');
        loadData();
        onRefreshCase();
      } else {
        setError(json.error || 'Failed to inward packet');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
  };

  // Handle Relocate
  const handleRelocate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relocatingPacketId) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/hardcopy/packets/${relocatingPacketId}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storage_location: {
            room: 'Main Archive',
            rack: newRack,
            shelf: newShelf,
            box: newBox,
          },
          movement_type: relocateMovementType,
          notes: relocateNotes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Storage location updated. Movement permanently logged.');
        setShowRelocateModal(false);
        loadData();
      } else {
        setError(json.error || 'Failed to update location');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-xs text-slate-400">Loading hardcopy dossiers...</div>;
  }

  return (
    <div className="space-y-6 text-xs">
      {notification && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded flex justify-between items-center">
          <span>{notification}</span>
          <button onClick={() => setNotification(null)} className="text-emerald-700 font-bold">✕</button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-700 font-bold">✕</button>
        </div>
      )}

      {/* Header Bar */}
      <div className="bg-white border border-slate-200 rounded p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            📦 Physical Hardcopy Tracking & Chain of Custody
          </h2>
          <p className="text-slate-500 text-[11px] mt-0.5">
            Append-only physical custody log (Rule A6): Records investigator reception, counts, rack/shelf/box archive, and client courier dispatch.
          </p>
        </div>
        <div>
          <button
            onClick={() => {
              setPacketNo(`PKT-${Math.floor(1000 + Math.random() * 9000)}`);
              setShowInwardModal(true);
            }}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded shadow-sm transition flex items-center gap-1.5"
          >
            + Inward Packet from Investigator
          </button>
        </div>
      </div>

      {/* Packets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {packets.length === 0 ? (
          <div className="col-span-2 bg-white border border-slate-200 rounded p-8 text-center space-y-2">
            <div className="text-2xl">📭</div>
            <div className="font-bold text-slate-700">No Hardcopy Packets Received Yet</div>
            <p className="text-slate-400 text-xs">
              When the field investigator delivers original hospital bills, prescriptions, and claim forms, inward them here.
            </p>
          </div>
        ) : (
          packets.map((pkt) => (
            <div key={pkt.id} className="bg-white border border-slate-200 rounded p-4 space-y-3 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-mono-code">Packet Number</span>
                  <div className="font-mono-code font-bold text-sm text-blue-700">{pkt.packet_no}</div>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  pkt.current_status === 'DELIVERED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : pkt.current_status === 'DISPATCHED'
                    ? 'bg-blue-100 text-blue-800'
                    : pkt.current_status === 'STORED'
                    ? 'bg-purple-100 text-purple-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {pkt.current_status}
                </span>
              </div>

              {/* Physical Location */}
              <div className="bg-slate-50 p-2.5 rounded border border-slate-100 flex justify-between items-center text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase block font-semibold">Storage Location:</span>
                  <span className="font-mono-code font-bold text-slate-800">
                    Rack {pkt.storage_location?.rack || 'R1'} • Shelf {pkt.storage_location?.shelf || 'S1'} • Box {pkt.storage_location?.box || 'B1'}
                  </span>
                </div>
                {pkt.current_status !== 'DISPATCHED' && pkt.current_status !== 'DELIVERED' && (
                  <button
                    onClick={() => {
                      setRelocatingPacketId(pkt.id);
                      setShowRelocateModal(true);
                    }}
                    className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded text-[10px]"
                  >
                    Relocate / Retrieve
                  </button>
                )}
              </div>

              {/* Item Counts */}
              <div className="grid grid-cols-5 gap-1 text-center font-mono-code pt-1 border-t border-slate-100">
                <div className="bg-slate-50 p-1.5 rounded">
                  <div className="text-[10px] text-slate-400">Bills</div>
                  <div className="font-bold text-slate-800">{pkt.item_counts?.bills || 0}</div>
                </div>
                <div className="bg-slate-50 p-1.5 rounded">
                  <div className="text-[10px] text-slate-400">Presc.</div>
                  <div className="font-bold text-slate-800">{pkt.item_counts?.prescriptions || 0}</div>
                </div>
                <div className="bg-slate-50 p-1.5 rounded">
                  <div className="text-[10px] text-slate-400">Reports</div>
                  <div className="font-bold text-slate-800">{pkt.item_counts?.reports || 0}</div>
                </div>
                <div className="bg-slate-50 p-1.5 rounded">
                  <div className="text-[10px] text-slate-400">Photos</div>
                  <div className="font-bold text-slate-800">{pkt.item_counts?.photos || 0}</div>
                </div>
                <div className="bg-blue-50 p-1.5 rounded">
                  <div className="text-[10px] text-blue-500 font-bold">Total Pgs</div>
                  <div className="font-bold text-blue-800">{pkt.item_counts?.total_pages || 0}</div>
                </div>
              </div>

              {pkt.condition_notes && (
                <div className="text-[11px] text-slate-500 italic">
                  Condition: {pkt.condition_notes}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Append-Only Chain of Custody Ledger */}
      <div className="bg-white border border-slate-200 rounded p-4 space-y-3 shadow-sm">
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
            Append-Only Chain of Custody Movement History ({movements.length} Events)
          </h3>
          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-mono-code font-bold border border-emerald-200">
            🔒 Append-Only Immutable (Cannot be edited or deleted)
          </span>
        </div>

        {movements.length === 0 ? (
          <div className="text-slate-400 py-4 text-center">No custody movements recorded yet.</div>
        ) : (
          <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {movements.map((m) => (
              <div key={m.id} className="relative text-xs space-y-1">
                <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-blue-600 ring-4 ring-white" />
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono-code text-slate-900">
                    {m.movement_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] font-mono-code text-slate-400">
                    {new Date(m.moved_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </span>
                </div>
                <div className="text-slate-600">
                  <span className="font-mono-code text-slate-500">{m.from_location}</span>
                  <span className="mx-1.5 text-blue-500 font-bold">→</span>
                  <span className="font-mono-code font-semibold text-slate-800">{m.to_location}</span>
                </div>
                {m.notes && <div className="text-[11px] text-slate-500 italic">{m.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inward Packet Modal */}
      {showInwardModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleInward} className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 border-b pb-2">
              Inward Physical Packet from Field Investigator
            </h3>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Packet Number / Envelope Code *</label>
              <input
                type="text"
                required
                value={packetNo}
                onChange={(e) => setPacketNo(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded font-mono-code"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">Rack *</label>
                <input
                  type="text"
                  required
                  value={rack}
                  onChange={(e) => setRack(e.target.value)}
                  className="w-full text-xs p-1.5 border border-slate-300 rounded font-mono-code"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">Shelf *</label>
                <input
                  type="text"
                  required
                  value={shelf}
                  onChange={(e) => setShelf(e.target.value)}
                  className="w-full text-xs p-1.5 border border-slate-300 rounded font-mono-code"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">Box / Bin *</label>
                <input
                  type="text"
                  required
                  value={box}
                  onChange={(e) => setBox(e.target.value)}
                  className="w-full text-xs p-1.5 border border-slate-300 rounded font-mono-code"
                />
              </div>
            </div>

            {/* Inventory Counts */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Document Counts Inventory</label>
              <div className="grid grid-cols-5 gap-1.5 text-center">
                <div>
                  <span className="text-[10px] text-slate-500 block">Bills</span>
                  <input
                    type="number"
                    min={0}
                    value={billsCount}
                    onChange={(e) => setBillsCount(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs p-1 border rounded text-center font-mono-code"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Presc.</span>
                  <input
                    type="number"
                    min={0}
                    value={prescriptionsCount}
                    onChange={(e) => setPrescriptionsCount(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs p-1 border rounded text-center font-mono-code"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Reports</span>
                  <input
                    type="number"
                    min={0}
                    value={reportsCount}
                    onChange={(e) => setReportsCount(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs p-1 border rounded text-center font-mono-code"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Photos</span>
                  <input
                    type="number"
                    min={0}
                    value={photosCount}
                    onChange={(e) => setPhotosCount(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs p-1 border rounded text-center font-mono-code"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block font-bold text-blue-600">Total Pgs</span>
                  <input
                    type="number"
                    min={0}
                    value={totalPagesCount}
                    onChange={(e) => setTotalPagesCount(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs p-1 border rounded text-center font-mono-code font-bold"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Physical Condition Notes</label>
              <input
                type="text"
                placeholder="e.g. Original signed hospital bills received in sealed brown envelope"
                value={conditionNotes}
                onChange={(e) => setConditionNotes(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowInwardModal(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
              >
                Inward & Vault Packet
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Relocate Modal */}
      {showRelocateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleRelocate} className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 border-b pb-2">
              Relocate / Retrieve Physical Packet
            </h3>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Movement Type</label>
              <select
                value={relocateMovementType}
                onChange={(e) => setRelocateMovementType(e.target.value as any)}
                className="w-full text-xs p-2 border border-slate-300 rounded"
              >
                <option value="STORED_IN_ARCHIVE">Relocate inside Archive Room</option>
                <option value="RETRIEVED_FOR_REVIEW">Retrieve to Reviewer Desk</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">New Rack *</label>
                <input
                  type="text"
                  required
                  value={newRack}
                  onChange={(e) => setNewRack(e.target.value)}
                  className="w-full text-xs p-1.5 border border-slate-300 rounded font-mono-code"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">New Shelf *</label>
                <input
                  type="text"
                  required
                  value={newShelf}
                  onChange={(e) => setNewShelf(e.target.value)}
                  className="w-full text-xs p-1.5 border border-slate-300 rounded font-mono-code"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">New Box *</label>
                <input
                  type="text"
                  required
                  value={newBox}
                  onChange={(e) => setNewBox(e.target.value)}
                  className="w-full text-xs p-1.5 border border-slate-300 rounded font-mono-code"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Handover Notes</label>
              <input
                type="text"
                placeholder="Reason for relocation"
                value={relocateNotes}
                onChange={(e) => setRelocateNotes(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowRelocateModal(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
              >
                Record Relocation Movement
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
