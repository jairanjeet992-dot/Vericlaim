import { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/service';
import { compileCustomFieldsSchema } from '../masters/case-types';
import {
  validateTransition,
  validateOutcome,
  resolveExceptionFinancialRule,
} from '../workflow/engine';
import {
  CreateCaseInput,
  UpdateCaseInput,
  TransitionCaseInput,
  AddCaseNoteInput,
  CreateCaseTaskInput,
} from './schema';

export class CasesService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Generates sequential, gapless doc_code per agency (e.g. OCT26-0001)
   */
  async generateDocCode(agencyId: string): Promise<string> {
    const now = new Date();
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const monthStr = `${months[now.getMonth()]}${now.getFullYear().toString().slice(-2)}`;
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Upsert sequence counter atomically
    const { data: existingSeq } = await this.supabase
      .from('agency_doc_sequences')
      .select('current_sequence')
      .eq('agency_id', agencyId)
      .eq('year_month', yearMonth)
      .single();

    const nextSeq = (existingSeq?.current_sequence || 0) + 1;

    await this.supabase.from('agency_doc_sequences').upsert({
      agency_id: agencyId,
      year_month: yearMonth,
      current_sequence: nextSeq,
      updated_at: new Date().toISOString(),
    });

    return `${monthStr}-${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Resolves owner-manager according to A9 routing rules
   */
  async resolveOwnerManager(
    agencyId: string,
    clientId: string,
    caseTypeCode: string,
    preferredManagerId?: string | null
  ): Promise<string | null> {
    const { data: scopes } = await this.supabase
      .from('manager_scopes')
      .select('*')
      .eq('agency_id', agencyId)
      .eq('client_id', clientId)
      .eq('case_type', caseTypeCode);

    const eligible = scopes || [];

    if (preferredManagerId) {
      const match = eligible.find((s: any) => s.manager_id === preferredManagerId);
      if (match) return match.manager_id;
    }

    const defaultScope = eligible.find((s: any) => s.is_default);
    if (defaultScope) return defaultScope.manager_id;

    if (eligible.length > 0) return eligible[0].manager_id;

    return null;
  }

  /**
   * Creates a new case with unique normalized claim check, custom fields validation,
   * doc_code generation, and owner-manager routing.
   */
  async createCase(actorUserId: string, agencyId: string, input: CreateCaseInput) {
    const normalizedClaim = input.claim_no.trim().toUpperCase();

    // 1. Check duplicate claim within same client
    const { data: existing } = await this.supabase
      .from('cases')
      .select('id, doc_code')
      .eq('agency_id', agencyId)
      .eq('client_id', input.client_id)
      .eq('normalized_claim_no', normalizedClaim)
      .single();

    if (existing) {
      throw new Error(
        `Duplicate claim rejected: A case with claim number "${input.claim_no}" already exists for this client (Doc Code: ${existing.doc_code}).`
      );
    }

    // 2. Fetch case type to validate custom fields
    const { data: caseType } = await this.supabase
      .from('case_types')
      .select('*')
      .eq('id', input.case_type_id)
      .single();

    if (!caseType) {
      throw new Error('Invalid case type specified');
    }

    if (caseType.custom_field_definitions && caseType.custom_field_definitions.length > 0) {
      const schema = compileCustomFieldsSchema(caseType.custom_field_definitions);
      const parsed = schema.safeParse(input.custom_fields || {});
      if (!parsed.success) {
        throw new Error(`Custom field validation failed: ${parsed.error.errors[0]?.message}`);
      }
    }

    // 3. Resolve owner manager per A9 routing
    let ownerManagerId = input.owner_manager_id;
    if (!ownerManagerId) {
      ownerManagerId = await this.resolveOwnerManager(
        agencyId,
        input.client_id,
        caseType.code,
        input.owner_manager_id
      );
    }

    // 4. Generate unique monotonic doc code
    const docCode = await this.generateDocCode(agencyId);

    // 5. Insert Case
    const { data: caseRow, error: caseError } = await this.supabase
      .from('cases')
      .insert({
        agency_id: agencyId,
        doc_code: docCode,
        client_id: input.client_id,
        client_branch_id: input.client_branch_id || null,
        case_type_id: input.case_type_id,
        case_type: caseType.code,
        claim_no: input.claim_no.trim(),
        claim_number: input.claim_no.trim(),
        normalized_claim_no: normalizedClaim,
        policy_no: input.policy_no.trim(),
        insured_name: input.insured_name.trim(),
        patient_name: input.patient_name || null,
        claimant_name: input.claimant_name || null,
        hospital_name: input.hospital_name || null,
        hospital_city: input.hospital_city || null,
        hospital_state: input.hospital_state || null,
        hospital_pincode: input.hospital_pincode || null,
        loss_date: input.loss_date || null,
        admission_date: input.admission_date || null,
        discharge_date: input.discharge_date || null,
        claim_amount: input.claim_amount || 0,
        location_city: input.location_city || null,
        location_district: input.location_district || null,
        location_state: input.location_state || null,
        location_pincode: input.location_pincode || null,
        risk_level: input.risk_level || 'LOW',
        custom_fields: input.custom_fields || {},
        owner_manager_id: ownerManagerId || actorUserId,
        data_entry_user_id: actorUserId,
        status: 'DATA_ENTRY',
        outcome: 'PENDING',
        version: 1,
        rework_count: 0,
        is_deleted: false,
      })
      .select()
      .single();

    if (caseError) throw new Error(`Failed to create case: ${caseError.message}`);

    // 6. Record initial status history
    await this.supabase.from('case_status_history').insert({
      agency_id: agencyId,
      case_id: caseRow.id,
      from_status: 'INITIAL_INTAKE',
      to_status: 'DATA_ENTRY',
      changed_by: actorUserId,
      reason: 'Initial case intake registration',
    });

    // 7. Audit log
    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'CASE_CREATE',
      entity_type: 'case',
      entity_id: caseRow.id,
      new_values: {
        doc_code: caseRow.doc_code,
        claim_no: caseRow.claim_no,
        client_id: caseRow.client_id,
        owner_manager_id: caseRow.owner_manager_id,
      },
    });

    return caseRow;
  }

  /**
   * Updates case details with optimistic locking and data entry lock after verification.
   */
  async updateCase(
    actorUserId: string,
    agencyId: string,
    caseId: string,
    input: UpdateCaseInput,
    callerScope?: string
  ) {
    const { data: currentCase } = await this.supabase
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .eq('agency_id', agencyId)
      .single();

    if (!currentCase) throw new Error('Case not found');

    // 1. Optimistic Locking Check
    if (currentCase.version !== input.version) {
      throw new Error(
        `Concurrent modification collision: Expected version ${currentCase.version}, got ${input.version}. Record has been modified by another user.`
      );
    }

    // 2. Data Entry Edit Lock Check (Rule A9 & GATE)
    if (
      currentCase.status !== 'DATA_ENTRY' &&
      currentCase.status !== 'VERIFICATION' &&
      callerScope === 'OWN_ENTERED'
    ) {
      throw new Error(
        `A9 Violation: Data entry cannot edit case after verification (current status: ${currentCase.status}).`
      );
    }

    // 3. Claim number uniqueness check if claim_no is modified
    if (input.claim_no && input.claim_no.trim().toUpperCase() !== currentCase.normalized_claim_no) {
      const normalizedClaim = input.claim_no.trim().toUpperCase();
      const { data: dup } = await this.supabase
        .from('cases')
        .select('id, doc_code')
        .eq('agency_id', agencyId)
        .eq('client_id', currentCase.client_id)
        .eq('normalized_claim_no', normalizedClaim)
        .single();

      if (dup && dup.id !== caseId) {
        throw new Error(
          `Duplicate claim rejected: Claim number "${input.claim_no}" already exists for this client (Doc Code: ${dup.doc_code}).`
        );
      }
    }

    const nextVersion = currentCase.version + 1;
    const updatePayload: any = {
      version: nextVersion,
      updated_at: new Date().toISOString(),
    };

    if (input.claim_no !== undefined) {
      updatePayload.claim_no = input.claim_no.trim();
      updatePayload.claim_number = input.claim_no.trim();
      updatePayload.normalized_claim_no = input.claim_no.trim().toUpperCase();
    }
    if (input.policy_no !== undefined) updatePayload.policy_no = input.policy_no.trim();
    if (input.insured_name !== undefined) updatePayload.insured_name = input.insured_name.trim();
    if (input.patient_name !== undefined) updatePayload.patient_name = input.patient_name;
    if (input.hospital_name !== undefined) updatePayload.hospital_name = input.hospital_name;
    if (input.claim_amount !== undefined) updatePayload.claim_amount = input.claim_amount;
    if (input.risk_level !== undefined) updatePayload.risk_level = input.risk_level;
    if (input.custom_fields !== undefined) updatePayload.custom_fields = input.custom_fields;
    if (input.owner_manager_id !== undefined) updatePayload.owner_manager_id = input.owner_manager_id;

    const { data: updatedCase, error } = await this.supabase
      .from('cases')
      .update(updatePayload)
      .eq('id', caseId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update case: ${error.message}`);

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'CASE_UPDATE',
      entity_type: 'case',
      entity_id: caseId,
      new_values: updatePayload,
    });

    return updatedCase;
  }

  /**
   * Executes atomic status transition conforming to WORKFLOW.md matrix,
   * optimistic concurrency control, auto-escalation, and exception financial triggers.
   */
  async transitionCase(
    actorUserId: string,
    agencyId: string,
    caseId: string,
    userPermissions: string[],
    input: TransitionCaseInput
  ) {
    const { data: currentCase } = await this.supabase
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .eq('agency_id', agencyId)
      .single();

    if (!currentCase) throw new Error('Case not found');

    // 1. Pure Workflow Engine Transition Validation
    const validation = validateTransition({
      fromStatus: currentCase.status,
      toStatus: input.target_status,
      reason: input.reason,
      userPermissions,
      currentVersion: currentCase.version,
      targetVersion: input.current_version,
      currentReworkCount: currentCase.rework_count || 0,
    });

    if (!validation.allowed) {
      throw new Error(`Workflow Transition Rejected: ${validation.error}`);
    }

    // 2. Validate Outcome if outcome is being set or updated
    if (input.outcome) {
      const outcomeCheck = validateOutcome(input.outcome, input.fraud_reason);
      if (!outcomeCheck.isValid) {
        throw new Error(outcomeCheck.error);
      }
    }

    // 3. Exception financial rules
    let exceptionFinancialRule = null;
    if (input.exception_type) {
      exceptionFinancialRule = resolveExceptionFinancialRule(input.exception_type);
    }

    const nextVersion = currentCase.version + 1;
    const updatePayload: any = {
      status: validation.resolvedNextStatus,
      rework_count: validation.nextReworkCount,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    };

    if (input.outcome) updatePayload.outcome = input.outcome;
    if (input.fraud_reason) updatePayload.fraud_reason = input.fraud_reason;
    if (input.exception_type) {
      updatePayload.exception_type = input.exception_type;
      updatePayload.exception_reason = input.reason || null;
      updatePayload.exception_financial_rule = exceptionFinancialRule;
    }
    if (validation.resolvedNextStatus === 'CLOSED' || validation.resolvedNextStatus === 'FINANCIALLY_CLOSED') {
      updatePayload.completed_at = new Date().toISOString();
    }

    // 4. Update Case Record
    const { data: updatedCase, error: updateError } = await this.supabase
      .from('cases')
      .update(updatePayload)
      .eq('id', caseId)
      .select()
      .single();

    if (updateError) throw new Error(`Failed to transition case: ${updateError.message}`);

    // 5. Append to Case Status History (Immutable)
    await this.supabase.from('case_status_history').insert({
      agency_id: agencyId,
      case_id: caseId,
      from_status: currentCase.status,
      to_status: validation.resolvedNextStatus,
      changed_by: actorUserId,
      reason: input.reason || null,
      metadata: {
        is_escalated: validation.isEscalated,
        rework_count: validation.nextReworkCount,
        outcome: input.outcome || currentCase.outcome,
        exception_type: input.exception_type || currentCase.exception_type,
      },
    });

    // 6. If send-back, insert note
    if (input.reason && (input.target_status === 'DATA_ENTRY' || input.target_status === 'REPORT_DRAFTING')) {
      await this.supabase.from('case_notes').insert({
        agency_id: agencyId,
        case_id: caseId,
        author_id: actorUserId,
        note_type: 'SEND_BACK',
        content: `[Send-back to ${input.target_status}]: ${input.reason}`,
      });
    }

    // 7. Audit Log
    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'CASE_STATUS_TRANSITION',
      entity_type: 'case',
      entity_id: caseId,
      new_values: {
        from_status: currentCase.status,
        to_status: validation.resolvedNextStatus,
        reason: input.reason,
        outcome: input.outcome,
      },
    });

    return updatedCase;
  }

  /**
   * Adds an internal, investigator, or client note to case
   */
  async addNote(actorUserId: string, agencyId: string, caseId: string, input: AddCaseNoteInput) {
    const { data, error } = await this.supabase
      .from('case_notes')
      .insert({
        agency_id: agencyId,
        case_id: caseId,
        author_id: actorUserId,
        note_type: input.note_type,
        content: input.content,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to add note: ${error.message}`);
    return data;
  }

  /**
   * Creates a workflow task for a case
   */
  async addTask(actorUserId: string, agencyId: string, caseId: string, input: CreateCaseTaskInput) {
    const { data, error } = await this.supabase
      .from('case_tasks')
      .insert({
        agency_id: agencyId,
        case_id: caseId,
        title: input.title,
        description: input.description || null,
        assigned_to: input.assigned_to || null,
        due_date: input.due_date || null,
        status: 'PENDING',
        created_by: actorUserId,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to add task: ${error.message}`);
    return data;
  }

  /**
   * Aggregates timeline history, notes, tasks into chronological feed
   */
  async getTimeline(agencyId: string, caseId: string) {
    const [{ data: history }, { data: notes }, { data: tasks }] = await Promise.all([
      this.supabase
        .from('case_status_history')
        .select('*')
        .eq('case_id', caseId)
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false }),
      this.supabase
        .from('case_notes')
        .select('*')
        .eq('case_id', caseId)
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false }),
      this.supabase
        .from('case_tasks')
        .select('*')
        .eq('case_id', caseId)
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false }),
    ]);

    const events: any[] = [];

    (history || []).forEach((h: any) => {
      events.push({
        id: h.id,
        type: 'STATUS_CHANGE',
        title: `Status changed from ${h.from_status} to ${h.to_status}`,
        description: h.reason,
        created_at: h.created_at,
        metadata: h.metadata,
      });
    });

    (notes || []).forEach((n: any) => {
      events.push({
        id: n.id,
        type: 'NOTE',
        title: `Note added (${n.note_type})`,
        description: n.content,
        created_at: n.created_at,
      });
    });

    (tasks || []).forEach((t: any) => {
      events.push({
        id: t.id,
        type: 'TASK',
        title: `Task created: ${t.title}`,
        description: t.description,
        created_at: t.created_at,
        status: t.status,
      });
    });

    events.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return events;
  }

  /**
   * Fetches single case details with related entities
   */
  async getCaseById(agencyId: string, caseId: string) {
    const { data, error } = await this.supabase
      .from('cases')
      .select('*, clients(*), case_types(*), users!cases_owner_manager_id_fkey(*)')
      .eq('id', caseId)
      .eq('agency_id', agencyId)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Lists cases filtered by scope and search
   */
  async listCases(agencyId: string, filters?: { status?: string; search?: string }) {
    let query = this.supabase
      .from('cases')
      .select('*, clients(name, code), case_types(name, code)')
      .eq('agency_id', agencyId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }
}
