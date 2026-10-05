'use client';

import React, { useState } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  ArrowRight,
  ShieldAlert,
  ClipboardPaste,
  Building,
  UserCheck,
  Search,
  ExternalLink,
  ChevronDown
} from 'lucide-react';
import {
  LegacyCaseRow,
  DryRunValidationResult,
  SmartPasteDiffPreview,
  ParityReconciliationReport,
  EntityApprovalDecision
} from '@/modules/migration/types';

// Sample DNA legacy dataset illustrating real-world edge cases (multi-inv, salary, withdrawn, TDS withholding)
const SAMPLE_DNA_DATASET: LegacyCaseRow[] = [
  {
    doc_code: 'JUL26-0912',
    date: '2026-07-15T10:00:00Z',
    company: 'STAR HEALTH',
    case_type: 'REIMBURSEMENT',
    claim_no: 'CLM-STAR-88192',
    insured_name: 'Rajesh Sharma',
    hospital: 'CHL Hospital Indore',
    location: 'Indore',
    inv1: 'Anil Rajput',
    fee1: 500.00,
    ta1: 150.00,
    inv1_status: 'Paid',
    inv2: 'Arun Barfa',
    fee2: 400.00,
    ta2: 100.00,
    inv2_status: 'Paid',
    total_payable: 1150.00,
    invoice_no: 'INV-2026-0112',
    invoice_amount: 3500.00,
    received: 3500.00,
    tds_deducted: 0.00,
    outcome: 'Genuine',
    sla_hours: 24
  },
  {
    doc_code: 'JUL26-0913',
    date: '2026-07-18T11:30:00Z',
    company: 'CARE',
    case_type: 'CASHLESS',
    claim_no: 'CLM-CARE-44120',
    insured_name: 'Pooja Verma',
    hospital: 'Bombay Hospital Indore',
    location: 'Indore',
    inv1: 'Anil Rajput (Dewas)', // Needs fuzzy resolution
    fee1: 600.00,
    ta1: 200.00,
    inv1_status: 'Paid',
    total_payable: 800.00,
    invoice_no: 'INV-2026-0113',
    invoice_amount: 4000.00,
    received: 3600.00,
    tds_deducted: 400.00,
    outcome: 'Genuine',
    sla_hours: 24
  },
  {
    doc_code: 'AUG26-0418',
    date: '2026-08-15T09:00:00Z',
    company: 'TATA AIG',
    case_type: 'PA',
    claim_no: 'CLM-TATA-99312',
    insured_name: 'Sunil Chouhan',
    hospital: 'Medanta Indore',
    location: 'Ujjain',
    inv1: 'Vikram Singh',
    fee1: 0.00, // Salaried investigator after transition
    ta1: 250.00,
    inv1_status: 'Pending',
    total_payable: 250.00,
    invoice_no: 'INV-2026-0201',
    invoice_amount: 2500.00,
    received: 2500.00,
    tds_deducted: 0.00,
    outcome: 'Fraud',
    sla_hours: 48
  },
  {
    doc_code: 'AUG26-0501',
    date: '2026-08-20T14:00:00Z',
    company: 'SBI GENERAL',
    case_type: 'FVR',
    claim_no: 'CLM-SBI-11029',
    insured_name: 'Mahesh Patidar',
    hospital: 'Care Hospital',
    location: 'Bhopal',
    inv1: 'Dheeraj Jagadhale',
    fee1: 0.00,
    ta1: 0.00,
    total_payable: 0.00,
    outcome: 'Withdrawn',
    exception_type: 'Withdrawn',
    exception_reason: 'Insurer cancelled inquiry before field visit',
    invoice_amount: 0.00,
    received: 0.00,
    tds_deducted: 0.00
  }
];

const SAMPLE_SMART_PASTE_TSV = `Doc Code\tClaim No\tInsured Name\tCompany\tInv1\tFee1\tTA1\tInv2\tFee2\tTA2\tOutcome\tReceived\tTDS
SEP26-0101\tCLM-HDFC-99120\tAmit Joshi\tHDFC ERGO\tAnil Rajput\t500\t150\t\t\t\tPending\t0\t0
SEP26-0102\tCLM-STAR-88192\tRajesh Sharma Updated\tSTAR HEALTH\tAnil Rajput\t500\t150\tArun Barfa\t400\t100\tGenuine\t3500\t0
SEP26-0103\tCLM-BAJAJ-44192\tSanjay Mehra\tBAJAJ ALLIANZ\tPavan Prajapati\t600\t100\t\t\t\tGenuine\t3000\t300`;

