// ============================================================================
// VERICLAIM MULTI-TENANT SAAS
// MODULE: evidence/service.ts
// PHASE 5: Investigation Activities, Evidence Pipeline (R2), Versioning, PWA
// ============================================================================

import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { recordAuditLog } from '@/modules/audit/service';
import { R2StorageService } from './storage';
import {
  InitUploadSchema,
  CompleteUploadSchema,
  CreateActivitySchema,
  UpdateActivitySchema,
  CompleteActivitySchema,
  SoftDeleteDocumentSchema,
} from './schema';
import {
  InitUploadRequest,
  InitUploadResponse,
  CompleteUploadRequest,
  CompleteUploadResponse,
  DownloadUrlResponse,
  DocumentRecord,
  InvestigationActivity,
  EvidenceCategory,
  ActivityStatus,
} from './types';

export interface UserScopeContext {
  agencyId: string;
  userId: string;
  scope: 'ALL' | 'TEAM' | 'ASSIGNED' | 'OWN_ENTERED';
  subordinateUserIds?: string[];
  reportsToId?: string | null;
}

export class EvidenceService {
  private storage: R2StorageService;

  constructor(
    private supabase: SupabaseClient,
    storageService?: R2StorageService
  ) {
    this.storage = storageService || new R2StorageService();
  }

  /**
   * Helper to verify if the caller has scope permission to view/interact with a case
   */
  async canUserAccessCase(
    context: UserScopeContext,
    caseId: string
  ): Promise<boolean> {
    const { agencyId, userId, scope, subordinateUserIds = [], reportsToId } = context;

    // 1. Fetch case details
    const { data: caseRow, error } = await this.supabase
      .from('cases')
      .select('id, agency_id, owner_manager_id, data_entry_user_id')
      .eq('id', caseId)
      .single();

    if (error || !caseRow) {
      return false;
    }

    // Invariant: Cross-agency access is NEVER allowed
    if (caseRow.agency_id !== agencyId) {
      return false;
    }

    // Check scope
    if (scope === 'ALL') {
      return true;
    }

    if (scope === 'OWN_ENTERED') {
      return caseRow.data_entry_user_id === userId;
    }

    if (scope === 'ASSIGNED') {
      // Check active assignment in case_investigators
      const { data: assignments } = await this.supabase
        .from('case_investigators')
        .select('id')
        .eq('agency_id', agencyId)
        .eq('case_id', caseId)
        .eq('is_active', true)
        .or(`investigator_id.eq.${userId},assigned_by.eq.${userId}`);

      return Boolean(assignments && assignments.length > 0);
    }

    if (scope === 'TEAM') {
      const allowedManagers = [userId, ...subordinateUserIds];
      if (reportsToId && !allowedManagers.includes(reportsToId)) {
        allowedManagers.push(reportsToId);
      }
      return allowedManagers.includes(caseRow.owner_manager_id);
    }

    return false;
  }

  // ==========================================================================
  // FILE / EVIDENCE PIPELINE (PER A8)
  // ==========================================================================

