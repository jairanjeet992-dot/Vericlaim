'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  Upload,
  CheckCircle2,
  Clock,
  MapPin,
  AlertTriangle,
  RefreshCw,
  Wifi,
  WifiOff,
  FileText,
  ChevronRight,
  Shield,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { compressFieldImage, computeSha256 } from '@/modules/evidence/image-compressor';
import { OfflineUploadQueue } from '@/modules/evidence/offline-queue';
import { OfflineQueueItem, EvidenceCategory } from '@/modules/evidence/types';

interface AssignedCase {
  id: string;
  doc_code: string;
  claim_no: string;
  insured_name: string;
  hospital_name: string | null;
  location_city: string;
  location_state: string;
  status: string;
  risk_level: string;
  due_date: string | null;
  clients?: { name: string; code: string };
}

interface AssignedActivity {
  id: string;
  case_id: string;
  activity_type: string;
  task_title: string;
  instructions: string | null;
  due_date: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  notes: string | null;
  completion_notes: string | null;
  case_claim_no?: string;
  case_insured_name?: string;
}

export default function InvestigatorDashboardPage() {
  const [cases, setCases] = useState<AssignedCase[]>([]);
  const [activities, setActivities] = useState<AssignedActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [queueItems, setQueueItems] = useState<OfflineQueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [selectedCase, setSelectedCase] = useState<AssignedCase | null>(null);

  // Activity Modal State
  const [completingActivity, setCompletingActivity] = useState<AssignedActivity | null>(null);
  const [completionNotes, setCompletionNotes] = useState('');
  const [submittingCompletion, setSubmittingCompletion] = useState(false);

  // Evidence Upload State
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<EvidenceCategory>('FIELD_PHOTO');
  const [selectedActivityId, setSelectedActivityId] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const offlineQueueRef = useRef<OfflineUploadQueue | null>(null);

  const handleProcessOfflineQueue = useCallback(async () => {
    if (!offlineQueueRef.current || syncing) return;
    setSyncing(true);
    try {
      await offlineQueueRef.current.processQueue();
      const updated = await offlineQueueRef.current.getItems();
      setQueueItems(updated);
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/investigator/dashboard');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setCases(json.cases || []);
          setActivities(json.activities || []);
          if (json.cases?.length > 0 && !selectedCase) {
            setSelectedCase(json.cases[0]);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCase]);

  // Initialize Queue and Network Listeners
  useEffect(() => {
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);

    const handleOnline = () => {
      setIsOnline(true);
      handleProcessOfflineQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const queue = new OfflineUploadQueue({
      uploadExecutor: async (item) => {
        try {
          // 1. Init upload
          const initRes = await fetch('/api/uploads/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              case_id: item.case_id,
              activity_id: item.activity_id,
              file_name: item.file_name,
              file_size: item.file_size,
              mime_type: item.mime_type,
              sha256_hash: item.sha256_hash,
              evidence_category: item.evidence_category,
              claimed_metadata: item.claimed_metadata,
            }),
          });
          const initData = await initRes.json();
          if (!initRes.ok || !initData.success) {
            return { success: false, error: initData.error || 'Failed to initialize upload' };
          }

          // 2. Direct PUT to R2 upload URL
          let uploadBody: any = item.blob;
          if (typeof item.blob === 'string' && item.blob.startsWith('data:')) {
            const base64Data = item.blob.split(',')[1];
            uploadBody = Buffer.from(base64Data, 'base64');
          }

          await fetch(initData.upload_url, {
            method: 'PUT',
            headers: initData.headers || { 'Content-Type': item.mime_type },
            body: uploadBody,
          });

          // 3. Complete upload with checksum
          const compRes = await fetch('/api/uploads/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              document_id: initData.document_id,
              actual_sha256: item.sha256_hash,
              actual_size: item.file_size,
            }),
          });
          const compData = await compRes.json();
          if (!compRes.ok || !compData.success) {
            return { success: false, error: compData.error || 'Failed to complete upload' };
          }

          return { success: true, documentId: initData.document_id };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    });

    offlineQueueRef.current = queue;
    queue.load().then((items) => setQueueItems(items));

    fetchDashboardData();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchDashboardData, handleProcessOfflineQueue]);

  // Activity Status Updates
  const handleUpdateActivityStatus = async (activityId: string, status: 'IN_PROGRESS') => {
    try {
      const res = await fetch(`/api/cases/${selectedCase?.id || 'active'}/activities/${activityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        fetchDashboardData();
      }
    } catch (err) {
      console.error('Failed to update activity status:', err);
    }
  };

  const handleCompleteActivitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingActivity || !completionNotes.trim()) return;

    setSubmittingCompletion(true);
    try {
      const res = await fetch(`/api/cases/${completingActivity.case_id}/activities/${completingActivity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          status: 'COMPLETED',
          completion_notes: completionNotes,
          completed_at: new Date().toISOString(),
        }),
      });

      if (res.ok) {
        setCompletingActivity(null);
        setCompletionNotes('');
        fetchDashboardData();
      } else {
        const errJson = await res.json();
        alert(`Error completing activity: ${errJson.error}`);
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    } finally {
      setSubmittingCompletion(false);
    }
  };

  // Direct Evidence Capture & Upload
  const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCase) return;

    setUploading(true);
    setUploadMessage(null);

    try {
      // 1. Get Claimed GPS if available
      let claimedGps: { latitude: number; longitude: number; accuracy: number; captured_at: string } | undefined;
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 8000,
              enableHighAccuracy: true,
            });
          });
          claimedGps = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            captured_at: new Date().toISOString(),
          };
        } catch {
          // GPS optional or timed out
        }
      }

      // 2. Compress image per Rule A8 (1600px max, q~0.75) and compute SHA-256
      let processedBlob: Blob | Buffer = file;
      let computedSha256 = '';
      let processedSize = file.size;

      if (file.type.startsWith('image/')) {
        const compressed = await compressFieldImage(file, 1600, 0.75);
        processedBlob = compressed.blob as Blob;
        computedSha256 = compressed.sha256Hash;
        processedSize = compressed.fileSize;
      } else {
        const arrayBuf = await file.arrayBuffer();
        computedSha256 = await computeSha256(arrayBuf);
      }

      // 3. If Offline: Add directly to persistent Offline Queue
      if (!isOnline || !navigator.onLine) {
        if (offlineQueueRef.current) {
          // Read blob as data URL for persistent offline storage
          const reader = new FileReader();
          const base64Data = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(processedBlob as Blob);
          });

          await offlineQueueRef.current.enqueue({
            case_id: selectedCase.id,
            activity_id: selectedActivityId || null,
            file_name: file.name,
            file_size: processedSize,
            mime_type: file.type || 'image/jpeg',
            sha256_hash: computedSha256,
            evidence_category: selectedCategory,
            claimed_metadata: claimedGps,
            blobData: base64Data,
          });

          const items = await offlineQueueRef.current.getItems();
          setQueueItems(items);
          setUploadMessage({
            type: 'success',
            text: 'Device is offline. Evidence added to offline queue and will automatically sync when online.',
          });
        }
        setUploading(false);
        setUploadModalOpen(false);
        return;
      }

      // 4. If Online: Execute standard 3-step pipeline (Init -> R2 PUT -> Complete)
      const initRes = await fetch('/api/uploads/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: selectedCase.id,
          activity_id: selectedActivityId || null,
          file_name: file.name,
          file_size: processedSize,
          mime_type: file.type || 'image/jpeg',
          sha256_hash: computedSha256,
          evidence_category: selectedCategory,
          claimed_metadata: claimedGps,
        }),
      });

      const initData = await initRes.json();
      if (!initRes.ok || !initData.success) {
        throw new Error(initData.error || 'Failed to initialize R2 upload');
      }

      // Direct PUT to Cloudflare R2
      await fetch(initData.upload_url, {
        method: 'PUT',
        headers: initData.headers || { 'Content-Type': file.type },
        body: processedBlob as Blob,
      });

      // Complete Upload
      const compRes = await fetch('/api/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: initData.document_id,
          actual_sha256: computedSha256,
          actual_size: processedSize,
        }),
      });

      const compData = await compRes.json();
      if (!compRes.ok || !compData.success) {
        throw new Error(compData.error || 'Failed to verify uploaded object');
      }

      setUploadMessage({
        type: 'success',
        text: `Evidence verified and vaulted to R2! SHA-256: ${computedSha256.substring(0, 12)}...`,
      });
      setUploadModalOpen(false);
    } catch (err: any) {
      setUploadMessage({
        type: 'error',
        text: err.message || 'Evidence upload failed',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20">
      {/* Top Mobile Bar with PWA Network Status */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Shield className="w-5 h-5 text-sky-400" />
          <span className="font-semibold text-sm tracking-wide">VERICLAIM FIELD</span>
          <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-1.5 py-0.5 rounded border border-slate-700">
            PWA
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Network indicator pill */}
          <span
            className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
              isOnline
                ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                : 'bg-amber-950/80 text-amber-400 border border-amber-800'
            }`}
          >
            {isOnline ? (
              <>
                <Wifi className="w-3 h-3 mr-1 text-emerald-400" /> Online
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 mr-1 text-amber-400" /> Offline
              </>
            )}
          </span>

          {/* Offline Queue Badge */}
          {queueItems.length > 0 && (
            <button
              onClick={handleProcessOfflineQueue}
              disabled={syncing || !isOnline}
              className="inline-flex items-center text-xs bg-sky-900 text-sky-200 border border-sky-700 px-2.5 py-1 rounded-md active:bg-sky-800"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${syncing ? 'animate-spin' : ''}`} />
              Queue ({queueItems.filter((i) => i.status !== 'COMPLETED').length})
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Banner Alert for Messages */}
        {uploadMessage && (
          <div
            className={`p-3 rounded-md text-sm border flex items-start space-x-2 ${
              uploadMessage.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
                : 'bg-rose-950/60 border-rose-800 text-rose-200'
            }`}
          >
            {uploadMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-400" />
            )}
            <div className="flex-1">{uploadMessage.text}</div>
            <button
              onClick={() => setUploadMessage(null)}
              className="text-xs text-slate-400 hover:text-slate-200 ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Assigned Cases Card Carousel / Selector */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Assigned Cases ({cases.length})
            </h2>
            <span className="text-[11px] text-slate-500 font-mono">Scope: ASSIGNED ONLY</span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-500 text-sm">Loading assigned cases...</div>
          ) : cases.length === 0 ? (
            <div className="p-8 bg-slate-900 rounded-lg border border-slate-800 text-center text-slate-400 text-sm">
              No active field assignments found. Cases assigned to you will appear here.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {cases.map((c) => {
                const isSelected = selectedCase?.id === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedCase(c)}
                    className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 border-sky-500 ring-1 ring-sky-500/40 shadow-sm'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-xs font-bold text-sky-400">{c.doc_code}</span>
                          <span className="text-[11px] bg-slate-800 text-slate-300 font-mono px-1.5 py-0.5 rounded">
                            {c.claim_no}
                          </span>
                        </div>
                        <h3 className="font-medium text-sm text-slate-100 mt-1">{c.insured_name}</h3>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {c.status}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400">
                      <div className="flex items-center space-x-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-500" />
                        <span>
                          {c.location_city}, {c.location_state}
                        </span>
                      </div>
                      {c.due_date && (
                        <div className="flex items-center space-x-1 text-amber-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Due {new Date(c.due_date).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Selected Case Quick Action Bar */}
        {selectedCase && (
          <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-md flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400">Active Case Target:</div>
              <div className="font-semibold text-sm text-slate-200">
                {selectedCase.insured_name} ({selectedCase.claim_no})
              </div>
            </div>
            <button
              onClick={() => setUploadModalOpen(true)}
              className="inline-flex items-center px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-semibold shadow active:scale-95 transition-transform"
            >
              <Camera className="w-4 h-4 mr-2" /> Capture Evidence
            </button>
          </div>
        )}

        {/* Activities List for Selected Case */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Investigation Activities ({activities.length})
            </h2>
          </div>

          {activities.length === 0 ? (
            <div className="p-6 bg-slate-900/50 rounded-lg border border-slate-800 text-center text-slate-500 text-sm">
              No field activities scheduled yet for this case.
            </div>
          ) : (
            <div className="space-y-3">
              {activities.map((act) => {
                const isCompleted = act.status === 'COMPLETED';
                const isInProgress = act.status === 'IN_PROGRESS';

                return (
                  <div
                    key={act.id}
                    className="p-4 bg-slate-900 rounded-lg border border-slate-800 space-y-2.5"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {act.activity_type.replace(/_/g, ' ')}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              isCompleted
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : isInProgress
                                ? 'bg-sky-950 text-sky-400 border border-sky-800'
                                : 'bg-amber-950 text-amber-400 border border-amber-800'
                            }`}
                          >
                            {act.status}
                          </span>
                        </div>
                        <h4 className="font-semibold text-sm text-slate-200">{act.task_title}</h4>
                      </div>

                      {act.due_date && (
                        <span className="text-xs text-slate-400 font-mono">
                          {new Date(act.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    {act.instructions && (
                      <p className="text-xs text-slate-400 bg-slate-950/60 p-2.5 rounded border border-slate-800/80">
                        {act.instructions}
                      </p>
                    )}

                    {act.completion_notes && (
                      <div className="text-xs text-emerald-400 bg-emerald-950/40 p-2.5 rounded border border-emerald-900/60">
                        <strong>Completion Notes:</strong> {act.completion_notes}
                      </div>
                    )}

                    {/* Action buttons with large touch targets */}
                    <div className="pt-2 flex items-center justify-end space-x-2">
                      {!isCompleted && !isInProgress && (
                        <button
                          onClick={() => handleUpdateActivityStatus(act.id, 'IN_PROGRESS')}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium border border-slate-700"
                        >
                          Start Activity
                        </button>
                      )}

                      {!isCompleted && (
                        <button
                          onClick={() => {
                            setCompletingActivity(act);
                            setCompletionNotes('');
                          }}
                          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold flex items-center"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Mark Complete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Complete Activity Modal */}
      {completingActivity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-100">
              Complete Activity: {completingActivity.task_title}
            </h3>
            <p className="text-xs text-slate-400">
              Provide thorough field observations and findings. Completion notes will be permanently logged.
            </p>

            <form onSubmit={handleCompleteActivitySubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Completion Notes / Field Report Summary *
                </label>
                <textarea
                  rows={4}
                  required
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="Summarize visit outcome, identity verification, verified documents..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCompletingActivity(null)}
                  className="px-3 py-2 text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingCompletion || !completionNotes.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-xs font-semibold disabled:opacity-50"
                >
                  {submittingCompletion ? 'Completing...' : 'Submit Completion'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Evidence Capture & Upload Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">Capture Field Evidence</h3>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Evidence Category</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value as EvidenceCategory)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100"
                >
                  <option value="FIELD_PHOTO">Field Photo</option>
                  <option value="HOSPITAL_RECORD">Hospital Record / IPD Paper</option>
                  <option value="CLAIMANT_ID">Claimant ID / Aadhaar</option>
                  <option value="TREATMENT_BILL">Treatment Bill / Pharmacy Receipt</option>
                  <option value="WITNESS_STATEMENT">Witness Statement</option>
                  <option value="AUDIO_RECORDING">Audio Recording</option>
                  <option value="POLICE_REPORT">Police FIR / Spot Memo</option>
                  <option value="INVESTIGATOR_NOTES">Investigator Rough Notes</option>
                  <option value="OTHER">Other Proof</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Link to Activity (Optional)</label>
                <select
                  value={selectedActivityId}
                  onChange={(e) => setSelectedActivityId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100"
                >
                  <option value="">-- Standalone Evidence --</option>
                  {activities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.task_title} ({a.activity_type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Big Touch Target Camera / File Trigger */}
              <div className="pt-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileCapture}
                  accept="image/*,video/*,application/pdf,audio/*"
                  capture="environment"
                  className="hidden"
                />

                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-4 px-4 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white rounded-xl flex flex-col items-center justify-center space-y-1 font-semibold text-sm transition-colors shadow-lg"
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="w-6 h-6 animate-spin" />
                      <span>Compressing & Vaulting to R2...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-6 h-6" />
                      <span>Tap to Open Camera / Select File</span>
                      <span className="text-[11px] font-normal text-sky-200">
                        Auto-compressed (1600px) + SHA-256 Checksum + Claimed GPS
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
