'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { compressFieldImage, computeSha256 } from '@/modules/evidence/image-compressor';
import { ReportTab } from './report-tab';
import { HardcopyTab } from './hardcopy-tab';

interface CaseDetail {
  id: string;
  doc_code: string;
  claim_no?: string;
  claim_number?: string;
  policy_no?: string;
  insured_name?: string;
  patient_name?: string;
  claimant_name?: string;
  hospital_name?: string;
  hospital_city?: string;
  hospital_state?: string;
  loss_date?: string;
  admission_date?: string;
  discharge_date?: string;
  claim_amount: number;
  location_city?: string;
  location_state?: string;
  risk_level: string;
  status: string;
  outcome: string;
  fraud_reason?: string;
  exception_type?: string;
  exception_reason?: string;
  version: number;
  rework_count: number;
  custom_fields: Record<string, any>;
  owner_manager_id: string;
  created_at: string;
  clients?: { name: string; code: string };
  case_types?: { name: string; code: string; custom_field_definitions?: any[] };
  users?: { full_name: string; email: string };
}

interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  description?: string;
  created_at: string;
  status?: string;
  metadata?: any;
}

interface AssignmentItem {
  id: string;
  case_id: string;
  investigator_id: string;
  assignment_scope: string;
  status: string;
  agreed_fee: number;
  travel_allowance: number;
  payout_status: string;
  hardcopy_status: string;
  rejection_reason?: string;
  reassignment_reason?: string;
  reassigned_to_id?: string;
  override_reason?: string;
  is_active: boolean;
  assigned_at: string;
  accepted_at?: string;
  rejected_at?: string;
  reassigned_at?: string;
  investigators?: { id: string; code: string; full_name: string; phone: string };
  assigned_by_user?: { id: string; full_name: string };
}

interface EligibleCandidate {
  investigator: {
    id: string;
    code: string;
    full_name: string;
    phone: string;
    city: string;
    state: string;
    pincodes: string[];
    current_active_cases: number;
    max_active_cases: number;
  };
  total_score: number;
  rank: number;
  is_eligible: boolean;
  is_available: boolean;
  is_overloaded: boolean;
  breakdown: {
    location_score: number;
    workload_score: number;
    specialization_score: number;
    cluster_score: number;
    sla_rating_score: number;
  };
  recommendation_reason: string;
  warnings: string[];
}