  /**
   * Initialize file upload: validates scope, allowlists mime/size, generates storage key,
   * inserts pending document row, and returns 10-minute presigned PUT URL.
   */
  async initUpload(
    context: UserScopeContext,
    input: InitUploadRequest
  ): Promise<InitUploadResponse> {
    const validated = InitUploadSchema.parse(input);

    const hasAccess = await this.canUserAccessCase(context, validated.case_id);
    if (!hasAccess) {
      throw new Error(`403 Forbidden: Caller has no scope access to case ${validated.case_id}`);
    }

    // Check versioning if parent_document_id is provided
    let version = 1;
    if (validated.parent_document_id) {
      const { data: parentDoc } = await this.supabase
        .from('documents')
        .select('version, agency_id, case_id')
        .eq('id', validated.parent_document_id)
        .single();

      if (parentDoc && parentDoc.agency_id === context.agencyId && parentDoc.case_id === validated.case_id) {
        version = (parentDoc.version || 1) + 1;
      }
    }

    const documentId = crypto.randomUUID();
    // Storage Key Format per A8: a/{agency_id}/c/{case_id}/{uuid}
    const storageKey = `a/${context.agencyId}/c/${validated.case_id}/${documentId}`;

    // Insert pending document row
    const { error: insertErr } = await this.supabase
      .from('documents')
      .insert({
        id: documentId,
        agency_id: context.agencyId,
        case_id: validated.case_id,
        activity_id: validated.activity_id || null,
        uploaded_by: context.userId,
        storage_key: storageKey,
        file_name: validated.file_name,
        file_size: validated.file_size,
        mime_type: validated.mime_type,
        sha256_hash: validated.sha256_hash.toLowerCase(),
        status: 'PENDING',
        evidence_category: validated.evidence_category || 'OTHER',
        claimed_latitude: validated.claimed_metadata?.latitude || null,
        claimed_longitude: validated.claimed_metadata?.longitude || null,
        claimed_accuracy: validated.claimed_metadata?.accuracy || null,
        claimed_captured_at: validated.claimed_metadata?.captured_at || null,
        is_sensitive: validated.is_sensitive || false,
        parent_document_id: validated.parent_document_id || null,
        version: version,
      });

    if (insertErr) {
      throw new Error(`Failed to create pending document: ${insertErr.message}`);
    }

    // Generate 10-minute presigned PUT URL
    const { uploadUrl, expiresInSeconds, headers } = await this.storage.getPresignedUploadUrl(
      storageKey,
      validated.mime_type,
      validated.sha256_hash
    );

    return {
      document_id: documentId,
      storage_key: storageKey,
      upload_url: uploadUrl,
      headers,
      expires_in_seconds: expiresInSeconds,
    };
  }

