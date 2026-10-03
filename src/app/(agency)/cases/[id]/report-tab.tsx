'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Report, ReportVersion, ReportComment, ReworkCycle, ReportDiff } from '@/modules/reports/types';

interface ReportTabProps {
  caseId: string;
  caseStatus: string;
  reworkCount: number;
  onRefreshCase: () => void;
}

export function ReportTab({ caseId, caseStatus, reworkCount, onRefreshCase }: ReportTabProps) {
  const [report, setReport] = useState<Report | null>(null);
  const [versions, setVersions] = useState<ReportVersion[]>([]);
  const [comments, setComments] = useState<ReportComment[]>([]);
  const [reworkCycles, setReworkCycles] = useState<ReworkCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showReworkModal, setShowReworkModal] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);

  // Comment Form State
  const [commentTargetType, setCommentTargetType] = useState<'SECTION' | 'EVIDENCE' | 'FIELD'>('SECTION');
  const [commentTargetId, setCommentTargetId] = useState('hospital_verification');
  const [commentTargetLabel, setCommentTargetLabel] = useState('Hospital Verification');
  const [commentText, setCommentText] = useState('');

  // Rework Form State
  const [reworkRecipient, setReworkRecipient] = useState<any>('INVESTIGATOR');
  const [reworkReasonCategory, setReworkReasonCategory] = useState('INCOMPLETE_EVIDENCE');
  const [reworkInstructions, setReworkInstructions] = useState('');
  const [reworkPriority, setReworkPriority] = useState<any>('MEDIUM');
  const [reworkDeadline, setReworkDeadline] = useState('');
  const [reworkSections, setReworkSections] = useState('hospital_verification, insured_statement');

  // Correction Form State
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);
  const [correctionSummary, setCorrectionSummary] = useState('');
  const [correctionNotes, setCorrectionNotes] = useState('');

  // Approval Form State
  const [approvalNotes, setApprovalNotes] = useState('');
  const [signoffDeclaration, setSignoffDeclaration] = useState(false);

  // Diff State
  const [diffFromVer, setDiffFromVer] = useState(1);
  const [diffToVer, setDiffToVer] = useState(2);
  const [activeDiff, setActiveDiff] = useState<ReportDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const loadReportData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/cases/${caseId}/report`);
      const json = await res.json();
      if (json.success && json.data) {
        setReport(json.data.report);
        setVersions(json.data.versions || []);
        setComments(json.data.comments || []);
        setReworkCycles(json.data.reworkCycles || []);

        if (json.data.versions?.length > 1) {
          setDiffFromVer(json.data.versions.length - 1);
          setDiffToVer(json.data.versions.length);
        }
      }
    } catch {
      setError('Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  // Create initial report draft
  const handleCreateDraft = async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Investigation Report - Docket ${caseId.substring(0, 8)}`,
          summary: 'Field investigation and medical record verification summary.',
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Draft report initialized.');
        loadReportData();
        onRefreshCase();
      } else {
        setError(json.error || 'Failed to create report draft');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
  };

  // Submit report for review
  const handleSubmitForReview = async () => {
    if (!report) return;
    try {
      const res = await fetch(`/api/cases/${caseId}/report/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: report.id,
          outcome: 'GENUINE',
          change_summary: 'Report compiled and submitted for formal scrutiny.',
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Report submitted for review.');
        loadReportData();
        onRefreshCase();
      } else {
        setError(json.error || 'Submission failed');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
  };

  // Add Comment
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!report || !commentText.trim()) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/report/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: report.id,
          version_number: report.current_version,
          target_type: commentTargetType,
          target_id: commentTargetId,
          target_label: commentTargetLabel,
          comment: commentText,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Reviewer comment anchored to section.');
        setShowCommentModal(false);
        setCommentText('');
        loadReportData();
      } else {
        setError(json.error || 'Failed to add comment');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
  };

  // Resolve Comment
  const handleResolveComment = async (commentId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/report/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'RESOLVED',
          resolution_notes: 'Addressed in revised version.',
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Comment marked resolved.');
        loadReportData();
      } else {
        setError(json.error || 'Failed to resolve comment');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
  };

  // Send back for rework
  const handleInitiateRework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!report) return;

    try {
      const sections = reworkSections.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/cases/${caseId}/report/rework`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: report.id,
          target_recipient_type: reworkRecipient,
          reason_category: reworkReasonCategory,
          instructions: reworkInstructions,
          priority: reworkPriority,
          deadline: reworkDeadline ? new Date(reworkDeadline).toISOString() : undefined,
          target_sections: sections,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification(
          json.data.isEscalated
            ? `⚠️ Rework #${json.data.reworkCycle.cycle_number} created with AUTO-ESCALATION to Executive Management!`
            : `Rework #${json.data.reworkCycle.cycle_number} task dispatched to ${reworkRecipient}.`
        );
        setShowReworkModal(false);
        setReworkInstructions('');
        loadReportData();
        onRefreshCase();
      } else {
        setError(json.error || 'Failed to initiate rework');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
  };

  // Submit rework correction
  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!report || !activeCycleId) return;

    try {
      const currentVer = versions[versions.length - 1];
      const res = await fetch(`/api/cases/${caseId}/report/rework/${activeCycleId}/correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: report.id,
          content: currentVer?.content || { summary: correctionSummary, sections: {} },
          change_summary: correctionSummary,
          correction_notes: correctionNotes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification(`Corrections submitted! New discrete version v${json.data.newVersion.version_number} preserved.`);
        setShowCorrectionModal(false);
        setCorrectionSummary('');
        setCorrectionNotes('');
        loadReportData();
        onRefreshCase();
      } else {
        setError(json.error || 'Failed to submit correction');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
  };

  // Approve Report
  const handleApproveReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!report || !signoffDeclaration) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/report/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: report.id,
          approval_notes: approvalNotes,
          signoff_declaration: signoffDeclaration,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNotification('Report formally APPROVED and SEALED. Status is now immutable.');
        setShowApproveModal(false);
        loadReportData();
        onRefreshCase();
      } else {
        setError(json.error || 'Failed to approve report');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
  };

  // Compare Versions Diff
  const handleLoadDiff = async () => {
    if (!report) return;
    try {
      setLoadingDiff(true);
      const res = await fetch(`/api/cases/${caseId}/report/diff?report_id=${report.id}&from=${diffFromVer}&to=${diffToVer}`);
      const json = await res.json();
      if (json.success) {
        setActiveDiff(json.data);
      } else {
        setError(json.error || 'Failed to compute diff');
      }
    } catch (err: any) {
      setError(err.message || 'Diff calculation failed');
    } finally {
      setLoadingDiff(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-xs text-slate-400">Loading report dossier...</div>;
  }

  if (!report) {
    return (
      <div className="bg-white border border-slate-200 rounded p-8 text-center space-y-4">
        <div className="text-3xl">📄</div>
        <h3 className="font-bold text-slate-800 text-sm">No Report Draft Created Yet</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Compile field evidence and interview findings into the official investigation report draft.
        </p>
        <button
          onClick={handleCreateDraft}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold shadow-sm transition"
        >
          + Create Report Draft (v1)
        </button>
      </div>
    );
  }

  const latestVersion = versions[versions.length - 1];
  const isImmutable = report.is_immutable || report.status === 'APPROVED' || report.status === 'FINAL';

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

      {/* Report Header Card */}
      <div className="bg-white border border-slate-200 rounded p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] text-slate-400 uppercase font-mono-code">Current Version</span>
            <span className="font-mono-code font-bold text-base text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
              v{report.current_version}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded font-bold text-[11px] ${
                isImmutable
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : report.status === 'SENT_BACK'
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : report.status === 'UNDER_REVIEW' || report.status === 'RESUBMITTED'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {isImmutable ? '🔒 APPROVED & IMMUTABLE' : report.status}
            </span>
            {reworkCount > 0 && (
              <span
                className={`px-2 py-0.5 rounded font-mono-code text-[11px] font-bold ${
                  reworkCount >= 3 ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {reworkCount >= 3 ? `🚨 ESCALATED (Cycle #${reworkCount})` : `Rework #${reworkCount}`}
              </span>
            )}
          </div>
          <div className="text-slate-500 mt-1">
            Total Versions Retained: <strong className="text-slate-800">{versions.length}</strong> • Open Comments: <strong className="text-slate-800">{comments.filter((c) => c.status === 'OPEN').length}</strong>
          </div>
        </div>

        {/* Action Triggers */}
        <div className="flex flex-wrap items-center gap-2">
          {versions.length > 1 && (
            <button
              onClick={() => {
                setShowDiffModal(true);
                handleLoadDiff();
              }}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded transition"
            >
              🔍 Compare Diff (v{diffFromVer} ↔ v{diffToVer})
            </button>
          )}

          {!isImmutable && (
            <>
              <button
                onClick={() => setShowCommentModal(true)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded transition"
              >
                💬 Add Anchored Comment
              </button>

              <button
                onClick={() => setShowReworkModal(true)}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded transition"
              >
                ↩️ Send Back / Rework
              </button>

              {report.status === 'SENT_BACK' && (
                <button
                  onClick={() => {
                    const lastCycle = reworkCycles[reworkCycles.length - 1];
                    setActiveCycleId(lastCycle ? lastCycle.id : null);
                    setShowCorrectionModal(true);
                  }}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded transition"
                >
                  📝 Submit Corrections (v{report.current_version + 1})
                </button>
              )}

              {report.status === 'DRAFT' && (
                <button
                  onClick={handleSubmitForReview}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded transition"
                >
                  ✓ Submit for Review
                </button>
              )}

              <button
                onClick={() => setShowApproveModal(true)}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded shadow-sm transition"
              >
                🔒 Formal Approval Sign-off
              </button>
            </>
          )}
        </div>
      </div>

      {/* Report Content View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Report Sections & Findings */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] border-b pb-2 flex justify-between">
              <span>Executive Investigation Summary</span>
              <span className="font-mono-code text-slate-400">Version #{latestVersion?.version_number}</span>
            </h3>
            <p className="text-slate-700 leading-relaxed bg-slate-50 p-3 rounded border border-slate-100">
              {latestVersion?.summary || 'No summary text provided.'}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] border-b pb-2">
              Dossier Sections
            </h3>

            {Object.entries(latestVersion?.content?.sections || {}).length === 0 ? (
              <div className="text-slate-400 py-4 text-center">No structured sections recorded.</div>
            ) : (
              Object.entries(latestVersion?.content?.sections || {}).map(([secKey, sec]: [string, any]) => {
                const secComments = comments.filter((c) => c.target_id === secKey);

                return (
                  <div key={secKey} className="border border-slate-200 rounded p-3 bg-slate-50 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 text-xs">{sec.title || secKey}</span>
                      <span className="text-[10px] text-slate-400 font-mono-code">Key: {secKey}</span>
                    </div>
                    <p className="text-slate-600 text-xs">{sec.text || 'No narrative text recorded.'}</p>

                    {secComments.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-200 space-y-1.5">
                        <div className="text-[10px] font-bold text-slate-500 uppercase">Anchored Review Comments:</div>
                        {secComments.map((cm) => (
                          <div
                            key={cm.id}
                            className={`p-2 rounded text-xs flex justify-between items-start gap-2 ${
                              cm.status === 'RESOLVED' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900 border border-amber-200'
                            }`}
                          >
                            <div>
                              <div className="font-medium">{cm.comment}</div>
                              {cm.resolution_notes && (
                                <div className="text-[10px] text-emerald-700 mt-0.5">Resolved: {cm.resolution_notes}</div>
                              )}
                            </div>
                            {cm.status === 'OPEN' && !isImmutable && (
                              <button
                                onClick={() => handleResolveComment(cm.id)}
                                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-semibold whitespace-nowrap"
                              >
                                Resolve ✓
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Rework History & Version Audit */}
        <div className="space-y-4">
          {/* Rework Cycles Ledger */}
          <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] border-b pb-2 flex justify-between items-center">
              <span>Rework Cycles ({reworkCycles.length})</span>
              {reworkCount >= 3 && (
                <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold font-mono-code">
                  ESCALATED
                </span>
              )}
            </h3>

            {reworkCycles.length === 0 ? (
              <div className="text-slate-400 py-3 text-center">No rework cycles initiated. Quality approved on first cycle.</div>
            ) : (
              <div className="space-y-3">
                {reworkCycles.map((cyc) => (
                  <div
                    key={cyc.id}
                    className={`p-3 rounded border text-xs space-y-1.5 ${
                      cyc.is_escalated ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-bold font-mono-code text-slate-800">
                        Cycle #{cyc.cycle_number} ({cyc.target_recipient_type})
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        cyc.status === 'CORRECTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {cyc.status}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-700 font-semibold">{cyc.reason_category}</div>
                    <div className="text-slate-600 text-[11px]">{cyc.instructions}</div>

                    {cyc.correction_notes && (
                      <div className="mt-1 pt-1 border-t border-slate-200 text-[10px] text-emerald-800">
                        <strong>Correction:</strong> {cyc.correction_notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Historical Versions Retained */}
          <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] border-b pb-2">
              Retained Version Ledger
            </h3>
            <div className="space-y-2">
              {versions.map((ver) => (
                <div key={ver.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded flex justify-between items-center text-xs">
                  <div>
                    <div className="font-mono-code font-bold text-slate-800">
                      Version #{ver.version_number} {ver.is_approved && '🔒 (APPROVED)'}
                    </div>
                    <div className="text-[10px] text-slate-500">{ver.change_summary || 'Saved revision'}</div>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono-code">
                    {new Date(ver.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Rework Send-Back Modal */}
      {showReworkModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleInitiateRework} className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 border-b pb-2 flex justify-between items-center">
              <span>Initiate Rework / Send-Back</span>
              <span className="font-mono-code text-xs text-amber-600 font-bold">
                Next Cycle: #{reworkCycles.length + 1}
              </span>
            </h3>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Target Recipient Role *</label>
              <select
                value={reworkRecipient}
                onChange={(e) => setReworkRecipient(e.target.value as any)}
                className="w-full text-xs p-2 border border-slate-300 rounded"
              >
                <option value="INVESTIGATOR">Field Investigator</option>
                <option value="BACK_OFFICE">Back Office QA</option>
                <option value="DATA_ENTRY">Data Entry Clerk</option>
                <option value="REVIEWER">Reviewer</option>
                <option value="CASE_MANAGER">Case Manager</option>
                <option value="REPORT_AUTHOR">Report Author</option>
                <option value="PREVIOUS_ASSIGNEE">Previous Assignee</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Reason Category *</label>
              <select
                value={reworkReasonCategory}
                onChange={(e) => setReworkReasonCategory(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded"
              >
                <option value="INCOMPLETE_EVIDENCE">Incomplete Evidence / Missing Photos</option>
                <option value="INACCURATE_FINDINGS">Inaccurate Findings Narrative</option>
                <option value="MISSING_HOSPITAL_RECORDS">Missing Indoor Case Paper (ICP) Records</option>
                <option value="DISCREPANCY_IN_DATES">Discrepancy in Admission/Discharge Dates</option>
                <option value="POLICY_CLAUSE_MISMATCH">Policy Clause Verification Mismatch</option>
                <option value="OTHER">Other Operational Clarification</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Actionable Instructions *</label>
              <textarea
                required
                rows={3}
                placeholder="Specific guidance for field operative or QA staff to rectify..."
                value={reworkInstructions}
                onChange={(e) => setReworkInstructions(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Priority</label>
                <select
                  value={reworkPriority}
                  onChange={(e) => setReworkPriority(e.target.value as any)}
                  className="w-full text-xs p-2 border border-slate-300 rounded"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Target Deadline</label>
                <input
                  type="date"
                  value={reworkDeadline}
                  onChange={(e) => setReworkDeadline(e.target.value)}
                  className="w-full text-xs p-2 border border-slate-300 rounded"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Target Sections (Comma-separated)</label>
              <input
                type="text"
                value={reworkSections}
                onChange={(e) => setReworkSections(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded font-mono-code"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowReworkModal(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-bold"
              >
                Dispatch Rework Task
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Submit Corrections Modal */}
      {showCorrectionModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSubmitCorrection} className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 border-b pb-2">
              Submit Corrections for Rework
            </h3>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Change Summary *</label>
              <input
                type="text"
                required
                placeholder="E.g., Added verified ICP hospital statement and updated doctor note"
                value={correctionSummary}
                onChange={(e) => setCorrectionSummary(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Correction Notes / Resolution *</label>
              <textarea
                required
                rows={3}
                placeholder="Detailed notes on how reviewer concerns were resolved..."
                value={correctionNotes}
                onChange={(e) => setCorrectionNotes(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowCorrectionModal(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-bold"
              >
                Save as Discrete Version v{report.current_version + 1}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Anchored Comment Modal */}
      {showCommentModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleAddComment} className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 border-b pb-2">
              Add Anchored Reviewer Comment
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Anchor Target Type</label>
                <select
                  value={commentTargetType}
                  onChange={(e) => setCommentTargetType(e.target.value as any)}
                  className="w-full text-xs p-2 border border-slate-300 rounded"
                >
                  <option value="SECTION">Section</option>
                  <option value="FIELD">Claim / Report Field</option>
                  <option value="EVIDENCE">Evidence Document</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Target Identifier</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. hospital_verification"
                  value={commentTargetId}
                  onChange={(e) => {
                    setCommentTargetId(e.target.value);
                    setCommentTargetLabel(e.target.value);
                  }}
                  className="w-full text-xs p-2 border border-slate-300 rounded font-mono-code"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Comment / Clarification *</label>
              <textarea
                required
                rows={3}
                placeholder="Specific scrutiny remark on this section/evidence..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowCommentModal(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold"
              >
                Anchor Comment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Formal Approval Modal */}
      {showApproveModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleApproveReport} className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 border-b pb-2 flex items-center gap-1.5">
              <span>🔒 Formal Report Approval & Sealing</span>
            </h3>
            <p className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded border border-amber-200">
              <strong>CRITICAL (Rule A6):</strong> Once approved, this report becomes completely sealed and IMMUTABLE. Historical versions, comments, and findings cannot be altered.
            </p>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Sign-off Remarks / Notes *</label>
              <textarea
                required
                rows={2}
                placeholder="Formal scrutiny remarks and approval endorsement..."
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded"
              />
            </div>
            <div className="flex items-start space-x-2 pt-1">
              <input
                type="checkbox"
                id="signoff_cert"
                checked={signoffDeclaration}
                onChange={(e) => setSignoffDeclaration(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-blue-600"
              />
              <label htmlFor="signoff_cert" className="text-[11px] text-slate-700 select-none">
                I hereby formally certify that the investigation has been thoroughly scrutinized, policy clauses verified, and findings authenticated for insurer transmission.
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowApproveModal(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!signoffDeclaration}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-xs font-bold"
              >
                Confirm Approval & Seal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Version Diff Modal */}
      {showDiffModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl p-6 text-xs text-slate-800 space-y-4">
            <div className="border-b pb-2 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-900">
                🔍 Report Version Diff: v{diffFromVer} ↔ v{diffToVer}
              </h3>
              <button onClick={() => setShowDiffModal(false)} className="text-slate-400 hover:text-slate-700 font-bold">✕</button>
            </div>

            <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded border border-slate-200">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mr-1">From:</label>
                <select
                  value={diffFromVer}
                  onChange={(e) => {
                    setDiffFromVer(parseInt(e.target.value, 10));
                    handleLoadDiff();
                  }}
                  className="text-xs p-1 border rounded"
                >
                  {versions.map((v) => (
                    <option key={v.version_number} value={v.version_number}>
                      v{v.version_number}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mr-1">To:</label>
                <select
                  value={diffToVer}
                  onChange={(e) => {
                    setDiffToVer(parseInt(e.target.value, 10));
                    handleLoadDiff();
                  }}
                  className="text-xs p-1 border rounded"
                >
                  {versions.map((v) => (
                    <option key={v.version_number} value={v.version_number}>
                      v{v.version_number}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loadingDiff ? (
              <div className="p-8 text-center text-slate-400">Computing version diff...</div>
            ) : !activeDiff ? (
              <div className="p-8 text-center text-slate-400">No diff available.</div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {activeDiff.summaryChange?.hasChanged && (
                  <div className="p-3 bg-slate-50 border rounded space-y-1">
                    <span className="font-bold text-slate-700 block">Executive Summary Change:</span>
                    <div className="bg-rose-50 text-rose-800 p-2 rounded line-through text-[11px]">
                      {activeDiff.summaryChange.oldSummary}
                    </div>
                    <div className="bg-emerald-50 text-emerald-800 p-2 rounded text-[11px]">
                      {activeDiff.summaryChange.newSummary}
                    </div>
                  </div>
                )}

                {activeDiff.sectionDiffs?.map((sec) => (
                  <div key={sec.sectionKey} className="p-3 border rounded space-y-1.5 bg-white">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-800">{sec.sectionTitle}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          sec.changeType === 'ADDED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : sec.changeType === 'REMOVED'
                            ? 'bg-rose-100 text-rose-800'
                            : sec.changeType === 'MODIFIED'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {sec.changeType}
                      </span>
                    </div>

                    {sec.changeType === 'MODIFIED' && (
                      <div className="space-y-1 text-[11px]">
                        <div className="p-2 bg-rose-50 text-rose-800 rounded">
                          <span className="text-[10px] font-bold uppercase block text-rose-600">Old Text (v{diffFromVer}):</span>
                          {sec.oldText}
                        </div>
                        <div className="p-2 bg-emerald-50 text-emerald-800 rounded">
                          <span className="text-[10px] font-bold uppercase block text-emerald-600">New Text (v{diffToVer}):</span>
                          {sec.newText}
                        </div>
                      </div>
                    )}

                    {sec.changeType === 'ADDED' && (
                      <div className="p-2 bg-emerald-50 text-emerald-800 rounded text-[11px]">
                        {sec.newText}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-3 border-t">
              <button
                onClick={() => setShowDiffModal(false)}
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold text-xs"
              >
                Close Diff Viewer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