export default function CaseDetailPage() {
  const params = useParams();
  const caseId = params?.id as string;

  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [candidates, setCandidates] = useState<EligibleCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'assignments' | 'activities' | 'evidence' | 'report' | 'hardcopy' | 'timeline' | 'notes' | 'tasks'>('overview');
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Transition Modal State
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string>('');
  const [transitionReason, setTransitionReason] = useState<string>('');
  const [targetOutcome, setTargetOutcome] = useState<string>('GENUINE');
  const [fraudReason, setFraudReason] = useState<string>('');

  // Assignment Modal States
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<EligibleCandidate | null>(null);
  const [assignScope, setAssignScope] = useState('PRIMARY');
  const [customFee, setCustomFee] = useState<number | ''>('');
  const [customTa, setCustomTa] = useState<number | ''>('');
  const [overrideReason, setOverrideReason] = useState('');

  // Reassignment Modal States
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [currentAssignId, setCurrentAssignId] = useState<string | null>(null);
  const [newInvestigatorId, setNewInvestigatorId] = useState('');
  const [reassignReason, setReassignReason] = useState('');

  // Decline/Reject Modal State
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectAssignId, setRejectAssignId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Activities State (Phase 5)
  const [activities, setActivities] = useState<any[]>([]);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [actType, setActType] = useState('FIELD_VISIT');
  const [actTitle, setActTitle] = useState('');
  const [actInstructions, setActInstructions] = useState('');
  const [actDueDate, setActDueDate] = useState('');
  const [actAssignedTo, setActAssignedTo] = useState('');
  const [completingActId, setCompletingActId] = useState<string | null>(null);
  const [actCompletionNotes, setActCompletionNotes] = useState('');

  // Evidence / Documents State (Phase 5)
  const [documents, setDocuments] = useState<any[]>([]);
  const [evidenceCategoryFilter, setEvidenceCategoryFilter] = useState('ALL');
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [evCategory, setEvCategory] = useState('FIELD_PHOTO');
  const [evActivityId, setEvActivityId] = useState('');
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [softDeletingDocId, setSoftDeletingDocId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Note & Task State
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteType, setNewNoteType] = useState<'INTERNAL' | 'CLIENT' | 'INVESTIGATOR'>('INTERNAL');
  const [newTaskTitle, setNewTaskTitle] = useState('');

  const loadCase = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/cases/${caseId}`);
      const json = await res.json();
      if (json.success) {
        setCaseData(json.data);
      } else {
        setError(json.error || 'Case not found');
      }
    } catch {
      setError('Network error loading case');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  const loadTimeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}/timeline`);
      const json = await res.json();
      if (json.success) setTimeline(json.data || []);
    } catch {
      // silent
    }
  }, [caseId]);

  const loadAssignments = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}/assignments`);
      const json = await res.json();
      if (json.success) setAssignments(json.data || []);
    } catch {
      // silent
    }
  }, [caseId]);

  const loadCandidates = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}/eligible-investigators`);
      const json = await res.json();
      if (json.success) setCandidates(json.data || []);
    } catch {
      // silent
    }
  }, [caseId]);

  const loadActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}/activities`);
      const json = await res.json();
      if (json.success) setActivities(json.data || []);
    } catch {
      // silent
    }
  }, [caseId]);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}/evidence`);
      const json = await res.json();
      if (json.success) setDocuments(json.data || []);
    } catch {
      // silent
    }
  }, [caseId]);

  useEffect(() => {
    if (caseId) {
      loadCase();
      loadTimeline();
      loadAssignments();
      loadCandidates();
      loadActivities();
      loadDocuments();
    }
  }, [caseId, loadCase, loadTimeline, loadAssignments, loadCandidates, loadActivities, loadDocuments]);

  // Execute Workflow Transition
  const handleExecuteTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseData) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_status: targetStatus,
          current_version: caseData.version,
          reason: transitionReason || null,
          outcome: targetStatus === 'REPORT_REVIEW' || targetStatus === 'APPROVED' ? targetOutcome : undefined,
          fraud_reason: targetOutcome === 'FRAUD' ? fraudReason : undefined,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`Successfully moved docket to ${targetStatus}`);
        setShowTransitionModal(false);
        setTransitionReason('');
        loadCase();
        loadTimeline();
      } else {
        setError(json.error || 'Transition rejected');
      }
    } catch {
      setError('Network error executing transition');
    }
  };

  // Assign Investigator
  const handleConfirmAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCandidate) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investigator_id: selectedCandidate.investigator.id,
          assignment_scope: assignScope,
          agreed_fee: customFee !== '' ? Number(customFee) : undefined,
          travel_allowance: customTa !== '' ? Number(customTa) : 0,
          override_reason: overrideReason || null,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`Investigator ${selectedCandidate.investigator.full_name} assigned successfully.`);
        setShowAssignModal(false);
        setSelectedCandidate(null);
        setOverrideReason('');
        loadAssignments();
        loadCase();
        loadTimeline();
      } else {
        setError(json.error || 'Assignment failed');
      }
    } catch {
      setError('Network error during assignment');
    }
  };

  // Accept Assignment
  const handleAcceptAssignment = async (assignId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/assignments/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_investigator_id: assignId }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Assignment accepted. Case is now under field investigation.');
        loadAssignments();
        loadCase();
        loadTimeline();
      } else {
        setError(json.error || 'Acceptance failed');
      }
    } catch {
      setError('Network error accepting assignment');
    }
  };

  // Reject Assignment
  const handleRejectAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectAssignId || !rejectReason.trim()) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/assignments/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_investigator_id: rejectAssignId,
          reason: rejectReason.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Assignment declined. Case returned to pool.');
        setShowRejectModal(false);
        setRejectAssignId(null);
        setRejectReason('');
        loadAssignments();
        loadCase();
        loadTimeline();
      } else {
        setError(json.error || 'Rejection failed');
      }
    } catch {
      setError('Network error declining assignment');
    }
  };

  // Reassign Investigator
  const handleConfirmReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAssignId || !newInvestigatorId || !reassignReason.trim()) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/assignments/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_case_investigator_id: currentAssignId,
          new_investigator_id: newInvestigatorId,
          reassignment_reason: reassignReason.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Case reassigned successfully. Historical assignment preserved.');
        setShowReassignModal(false);
        setCurrentAssignId(null);
        setNewInvestigatorId('');
        setReassignReason('');
        loadAssignments();
        loadCase();
        loadTimeline();
      } else {
        setError(json.error || 'Reassignment failed');
      }
    } catch {
      setError('Network error reassigning investigator');
    }
  };

  // Add Note
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim()) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newNoteContent, note_type: newNoteType }),
      });
      const json = await res.json();
      if (json.success) {
        setNewNoteContent('');
        loadTimeline();
      }
    } catch {
      // silent
    }
  };

  // Add Task
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTaskTitle }),
      });
      const json = await res.json();
      if (json.success) {
        setNewTaskTitle('');
        loadTimeline();
      }
    } catch {
      // silent
    }
  };

  // Phase 5: Create Investigation Activity
  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actTitle.trim()) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_type: actType,
          task_title: actTitle,
          instructions: actInstructions || null,
          due_date: actDueDate ? new Date(actDueDate).toISOString() : null,
          assigned_to_id: actAssignedTo || null,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification(`Activity "${actTitle}" scheduled successfully.`);
        setShowActivityModal(false);
        setActTitle('');
        setActInstructions('');
        setActDueDate('');
        setActAssignedTo('');
        loadActivities();
        loadTimeline();
      } else {
        setError(json.error || 'Failed to create activity');
      }
    } catch (err: any) {
      setError(err.message || 'Network error creating activity');
    }
  };

  // Phase 5: Complete Activity
  const handleCompleteActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingActId || !actCompletionNotes.trim()) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/activities/${completingActId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          status: 'COMPLETED',
          completion_notes: actCompletionNotes,
          completed_at: new Date().toISOString(),
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification('Activity marked as COMPLETED.');
        setCompletingActId(null);
        setActCompletionNotes('');
        loadActivities();
        loadTimeline();
      } else {
        setError(json.error || 'Failed to complete activity');
      }
    } catch (err: any) {
      setError(err.message || 'Network error completing activity');
    }
  };

  // Phase 5: Upload Evidence to R2 Pipeline
  const handleUploadEvidence = async (file: File) => {
    try {
      setUploadingEvidence(true);
      setError(null);

      // 1. Get GPS if available
      let claimedGps: any = undefined;
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000 });
          });
          claimedGps = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            captured_at: new Date().toISOString(),
          };
        } catch {
          // GPS optional
        }
      }

      // 2. Compress image per A8 or compute SHA-256
      let processedBlob: Blob = file;
      let computedSha256 = '';
      let processedSize = file.size;

      if (file.type.startsWith('image/')) {
        const comp = await compressFieldImage(file, 1600, 0.75);
        processedBlob = comp.blob as Blob;
        computedSha256 = comp.sha256Hash;
        processedSize = comp.fileSize;
      } else {
        const buf = await file.arrayBuffer();
        computedSha256 = await computeSha256(buf);
      }

      // 3. Init upload
      const initRes = await fetch('/api/uploads/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: caseId,
          activity_id: evActivityId || null,
          file_name: file.name,
          file_size: processedSize,
          mime_type: file.type || 'image/jpeg',
          sha256_hash: computedSha256,
          evidence_category: evCategory,
          claimed_metadata: claimedGps,
        }),
      });

      const initData = await initRes.json();
      if (!initRes.ok || !initData.success) {
        throw new Error(initData.error || 'Failed to initialize R2 upload');
      }

      // 4. PUT to R2 direct
      await fetch(initData.upload_url, {
        method: 'PUT',
        headers: initData.headers || { 'Content-Type': file.type },
        body: processedBlob,
      });

      // 5. Complete upload
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
        throw new Error(compData.error || 'Failed to verify uploaded evidence');
      }

      setNotification(`Evidence vaulted and verified to Cloudflare R2! SHA-256: ${computedSha256.substring(0, 12)}...`);
      setShowEvidenceModal(false);
      loadDocuments();
      loadTimeline();
    } catch (err: any) {
      setError(err.message || 'Evidence upload failed');
    } finally {
      setUploadingEvidence(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Phase 5: Download Evidence (Presigned 5-min GET)
  const handleDownloadEvidence = async (docId: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/download`);
      const json = await res.json();
      if (json.success && json.download_url) {
        window.open(json.download_url, '_blank');
      } else {
        alert(json.error || 'Download failed');
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    }
  };

  // Phase 5: Soft Delete Evidence (Reason required)
  const handleSoftDeleteEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!softDeletingDocId || !deleteReason.trim()) return;

    try {
      const res = await fetch(`/api/documents/${softDeletingDocId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete_reason: deleteReason }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Evidence document soft-deleted.');
        setSoftDeletingDocId(null);
        setDeleteReason('');
        loadDocuments();
        loadTimeline();
      } else {
        alert(json.error || 'Delete failed');
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-500 font-mono-code text-xs">
        Loading case file {caseId}...
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="p-8 text-center text-red-600 bg-red-50 border border-red-200 rounded">
        Case not found or permission denied.
      </div>
    );
  }

  // Active status action mappings
  const getActionButtons = () => {
    switch (caseData.status) {
      case 'DATA_ENTRY':
        return [{ label: 'Submit for Verification', status: 'VERIFICATION' }];
      case 'VERIFICATION':
        return [
          { label: 'Verify & Route to Assignment', status: 'ASSIGNMENT' },
          { label: 'Send Back to Data Entry', status: 'DATA_ENTRY', isDestructive: true },
        ];
      case 'ASSIGNMENT':
        return [{ label: 'Assign Investigator', status: 'ACCEPTANCE_PENDING' }];
      case 'FIELD_INVESTIGATION':
        return [{ label: 'Submit Evidence', status: 'EVIDENCE_GATHERING' }];
      case 'EVIDENCE_GATHERING':
        return [{ label: 'Start Report Drafting', status: 'REPORT_DRAFTING' }];
      case 'REPORT_DRAFTING':
        return [{ label: 'Submit Report for Review', status: 'REPORT_REVIEW' }];
      case 'REPORT_REVIEW':
        return [
          { label: 'Approve Investigation', status: 'APPROVED' },
          { label: 'Send Back / Rework', status: 'REPORT_DRAFTING', isDestructive: true },
        ];
      case 'ESCALATED_REVIEW':
        return [
          { label: 'Executive Senior Approval', status: 'APPROVED' },
          { label: 'Senior Override Rework', status: 'REPORT_DRAFTING', isDestructive: true },
        ];
      case 'APPROVED':
        return [
          { label: 'Handover to Courier', status: 'HARDCOPY_TRANSIT' },
          { label: 'Digital-Only Closure', status: 'CLOSED' },
        ];
      case 'HARDCOPY_TRANSIT':
        return [{ label: 'Record Proof of Delivery', status: 'CLOSED' }];
      case 'CLOSED':
        return [{ label: 'Generate GST Invoice', status: 'INVOICED' }];
      default:
        return [];
    }
  };

  const actionButtons = getActionButtons();
  const activeAssignments = assignments.filter((a) => a.is_active);

  return (
    <div className="space-y-4">
      {/* Toast Notifications */}
      {notification && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded text-xs flex justify-between items-center font-medium">
          <span>{notification}</span>
          <button onClick={() => setNotification(null)} className="text-emerald-700 font-bold ml-2">✕</button>
        </div>
      )}
      {error && (
        <div className="p-2.5 bg-rose-50 border border-rose-300 text-rose-900 rounded text-xs flex justify-between items-center font-medium">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-700 font-bold ml-2">✕</button>
        </div>
      )}

      {/* Case Header Card */}
      <div className="bg-white border border-slate-200 rounded p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400 font-mono-code uppercase tracking-wider">Docket</span>
              <h1 className="text-xl font-bold font-mono-code text-slate-900">
                {caseData.doc_code}
              </h1>
              <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                caseData.status === 'APPROVED' || caseData.status === 'CLOSED'
                  ? 'bg-emerald-100 text-emerald-800'
                  : caseData.status === 'WITHDRAWN'
                  ? 'bg-rose-100 text-rose-800'
                  : caseData.status === 'ESCALATED_REVIEW'
                  ? 'bg-rose-600 text-white font-black'
                  : 'bg-blue-100 text-blue-800'
              }`}>
                {caseData.status}
              </span>
              <span className="px-2 py-0.5 rounded text-xs bg-slate-100 font-semibold text-slate-800">
                Outcome: {caseData.outcome}
              </span>
              {caseData.rework_count > 0 && (
                <span className="px-2 py-0.5 rounded text-[11px] bg-amber-100 text-amber-800 font-bold font-mono-code">
                  Rework #{caseData.rework_count}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-2 font-mono-code">
              <span>Claim: <strong className="text-slate-800">{caseData.claim_no || caseData.claim_number}</strong></span>
              <span>Policy: <strong className="text-slate-800">{caseData.policy_no || '—'}</strong></span>
              <span>Client: <strong className="text-slate-800">{caseData.clients?.name}</strong></span>
              <span>Category: <strong className="text-slate-800">{caseData.case_types?.name}</strong></span>
              <span>Amount: <strong className="text-slate-800">₹{caseData.claim_amount}</strong></span>
            </div>
          </div>

          {/* Workflow Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {caseData.status === 'ASSIGNMENT' && (
              <button
                onClick={() => setShowAssignModal(true)}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition"
              >
                + Assign Field Investigator
              </button>
            )}

            {actionButtons.map((btn) => (
              <button
                key={btn.status}
                onClick={() => {
                  setTargetStatus(btn.status);
                  setTransitionReason('');
                  setShowTransitionModal(true);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded transition ${
                  btn.isDestructive
                    ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-6 text-xs font-semibold">
          {[
            { id: 'overview', label: 'Case Overview & Intake Details' },
            { id: 'assignments', label: `Field Assignments (${activeAssignments.length})` },
            { id: 'activities', label: `Investigation Activities (${activities.length})` },
            { id: 'evidence', label: `Evidence Vault & Gallery (${documents.length})` },
            { id: 'report', label: 'Investigation Report & Rework' },
            { id: 'hardcopy', label: 'Hardcopy & Custody' },
            { id: 'timeline', label: `Timeline & Audit Stream (${timeline.length})` },
            { id: 'notes', label: 'Notes & Collaboration' },
            { id: 'tasks', label: 'Tasks & Checklist' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-2.5 border-b-2 transition ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
            <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px] border-b pb-2">
              Insured & Hospitalization Details
            </h3>
            <div className="grid grid-cols-2 gap-2 text-slate-700">
              <div><span className="text-slate-400 block text-[10px] uppercase">Insured Subject:</span> {caseData.insured_name}</div>
              <div><span className="text-slate-400 block text-[10px] uppercase">Patient / Claimant:</span> {caseData.patient_name || 'Same as insured'}</div>
              <div><span className="text-slate-400 block text-[10px] uppercase">Hospital:</span> {caseData.hospital_name || '—'}</div>
              <div><span className="text-slate-400 block text-[10px] uppercase">Location:</span> {caseData.hospital_city || '—'}, {caseData.hospital_state || ''}</div>
              <div><span className="text-slate-400 block text-[10px] uppercase">Admission Date:</span> {caseData.admission_date || '—'}</div>
              <div><span className="text-slate-400 block text-[10px] uppercase">Discharge Date:</span> {caseData.discharge_date || '—'}</div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
            <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px] border-b pb-2">
              Custom Intake Fields ({caseData.case_types?.name})
            </h3>
            {Object.keys(caseData.custom_fields || {}).length === 0 ? (
              <div className="text-slate-400 py-3">Standard intake fields only.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-slate-700">
                {Object.entries(caseData.custom_fields || {}).map(([key, val]) => (
                  <div key={key}>
                    <span className="text-slate-400 block text-[10px] uppercase">{key.replace(/_/g, ' ')}:</span>
                    <span className="font-mono-code">{String(val)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Assignments & Field Roster (PHASE 4B) */}
      {activeTab === 'assignments' && (
        <div className="space-y-6 text-xs">
          {/* Active Field Investigators */}
          <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Active Field Investigators</h3>
                <p className="text-xs text-slate-500">Multi-investigator roster (N per case) with fee, travel allowance, and hardcopy tracking</p>
              </div>
              <button
                onClick={() => setShowAssignModal(true)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-xs transition"
              >
                + Assign Investigator
              </button>
            </div>

            {activeAssignments.length === 0 ? (
              <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 rounded">
                No active field investigators assigned to this docket. Click &quot;+ Assign Investigator&quot; to route.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeAssignments.map((a) => (
                  <div key={a.id} className="border border-slate-200 rounded p-3 bg-slate-50/50 space-y-2.5">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-bold text-sm text-slate-900">
                          {a.investigators?.full_name || 'Assigned Investigator'}
                        </span>
                        <div className="font-mono-code text-[11px] text-slate-500">
                          Code: {a.investigators?.code} | Scope: <strong className="text-slate-700">{a.assignment_scope}</strong>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono-code ${
                        a.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800' :
                        a.status === 'PENDING_ACCEPTANCE' ? 'bg-amber-100 text-amber-800' :
                        'bg-slate-100 text-slate-800'
                      }`}>
                        {a.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 bg-white p-2 border border-slate-200 rounded font-mono-code text-[11px]">
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase">Agreed Fee:</span>
                        ₹{a.agreed_fee}
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase">Conveyance (TA):</span>
                        ₹{a.travel_allowance}
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase">Hardcopy:</span>
                        <span className="font-semibold text-slate-700">{a.hardcopy_status}</span>
                      </div>
                    </div>

                    {/* Investigator Action Triggers */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="text-[10px] text-slate-400 font-mono-code">
                        Assigned: {new Date(a.assigned_at).toLocaleDateString()}
                      </div>
                      <div className="flex items-center space-x-1.5">
                        {a.status === 'PENDING_ACCEPTANCE' && (
                          <>
                            <button
                              onClick={() => handleAcceptAssignment(a.id)}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded text-[11px]"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => {
                                setRejectAssignId(a.id);
                                setShowRejectModal(true);
                              }}
                              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold rounded text-[11px]"
                            >
                              Decline
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => {
                            setCurrentAssignId(a.id);
                            setShowReassignModal(true);
                          }}
                          className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded text-[11px]"
                        >
                          Reassign
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Assignment History & Reassignment Audit Ledger */}
          <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
            <h3 className="font-bold text-slate-900 text-sm border-b pb-2">
              Assignment & Reassignment Audit History
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-semibold border-b">
                  <tr>
                    <th className="p-2">Investigator</th>
                    <th className="p-2">Scope</th>
                    <th className="p-2">Fee / TA</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Assigned At</th>
                    <th className="p-2">Remarks / Reassignment Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignments.map((row) => (
                    <tr key={row.id} className={!row.is_active ? 'bg-slate-50/50 text-slate-500' : ''}>
                      <td className="p-2 font-medium">
                        {row.investigators?.full_name} ({row.investigators?.code})
                      </td>
                      <td className="p-2">{row.assignment_scope}</td>
                      <td className="p-2 font-mono-code">₹{row.agreed_fee} / ₹{row.travel_allowance}</td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono-code ${
                          row.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800' :
                          row.status === 'REASSIGNED' ? 'bg-amber-100 text-amber-800' :
                          row.status === 'REJECTED' ? 'bg-rose-100 text-rose-800' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="p-2 font-mono-code text-[11px]">
                        {new Date(row.assigned_at).toLocaleString()}
                      </td>
                      <td className="p-2 italic text-slate-600">
                        {row.reassignment_reason && `Reassigned: ${row.reassignment_reason}`}
                        {row.rejection_reason && `Declined: ${row.rejection_reason}`}
                        {row.override_reason && `Override: ${row.override_reason}`}
                        {!row.reassignment_reason && !row.rejection_reason && !row.override_reason && '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Activities (Phase 5) */}
      {activeTab === 'activities' && (
        <div className="space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Investigation Activities & Field Tasks</h3>
              <p className="text-slate-500 text-[11px]">Field visits, witness interviews, hospital inquiries, and document checks.</p>
            </div>
            <button
              onClick={() => setShowActivityModal(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold text-xs shadow-sm transition"
            >
              + Schedule Activity Task
            </button>
          </div>

          {activities.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-white border border-slate-200 rounded">
              No investigation activities logged yet. Click &quot;+ Schedule Activity Task&quot; to assign field enquiries.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5">Activity Type</th>
                    <th className="p-2.5">Task Title & Instructions</th>
                    <th className="p-2.5">Due Date</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5">Findings / Completion Notes</th>
                    <th className="p-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activities.map((act) => (
                    <tr key={act.id} className="hover:bg-slate-50">
                      <td className="p-2.5">
                        <span className="font-mono-code text-[10px] uppercase font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">
                          {act.activity_type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="p-2.5">
                        <div className="font-semibold text-slate-900">{act.task_title}</div>
                        {act.instructions && (
                          <div className="text-slate-500 text-[11px] mt-0.5">{act.instructions}</div>
                        )}
                      </td>
                      <td className="p-2.5 font-mono-code text-[11px] text-slate-600">
                        {act.due_date ? new Date(act.due_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="p-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          act.status === 'COMPLETED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : act.status === 'IN_PROGRESS'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {act.status}
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-700">
                        {act.completion_notes ? (
                          <div className="text-[11px] text-emerald-800 font-medium bg-emerald-50/60 p-1.5 rounded border border-emerald-100">
                            {act.completion_notes}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Pending field findings</span>
                        )}
                      </td>
                      <td className="p-2.5 text-right">
                        {act.status !== 'COMPLETED' && (
                          <button
                            onClick={() => {
                              setCompletingActId(act.id);
                              setActCompletionNotes('');
                            }}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-semibold"
                          >
                            Mark Complete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Evidence Vault (Phase 5) */}
      {activeTab === 'evidence' && (
        <div className="space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Evidence Vault & Media Gallery (Cloudflare R2)</h3>
              <p className="text-slate-500 text-[11px]">Secure tamper-proof private S3 storage per Rule A8. SHA-256 verified, client compressed, GPS audited.</p>
            </div>
            <button
              onClick={() => setShowEvidenceModal(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold text-xs shadow-sm transition flex items-center space-x-1"
            >
              <span>+ Upload Evidence to R2</span>
            </button>
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap gap-1.5 pt-1 border-b pb-2">
            {[
              { id: 'ALL', label: 'All Evidence' },
              { id: 'FIELD_PHOTO', label: 'Field Photos' },
              { id: 'HOSPITAL_RECORD', label: 'Hospital Records' },
              { id: 'CLAIMANT_ID', label: 'Claimant IDs' },
              { id: 'TREATMENT_BILL', label: 'Treatment Bills' },
              { id: 'WITNESS_STATEMENT', label: 'Witness Statements' },
              { id: 'AUDIO_RECORDING', label: 'Audio Records' },
              { id: 'POLICE_REPORT', label: 'Police Reports' },
              { id: 'OTHER', label: 'Other Proof' },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => setEvidenceCategoryFilter(cat.id)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                  evidenceCategoryFilter === cat.id
                    ? 'bg-slate-900 text-white font-bold'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Evidence Grid / Table */}
          {documents.filter((d) => evidenceCategoryFilter === 'ALL' || d.evidence_category === evidenceCategoryFilter).length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-white border border-slate-200 rounded">
              No evidence documents recorded under this category.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5">Document / Category</th>
                    <th className="p-2.5">Version & Size</th>
                    <th className="p-2.5">SHA-256 Checksum (Vault Hash)</th>
                    <th className="p-2.5">Claimed Geolocation (GPS)</th>
                    <th className="p-2.5">Status & Upload Time</th>
                    <th className="p-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documents
                    .filter((d) => evidenceCategoryFilter === 'ALL' || d.evidence_category === evidenceCategoryFilter)
                    .map((doc) => (
                      <tr key={doc.id} className="hover:bg-slate-50">
                        <td className="p-2.5">
                          <div className="font-semibold text-slate-900">{doc.file_name}</div>
                          <span className="font-mono-code text-[10px] uppercase font-bold text-blue-700 bg-blue-50 px-1 py-0.5 rounded border border-blue-100">
                            {doc.evidence_category}
                          </span>
                        </td>
                        <td className="p-2.5 font-mono-code text-[11px]">
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded font-bold mr-1">
                            v{doc.version || 1}
                          </span>
                          {(doc.file_size / (1024 * 1024)).toFixed(2)} MB
                        </td>
                        <td className="p-2.5 font-mono-code text-[11px] text-slate-700">
                          <span title={doc.sha256_hash} className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                            {doc.sha256_hash.substring(0, 16)}...
                          </span>
                        </td>
                        <td className="p-2.5 text-[11px]">
                          {doc.claimed_latitude ? (
                            <span className="text-emerald-700 font-mono-code">
                              📍 {doc.claimed_latitude.toFixed(5)}, {doc.claimed_longitude.toFixed(5)}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">No GPS</span>
                          )}
                        </td>
                        <td className="p-2.5 text-[11px]">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 mr-1.5">
                            {doc.status}
                          </span>
                          <span className="text-slate-400 font-mono-code">
                            {new Date(doc.created_at).toLocaleString()}
                          </span>
                        </td>
                        <td className="p-2.5 text-right space-x-2">
                          <button
                            onClick={() => handleDownloadEvidence(doc.id)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[11px] font-medium"
                          >
                            Download (5m)
                          </button>
                          <button
                            onClick={() => {
                              setSoftDeletingDocId(doc.id);
                              setDeleteReason('');
                            }}
                            className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded text-[11px] font-medium border border-rose-200"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Timeline */}
      {activeTab === 'timeline' && (
        <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
          <h3 className="font-bold text-slate-900 text-sm border-b pb-2">
            Append-Only Audit Stream & Transition History
          </h3>
          <div className="space-y-3 pt-2">
            {timeline.map((event) => (
              <div key={event.id} className="flex items-start space-x-3 text-xs border-l-2 border-slate-300 pl-3 py-1">
                <div className="flex-1">
                  <div className="font-bold text-slate-900">{event.title}</div>
                  {event.description && <div className="text-slate-600 mt-0.5">{event.description}</div>}
                  <div className="text-[10px] text-slate-400 font-mono-code mt-1">{event.created_at}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Notes */}
      {activeTab === 'notes' && (
        <div className="bg-white border border-slate-200 rounded p-5 space-y-4">
          <h3 className="font-bold text-sm text-slate-900">Case Collaboration Notes</h3>
          <form onSubmit={handleAddNote} className="space-y-2">
            <textarea
              required
              rows={3}
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              placeholder="Add internal finding, communication note, or investigation detail..."
              className="w-full text-xs p-2.5 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex justify-between items-center">
              <select
                value={newNoteType}
                onChange={(e: any) => setNewNoteType(e.target.value)}
                className="text-xs px-2.5 py-1 border border-slate-300 rounded bg-white"
              >
                <option value="INTERNAL">Internal Note</option>
                <option value="CLIENT">Client Communication</option>
                <option value="INVESTIGATOR">Field Instructions</option>
              </select>
              <button
                type="submit"
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded"
              >
                Post Note
              </button>
            </div>
          </form>

          <div className="space-y-2 pt-4 border-t border-slate-100">
            {timeline
              .filter((e) => e.type === 'NOTE')
              .map((n) => (
                <div key={n.id} className="p-3 bg-slate-50 border border-slate-200 rounded text-xs space-y-1">
                  <div className="font-semibold text-slate-800">{n.description}</div>
                  <div className="text-[10px] text-slate-400 font-mono-code">{n.created_at}</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Tab 5: Tasks */}
      {activeTab === 'tasks' && (
        <div className="bg-white border border-slate-200 rounded p-5 space-y-4">
          <h3 className="font-bold text-sm text-slate-900">Investigation Action Tasks</h3>
          <form onSubmit={handleAddTask} className="flex space-x-2">
            <input
              type="text"
              required
              placeholder="E.g., Verify ICU admission log register..."
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              className="flex-1 text-xs px-3 py-2 border border-slate-300 rounded"
            />
            <button
              type="submit"
              className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded"
            >
              + Add Task
            </button>
          </form>

          <div className="space-y-2 pt-2">
            {timeline
              .filter((e) => e.type === 'TASK')
              .map((t) => (
                <div key={t.id} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded text-xs">
                  <span className="font-medium text-slate-800">{t.title}</span>
                  <span className="font-mono-code text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-bold">
                    {t.status || 'PENDING'}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Tab 8: Report & Quality Review (PHASE 6) */}
      {activeTab === 'report' && (
        <ReportTab
          caseId={caseId}
          caseStatus={caseData.status}
          reworkCount={caseData.rework_count || 0}
          onRefreshCase={loadCase}
        />
      )}

      {/* Tab 9: Hardcopy Tracking & Chain of Custody (PHASE 6) */}
      {activeTab === 'hardcopy' && (
        <HardcopyTab
          caseId={caseId}
          onRefreshCase={loadCase}
        />
      )}

      {/* ELIGIBILITY RANKING & ASSIGNMENT MODAL (PHASE 4B) */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Select Field Investigator (Ranked by Eligibility)
                </h3>
                <p className="text-xs text-slate-500">
                  Scored based on territory match, current workload capacity, and cluster proximity
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAssignModal(false);
                  setSelectedCandidate(null);
                }}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              {candidates.map((c) => {
                const isSelected = selectedCandidate?.investigator.id === c.investigator.id;
                return (
                  <div
                    key={c.investigator.id}
                    onClick={() => setSelectedCandidate(c)}
                    className={`p-3 border rounded cursor-pointer transition ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/70 ring-1 ring-blue-600'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-xs text-slate-900">
                          #{c.rank} {c.investigator.full_name}
                        </span>
                        <span className="font-mono-code text-[11px] text-slate-500">
                          ({c.investigator.code})
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold font-mono-code text-blue-700">
                          {c.total_score} pts
                        </span>
                        {c.is_overloaded && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-100 text-red-800 rounded">
                            OVERLOADED
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap gap-x-3">
                      <span>City: <strong>{c.investigator.city}</strong></span>
                      <span>Active Load: <strong>{c.investigator.current_active_cases}/{c.investigator.max_active_cases}</strong></span>
                      <span className="text-emerald-700">{c.recommendation_reason}</span>
                    </div>

                    {c.warnings.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.warnings.map((w, idx) => (
                          <span key={idx} className="text-[9px] font-medium px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded">
                            ⚠️ {w}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedCandidate && (
              <form onSubmit={handleConfirmAssign} className="pt-3 border-t border-slate-200 space-y-3 text-xs">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Scope</label>
                    <select
                      value={assignScope}
                      onChange={(e) => setAssignScope(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded bg-white"
                    >
                      <option value="PRIMARY">Primary Investigator</option>
                      <option value="SECONDARY">Secondary Support</option>
                      <option value="HOSPITAL_CHECK">Hospital Check</option>
                      <option value="INSURED_MEET">Insured Meet</option>
                      <option value="SPOT">Spot Check</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Custom Fee (₹)</label>
                    <input
                      type="number"
                      placeholder="Default fee"
                      value={customFee}
                      onChange={(e) => setCustomFee(e.target.value ? Number(e.target.value) : '')}
                      className="w-full p-2 border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Conveyance TA (₹)</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={customTa}
                      onChange={(e) => setCustomTa(e.target.value ? Number(e.target.value) : '')}
                      className="w-full p-2 border border-slate-300 rounded"
                    />
                  </div>
                </div>

                {selectedCandidate.warnings.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-semibold text-amber-800 mb-1">
                      Manual Override Reason (Mandatory when assigning candidate with warnings) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="E.g. Approved by Senior Manager due to local familiarity"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      className="w-full p-2 border border-amber-300 rounded bg-amber-50/50"
                    />
                  </div>
                )}

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedCandidate(null)}
                    className="px-3 py-1.5 border border-slate-300 rounded text-slate-700"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded"
                  >
                    Confirm Assignment
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* REASSIGNMENT MODAL (PHASE 4B) */}
      {showReassignModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5 border border-slate-200 text-xs space-y-3">
            <h3 className="font-bold text-sm text-slate-900">Reassign Investigator</h3>
            <p className="text-slate-500">
              The current investigator assignment will be archived with status REASSIGNED to preserve audit history.
            </p>
            <form onSubmit={handleConfirmReassign} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">New Investigator *</label>
                <select
                  required
                  value={newInvestigatorId}
                  onChange={(e) => setNewInvestigatorId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  <option value="">Select Replacement...</option>
                  {candidates.map((c) => (
                    <option key={c.investigator.id} value={c.investigator.id}>
                      {c.investigator.full_name} ({c.investigator.code}) - {c.investigator.city} ({c.total_score} pts)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Mandatory Reassignment Reason *
                </label>
                <textarea
                  required
                  rows={3}
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  placeholder="E.g. Prior investigator on medical leave; territory handover."
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowReassignModal(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded"
                >
                  Confirm Reassignment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DECLINE / REJECT ASSIGNMENT MODAL */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 border border-slate-200 text-xs space-y-3">
            <h3 className="font-bold text-sm text-slate-900">Decline Field Assignment</h3>
            <p className="text-slate-500">
              Provide a valid reason for declining this assignment (e.g. out of station, capacity limit).
            </p>
            <form onSubmit={handleRejectAssignment} className="space-y-3">
              <textarea
                required
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter non-acceptance reason..."
                className="w-full p-2 border border-slate-300 rounded"
              />
              <div className="flex justify-end space-x-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded"
                >
                  Confirm Decline
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transition Modal */}
      {showTransitionModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="font-bold text-sm text-slate-900">
                Execute Status Transition: {targetStatus}
              </h3>
              <button
                onClick={() => setShowTransitionModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteTransition} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Transition Reason / Review Notes
                </label>
                <textarea
                  rows={3}
                  value={transitionReason}
                  onChange={(e) => setTransitionReason(e.target.value)}
                  placeholder="Enter reason or instructions for this status change..."
                  className="w-full text-xs p-2.5 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {(targetStatus === 'REPORT_REVIEW' || targetStatus === 'APPROVED') && (
                <div className="space-y-3 p-3 bg-slate-50 border border-slate-200 rounded">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                      Investigation Outcome
                    </label>
                    <select
                      value={targetOutcome}
                      onChange={(e) => setTargetOutcome(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                    >
                      <option value="GENUINE">Genuine Claim</option>
                      <option value="FRAUD">Confirmed Fraud</option>
                      <option value="SUSPICIOUS">Suspicious</option>
                      <option value="REPUDIATED">Repudiated</option>
                      <option value="UNTRACEABLE">Untraceable</option>
                    </select>
                  </div>

                  {targetOutcome === 'FRAUD' && (
                    <div>
                      <label className="block text-[11px] font-semibold text-rose-700 uppercase tracking-wider mb-1">
                        Mandatory Fraud Reason / Category *
                      </label>
                      <input
                        type="text"
                        required
                        value={fraudReason}
                        onChange={(e) => setFraudReason(e.target.value)}
                        placeholder="E.g., Staged admission with fictitious doctor notes"
                        className="w-full text-xs px-2.5 py-1.5 border border-rose-300 rounded"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowTransitionModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded"
                >
                  Confirm Transition
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* SCHEDULE ACTIVITY MODAL (PHASE 5) */}
      {showActivityModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 border border-slate-200 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900">Schedule Investigation Activity Task</h3>
                <p className="text-xs text-slate-500">Assign verification tasks, hospital audits, or witness statements</p>
              </div>
              <button
                onClick={() => setShowActivityModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateActivity} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Activity Type *</label>
                <select
                  value={actType}
                  onChange={(e) => setActType(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  <option value="FIELD_VISIT">Field Visit</option>
                  <option value="RESIDENCE_VERIFICATION">Residence Verification</option>
                  <option value="HOSPITAL_VERIFICATION">Hospital Verification</option>
                  <option value="EMPLOYMENT_VERIFICATION">Employment Verification</option>
                  <option value="DOCUMENT_VERIFICATION">Document Verification</option>
                  <option value="CLAIMANT_INTERVIEW">Claimant Interview</option>
                  <option value="WITNESS_INTERVIEW">Witness Interview</option>
                  <option value="TELEPHONIC_VERIFICATION">Telephonic Verification</option>
                  <option value="MEDICAL_RECORDS_CHECK">Medical Records Check</option>
                  <option value="SPOT_INVESTIGATION">Spot Investigation</option>
                  <option value="CUSTOM">Custom Activity</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Task Title *</label>
                <input
                  type="text"
                  required
                  value={actTitle}
                  onChange={(e) => setActTitle(e.target.value)}
                  placeholder="E.g., Verify IPD register and indoor admission sheets"
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Specific Instructions / Protocol</label>
                <textarea
                  rows={3}
                  value={actInstructions}
                  onChange={(e) => setActInstructions(e.target.value)}
                  placeholder="Specific questions to ask, documents to gather, cross-references..."
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={actDueDate}
                    onChange={(e) => setActDueDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Assign to Investigator</label>
                  <select
                    value={actAssignedTo}
                    onChange={(e) => setActAssignedTo(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="">-- Unassigned (Team Pool) --</option>
                    {activeAssignments.map((a) => (
                      <option key={a.id} value={a.investigator_id}>
                        {a.investigators?.full_name || 'Assigned Investigator'} ({a.assignment_scope})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowActivityModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded"
                >
                  Schedule Activity
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* COMPLETE ACTIVITY MODAL */}
      {completingActId && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <h3 className="font-bold text-sm text-slate-900">Complete Investigation Activity</h3>
            <p className="text-xs text-slate-500">Record definitive field findings. Completion notes will be permanently logged.</p>

            <form onSubmit={handleCompleteActivity} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Findings / Completion Summary *
                </label>
                <textarea
                  rows={4}
                  required
                  value={actCompletionNotes}
                  onChange={(e) => setActCompletionNotes(e.target.value)}
                  placeholder="Record summary of checks performed, findings, confirmed admission details, witness quotes..."
                  className="w-full p-2.5 border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setCompletingActId(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded"
                >
                  Mark Completed
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* UPLOAD EVIDENCE MODAL (PHASE 5) */}
      {showEvidenceModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900">Upload Evidence to Cloudflare R2 Vault</h3>
                <p className="text-xs text-slate-500">Direct S3 presigned upload with client compression & SHA-256</p>
              </div>
              <button
                onClick={() => setShowEvidenceModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Evidence Category *</label>
                <select
                  value={evCategory}
                  onChange={(e) => setEvCategory(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  <option value="FIELD_PHOTO">Field Photo</option>
                  <option value="HOSPITAL_RECORD">Hospital Record / IPD Paper</option>
                  <option value="CLAIMANT_ID">Claimant ID / Aadhaar</option>
                  <option value="TREATMENT_BILL">Treatment Bill / Pharmacy Receipt</option>
                  <option value="WITNESS_STATEMENT">Witness Statement</option>
                  <option value="AUDIO_RECORDING">Audio Recording</option>
                  <option value="POLICE_REPORT">Police FIR / Spot Memo</option>
                  <option value="INVESTIGATOR_NOTES">Investigator Notes</option>
                  <option value="OTHER">Other Proof</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Link to Activity (Optional)</label>
                <select
                  value={evActivityId}
                  onChange={(e) => setEvActivityId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  <option value="">-- Case General Evidence --</option>
                  {activities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.task_title} ({a.activity_type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadEvidence(f);
                  }}
                  accept="image/*,video/*,application/pdf,audio/*"
                  className="hidden"
                />

                <button
                  type="button"
                  disabled={uploadingEvidence}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-4 px-3 border-2 border-dashed border-blue-400 bg-blue-50/50 hover:bg-blue-50 text-blue-700 rounded-lg text-center font-semibold text-xs transition flex flex-col items-center justify-center space-y-1"
                >
                  {uploadingEvidence ? (
                    <span>Compressing & Vaulting to Cloudflare R2...</span>
                  ) : (
                    <>
                      <span>Click to Select Evidence File</span>
                      <span className="text-[10px] text-slate-500 font-normal">
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

      {/* SOFT DELETE EVIDENCE MODAL */}
      {softDeletingDocId && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 border border-slate-200 space-y-4">
            <h3 className="font-bold text-sm text-slate-900">Soft-Delete Evidence Document</h3>
            <p className="text-xs text-slate-500">Per Rule A6, records are soft-deleted and permanently audited. Enter a deletion reason:</p>

            <form onSubmit={handleSoftDeleteEvidence} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Delete Reason *</label>
                <input
                  type="text"
                  required
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="E.g., Duplicate document or unreadable copy"
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setSoftDeletingDocId(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded"
                >
                  Confirm Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