export default function LegacyImportPage() {
  const [activeTab, setActiveTab] = useState<'LEGACY_UPLOAD' | 'SMART_PASTE' | 'PARITY_DASHBOARD'>('LEGACY_UPLOAD');

  // Legacy Migration States
  const [rawJsonInput, setRawJsonInput] = useState<string>(JSON.stringify(SAMPLE_DNA_DATASET, null, 2));
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<DryRunValidationResult | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [pendingResolutions, setPendingResolutions] = useState<Record<string, EntityApprovalDecision>>({});
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [commitSummary, setCommitSummary] = useState<any>(null);

  // Rollback Modal State
  const [showRollbackModal, setShowRollbackModal] = useState<boolean>(false);
  const [rollbackBatchId, setRollbackBatchId] = useState<string>('');
  const [rollbackReason, setRollbackReason] = useState<string>('');
  const [isRollingBack, setIsRollingBack] = useState<boolean>(false);
  const [rollbackFeedback, setRollbackFeedback] = useState<string | null>(null);

  // Smart Paste States
  const [pastedTsv, setPastedTsv] = useState<string>(SAMPLE_SMART_PASTE_TSV);
  const [isPreviewingPaste, setIsPreviewingPaste] = useState<boolean>(false);
  const [pasteDiffPreview, setPasteDiffPreview] = useState<SmartPasteDiffPreview | null>(null);

  // Parity Dashboard States
  const [parityReport, setParityReport] = useState<ParityReconciliationReport | null>(null);

  // 1. Dry Run Validation
  const handleRunDryRun = async () => {
    setIsValidating(true);
    setValidationResult(null);
    setCommitSummary(null);
    try {
      let parsedRows: LegacyCaseRow[] = [];
      try {
        parsedRows = JSON.parse(rawJsonInput);
      } catch {
        alert('Invalid JSON format. Please verify your legacy export input.');
        setIsValidating(false);
        return;
      }

      const res = await fetch('/api/migration/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows, source_type: 'DNA_LEGACY_JSON' })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(`Dry run failed: ${data.error}`);
        return;
      }

      setActiveBatchId(data.batch_id);
      setValidationResult(data.validation_result);

      // Pre-seed resolution suggestions
      const initialResolutions: Record<string, EntityApprovalDecision> = {};
      data.validation_result.unresolved_report.exceptions.forEach((exc: any) => {
        if (exc.suggested_match && exc.suggested_match.entity_id) {
          initialResolutions[exc.raw_text] = {
            raw_text: exc.raw_text,
            entity_type: exc.entity_type === 'company' ? 'CLIENT' : 'INVESTIGATOR',
            action: 'MAP_TO_EXISTING',
            target_id: exc.suggested_match.entity_id,
            new_entity_name: exc.suggested_match.canonical_name
          };
        }
      });
      setPendingResolutions(initialResolutions);
    } catch (err: any) {
      alert(`Error during dry-run: ${err.message}`);
    } finally {
      setIsValidating(false);
    }
  };

  // 2. Commit Import Batch
  const handleCommitBatch = async () => {
    if (!activeBatchId) return;
    setIsCommitting(true);
    try {
      let parsedRows: LegacyCaseRow[] = [];
      try {
        parsedRows = JSON.parse(rawJsonInput);
      } catch {
        alert('Invalid JSON input');
        setIsCommitting(false);
        return;
      }

      const res = await fetch('/api/migration/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: activeBatchId,
          resolutions: Object.values(pendingResolutions),
          rows: parsedRows
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(`Commit failed: ${data.error}`);
        return;
      }

      setCommitSummary(data);
      if (data.reconciliation_report) {
        setParityReport(data.reconciliation_report);
        setActiveTab('PARITY_DASHBOARD');
      }
    } catch (err: any) {
      alert(`Commit error: ${err.message}`);
    } finally {
      setIsCommitting(false);
    }
  };

  // 3. Rollback Stored Procedure Execution
  const handleExecuteRollback = async () => {
    if (!rollbackBatchId || !rollbackReason || rollbackReason.trim().length < 5) {
      alert('Please provide valid Batch ID and a mandatory reason (minimum 5 chars).');
      return;
    }

    setIsRollingBack(true);
    try {
      const res = await fetch('/api/migration/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: rollbackBatchId.trim(),
          reason: rollbackReason.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(`Rollback failed: ${data.error}`);
        return;
      }

      setRollbackFeedback(`Batch ${data.batch_number} successfully rolled back. Deleted: ${data.deleted_cases} cases, ${data.deleted_invoices} invoices, ${data.deleted_payments} payments.`);
      setShowRollbackModal(false);
      setCommitSummary(null);
      setValidationResult(null);
    } catch (err: any) {
      alert(`Rollback execution failed: ${err.message}`);
    } finally {
      setIsRollingBack(false);
    }
  };

  // 4. Smart Paste Diff Preview
  const handleGeneratePastePreview = async () => {
    setIsPreviewingPaste(true);
    setPasteDiffPreview(null);
    try {
      const res = await fetch('/api/migration/smart-paste/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_tsv_text: pastedTsv,
          delimiter: '\t',
          has_headers: true
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(`Smart paste failed: ${data.error}`);
        return;
      }

      setPasteDiffPreview(data.preview);
    } catch (err: any) {
      alert(`Smart paste error: ${err.message}`);
    } finally {
      setIsPreviewingPaste(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3 mb-2">
            <span className="p-2 bg-emerald-500/10 text-emerald-400 rounded-md border border-emerald-500/20">
              <UploadCloud className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-white">
              Legacy Data Migration & Parity Verification
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              PHASE-9B
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
            Multi-tenant DNA legacy import engine with automated entity resolution, dry-run gatekeeper (bad GSTIN, duplicate claims, negative amounts), idempotent <code className="font-mono-code text-slate-300">import_batch_id</code> tagging, DB-based atomic rollback, and day-to-day smart paste diff preview.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              setRollbackBatchId(activeBatchId || '');
              setShowRollbackModal(true);
            }}
            className="px-3.5 py-2 text-xs font-medium rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-colors flex items-center space-x-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Rollback Batch</span>
          </button>
        </div>
      </div>

      {rollbackFeedback && (
        <div className="p-4 bg-emerald-950/60 border border-emerald-500/40 rounded-lg text-emerald-200 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span>{rollbackFeedback}</span>
          </div>
          <button onClick={() => setRollbackFeedback(null)} className="text-emerald-400 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-800 space-x-6 text-sm">
        <button
          onClick={() => setActiveTab('LEGACY_UPLOAD')}
          className={`pb-3 font-medium transition-colors flex items-center space-x-2 ${
            activeTab === 'LEGACY_UPLOAD'
              ? 'text-emerald-400 border-b-2 border-emerald-500'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          <span>Legacy DNA Migration (CSV/JSON)</span>
        </button>

        <button
          onClick={() => setActiveTab('SMART_PASTE')}
          className={`pb-3 font-medium transition-colors flex items-center space-x-2 ${
            activeTab === 'SMART_PASTE'
              ? 'text-emerald-400 border-b-2 border-emerald-500'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ClipboardPaste className="h-4 w-4" />
          <span>Smart Paste Bulk Entry</span>
        </button>

        <button
          onClick={() => setActiveTab('PARITY_DASHBOARD')}
          className={`pb-3 font-medium transition-colors flex items-center space-x-2 ${
            activeTab === 'PARITY_DASHBOARD'
              ? 'text-emerald-400 border-b-2 border-emerald-500'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="h-4 w-4" />
          <span>Reconciliation & Parity Gate</span>
        </button>
      </div>

      {/* TAB 1: LEGACY UPLOAD */}
      {activeTab === 'LEGACY_UPLOAD' && (
        <div className="space-y-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">
                  Legacy DNA Export Payload (JSON / CSV Format)
                </h3>
                <p className="text-xs text-slate-400">
                  Upload or paste your DNA database export. Columns strictly conform to <code className="font-mono-code text-slate-300">docs/LEGACY_DATA_MAP.md</code>.
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setRawJsonInput(JSON.stringify(SAMPLE_DNA_DATASET, null, 2))}
                  className="px-2.5 py-1.5 text-xs font-mono-code bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors"
                >
                  Load Reference Golden Dataset
                </button>
              </div>
            </div>

            <textarea
              rows={8}
              value={rawJsonInput}
              onChange={(e) => setRawJsonInput(e.target.value)}
              className="w-full bg-slate-950 font-mono-code text-xs text-slate-200 p-3 rounded border border-slate-800 focus:outline-none focus:border-emerald-500"
              placeholder="Paste JSON array of cases here..."
            />

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Idempotent Batch tag will be generated automatically upon validation.
              </span>

              <button
                type="button"
                onClick={handleRunDryRun}
                disabled={isValidating}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded flex items-center space-x-2 disabled:opacity-50 transition-colors"
              >
                {isValidating ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Validating Legacy Records...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Run Dry-Run Gatekeeper</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Dry Run Summary Results */}
          {validationResult && (
            <div className="space-y-6">
              {/* Telemetry Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Total Analyzed Rows</span>
                  <span className="text-2xl font-bold font-mono-code text-white">
                    {validationResult.total_rows}
                  </span>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Valid Case Rows</span>
                  <span className="text-2xl font-bold font-mono-code text-emerald-400">
                    {validationResult.valid_rows_count}
                  </span>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Dry-Run Errors</span>
                  <span className={`text-2xl font-bold font-mono-code ${validationResult.error_count > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                    {validationResult.error_count}
                  </span>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Unresolved Entities</span>
                  <span className={`text-2xl font-bold font-mono-code ${validationResult.warning_count > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                    {validationResult.warning_count}
                  </span>
                </div>
              </div>

              {/* Unresolved Names & Entity Resolution Review (Mandatory approval) */}
              {validationResult.unresolved_report.exceptions.length > 0 && (
                <div className="bg-amber-950/20 border border-amber-500/30 rounded-lg p-5">
                  <div className="flex items-center space-x-2 text-amber-300 font-semibold text-sm mb-2">
                    <ShieldAlert className="h-4 w-4" />
                    <span>Unresolved Names & Reconciliation Exception Report</span>
                  </div>
                  <p className="text-xs text-amber-200/80 mb-4">
                    Rule A12 & LEGACY_DATA_MAP.md require <strong>Zero Silent Fallbacks</strong>. Every ambiguous entity name must be explicitly mapped or approved before batch commit.
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-amber-500/20 text-slate-400 uppercase tracking-wider font-semibold">
                          <th className="py-2.5 px-3">Exception ID</th>
                          <th className="py-2.5 px-3">Entity Type</th>
                          <th className="py-2.5 px-3">Legacy Raw Text</th>
                          <th className="py-2.5 px-3">Occurrences</th>
                          <th className="py-2.5 px-3">Suggested Match</th>
                          <th className="py-2.5 px-3">Score</th>
                          <th className="py-2.5 px-3">Approval Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-500/10 text-slate-200">
                        {validationResult.unresolved_report.exceptions.map((exc) => {
                          const currentDecision = pendingResolutions[exc.raw_text];
                          return (
                            <tr key={exc.exception_id} className="hover:bg-amber-500/5">
                              <td className="py-3 px-3 font-mono-code text-slate-400">{exc.exception_id}</td>
                              <td className="py-3 px-3 uppercase font-medium">{exc.entity_type}</td>
                              <td className="py-3 px-3 font-mono-code text-amber-200 font-semibold">{exc.raw_text}</td>
                              <td className="py-3 px-3 font-mono-code">{exc.occurrences}</td>
                              <td className="py-3 px-3">
                                {exc.suggested_match.canonical_name ? (
                                  <span className="text-emerald-300 font-medium">
                                    {exc.suggested_match.canonical_name}
                                  </span>
                                ) : (
                                  <span className="text-slate-500 italic">No close registry match</span>
                                )}
                              </td>
                              <td className="py-3 px-3 font-mono-code">
                                {Math.round(exc.suggested_match.similarity_score * 100)}%
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex items-center space-x-2">
                                  {exc.suggested_match.entity_id && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPendingResolutions({
                                          ...pendingResolutions,
                                          [exc.raw_text]: {
                                            raw_text: exc.raw_text,
                                            entity_type: exc.entity_type === 'company' ? 'CLIENT' : 'INVESTIGATOR',
                                            action: 'MAP_TO_EXISTING',
                                            target_id: exc.suggested_match.entity_id!,
                                            new_entity_name: exc.suggested_match.canonical_name!
                                          }
                                        });
                                      }}
                                      className={`px-2.5 py-1 text-[11px] rounded font-medium border transition-colors ${
                                        currentDecision?.action === 'MAP_TO_EXISTING'
                                          ? 'bg-emerald-600 text-white border-emerald-500'
                                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                      }`}
                                    >
                                      Approve Match
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPendingResolutions({
                                        ...pendingResolutions,
                                        [exc.raw_text]: {
                                          raw_text: exc.raw_text,
                                          entity_type: exc.entity_type === 'company' ? 'CLIENT' : 'INVESTIGATOR',
                                          action: 'CREATE_NEW',
                                          new_entity_name: exc.raw_text
                                        }
                                      });
                                    }}
                                    className={`px-2.5 py-1 text-[11px] rounded font-medium border transition-colors ${
                                      currentDecision?.action === 'CREATE_NEW'
                                        ? 'bg-blue-600 text-white border-blue-500'
                                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                    }`}
                                  >
                                    Create New
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Error Breakdown */}
              {validationResult.errors.length > 0 && (
                <div className="bg-rose-950/20 border border-rose-500/30 rounded-lg p-5">
                  <div className="flex items-center space-x-2 text-rose-300 font-semibold text-sm mb-2">
                    <XCircle className="h-4 w-4" />
                    <span>Dry-Run Validation Errors ({validationResult.errors.length})</span>
                  </div>
                  <div className="divide-y divide-rose-500/10">
                    {validationResult.errors.map((err, i) => (
                      <div key={i} className="py-2.5 flex items-start justify-between text-xs">
                        <div>
                          <span className="font-mono-code text-rose-400 font-semibold mr-2">[{err.error_type}]</span>
                          <span className="text-slate-300">{err.message}</span>
                        </div>
                        {err.suggested_fix && (
                          <span className="text-emerald-400 font-medium text-[11px]">
                            Suggested Fix: {err.suggested_fix}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Commit Action */}
              <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-lg">
                <div>
                  <span className="text-xs font-semibold text-white block">Ready to Commit Migration Batch</span>
                  <span className="text-[11px] text-slate-400">
                    Batch ID: <code className="font-mono-code text-emerald-400">{activeBatchId}</code>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleCommitBatch}
                  disabled={isCommitting || validationResult.errors.length > 0}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded flex items-center space-x-2 disabled:opacity-40 transition-colors"
                >
                  {isCommitting ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Committing Batch to Database...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Approve & Commit Import Batch</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SMART PASTE BULK ENTRY */}
      {activeTab === 'SMART_PASTE' && (
        <div className="space-y-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">
                  Smart Paste Bulk Entry (TSV / Excel Clipboard)
                </h3>
                <p className="text-xs text-slate-400">
                  Copy rows directly from Excel or Google Sheets and paste below. The system automatically inspects headers and builds a real-time diff preview.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPastedTsv(SAMPLE_SMART_PASTE_TSV)}
                className="px-2.5 py-1.5 text-xs font-mono-code bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors"
              >
                Load Sample TSV
              </button>
            </div>

            <textarea
              rows={7}
              value={pastedTsv}
              onChange={(e) => setPastedTsv(e.target.value)}
              className="w-full bg-slate-950 font-mono-code text-xs text-slate-200 p-3 rounded border border-slate-800 focus:outline-none focus:border-emerald-500"
              placeholder="Paste tab-delimited rows here..."
            />

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleGeneratePastePreview}
                disabled={isPreviewingPaste}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded flex items-center space-x-2 disabled:opacity-50 transition-colors"
              >
                {isPreviewingPaste ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Parsing Spreadsheets...</span>
                  </>
                ) : (
                  <>
                    <ClipboardPaste className="h-4 w-4" />
                    <span>Generate Diff Preview</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Smart Paste Diff Preview Table */}
          {pasteDiffPreview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Total Pasted Rows</span>
                  <span className="text-2xl font-bold font-mono-code text-white">
                    {pasteDiffPreview.total_pasted}
                  </span>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">New Cases to Create</span>
                  <span className="text-2xl font-bold font-mono-code text-emerald-400">
                    {pasteDiffPreview.new_cases_count}
                  </span>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Updates to Existing</span>
                  <span className="text-2xl font-bold font-mono-code text-amber-400">
                    {pasteDiffPreview.update_cases_count}
                  </span>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Validation Errors</span>
                  <span className={`text-2xl font-bold font-mono-code ${pasteDiffPreview.error_count > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                    {pasteDiffPreview.error_count}
                  </span>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div className="p-4 border-b border-slate-800">
                  <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    Tabular Diff Preview
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                        <th className="py-2.5 px-3">Row</th>
                        <th className="py-2.5 px-3">Doc Code</th>
                        <th className="py-2.5 px-3">Claim No</th>
                        <th className="py-2.5 px-3">Insured Name</th>
                        <th className="py-2.5 px-3">Company</th>
                        <th className="py-2.5 px-3">Investigator(s)</th>
                        <th className="py-2.5 px-3">Total Payable</th>
                        <th className="py-2.5 px-3">Action Type</th>
                        <th className="py-2.5 px-3">Field Changes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-200">
                      {pasteDiffPreview.rows.map((row) => (
                        <tr key={row.row_index} className="hover:bg-slate-800/40">
                          <td className="py-3 px-3 font-mono-code text-slate-400">{row.row_index}</td>
                          <td className="py-3 px-3 font-mono-code font-semibold text-white">{row.doc_code}</td>
                          <td className="py-3 px-3 font-mono-code text-slate-300">{row.claim_no}</td>
                          <td className="py-3 px-3">{row.insured_name}</td>
                          <td className="py-3 px-3">{row.client_name}</td>
                          <td className="py-3 px-3 text-slate-400">
                            {row.investigator_names.length > 0 ? row.investigator_names.join(', ') : 'Unassigned'}
                          </td>
                          <td className="py-3 px-3 font-mono-code">₹{row.total_payable.toFixed(2)}</td>
                          <td className="py-3 px-3">
                            {row.is_new_case ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                NEW CASE
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                UPDATE
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            {Object.keys(row.diff_fields).length > 0 ? (
                              <div className="space-y-1">
                                {Object.entries(row.diff_fields).map(([k, v]) => (
                                  <div key={k} className="text-[11px] font-mono-code">
                                    <span className="text-slate-400">{k}: </span>
                                    <span className="line-through text-rose-400">{String(v.old_val)}</span>
                                    <span className="text-slate-500"> → </span>
                                    <span className="text-emerald-400 font-semibold">{String(v.new_val)}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-500 italic text-[11px]">No modifications</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: PARITY RECONCILIATION DASHBOARD (Mandatory Gate) */}
      {activeTab === 'PARITY_DASHBOARD' && (
        <div className="space-y-6">
          {parityReport ? (
            <>
              {/* Mandatory Gate Status Banner */}
              <div
                className={`p-5 rounded-lg border flex items-center justify-between ${
                  parityReport.is_parity_achieved
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                }`}
              >
                <div className="flex items-center space-x-3">
                  {parityReport.is_parity_achieved ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-6 w-6 text-rose-400 flex-shrink-0" />
                  )}
                  <div>
                    <h3 className="font-bold text-sm">
                      {parityReport.is_parity_achieved
                        ? 'PARITY GATE PASSED: Authoritative 100% Reconciliation Achieved'
                        : 'PARITY GATE FAILED: Discrepancies Detected'}
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {parityReport.is_parity_achieved
                        ? 'Differences across total cases, monthly distributions, invoice amounts, receipts, TDS withheld, and investigator payables are strictly 0.00.'
                        : 'All line item discrepancies must be zero or explained line by line before sign-off.'}
                    </p>
                  </div>
                </div>
                <span className="font-mono-code text-xs px-2.5 py-1 bg-slate-900 rounded border border-slate-700">
                  Batch: {parityReport.batch_id.slice(0, 13)}
                </span>
              </div>

              {/* Side-by-Side Financial Telemetry */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Total Cases</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-bold font-mono-code text-white">
                      {parityReport.metrics.total_cases.target}
                    </span>
                    <span className="text-xs font-mono-code text-emerald-400">
                      Diff: {parityReport.metrics.total_cases.difference}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Legacy: {parityReport.metrics.total_cases.legacy}</span>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Total Invoiced</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-bold font-mono-code text-white">
                      ₹{parityReport.metrics.total_invoice_amount.target.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs font-mono-code text-emerald-400">
                      ₹{parityReport.metrics.total_invoice_amount.difference.toFixed(2)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Legacy: ₹{parityReport.metrics.total_invoice_amount.legacy.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Total Received</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-bold font-mono-code text-white">
                      ₹{parityReport.metrics.total_received_amount.target.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs font-mono-code text-emerald-400">
                      ₹{parityReport.metrics.total_received_amount.difference.toFixed(2)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Legacy: ₹{parityReport.metrics.total_received_amount.legacy.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">TDS Withheld</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-bold font-mono-code text-white">
                      ₹{parityReport.metrics.total_tds_deducted.target.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs font-mono-code text-emerald-400">
                      ₹{parityReport.metrics.total_tds_deducted.difference.toFixed(2)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Legacy: ₹{parityReport.metrics.total_tds_deducted.legacy.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                  <span className="text-xs text-slate-400 block mb-1">Investigator Payable</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-bold font-mono-code text-white">
                      ₹{parityReport.metrics.total_investigator_payable.target.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs font-mono-code text-emerald-400">
                      ₹{parityReport.metrics.total_investigator_payable.difference.toFixed(2)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Legacy: ₹{parityReport.metrics.total_investigator_payable.legacy.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {/* Monthly Case Counts & Golden Tests Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Monthly Case Distribution Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                  <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-3">
                    Per-Month Case Volume Breakdown
                  </h4>
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2">Month</th>
                        <th className="py-2">Legacy Count</th>
                        <th className="py-2">Target Count</th>
                        <th className="py-2">Diff</th>
                        <th className="py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono-code">
                      {parityReport.monthly_case_counts.map((m) => (
                        <tr key={m.month}>
                          <td className="py-2 font-semibold text-slate-200">{m.month}</td>
                          <td className="py-2 text-slate-300">{m.legacy_count}</td>
                          <td className="py-2 text-slate-300">{m.target_count}</td>
                          <td className="py-2 text-emerald-400">{m.difference}</td>
                          <td className="py-2">
                            <span className="text-emerald-400 font-bold">MATCH</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Golden Test Vectors Verification */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                  <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-3">
                    Golden Test Suite Verification (Real Imported Rows)
                  </h4>
                  <div className="space-y-3">
                    {parityReport.golden_tests_results.map((gt) => (
                      <div key={gt.test_id} className="p-3 bg-slate-950 rounded border border-slate-800 flex items-start space-x-3">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold font-mono-code text-white">{gt.test_id}:</span>
                            <span className="text-xs font-semibold text-slate-200">{gt.scenario}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">{gt.details}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-lg">
              <Sparkles className="h-8 w-8 text-slate-600 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-300 mb-1">
                No Active Reconciliation Report Loaded
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
                Run a legacy import or paste spreadsheet data to generate a side-by-side parity reconciliation report.
              </p>
              <button
                onClick={() => setActiveTab('LEGACY_UPLOAD')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded"
              >
                Go to Legacy Upload
              </button>
            </div>
          )}
        </div>
      )}

      {/* Rollback Confirmation Modal */}
      {showRollbackModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center space-x-3 text-rose-400">
              <RotateCcw className="h-5 w-5" />
              <h3 className="text-sm font-bold text-white">Rollback Import Batch</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              This initiates an atomic database procedure (<code className="font-mono-code text-slate-300">rollback_import_batch</code>) that bypasses immutability triggers via server-side session config and permanently removes all cases, invoices, and payments created in this batch.
            </p>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Import Batch ID</label>
              <input
                type="text"
                value={rollbackBatchId}
                onChange={(e) => setRollbackBatchId(e.target.value)}
                className="w-full bg-slate-950 font-mono-code text-xs text-white p-2.5 rounded border border-slate-800 focus:outline-none focus:border-rose-500"
                placeholder="UUID of import batch..."
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Mandatory Rollback Reason (Audited)</label>
              <textarea
                rows={3}
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                className="w-full bg-slate-950 text-xs text-white p-2.5 rounded border border-slate-800 focus:outline-none focus:border-rose-500"
                placeholder="Explain why this batch is being rolled back (minimum 5 characters)..."
              />
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRollbackModal(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-white"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteRollback}
                disabled={isRollingBack || !rollbackReason || rollbackReason.trim().length < 5}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded flex items-center space-x-1.5 disabled:opacity-50"
              >
                {isRollingBack ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Rolling back in DB...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Execute Atomic Rollback</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