  /**
   * Complete upload: verifies object checksum against uploaded file,
   * updates status to VERIFIED, and appends audit log.
   */
  async completeUpload(
    context: UserScopeContext,
    input: CompleteUploadRequest
  ): Promise<CompleteUploadResponse> {
    const validated = CompleteUploadSchema.parse(input);

    // 1. Fetch document row
    const { data: doc, error: fetchErr } = await this.supabase
      .from('documents')
      .select('*')
      .eq('id', validated.document_id)
      .single();

    if (fetchErr || !doc) {
      throw new Error(`404 Not Found: Document ${validated.document_id} not found`);
    }

    // Invariant: Cross-agency access denied
    if (doc.agency_id !== context.agencyId) {
      throw new Error(`403 Forbidden: Cross-agency access denied`);
    }

    // Verify case scope
    const hasAccess = await this.canUserAccessCase(context, doc.case_id);
    if (!hasAccess) {
      throw new Error(`403 Forbidden: Caller has no scope access to this case`);
    }

    // 2. Validate Checksum: Provided/actual SHA-256 MUST match expected
    const actualHash = validated.actual_sha256.toLowerCase();
    const expectedHash = doc.sha256_hash.toLowerCase();

    if (actualHash !== expectedHash) {
      // Mark as REJECTED in database
      await this.supabase
        .from('documents')
        .update({ status: 'REJECTED' })
        .eq('id', doc.id);

      throw new Error(
        `Checksum mismatch: Expected SHA-256 ${expectedHash}, received ${actualHash}. Upload rejected.`
      );
    }

    // 3. Verify object in R2
    await this.storage.verifyUploadedObject(doc.storage_key, expectedHash);

    // 4. Update document status to VERIFIED
    const verifiedAt = new Date().toISOString();
    const { error: updateErr } = await this.supabase
      .from('documents')
      .update({
        status: 'VERIFIED',
        verified_at: verifiedAt,
      })
      .eq('id', doc.id);

    if (updateErr) {
      throw new Error(`Failed to mark document verified: ${updateErr.message}`);
    }

    // 5. Append Audit Log
    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'evidence.upload_completed',
      entity_type: 'documents',
      entity_id: doc.id,
      new_values: {
        case_id: doc.case_id,
        file_name: doc.file_name,
        sha256_hash: expectedHash,
        file_size: doc.file_size,
        mime_type: doc.mime_type,
        category: doc.evidence_category,
        claimed_gps: doc.claimed_latitude
          ? `${doc.claimed_latitude}, ${doc.claimed_longitude}`
          : null,
      },
    });

    return {
      document_id: doc.id,
      status: 'VERIFIED',
      verified_at: verifiedAt,
      sha256_hash: expectedHash,
      file_name: doc.file_name,
    };
  }

  /**
   * Get 5-minute presigned GET download URL with scope verification & audit
   */
  async getDownloadUrl(
    context: UserScopeContext,
    documentId: string
  ): Promise<DownloadUrlResponse> {
    const { data: doc, error } = await this.supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .is('deleted_at', null)
      .single();

    if (error || !doc) {
      throw new Error(`404 Not Found: Document ${documentId} not found`);
    }

    // Cross-agency isolation check
    if (doc.agency_id !== context.agencyId) {
      throw new Error(`403 Forbidden: Cross-agency access denied`);
    }

    // Case scope check
    const hasAccess = await this.canUserAccessCase(context, doc.case_id);
    if (!hasAccess) {
      throw new Error(`403 Forbidden: Caller has no scope access to this case`);
    }

    // Generate 5-minute presigned GET URL (per A8)
    const { downloadUrl, expiresInSeconds } = await this.storage.getPresignedDownloadUrl(
      doc.storage_key,
      doc.file_name
    );

    // Audit sensitive or standard download
    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: doc.is_sensitive ? 'evidence.download_sensitive' : 'evidence.download',
      entity_type: 'documents',
      entity_id: doc.id,
      new_values: {
        file_name: doc.file_name,
        storage_key: doc.storage_key,
      },
    });

    return {
      document_id: doc.id,
      download_url: downloadUrl,
      expires_in_seconds: expiresInSeconds,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
    };
  }

  /**
   * Soft-delete document (A6: Never hard delete, soft delete with reason & audit)
   */
  async deleteDocument(
    context: UserScopeContext,
    documentId: string,
    reason: string
  ): Promise<{ success: boolean; document_id: string }> {
    const validated = SoftDeleteDocumentSchema.parse({ delete_reason: reason });

    const { data: doc, error } = await this.supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .is('deleted_at', null)
      .single();

    if (error || !doc) {
      throw new Error(`404 Not Found: Document ${documentId} not found`);
    }

    if (doc.agency_id !== context.agencyId) {
      throw new Error(`403 Forbidden: Cross-agency access denied`);
    }

    const hasAccess = await this.canUserAccessCase(context, doc.case_id);
    if (!hasAccess) {
      throw new Error(`403 Forbidden: Caller has no scope access to this case`);
    }

    const now = new Date().toISOString();
    const { error: delErr } = await this.supabase
      .from('documents')
      .update({
        deleted_at: now,
        deleted_by: context.userId,
        delete_reason: validated.delete_reason,
      })
      .eq('id', doc.id);

    if (delErr) {
      throw new Error(`Failed to soft-delete document: ${delErr.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'evidence.soft_deleted',
      entity_type: 'documents',
      entity_id: doc.id,
      new_values: {
        delete_reason: validated.delete_reason,
        deleted_at: now,
      },
    });

    return { success: true, document_id: doc.id };
  }

  /**
   * List documents for a case with scope protection and optional filters
   */
  async listDocumentsForCase(
    context: UserScopeContext,
    caseId: string,
    filters?: {
      category?: EvidenceCategory;
      activity_id?: string;
      status?: 'PENDING' | 'VERIFIED' | 'REJECTED';
    }
  ): Promise<DocumentRecord[]> {
    const hasAccess = await this.canUserAccessCase(context, caseId);
    if (!hasAccess) {
      throw new Error(`403 Forbidden: Caller has no scope access to case ${caseId}`);
    }

    let query = this.supabase
      .from('documents')
      .select('*')
      .eq('agency_id', context.agencyId)
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (filters?.category) {
      query = query.eq('evidence_category', filters.category);
    }
    if (filters?.activity_id) {
      query = query.eq('activity_id', filters.activity_id);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list documents: ${error.message}`);
    }

    return (data || []) as DocumentRecord[];
  }

  // ==========================================================================
  // INVESTIGATION ACTIVITIES LIFECYCLE
  // ==========================================================================

  /**
   * Create an investigation activity task (e.g. Field visit, hospital verification)
   */
  async createActivity(
    context: UserScopeContext,
    input: {
      case_id: string;
      activity_type: string;
      custom_type_name?: string | null;
      task_title: string;
      instructions?: string | null;
      assigned_to_id?: string | null;
      due_date?: string | null;
      notes?: string | null;
    }
  ): Promise<InvestigationActivity> {
    const validated = CreateActivitySchema.parse(input);

    const hasAccess = await this.canUserAccessCase(context, validated.case_id);
    if (!hasAccess) {
      throw new Error(`403 Forbidden: Caller has no scope access to case ${validated.case_id}`);
    }

    const activityId = crypto.randomUUID();
    const { data, error } = await this.supabase
      .from('investigation_activities')
      .insert({
        id: activityId,
        agency_id: context.agencyId,
        case_id: validated.case_id,
        activity_type: validated.activity_type,
        custom_type_name: validated.custom_type_name || null,
        task_title: validated.task_title,
        instructions: validated.instructions || null,
        assigned_to_id: validated.assigned_to_id || null,
        due_date: validated.due_date || null,
        status: 'PENDING',
        notes: validated.notes || null,
        created_by: context.userId,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create activity: ${error?.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'activity.created',
      entity_type: 'investigation_activities',
      entity_id: activityId,
      new_values: {
        task_title: validated.task_title,
        activity_type: validated.activity_type,
        case_id: validated.case_id,
      },
    });

    return data as InvestigationActivity;
  }

  /**
   * Update an investigation activity (instructions, status, notes)
   */
  async updateActivity(
    context: UserScopeContext,
    activityId: string,
    input: {
      task_title?: string;
      instructions?: string | null;
      assigned_to_id?: string | null;
      due_date?: string | null;
      status?: ActivityStatus;
      notes?: string | null;
      completion_notes?: string | null;
    }
  ): Promise<InvestigationActivity> {
    const validated = UpdateActivitySchema.parse(input);

    const { data: existing, error: fetchErr } = await this.supabase
      .from('investigation_activities')
      .select('*')
      .eq('id', activityId)
      .eq('agency_id', context.agencyId)
      .single();

    if (fetchErr || !existing) {
      throw new Error(`404 Not Found: Activity ${activityId} not found`);
    }

    const hasAccess = await this.canUserAccessCase(context, existing.case_id);
    if (!hasAccess) {
      throw new Error(`403 Forbidden: Caller has no scope access to this case`);
    }

    const updates: Record<string, any> = {
      ...validated,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from('investigation_activities')
      .update(updates)
      .eq('id', activityId)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to update activity: ${error?.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'activity.updated',
      entity_type: 'investigation_activities',
      entity_id: activityId,
      new_values: updates,
    });

    return data as InvestigationActivity;
  }

  /**
   * Complete an investigation activity with mandatory completion notes and timestamp
   */
  async completeActivity(
    context: UserScopeContext,
    activityId: string,
    completionNotes: string,
    completedAt?: string
  ): Promise<InvestigationActivity> {
    const validated = CompleteActivitySchema.parse({
      completion_notes: completionNotes,
      completed_at: completedAt,
    });

    const { data: existing, error: fetchErr } = await this.supabase
      .from('investigation_activities')
      .select('*')
      .eq('id', activityId)
      .eq('agency_id', context.agencyId)
      .single();

    if (fetchErr || !existing) {
      throw new Error(`404 Not Found: Activity ${activityId} not found`);
    }

    const hasAccess = await this.canUserAccessCase(context, existing.case_id);
    if (!hasAccess) {
      throw new Error(`403 Forbidden: Caller has no scope access to this case`);
    }

    const completedTimestamp = validated.completed_at || new Date().toISOString();

    const { data, error } = await this.supabase
      .from('investigation_activities')
      .update({
        status: 'COMPLETED',
        completion_notes: validated.completion_notes,
        completed_at: completedTimestamp,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activityId)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to complete activity: ${error?.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'activity.completed',
      entity_type: 'investigation_activities',
      entity_id: activityId,
      new_values: {
        completion_notes: validated.completion_notes,
        completed_at: completedTimestamp,
      },
    });

    return data as InvestigationActivity;
  }

  /**
   * List all activities for a case
   */
  async listActivitiesForCase(
    context: UserScopeContext,
    caseId: string
  ): Promise<InvestigationActivity[]> {
    const hasAccess = await this.canUserAccessCase(context, caseId);
    if (!hasAccess) {
      throw new Error(`403 Forbidden: Caller has no scope access to case ${caseId}`);
    }

    const { data, error } = await this.supabase
      .from('investigation_activities')
      .select('*')
      .eq('agency_id', context.agencyId)
      .eq('case_id', caseId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to list activities: ${error.message}`);
    }

    return (data || []) as InvestigationActivity[];
  }

  /**
   * List activities assigned to an investigator across active cases
   */
  async listActivitiesForInvestigator(
    agencyId: string,
    investigatorUserId: string,
    statusFilter?: ActivityStatus
  ): Promise<(InvestigationActivity & { case_claim_no?: string; case_insured_name?: string })[]> {
    let query = this.supabase
      .from('investigation_activities')
      .select('*, cases(claim_no, insured_name)')
      .eq('agency_id', agencyId)
      .eq('assigned_to_id', investigatorUserId)
      .order('due_date', { ascending: true, nullsFirst: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch investigator activities: ${error.message}`);
    }

    return (data || []).map((item: any) => ({
      ...item,
      case_claim_no: item.cases?.claim_no,
      case_insured_name: item.cases?.insured_name,
    }));
  }

  // ==========================================================================
  // CLEANUP CRON: STALE PENDING UPLOADS
  // ==========================================================================

  /**
   * Clean up pending documents that were initialized but never completed (> 2 hours)
   */
  async cleanupStalePendingUploads(thresholdHours = 2): Promise<{
    pruned_count: number;
    pruned_documents: { id: string; storage_key: string }[];
  }> {
    const thresholdDate = new Date(Date.now() - thresholdHours * 60 * 60 * 1000).toISOString();

    const { data: staleDocs, error: fetchErr } = await this.supabase
      .from('documents')
      .select('id, storage_key, agency_id')
      .eq('status', 'PENDING')
      .lt('created_at', thresholdDate);

    if (fetchErr) {
      throw new Error(`Failed to fetch stale uploads: ${fetchErr.message}`);
    }

    const staleList = staleDocs || [];
    const pruned: { id: string; storage_key: string }[] = [];

    for (const doc of staleList) {
      // 1. Delete object from R2 storage if exists
      try {
        await this.storage.deleteObject(doc.storage_key);
      } catch (err) {
        console.warn(`[CLEANUP CRON] Failed to delete R2 object for ${doc.storage_key}:`, err);
      }

      // 2. Delete pending document record from database
      const { error: delErr } = await this.supabase
        .from('documents')
        .delete()
        .eq('id', doc.id);

      if (!delErr) {
        pruned.push({ id: doc.id, storage_key: doc.storage_key });
      }
    }

    return {
      pruned_count: pruned.length,
      pruned_documents: pruned,
    };
  }
}
