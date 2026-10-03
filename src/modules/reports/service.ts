import { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/service';
import { calculateReportDiff } from './diff';
import { evaluateReworkEscalation, generateReworkTaskPayload } from './rework';
import {
  CreateReportInput,
  SaveDraftReportInput,
  SubmitReportInput,
  AddReportCommentInput,
  ResolveReportCommentInput,
  InitiateReworkInput,
  InitiateReworkSchema,
  SubmitReworkCorrectionInput,
  ApproveReportInput,
  InwardHardcopyInput,
  UpdatePacketLocationInput,
  DispatchHardcopyInput,
  AcknowledgeHardcopyDeliveryInput,
} from './schema';
import {
  Report,
  ReportVersion,
  ReportComment,
  ReworkCycle,
  HardcopyPacket,
  HardcopyMovement,
  CourierDocket,
  PrintableManifestData,
  ReportDiff,
} from './types';

export interface UserScopeContext {
  userId: string;
  agencyId: string;
  role?: string;
  scope?: 'ALL' | 'TEAM' | 'ASSIGNED' | 'OWN_ENTERED';
  permissions: string[];
}

export class ReportsService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Internal Scope Verification Helper:
   * Verifies tenant isolation and caller authorization to view/mutate the case docket.
   */
  private async verifyCaseAccess(
    context: UserScopeContext,
    caseId: string,
    requiredPermission?: string
  ): Promise<any> {
    if (requiredPermission && !context.permissions.includes(requiredPermission)) {
      throw new Error(`Permission denied: Missing '${requiredPermission}'`);
    }

    const { data: c, error } = await this.supabase
      .from('cases')
      .select('id, agency_id, doc_code, owner_manager_id, data_entry_user_id, status, rework_count, version, client_id, claim_no, insured_name, patient_name')
      .eq('id', caseId)
      .eq('agency_id', context.agencyId)
      .single();

    if (error || !c) {
      throw new Error(`Case ${caseId} not found or access denied in agency ${context.agencyId}`);
    }

    // Check scope restrictions
    if (context.scope === 'OWN_ENTERED' && c.data_entry_user_id !== context.userId) {
      throw new Error('Scope violation: You can only access cases you entered');
    }

    if (context.scope === 'ASSIGNED') {
      const { data: inv } = await this.supabase
        .from('case_investigators')
        .select('id')
        .eq('case_id', caseId)
        .eq('investigator_id', context.userId)
        .eq('is_active', true)
        .maybeSingle();

      if (!inv) {
        throw new Error('Scope violation: You are not assigned to this case');
      }
    }

    return c;
  }

  // ===========================================================================
  // REPORT LIFECYCLE & VERSIONING
  // ===========================================================================

  /**
   * Fetches report, all historical versions, reviewer comments, and rework cycles.
   */
  async getReportByCaseId(context: UserScopeContext, caseId: string) {
    await this.verifyCaseAccess(context, caseId);

    const { data: report } = await this.supabase
      .from('reports')
      .select('*')
      .eq('case_id', caseId)
      .eq('agency_id', context.agencyId)
      .maybeSingle();

    if (!report) {
      return null;
    }

    const { data: versions } = await this.supabase
      .from('report_versions')
      .select('*')
      .eq('report_id', report.id)
      .eq('agency_id', context.agencyId)
      .order('version_number', { ascending: true });

    const { data: comments } = await this.supabase
      .from('report_comments')
      .select('*')
      .eq('report_id', report.id)
      .eq('agency_id', context.agencyId)
      .order('created_at', { ascending: true });

    const { data: reworkCycles } = await this.supabase
      .from('rework_cycles')
      .select('*')
      .eq('case_id', caseId)
      .eq('agency_id', context.agencyId)
      .order('cycle_number', { ascending: true });

    return {
      report: report as Report,
      versions: (versions || []) as ReportVersion[],
      comments: (comments || []) as ReportComment[],
      reworkCycles: (reworkCycles || []) as ReworkCycle[],
    };
  }

  /**
   * Initializes or fetches a report for a case.
   */
  async createOrGetReport(context: UserScopeContext, input: CreateReportInput): Promise<Report> {
    await this.verifyCaseAccess(context, input.case_id, 'reports.write');

    const { data: existing } = await this.supabase
      .from('reports')
      .select('*')
      .eq('case_id', input.case_id)
      .eq('agency_id', context.agencyId)
      .maybeSingle();

    if (existing) {
      return existing as Report;
    }

    // Insert Report master row
    const { data: report, error: reportErr } = await this.supabase
      .from('reports')
      .insert({
        agency_id: context.agencyId,
        case_id: input.case_id,
        title: input.title || 'Investigation Report',
        status: 'DRAFT',
        current_version: 1,
        author_id: context.userId,
        is_immutable: false,
      })
      .select()
      .single();

    if (reportErr || !report) {
      throw new Error(`Failed to create report: ${reportErr?.message}`);
    }

    // Insert Initial Report Version 1
    const initialContent = {
      summary: input.summary || '',
      sections: input.initial_sections || {
        investigation_summary: {
          title: 'Executive Summary',
          text: input.summary || '',
          evidence_ids: [],
          verified: false,
        },
      },
    };

    await this.supabase.from('report_versions').insert({
      agency_id: context.agencyId,
      report_id: report.id,
      case_id: input.case_id,
      version_number: 1,
      status: 'DRAFT',
      author_id: context.userId,
      summary: input.summary || '',
      content: initialContent,
      change_summary: 'Initial report draft initialized',
      is_approved: false,
    });

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'REPORTS.CREATE',
      entity_type: 'reports',
      entity_id: report.id,
      new_values: { case_id: input.case_id, version: 1 },
    });

    return report as Report;
  }

  /**
   * Saves work in progress for a draft report version.
   */
  async saveDraft(context: UserScopeContext, input: SaveDraftReportInput): Promise<Report> {
    const { data: report } = await this.supabase
      .from('reports')
      .select('*')
      .eq('id', input.report_id)
      .eq('agency_id', context.agencyId)
      .single();

    if (!report) {
      throw new Error('Report not found');
    }

    if (report.is_immutable || report.status === 'APPROVED' || report.status === 'FINAL') {
      throw new Error('A6 Security Violation: Approved report is sealed and immutable. Content and state cannot be modified.');
    }

    await this.verifyCaseAccess(context, report.case_id, 'reports.write');

    // Update report master
    const { data: updatedReport, error: updateErr } = await this.supabase
      .from('reports')
      .update({
        status: 'DRAFT',
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.report_id)
      .select()
      .single();

    if (updateErr) {
      throw new Error(`Failed to save draft: ${updateErr.message}`);
    }

    // Upsert or update version 1 if still in draft, or record draft content
    const { data: existingVer } = await this.supabase
      .from('report_versions')
      .select('*')
      .eq('report_id', input.report_id)
      .eq('version_number', report.current_version)
      .maybeSingle();

    if (!existingVer) {
      await this.supabase.from('report_versions').insert({
        agency_id: context.agencyId,
        report_id: report.id,
        case_id: report.case_id,
        version_number: report.current_version,
        status: 'DRAFT',
        author_id: context.userId,
        summary: input.content.summary,
        content: input.content,
        change_summary: 'Draft updated',
        is_approved: false,
      });
    }

    return updatedReport as Report;
  }

  /**
   * Submits a drafted report for peer review.
   */
  async submitReport(context: UserScopeContext, input: SubmitReportInput): Promise<Report> {
    const { data: report } = await this.supabase
      .from('reports')
      .select('*')
      .eq('id', input.report_id)
      .eq('agency_id', context.agencyId)
      .single();

    if (!report) {
      throw new Error('Report not found');
    }

    if (report.is_immutable || report.status === 'APPROVED' || report.status === 'FINAL') {
      throw new Error('A6 Security Violation: Approved report is sealed and immutable. Content and state cannot be modified.');
    }

    const c = await this.verifyCaseAccess(context, report.case_id, 'reports.submit');

    // Determine target report status
    const targetStatus = report.status === 'SENT_BACK' || report.status === 'CORRECTED'
      ? 'RESUBMITTED'
      : 'SUBMITTED';

    const { data: updatedReport, error: updateErr } = await this.supabase
      .from('reports')
      .update({
        status: targetStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', report.id)
      .select()
      .single();

    if (updateErr) {
      throw new Error(`Failed to submit report: ${updateErr.message}`);
    }

    // Update case outcome and status to REPORT_REVIEW
    await this.supabase
      .from('cases')
      .update({
        status: 'REPORT_REVIEW',
        outcome: input.outcome,
        fraud_reason: input.fraud_reason || null,
        version: c.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', report.case_id);

    // Record status history
    await this.supabase.from('case_status_history').insert({
      agency_id: context.agencyId,
      case_id: report.case_id,
      from_status: c.status,
      to_status: 'REPORT_REVIEW',
      reason: input.change_summary || 'Report submitted for review',
      changed_by: context.userId,
      metadata: { report_id: report.id, outcome: input.outcome },
    });

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'REPORTS.SUBMIT',
      entity_type: 'reports',
      entity_id: report.id,
      new_values: { case_id: report.case_id, status: targetStatus, outcome: input.outcome },
    });

    return updatedReport as Report;
  }

  // ===========================================================================
  // REVIEWER COMMENTS (ANCHORED TO SECTION / EVIDENCE / FIELD)
  // ===========================================================================

  /**
   * Adds a reviewer comment anchored to a specific section, evidence document, or field.
   */
  async addReviewComment(
    context: UserScopeContext,
    input: AddReportCommentInput
  ): Promise<ReportComment> {
    const { data: report } = await this.supabase
      .from('reports')
      .select('*')
      .eq('id', input.report_id)
      .eq('agency_id', context.agencyId)
      .single();

    if (!report) {
      throw new Error('Report not found');
    }

    if (report.is_immutable || report.status === 'APPROVED' || report.status === 'FINAL') {
      throw new Error('A6 Security Violation: Approved report is sealed and immutable. Comments cannot be added to an approved report.');
    }

    await this.verifyCaseAccess(context, report.case_id, 'reports.review');

    const { data: comment, error } = await this.supabase
      .from('report_comments')
      .insert({
        agency_id: context.agencyId,
        report_id: report.id,
        case_id: report.case_id,
        version_number: input.version_number,
        target_type: input.target_type,
        target_id: input.target_id,
        target_label: input.target_label || input.target_id,
        comment: input.comment,
        author_id: context.userId,
        status: 'OPEN',
      })
      .select()
      .single();

    if (error || !comment) {
      throw new Error(`Failed to add comment: ${error?.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'REPORTS.COMMENT_ADD',
      entity_type: 'report_comments',
      entity_id: comment.id,
      new_values: { target_type: input.target_type, target_id: input.target_id },
    });

    return comment as ReportComment;
  }

  /**
   * Resolves a reviewer comment.
   */
  async resolveReviewComment(
    context: UserScopeContext,
    input: ResolveReportCommentInput
  ): Promise<ReportComment> {
    const { data: comment } = await this.supabase
      .from('report_comments')
      .select('*, reports!inner(is_immutable, status)')
      .eq('id', input.comment_id)
      .eq('agency_id', context.agencyId)
      .single();

    if (!comment) {
      throw new Error('Comment not found');
    }

    if (comment.reports?.is_immutable || comment.reports?.status === 'APPROVED') {
      throw new Error('A6 Security Violation: Approved report is sealed and immutable. Comments cannot be modified.');
    }

    await this.verifyCaseAccess(context, comment.case_id);

    const { data: updated, error } = await this.supabase
      .from('report_comments')
      .update({
        status: input.status,
        resolution_notes: input.resolution_notes,
        resolved_by: context.userId,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', input.comment_id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to resolve comment: ${error?.message}`);
    }

    return updated as ReportComment;
  }

  // ===========================================================================
  // REWORK ENGINE & SEND-BACK LIFECYCLE
  // ===========================================================================

  /**
   * Sends back report for rework to investigator, back office, data entry, etc.
   * Creates an actionable task for the receiver, updates rework count,
   * and auto-escalates to ESCALATED_REVIEW when rework_count >= threshold.
   */
  async sendBackForRework(
    context: UserScopeContext,
    input: InitiateReworkInput
  ): Promise<{ reworkCycle: ReworkCycle; isEscalated: boolean; targetCaseStatus: string }> {
    const c = await this.verifyCaseAccess(context, input.case_id, 'reports.review');

    const { data: report } = await this.supabase
      .from('reports')
      .select('*')
      .eq('case_id', input.case_id)
      .eq('agency_id', context.agencyId)
      .single();

    if (!report) {
      throw new Error('Report not found for this case');
    }

    if (report.is_immutable || report.status === 'APPROVED' || report.status === 'FINAL') {
      throw new Error('A6 Security Violation: Approved report is sealed and immutable. Cannot initiate rework.');
    }

    const validated = InitiateReworkSchema.parse(input);

    // 1. Calculate next rework cycle number
    const { data: existingCycles } = await this.supabase
      .from('rework_cycles')
      .select('cycle_number')
      .eq('case_id', validated.case_id)
      .eq('agency_id', context.agencyId);

    const cycleNumber = (existingCycles?.length || 0) + 1;

    // 2. Evaluate Auto-Escalation
    const escalation = evaluateReworkEscalation({
      cycleNumber,
      priority: validated.priority,
    });

    // 3. Insert Rework Cycle Record
    const { data: reworkCycle, error: reworkErr } = await this.supabase
      .from('rework_cycles')
      .insert({
        agency_id: context.agencyId,
        case_id: validated.case_id,
        report_id: report.id,
        cycle_number: cycleNumber,
        requested_by: context.userId,
        target_recipient_type: validated.target_recipient_type,
        target_user_id: validated.target_user_id || null,
        reason_category: validated.reason_category,
        instructions: validated.instructions,
        priority: escalation.effectivePriority,
        deadline: validated.deadline || null,
        target_sections: validated.target_sections,
        target_field_names: validated.target_field_names,
        target_evidence_ids: validated.target_evidence_ids,
        status: 'PENDING',
        is_escalated: escalation.isEscalated,
        escalation_reason: escalation.escalationReason || null,
      })
      .select()
      .single();

    if (reworkErr || !reworkCycle) {
      throw new Error(`Failed to initiate rework: ${reworkErr?.message}`);
    }

    // 4. Create Actionable Task for Receiver
    const taskPayload = generateReworkTaskPayload({
      cycleNumber,
      recipientType: input.target_recipient_type,
      reasonCategory: input.reason_category,
      instructions: input.instructions,
      targetSections: input.target_sections,
      targetFieldNames: input.target_field_names,
      targetEvidenceIds: input.target_evidence_ids,
      deadline: input.deadline,
    });

    await this.supabase.from('case_tasks').insert({
      agency_id: context.agencyId,
      case_id: input.case_id,
      task_title: taskPayload.title,
      description: taskPayload.description,
      assigned_to_id: input.target_user_id || null,
      due_date: input.deadline || null,
      status: 'PENDING',
      created_by: context.userId,
    });

    // 5. Update Report Status
    await this.supabase
      .from('reports')
      .update({
        status: 'SENT_BACK',
        updated_at: new Date().toISOString(),
      })
      .eq('id', report.id);

    // 6. Update Case Status & Rework Count
    await this.supabase
      .from('cases')
      .update({
        status: escalation.targetCaseStatus,
        rework_count: cycleNumber,
        version: c.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.case_id);

    // 7. Record Case Status History
    await this.supabase.from('case_status_history').insert({
      agency_id: context.agencyId,
      case_id: input.case_id,
      from_status: c.status,
      to_status: escalation.targetCaseStatus,
      reason: `Rework #${cycleNumber} (${input.reason_category}): ${input.instructions}`,
      changed_by: context.userId,
      metadata: {
        rework_cycle_id: reworkCycle.id,
        is_escalated: escalation.isEscalated,
        recipient_type: input.target_recipient_type,
      },
    });

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'REPORTS.REWORK_INITIATE',
      entity_type: 'rework_cycles',
      entity_id: reworkCycle.id,
      new_values: {
        cycle_number: cycleNumber,
        is_escalated: escalation.isEscalated,
        target_recipient: input.target_recipient_type,
      },
    });

    return {
      reworkCycle: reworkCycle as ReworkCycle,
      isEscalated: escalation.isEscalated,
      targetCaseStatus: escalation.targetCaseStatus,
    };
  }

  /**
   * Submits corrections for an active rework cycle.
   * Increments current_version and inserts a NEW discrete version (Rule A6).
   */
  async submitReworkCorrection(
    context: UserScopeContext,
    input: SubmitReworkCorrectionInput
  ): Promise<{ report: Report; newVersion: ReportVersion }> {
    const { data: report } = await this.supabase
      .from('reports')
      .select('*')
      .eq('id', input.report_id)
      .eq('agency_id', context.agencyId)
      .single();

    if (!report) {
      throw new Error('Report not found');
    }

    if (report.is_immutable || report.status === 'APPROVED' || report.status === 'FINAL') {
      throw new Error('A6 Security Violation: Approved report is sealed and immutable. Cannot submit correction.');
    }

    const c = await this.verifyCaseAccess(context, report.case_id, 'reports.write');

    const nextVersionNumber = report.current_version + 1;

    // 1. Insert new discrete version (Append-only)
    const { data: newVer, error: verErr } = await this.supabase
      .from('report_versions')
      .insert({
        agency_id: context.agencyId,
        report_id: report.id,
        case_id: report.case_id,
        version_number: nextVersionNumber,
        status: 'CORRECTED',
        author_id: context.userId,
        summary: input.content.summary,
        content: input.content,
        change_summary: input.change_summary,
        rework_cycle_id: input.rework_cycle_id,
        is_approved: false,
      })
      .select()
      .single();

    if (verErr || !newVer) {
      throw new Error(`Failed to store corrected version: ${verErr?.message}`);
    }

    // 2. Mark Rework Cycle Corrected
    await this.supabase
      .from('rework_cycles')
      .update({
        status: 'CORRECTED',
        correction_notes: input.correction_notes,
        completed_at: new Date().toISOString(),
      })
      .eq('id', input.rework_cycle_id);

    // 3. Update Report master current_version and status
    const { data: updatedReport, error: repErr } = await this.supabase
      .from('reports')
      .update({
        current_version: nextVersionNumber,
        status: 'RESUBMITTED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', report.id)
      .select()
      .single();

    if (repErr) {
      throw new Error(`Failed to update report version pointer: ${repErr.message}`);
    }

    // 4. Update Case status back to REPORT_REVIEW
    await this.supabase
      .from('cases')
      .update({
        status: 'REPORT_REVIEW',
        version: c.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', report.case_id);

    await this.supabase.from('case_status_history').insert({
      agency_id: context.agencyId,
      case_id: report.case_id,
      from_status: c.status,
      to_status: 'REPORT_REVIEW',
      reason: `Rework corrections submitted (v${nextVersionNumber}): ${input.change_summary}`,
      changed_by: context.userId,
      metadata: { rework_cycle_id: input.rework_cycle_id, new_version: nextVersionNumber },
    });

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'REPORTS.CORRECTION_SUBMIT',
      entity_type: 'reports',
      entity_id: report.id,
      new_values: { new_version: nextVersionNumber, rework_cycle_id: input.rework_cycle_id },
    });

    return {
      report: updatedReport as Report,
      newVersion: newVer as ReportVersion,
    };
  }

  // ===========================================================================
  // APPROVAL STEP & IMMUTABILITY ENFORCEMENT
  // ===========================================================================

  /**
   * Formally approves and seals an investigation report.
   * Sets is_immutable = true. Approved report cannot be modified or deleted.
   */
  async approveReport(context: UserScopeContext, input: ApproveReportInput): Promise<Report> {
    const { data: report } = await this.supabase
      .from('reports')
      .select('*')
      .eq('id', input.report_id)
      .eq('agency_id', context.agencyId)
      .single();

    if (!report) {
      throw new Error('Report not found');
    }

    if (report.is_immutable || report.status === 'APPROVED' || report.status === 'FINAL') {
      throw new Error('A6 Security Violation: Approved report is already sealed and immutable.');
    }

    const c = await this.verifyCaseAccess(context, report.case_id);

    // If case was escalated, require reports.escalate, else reports.approve
    const requiredPerm = c.status === 'ESCALATED_REVIEW' ? 'reports.escalate' : 'reports.approve';
    if (!context.permissions.includes(requiredPerm) && !context.permissions.includes('reports.approve')) {
      throw new Error(`Permission denied: Missing '${requiredPerm}' to approve report`);
    }

    const approvedAt = new Date().toISOString();

    // 1. Seal Report and mark immutable
    const { data: approvedReport, error: appErr } = await this.supabase
      .from('reports')
      .update({
        status: 'APPROVED',
        is_immutable: true,
        approved_by: context.userId,
        approved_at: approvedAt,
        approval_notes: input.approval_notes,
        updated_at: approvedAt,
      })
      .eq('id', report.id)
      .select()
      .single();

    if (appErr || !approvedReport) {
      throw new Error(`Failed to approve report: ${appErr?.message}`);
    }

    // 2. Advance Case Status to APPROVED
    await this.supabase
      .from('cases')
      .update({
        status: 'APPROVED',
        version: c.version + 1,
        updated_at: approvedAt,
      })
      .eq('id', report.case_id);

    await this.supabase.from('case_status_history').insert({
      agency_id: context.agencyId,
      case_id: report.case_id,
      from_status: c.status,
      to_status: 'APPROVED',
      reason: `Report formally approved: ${input.approval_notes}`,
      changed_by: context.userId,
      metadata: { report_id: report.id, version: report.current_version },
    });

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'REPORTS.APPROVE',
      entity_type: 'reports',
      entity_id: report.id,
      new_values: { version: report.current_version, approved_by: context.userId },
    });

    return approvedReport as Report;
  }

  /**
   * Computes a structured diff between any two report versions.
   */
  async getReportDiff(
    context: UserScopeContext,
    reportId: string,
    fromVersionNumber: number,
    toVersionNumber: number
  ): Promise<ReportDiff> {
    const { data: report } = await this.supabase
      .from('reports')
      .select('*')
      .eq('id', reportId)
      .eq('agency_id', context.agencyId)
      .single();

    if (!report) {
      throw new Error('Report not found');
    }

    await this.verifyCaseAccess(context, report.case_id);

    const { data: vFrom } = await this.supabase
      .from('report_versions')
      .select('*')
      .eq('report_id', reportId)
      .eq('version_number', fromVersionNumber)
      .single();

    const { data: vTo } = await this.supabase
      .from('report_versions')
      .select('*')
      .eq('report_id', reportId)
      .eq('version_number', toVersionNumber)
      .single();

    if (!vFrom || !vTo) {
      throw new Error(`Versions ${fromVersionNumber} and/or ${toVersionNumber} not found for report ${reportId}`);
    }

    return calculateReportDiff(fromVersionNumber, toVersionNumber, vFrom.content, vTo.content);
  }

  // ===========================================================================
  // HARDCOPY LOGISTICS & APPEND-ONLY CHAIN OF CUSTODY
  // ===========================================================================

  /**
   * Inwards a physical document packet from field investigator.
   * Tracks packet number, document counts (bills, discharge, reports, photos),
   * physical location (rack/shelf/box), and logs append-only movement.
   */
  async inwardPacket(
    context: UserScopeContext,
    input: InwardHardcopyInput
  ): Promise<HardcopyPacket> {
    const c = await this.verifyCaseAccess(context, input.case_id, 'hardcopy.receive');

    // Check packet_no uniqueness within agency
    const { data: existing } = await this.supabase
      .from('hardcopy_packets')
      .select('id')
      .eq('agency_id', context.agencyId)
      .eq('packet_no', input.packet_no)
      .maybeSingle();

    if (existing) {
      throw new Error(`Packet number "${input.packet_no}" already exists in agency`);
    }

    const locStr = `Room: ${input.storage_location.room || 'Archive'} / Rack: ${input.storage_location.rack} / Shelf: ${input.storage_location.shelf} / Box: ${input.storage_location.box}`;

    // 1. Insert Packet
    const { data: packet, error: pktErr } = await this.supabase
      .from('hardcopy_packets')
      .insert({
        agency_id: context.agencyId,
        case_id: input.case_id,
        packet_no: input.packet_no,
        investigator_id: input.investigator_id || null,
        received_from_user_id: input.received_from_user_id || null,
        received_by_user_id: context.userId,
        received_at: new Date().toISOString(),
        item_counts: input.item_counts,
        condition_notes: input.condition_notes || null,
        storage_location: input.storage_location,
        current_status: 'RECEIVED',
      })
      .select()
      .single();

    if (pktErr || !packet) {
      throw new Error(`Failed to inward hardcopy packet: ${pktErr?.message}`);
    }

    // 2. Insert Append-Only Chain of Custody Movement
    await this.supabase.from('hardcopy_movements').insert({
      agency_id: context.agencyId,
      case_id: input.case_id,
      packet_id: packet.id,
      movement_type: 'RECEIVED_FROM_INVESTIGATOR',
      from_location: 'Investigator Handover',
      to_location: locStr,
      handler_id: context.userId,
      notes: input.condition_notes || 'Physical documents received into archive',
      item_counts: input.item_counts,
      moved_at: new Date().toISOString(),
    });

    // 3. Update investigator hardcopy status in case_investigators if matched
    if (input.investigator_id) {
      await this.supabase
        .from('case_investigators')
        .update({ hardcopy_status: 'RECEIVED' })
        .eq('case_id', input.case_id)
        .eq('investigator_id', input.investigator_id);
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'HARDCOPY.INWARD',
      entity_type: 'hardcopy_packets',
      entity_id: packet.id,
      new_values: { packet_no: input.packet_no, case_id: input.case_id, location: locStr },
    });

    return packet as HardcopyPacket;
  }

  /**
   * Updates physical packet storage location (e.g. Rack/Shelf/Box change or retrieval).
   * Generates append-only chain of custody movement.
   */
  async updatePacketLocation(
    context: UserScopeContext,
    input: UpdatePacketLocationInput
  ): Promise<HardcopyPacket> {
    const { data: packet } = await this.supabase
      .from('hardcopy_packets')
      .select('*')
      .eq('id', input.packet_id)
      .eq('agency_id', context.agencyId)
      .single();

    if (!packet) {
      throw new Error('Hardcopy packet not found');
    }

    await this.verifyCaseAccess(context, packet.case_id, 'hardcopy.receive');

    const oldLocStr = `Rack: ${packet.storage_location.rack} / Shelf: ${packet.storage_location.shelf} / Box: ${packet.storage_location.box}`;
    const newLocStr = `Rack: ${input.storage_location.rack} / Shelf: ${input.storage_location.shelf} / Box: ${input.storage_location.box}`;

    // Update packet location
    const { data: updated, error } = await this.supabase
      .from('hardcopy_packets')
      .update({
        storage_location: input.storage_location,
        current_status: input.movement_type === 'RETRIEVED_FOR_REVIEW' ? 'RETRIEVED' : 'STORED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', packet.id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to update packet location: ${error?.message}`);
    }

    // Append-only chain of custody entry
    await this.supabase.from('hardcopy_movements').insert({
      agency_id: context.agencyId,
      case_id: packet.case_id,
      packet_id: packet.id,
      movement_type: input.movement_type,
      from_location: oldLocStr,
      to_location: newLocStr,
      handler_id: context.userId,
      notes: input.notes || 'Internal custody relocation',
      item_counts: packet.item_counts,
      moved_at: new Date().toISOString(),
    });

    return updated as HardcopyPacket;
  }

  /**
   * Dispatches hardcopy dockets to client via courier with AWB tracking.
   * Generates courier manifest and append-only dispatch custody records.
   */
  async dispatchHardcopy(
    context: UserScopeContext,
    input: DispatchHardcopyInput
  ): Promise<CourierDocket> {
    if (!context.permissions.includes('hardcopy.dispatch')) {
      throw new Error("Permission denied: Missing 'hardcopy.dispatch'");
    }

    // Verify all packets exist in tenant
    const { data: packets } = await this.supabase
      .from('hardcopy_packets')
      .select('*, cases(id, doc_code, claim_no, insured_name, status, version)')
      .eq('agency_id', context.agencyId)
      .in('id', input.packet_ids);

    if (!packets || packets.length !== input.packet_ids.length) {
      throw new Error('One or more hardcopy packets not found in agency');
    }

    const now = new Date();
    const docketNumber = `DOK-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${String(Math.floor(1000 + Math.random() * 9000))}`;

    // 1. Create Courier Docket
    const { data: docket, error: dockErr } = await this.supabase
      .from('courier_dockets')
      .insert({
        agency_id: context.agencyId,
        docket_number: docketNumber,
        client_id: input.client_id,
        client_branch_id: input.client_branch_id || null,
        courier_partner: input.courier_partner,
        awb_number: input.awb_number,
        dispatched_at: input.dispatched_at || now.toISOString(),
        dispatched_by: context.userId,
        delivery_status: 'IN_TRANSIT',
      })
      .select()
      .single();

    if (dockErr || !docket) {
      throw new Error(`Failed to create courier docket: ${dockErr?.message}`);
    }

    // 2. Update Packets & append movements
    for (const pkt of packets) {
      const fromLoc = `Rack: ${pkt.storage_location.rack} / Shelf: ${pkt.storage_location.shelf} / Box: ${pkt.storage_location.box}`;
      const toLoc = `${input.courier_partner} Transit (AWB: ${input.awb_number})`;

      await this.supabase
        .from('hardcopy_packets')
        .update({
          current_status: 'DISPATCHED',
          courier_docket_id: docket.id,
          updated_at: now.toISOString(),
        })
        .eq('id', pkt.id);

      await this.supabase.from('hardcopy_movements').insert({
        agency_id: context.agencyId,
        case_id: pkt.case_id,
        packet_id: pkt.id,
        movement_type: 'DISPATCHED_TO_CLIENT',
        from_location: fromLoc,
        to_location: toLoc,
        handler_id: context.userId,
        docket_id: docket.id,
        notes: `Dispatched to client via ${input.courier_partner} (AWB: ${input.awb_number})`,
        item_counts: pkt.item_counts,
        moved_at: now.toISOString(),
      });

      // Fetch case directly to check status and version
      const { data: c } = await this.supabase
        .from('cases')
        .select('id, status, version')
        .eq('id', pkt.case_id)
        .single();

      // Advance case status to HARDCOPY_TRANSIT if approved
      if (c?.status === 'APPROVED') {
        await this.supabase
          .from('cases')
          .update({
            status: 'HARDCOPY_TRANSIT',
            version: c.version + 1,
            updated_at: now.toISOString(),
          })
          .eq('id', pkt.case_id);

        await this.supabase.from('case_status_history').insert({
          agency_id: context.agencyId,
          case_id: pkt.case_id,
          from_status: 'APPROVED',
          to_status: 'HARDCOPY_TRANSIT',
          reason: `Physical docket dispatched via ${input.courier_partner} (AWB: ${input.awb_number})`,
          changed_by: context.userId,
          metadata: { docket_id: docket.id, awb_number: input.awb_number },
        });
      }
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'HARDCOPY.DISPATCH',
      entity_type: 'courier_dockets',
      entity_id: docket.id,
      new_values: {
        docket_number: docketNumber,
        awb: input.awb_number,
        packet_count: packets.length,
      },
    });

    return docket as CourierDocket;
  }

  /**
   * Acknowledges delivery receipt from client / courier POD.
   */
  async acknowledgeDelivery(
    context: UserScopeContext,
    input: AcknowledgeHardcopyDeliveryInput
  ): Promise<CourierDocket> {
    if (!context.permissions.includes('hardcopy.receive')) {
      throw new Error("Permission denied: Missing 'hardcopy.receive'");
    }

    const { data: docket } = await this.supabase
      .from('courier_dockets')
      .select('*')
      .eq('id', input.docket_id)
      .eq('agency_id', context.agencyId)
      .single();

    if (!docket) {
      throw new Error('Courier docket not found');
    }

    const deliveredAt = input.delivered_at || new Date().toISOString();

    // 1. Update Docket
    const { data: updatedDocket, error } = await this.supabase
      .from('courier_dockets')
      .update({
        delivery_status: 'DELIVERED',
        delivered_at: deliveredAt,
        recipient_name: input.recipient_name,
        acknowledgement_notes: input.acknowledgement_notes || null,
        proof_of_delivery_r2_key: input.proof_of_delivery_r2_key || null,
      })
      .eq('id', docket.id)
      .select()
      .single();

    if (error || !updatedDocket) {
      throw new Error(`Failed to acknowledge delivery: ${error?.message}`);
    }

    // 2. Fetch packets in docket
    const { data: packets } = await this.supabase
      .from('hardcopy_packets')
      .select('*, cases(id, status, version)')
      .eq('courier_docket_id', docket.id)
      .eq('agency_id', context.agencyId);

    for (const pkt of packets || []) {
      await this.supabase
        .from('hardcopy_packets')
        .update({
          current_status: 'DELIVERED',
          updated_at: deliveredAt,
        })
        .eq('id', pkt.id);

      await this.supabase.from('hardcopy_movements').insert({
        agency_id: context.agencyId,
        case_id: pkt.case_id,
        packet_id: pkt.id,
        movement_type: 'DELIVERY_ACKNOWLEDGED',
        from_location: `${docket.courier_partner} In Transit`,
        to_location: `Client Recipient: ${input.recipient_name}`,
        handler_id: context.userId,
        docket_id: docket.id,
        notes: input.acknowledgement_notes || 'Client acknowledgement confirmed',
        item_counts: pkt.item_counts,
        moved_at: deliveredAt,
      });

      // Fetch case directly to check status and version
      const { data: c } = await this.supabase
        .from('cases')
        .select('id, status, version')
        .eq('id', pkt.case_id)
        .single();

      // Advance case from HARDCOPY_TRANSIT to CLOSED (ready for billing)
      if (c?.status === 'HARDCOPY_TRANSIT') {
        await this.supabase
          .from('cases')
          .update({
            status: 'CLOSED',
            completed_at: deliveredAt,
            version: c.version + 1,
            updated_at: deliveredAt,
          })
          .eq('id', pkt.case_id);

        await this.supabase.from('case_status_history').insert({
          agency_id: context.agencyId,
          case_id: pkt.case_id,
          from_status: 'HARDCOPY_TRANSIT',
          to_status: 'CLOSED',
          reason: `Hardcopy delivery acknowledged by ${input.recipient_name}. Docket closed for billing.`,
          changed_by: context.userId,
          metadata: { docket_id: docket.id, recipient: input.recipient_name },
        });
      }
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'HARDCOPY.ACKNOWLEDGE_DELIVERY',
      entity_type: 'courier_dockets',
      entity_id: docket.id,
      new_values: { recipient: input.recipient_name, delivered_at: deliveredAt },
    });

    return updatedDocket as CourierDocket;
  }

  /**
   * Retrieves append-only chain of custody movements for a case.
   */
  async getChainOfCustody(
    context: UserScopeContext,
    caseId: string
  ): Promise<HardcopyMovement[]> {
    await this.verifyCaseAccess(context, caseId);

    const { data: movements } = await this.supabase
      .from('hardcopy_movements')
      .select('*')
      .eq('case_id', caseId)
      .eq('agency_id', context.agencyId)
      .order('moved_at', { ascending: true });

    return (movements || []) as HardcopyMovement[];
  }

  /**
   * Generates printable manifest docket model.
   */
  async getPrintableManifest(
    context: UserScopeContext,
    docketId: string
  ): Promise<PrintableManifestData> {
    const { data: docket } = await this.supabase
      .from('courier_dockets')
      .select('*, clients(id, name, pan_number), users!courier_dockets_dispatched_by_fkey(full_name), agencies(name)')
      .eq('id', docketId)
      .eq('agency_id', context.agencyId)
      .single();

    if (!docket) {
      throw new Error('Docket not found');
    }

    const { data: packets } = await this.supabase
      .from('hardcopy_packets')
      .select('*, cases(claim_no, insured_name, patient_name)')
      .eq('courier_docket_id', docket.id)
      .eq('agency_id', context.agencyId);

    const pktsList = packets || [];
    let totalDocs = 0;

    let agencyName = docket.agencies?.name;
    if (!agencyName && docket.agency_id) {
      const { data: ag } = await this.supabase
        .from('agencies')
        .select('name')
        .eq('id', docket.agency_id)
        .single();
      if (ag?.name) agencyName = ag.name;
    }

    let clientName = docket.clients?.name;
    if (!clientName && docket.client_id) {
      const { data: cl } = await this.supabase
        .from('clients')
        .select('name')
        .eq('id', docket.client_id)
        .single();
      if (cl?.name) clientName = cl.name;
    }

    let dispatchedByName = docket.users?.full_name;
    if (!dispatchedByName && docket.dispatched_by) {
      const { data: u } = await this.supabase
        .from('users')
        .select('full_name')
        .eq('id', docket.dispatched_by)
        .single();
      if (u?.full_name) dispatchedByName = u.full_name;
    }

    const formattedPackets = [];
    for (const p of pktsList) {
      let claimNo = p.cases?.claim_no;
      let insuredName = p.cases?.insured_name;
      let patientName = p.cases?.patient_name;

      if ((!claimNo || !insuredName) && p.case_id) {
        const { data: c } = await this.supabase
          .from('cases')
          .select('claim_no, insured_name, patient_name')
          .eq('id', p.case_id)
          .single();
        if (c) {
          claimNo = c.claim_no || claimNo;
          insuredName = c.insured_name || insuredName;
          patientName = c.patient_name || patientName;
        }
      }

      const counts = p.item_counts || {};
      const sum = (counts.bills || 0) + (counts.prescriptions || 0) + (counts.reports || 0) + (counts.photos || 0) + (counts.total_pages || 0);
      totalDocs += sum;

      formattedPackets.push({
        packetNo: p.packet_no,
        claimNo: claimNo || 'N/A',
        insuredName: insuredName || 'N/A',
        patientName: patientName,
        itemCounts: p.item_counts,
        conditionNotes: p.condition_notes,
      });
    }

    return {
      agencyName: agencyName || 'Vericlaim Investigation Agency',
      docketNumber: docket.docket_number,
      courierPartner: docket.courier_partner,
      awbNumber: docket.awb_number,
      dispatchedAt: docket.dispatched_at,
      clientName: clientName || 'Insurance Client',
      totalPackets: pktsList.length,
      totalDocs,
      packets: formattedPackets,
      dispatchedByName: dispatchedByName || 'Dispatch Coordinator',
    };
  }
}
