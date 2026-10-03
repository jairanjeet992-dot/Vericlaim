import { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '@/modules/audit/service';
import {
  AssignInvestigatorSchema,
  AssignInvestigatorInput,
  RejectAssignmentSchema,
  RejectAssignmentInput,
  ReassignInvestigatorSchema,
  ReassignInvestigatorInput,
  UpdateHardcopyStatusSchema,
  UpdateHardcopyStatusInput,
} from './schema';
import { rankInvestigatorsForCase, InvestigatorCandidate, CaseEligibilityContext } from './eligibility';
import { resolveEffectivePaymentTerm, calculateInvestigatorFeeForCase } from '../masters/investigators';

export class AssignmentService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Retrieves ranked list of eligible investigators for a case based on
   * geographic coverage, capacity, specialization, and cluster bonus.
   */
  async getEligibleInvestigators(agencyId: string, caseId: string) {
    // 1. Fetch case details
    const { data: caseRow, error: caseErr } = await this.supabase
      .from('cases')
      .select('id, claim_no, case_type_id, location_city, location_state, location_pincode, hospital_city, hospital_pincode, risk_level, due_date')
      .eq('id', caseId)
      .eq('agency_id', agencyId)
      .single();

    if (caseErr || !caseRow) {
      throw new Error(`Case not found: ${caseId}`);
    }

    // Fetch case type code
    let caseTypeCode = 'STANDARD';
    if (caseRow.case_type_id) {
      const { data: ct } = await this.supabase
        .from('case_types')
        .select('code')
        .eq('id', caseRow.case_type_id)
        .single();
      if (ct) caseTypeCode = ct.code;
    }

    // 2. Fetch all active investigators for the agency
    const { data: investigators, error: invErr } = await this.supabase
      .from('investigators')
      .select('*')
      .eq('agency_id', agencyId)
      .eq('is_active', true);

    if (invErr) {
      throw new Error(`Failed to fetch investigators: ${invErr.message}`);
    }

    // 3. Fetch active assignment counts for all investigators
    const { data: activeAssignments } = await this.supabase
      .from('case_investigators')
      .select('investigator_id, case_id')
      .eq('agency_id', agencyId)
      .eq('is_active', true);

    const activeCountMap = new Map<string, number>();
    (activeAssignments || []).forEach((a) => {
      activeCountMap.set(a.investigator_id, (activeCountMap.get(a.investigator_id) || 0) + 1);
    });

    // 4. Map candidates
    const candidates: InvestigatorCandidate[] = (investigators || []).map((inv) => ({
      id: inv.id,
      code: inv.code,
      full_name: inv.full_name,
      phone: inv.phone,
      email: inv.email,
      state: inv.state,
      district: inv.district,
      city: inv.city,
      pincodes: inv.pincodes || [],
      radius_km: inv.radius_km || 50,
      is_available: inv.is_available ?? true,
      is_active: inv.is_active ?? true,
      max_active_cases: inv.max_active_cases || 15,
      current_active_cases: activeCountMap.get(inv.id) || 0,
      specializations: inv.specializations || [],
      case_types: inv.case_types || [],
    }));

    const caseCtx: CaseEligibilityContext = {
      id: caseRow.id,
      claim_no: caseRow.claim_no,
      case_type_code: caseTypeCode,
      location_state: caseRow.location_state,
      location_city: caseRow.location_city,
      location_pincode: caseRow.location_pincode,
      hospital_city: caseRow.hospital_city,
      hospital_pincode: caseRow.hospital_pincode,
      risk_level: caseRow.risk_level,
      due_date: caseRow.due_date,
    };

    return rankInvestigatorsForCase(candidates, caseCtx);
  }

  /**
   * Assigns an investigator to a case. Computes effective fee/TA based on
   * effective payment terms (Per Case vs Salary) and updates case status to ACCEPTANCE_PENDING.
   */
  async assignInvestigator(
    actorUserId: string,
    agencyId: string,
    caseId: string,
    input: AssignInvestigatorInput,
    userPermissions: string[] = []
  ) {
    if (!userPermissions.includes('cases.assign') && !userPermissions.includes('*')) {
      throw new Error("Unauthorized: Missing required permission 'cases.assign'");
    }

    const validated = AssignInvestigatorSchema.parse(input);

    // 1. Fetch case
    const { data: caseRow, error: caseErr } = await this.supabase
      .from('cases')
      .select('id, status, loss_date, created_at, exception_type, version')
      .eq('id', caseId)
      .eq('agency_id', agencyId)
      .single();

    if (caseErr || !caseRow) {
      throw new Error(`Case not found: ${caseId}`);
    }

    // 2. Fetch investigator and effective payment terms
    const { data: inv, error: invErr } = await this.supabase
      .from('investigators')
      .select('id, full_name, code')
      .eq('id', validated.investigator_id)
      .eq('agency_id', agencyId)
      .single();

    if (invErr || !inv) {
      throw new Error(`Investigator not found: ${validated.investigator_id}`);
    }

    const { data: terms } = await this.supabase
      .from('investigator_payment_terms')
      .select('*')
      .eq('investigator_id', validated.investigator_id)
      .eq('agency_id', agencyId);

    const caseDate = caseRow.loss_date || new Date(caseRow.created_at).toISOString().split('T')[0];
    const effectiveTerm = resolveEffectivePaymentTerm(terms || [], caseDate);

    // 3. Compute Fee & TA (Gold Standard TEST-01 to TEST-05)
    let agreedFee = validated.agreed_fee;
    let travelAllowance = validated.travel_allowance || 0;

    if (agreedFee === undefined) {
      const baseFee = effectiveTerm?.base_fee_or_salary || 500;
      const feeResult = calculateInvestigatorFeeForCase({
        term: effectiveTerm,
        enteredFee: baseFee,
        enteredTa: travelAllowance,
        exceptionType: caseRow.exception_type,
      });
      agreedFee = feeResult.effective_fee;
      travelAllowance = feeResult.effective_ta;
    } else {
      const feeResult = calculateInvestigatorFeeForCase({
        term: effectiveTerm,
        enteredFee: agreedFee,
        enteredTa: travelAllowance,
        exceptionType: caseRow.exception_type,
      });
      agreedFee = feeResult.effective_fee;
      travelAllowance = feeResult.effective_ta;
    }

    // 4. Insert case_investigators record
    const { data: assignment, error: assignErr } = await this.supabase
      .from('case_investigators')
      .insert({
        agency_id: agencyId,
        case_id: caseId,
        investigator_id: validated.investigator_id,
        assigned_by: actorUserId,
        assignment_scope: validated.assignment_scope,
        status: 'PENDING_ACCEPTANCE',
        agreed_fee: agreedFee,
        travel_allowance: travelAllowance,
        payout_status: 'PENDING',
        hardcopy_status: 'PENDING',
        override_reason: validated.override_reason || null,
        is_active: true,
        assigned_at: new Date().toISOString(),
        version: 1,
      })
      .select()
      .single();

    if (assignErr) {
      throw new Error(`Failed to assign investigator: ${assignErr.message}`);
    }

    // 5. If case is in ASSIGNMENT status, advance to ACCEPTANCE_PENDING
    if (caseRow.status === 'ASSIGNMENT') {
      await this.supabase
        .from('cases')
        .update({
          status: 'ACCEPTANCE_PENDING',
          version: caseRow.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', caseId)
        .eq('agency_id', agencyId);
    }

    // 6. Audit Log
    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      entity_type: 'case_investigators',
      entity_id: assignment.id,
      action: 'ASSIGN',
      new_values: {
        case_id: caseId,
        investigator_id: validated.investigator_id,
        investigator_name: inv.full_name,
        agreed_fee: agreedFee,
        travel_allowance: travelAllowance,
        scope: validated.assignment_scope,
      },
    });

    return assignment;
  }

  /**
   * Investigator accepts assignment. Advances case status to FIELD_INVESTIGATION.
   */
  async acceptAssignment(
    actorUserId: string,
    agencyId: string,
    caseInvestigatorId: string,
    userPermissions: string[] = []
  ) {
    const { data: assignment, error: aErr } = await this.supabase
      .from('case_investigators')
      .select('*, cases(id, status, version)')
      .eq('id', caseInvestigatorId)
      .eq('agency_id', agencyId)
      .single();

    if (aErr || !assignment) {
      throw new Error(`Assignment not found: ${caseInvestigatorId}`);
    }

    if (assignment.status !== 'PENDING_ACCEPTANCE') {
      throw new Error(`Assignment cannot be accepted: current status is ${assignment.status}`);
    }

    // Check authorization: caller is assigned investigator or has cases.accept
    const { data: inv } = await this.supabase
      .from('investigators')
      .select('user_id')
      .eq('id', assignment.investigator_id)
      .single();

    const isAssignedUser = inv?.user_id === actorUserId || assignment.investigator_id === actorUserId;
    const hasPermission = userPermissions.includes('cases.accept') || userPermissions.includes('*');

    if (!isAssignedUser && !hasPermission) {
      throw new Error('Unauthorized: You are not authorized to accept this assignment.');
    }

    const now = new Date().toISOString();

    // 1. Mark assignment accepted
    const { data: updated, error: uErr } = await this.supabase
      .from('case_investigators')
      .update({
        status: 'ACCEPTED',
        accepted_at: now,
        version: assignment.version + 1,
        updated_at: now,
      })
      .eq('id', caseInvestigatorId)
      .select()
      .single();

    if (uErr) {
      throw new Error(`Failed to accept assignment: ${uErr.message}`);
    }

    // 2. Advance case to FIELD_INVESTIGATION if in ACCEPTANCE_PENDING
    const caseObj = assignment.cases;
    if (caseObj && caseObj.status === 'ACCEPTANCE_PENDING') {
      await this.supabase
        .from('cases')
        .update({
          status: 'FIELD_INVESTIGATION',
          version: caseObj.version + 1,
          updated_at: now,
        })
        .eq('id', assignment.case_id)
        .eq('agency_id', agencyId);
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      entity_type: 'case_investigators',
      entity_id: caseInvestigatorId,
      action: 'ACCEPT',
      old_values: { status: assignment.status },
      new_values: { status: 'ACCEPTED', accepted_at: now },
    });

    return updated;
  }

  /**
   * Investigator declines/rejects assignment with mandatory reason.
   * Clears active slot and returns case to ASSIGNMENT pool.
   */
  async rejectAssignment(
    actorUserId: string,
    agencyId: string,
    input: RejectAssignmentInput,
    userPermissions: string[] = []
  ) {
    const validated = RejectAssignmentSchema.parse(input);

    const { data: assignment, error: aErr } = await this.supabase
      .from('case_investigators')
      .select('*, cases(id, status, version)')
      .eq('id', validated.case_investigator_id)
      .eq('agency_id', agencyId)
      .single();

    if (aErr || !assignment) {
      throw new Error(`Assignment not found: ${validated.case_investigator_id}`);
    }

    const { data: inv } = await this.supabase
      .from('investigators')
      .select('user_id')
      .eq('id', assignment.investigator_id)
      .single();

    const isAssignedUser = inv?.user_id === actorUserId || assignment.investigator_id === actorUserId;
    const hasPermission = userPermissions.includes('cases.accept') || userPermissions.includes('*');

    if (!isAssignedUser && !hasPermission) {
      throw new Error('Unauthorized: You are not authorized to decline this assignment.');
    }

    const now = new Date().toISOString();

    // 1. Mark assignment rejected and inactive (preserving historical record)
    const { data: updated, error: uErr } = await this.supabase
      .from('case_investigators')
      .update({
        status: 'REJECTED',
        rejection_reason: validated.reason,
        rejected_at: now,
        is_active: false,
        version: assignment.version + 1,
        updated_at: now,
      })
      .eq('id', validated.case_investigator_id)
      .select()
      .single();

    if (uErr) {
      throw new Error(`Failed to reject assignment: ${uErr.message}`);
    }

    // 2. Check if any other active assignments remain on this case
    const { data: remainingActive } = await this.supabase
      .from('case_investigators')
      .select('id')
      .eq('case_id', assignment.case_id)
      .eq('agency_id', agencyId)
      .eq('is_active', true);

    // If no active investigators remain, return case to ASSIGNMENT
    if (!remainingActive || remainingActive.length === 0) {
      const caseObj = assignment.cases;
      if (caseObj && caseObj.status === 'ACCEPTANCE_PENDING') {
        await this.supabase
          .from('cases')
          .update({
            status: 'ASSIGNMENT',
            version: caseObj.version + 1,
            updated_at: now,
          })
          .eq('id', assignment.case_id)
          .eq('agency_id', agencyId);
      }
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      entity_type: 'case_investigators',
      entity_id: validated.case_investigator_id,
      action: 'REJECT',
      old_values: { status: assignment.status },
      new_values: { status: 'REJECTED', rejection_reason: validated.reason },
    });

    return updated;
  }

  /**
   * Reassigns a case from one investigator to another.
   * GATE: Reassignment preserves complete historical record!
   * The old assignment is marked REASSIGNED (is_active = false) with reason & timestamp;
   * A new active row is inserted for the new investigator.
   */
  async reassignInvestigator(
    actorUserId: string,
    agencyId: string,
    input: ReassignInvestigatorInput,
    userPermissions: string[] = []
  ) {
    if (!userPermissions.includes('cases.assign') && !userPermissions.includes('*')) {
      throw new Error("Unauthorized: Missing required permission 'cases.assign'");
    }

    const validated = ReassignInvestigatorSchema.parse(input);

    // 1. Fetch current assignment
    const { data: current, error: cErr } = await this.supabase
      .from('case_investigators')
      .select('*, cases(id, status, loss_date, created_at, exception_type, version)')
      .eq('id', validated.current_case_investigator_id)
      .eq('agency_id', agencyId)
      .single();

    if (cErr || !current) {
      throw new Error(`Current assignment not found: ${validated.current_case_investigator_id}`);
    }

    if (!current.is_active) {
      throw new Error(`Cannot reassign: assignment ${current.id} is already inactive (status: ${current.status})`);
    }

    // 2. Fetch new investigator details & effective payment terms
    const { data: newInv, error: niErr } = await this.supabase
      .from('investigators')
      .select('id, full_name, code')
      .eq('id', validated.new_investigator_id)
      .eq('agency_id', agencyId)
      .single();

    if (niErr || !newInv) {
      throw new Error(`New investigator not found: ${validated.new_investigator_id}`);
    }

    const caseRow = current.cases;
    const caseDate = caseRow?.loss_date || new Date(caseRow?.created_at || Date.now()).toISOString().split('T')[0];

    const { data: newTerms } = await this.supabase
      .from('investigator_payment_terms')
      .select('*')
      .eq('investigator_id', validated.new_investigator_id)
      .eq('agency_id', agencyId);

    const effectiveTerm = resolveEffectivePaymentTerm(newTerms || [], caseDate);

    // 3. Compute Fee & TA for new investigator
    let agreedFee = validated.agreed_fee !== undefined ? validated.agreed_fee : current.agreed_fee;
    let travelAllowance = validated.travel_allowance !== undefined ? validated.travel_allowance : current.travel_allowance;

    const feeResult = calculateInvestigatorFeeForCase({
      term: effectiveTerm,
      enteredFee: agreedFee,
      enteredTa: travelAllowance,
      exceptionType: caseRow?.exception_type,
    });
    agreedFee = feeResult.effective_fee;
    travelAllowance = feeResult.effective_ta;

    const now = new Date().toISOString();

    // 4. Mark old assignment row REASSIGNED and inactive (PRESERVING FULL HISTORY)
    const { data: oldUpdated, error: oErr } = await this.supabase
      .from('case_investigators')
      .update({
        status: 'REASSIGNED',
        reassignment_reason: validated.reassignment_reason,
        reassigned_to_id: validated.new_investigator_id,
        reassigned_at: now,
        is_active: false,
        version: current.version + 1,
        updated_at: now,
      })
      .eq('id', current.id)
      .select()
      .single();

    if (oErr) {
      throw new Error(`Failed to update old assignment: ${oErr.message}`);
    }

    // 5. Create new assignment row for new investigator
    const { data: newAssignment, error: nErr } = await this.supabase
      .from('case_investigators')
      .insert({
        agency_id: agencyId,
        case_id: current.case_id,
        investigator_id: validated.new_investigator_id,
        assigned_by: actorUserId,
        assignment_scope: validated.assignment_scope || current.assignment_scope,
        status: 'PENDING_ACCEPTANCE',
        agreed_fee: agreedFee,
        travel_allowance: travelAllowance,
        payout_status: 'PENDING',
        hardcopy_status: 'PENDING',
        override_reason: validated.override_reason || null,
        is_active: true,
        assigned_at: now,
        version: 1,
      })
      .select()
      .single();

    if (nErr) {
      throw new Error(`Failed to create new assignment: ${nErr.message}`);
    }

    // 6. Reset case status to ACCEPTANCE_PENDING if needed
    if (caseRow && (caseRow.status === 'ASSIGNMENT' || caseRow.status === 'FIELD_INVESTIGATION')) {
      await this.supabase
        .from('cases')
        .update({
          status: 'ACCEPTANCE_PENDING',
          version: caseRow.version + 1,
          updated_at: now,
        })
        .eq('id', current.case_id)
        .eq('agency_id', agencyId);
    }

    // 7. Audit Log
    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      entity_type: 'case_investigators',
      entity_id: current.id,
      action: 'REASSIGN',
      old_values: {
        investigator_id: current.investigator_id,
        status: current.status,
      },
      new_values: {
        reassigned_to_id: validated.new_investigator_id,
        reassignment_reason: validated.reassignment_reason,
        new_assignment_id: newAssignment.id,
      },
    });

    return {
      previousAssignment: oldUpdated,
      newAssignment,
    };
  }

  /**
   * Retrieves full assignment history (active and historical rows) for a case.
   */
  async getCaseAssignments(agencyId: string, caseId: string) {
    const { data, error } = await this.supabase
      .from('case_investigators')
      .select(`
        id,
        case_id,
        investigator_id,
        assignment_scope,
        status,
        agreed_fee,
        travel_allowance,
        payout_status,
        hardcopy_status,
        rejection_reason,
        reassignment_reason,
        reassigned_to_id,
        override_reason,
        is_active,
        assigned_at,
        accepted_at,
        rejected_at,
        reassigned_at,
        investigators(id, code, full_name, phone),
        assigned_by_user:users!case_investigators_assigned_by_fkey(id, full_name)
      `)
      .eq('case_id', caseId)
      .eq('agency_id', agencyId)
      .order('assigned_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to load case assignments: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Updates physical hardcopy tracking status for an investigator assignment.
   */
  async updateHardcopyStatus(
    actorUserId: string,
    agencyId: string,
    input: UpdateHardcopyStatusInput
  ) {
    const validated = UpdateHardcopyStatusSchema.parse(input);

    const { data: current, error: cErr } = await this.supabase
      .from('case_investigators')
      .select('id, hardcopy_status, version')
      .eq('id', validated.case_investigator_id)
      .eq('agency_id', agencyId)
      .single();

    if (cErr || !current) {
      throw new Error(`Assignment not found: ${validated.case_investigator_id}`);
    }

    const { data: updated, error: uErr } = await this.supabase
      .from('case_investigators')
      .update({
        hardcopy_status: validated.hardcopy_status,
        version: current.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', validated.case_investigator_id)
      .select()
      .single();

    if (uErr) {
      throw new Error(`Failed to update hardcopy status: ${uErr.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      entity_type: 'case_investigators',
      entity_id: validated.case_investigator_id,
      action: 'UPDATE_HARDCOPY_STATUS',
      old_values: { hardcopy_status: current.hardcopy_status },
      new_values: { hardcopy_status: validated.hardcopy_status },
    });

    return updated;
  }
}
