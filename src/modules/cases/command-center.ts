import { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '@/modules/audit/service';

export interface CommandCenterTileCount {
  key: string;
  label: string;
  count: number;
  color: string;
  category: 'intake' | 'field' | 'review' | 'finance' | 'alert';
}

export interface CommandCenterFilters {
  tile?: string | null;
  client_id?: string | null;
  case_type_id?: string | null;
  investigator_id?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  risk_level?: string | null;
  status?: string | null;
  sla_status?: 'ON_TRACK' | 'APPROACHING_BREACH' | 'BREACHED' | null;
  date_from?: string | null;
  date_to?: string | null;
  pending_age_days?: number | null;
  search_query?: string | null;
}

export interface CommandCenterPagination {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export class CommandCenterService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Computes counts for all 13 Command Center tiles respecting caller's scope.
   * GATES: Strict scope isolation ensures no leak of out-of-scope rows.
   */
  async getTileMetrics(
    actorUserId: string,
    agencyId: string,
    callerScope: 'ALL' | 'TEAM' | 'ASSIGNED' | 'OWN_ENTERED' = 'ALL',
    subordinateUserIds: string[] = []
  ): Promise<CommandCenterTileCount[]> {
    // Build scoped query
    let query = this.supabase
      .from('cases')
      .select('id, status, risk_level, rework_count, due_date, created_at, owner_manager_id, data_entry_user_id')
      .eq('agency_id', agencyId);

    // Apply Scope Filter (Rule A5 & A9)
    if (callerScope === 'TEAM') {
      const allowedManagers = [actorUserId, ...subordinateUserIds];
      const { data: userRow } = await this.supabase
        .from('users')
        .select('reports_to_id')
        .eq('id', actorUserId)
        .single();
      if (userRow?.reports_to_id && !allowedManagers.includes(userRow.reports_to_id)) {
        allowedManagers.push(userRow.reports_to_id);
      }
      query = query.in('owner_manager_id', allowedManagers);
    } else if (callerScope === 'OWN_ENTERED') {
      query = query.eq('data_entry_user_id', actorUserId);
    } else if (callerScope === 'ASSIGNED') {
      // Fetch cases assigned to investigator
      const { data: assigned } = await this.supabase
        .from('case_investigators')
        .select('case_id')
        .eq('agency_id', agencyId)
        .eq('is_active', true)
        .or(`investigator_id.eq.${actorUserId},assigned_by.eq.${actorUserId}`);
      const caseIds = (assigned || []).map((a) => a.case_id);
      query = query.in('id', caseIds.length > 0 ? caseIds : ['00000000-0000-0000-0000-000000000000']);
    }

    const { data: cases, error } = await query;
    if (error) {
      throw new Error(`Failed to load command center metrics: ${error.message}`);
    }

    const allCases = cases || [];
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Initialize 13 tiles
    const tiles: CommandCenterTileCount[] = [
      {
        key: 'NEW',
        label: 'New Intake',
        count: allCases.filter((c) => c.status === 'DATA_ENTRY' && new Date(c.created_at) >= twentyFourHoursAgo).length,
        color: 'blue',
        category: 'intake',
      },
      {
        key: 'VERIFICATION_PENDING',
        label: 'Verification Pending',
        count: allCases.filter((c) => c.status === 'DATA_ENTRY' || c.status === 'VERIFICATION').length,
        color: 'sky',
        category: 'intake',
      },
      {
        key: 'ASSIGNMENT_PENDING',
        label: 'Assignment Pending',
        count: allCases.filter((c) => c.status === 'ASSIGNMENT').length,
        color: 'indigo',
        category: 'intake',
      },
      {
        key: 'INVESTIGATOR_PENDING',
        label: 'Investigator Pending',
        count: allCases.filter((c) => c.status === 'ACCEPTANCE_PENDING').length,
        color: 'purple',
        category: 'field',
      },
      {
        key: 'IN_PROGRESS',
        label: 'In Progress',
        count: allCases.filter((c) => c.status === 'FIELD_INVESTIGATION' || c.status === 'EVIDENCE_GATHERING').length,
        color: 'teal',
        category: 'field',
      },
      {
        key: 'REPORT_PENDING',
        label: 'Report Pending',
        count: allCases.filter((c) => c.status === 'REPORT_DRAFTING').length,
        color: 'emerald',
        category: 'review',
      },
      {
        key: 'CORRECTIONS_PENDING',
        label: 'Corrections Pending',
        count: allCases.filter((c) => c.status === 'REPORT_DRAFTING' && (c.rework_count || 0) > 0).length,
        color: 'orange',
        category: 'review',
      },
      {
        key: 'RESUBMITTED',
        label: 'Resubmitted',
        count: allCases.filter((c) => c.status === 'REPORT_REVIEW' && (c.rework_count || 0) > 0).length,
        color: 'amber',
        category: 'review',
      },
      {
        key: 'APPROVAL_PENDING',
        label: 'Approval Pending',
        count: allCases.filter((c) => c.status === 'REPORT_REVIEW' || c.status === 'ESCALATED_REVIEW').length,
        color: 'yellow',
        category: 'review',
      },
      {
        key: 'HARDCOPY_PENDING',
        label: 'Hardcopy Pending',
        count: allCases.filter((c) => c.status === 'HARDCOPY_TRANSIT').length,
        color: 'cyan',
        category: 'field',
      },
      {
        key: 'BILLING_PENDING',
        label: 'Billing Pending',
        count: allCases.filter((c) => c.status === 'CLOSED').length,
        color: 'slate',
        category: 'finance',
      },
      {
        key: 'PAYMENT_PENDING',
        label: 'Payment Pending',
        count: allCases.filter((c) => c.status === 'INVOICED' || c.status === 'PARTIALLY_PAID').length,
        color: 'rose',
        category: 'finance',
      },
      {
        key: 'SLA_BREACHED',
        label: 'SLA Breached',
        count: allCases.filter((c) => {
          if (c.status === 'PAID_IN_FULL' || c.status === 'FINANCIALLY_CLOSED') return false;
          if (!c.due_date) return false;
          return new Date(c.due_date) < now;
        }).length,
        color: 'red',
        category: 'alert',
      },
    ];

    return tiles;
  }

  /**
   * Queries and filters cases in Command Center with composite search,
   * filter tags, pagination, and strict scope guarantees.
   */
  async queryCases(
    actorUserId: string,
    agencyId: string,
    filters: CommandCenterFilters = {},
    pagination: CommandCenterPagination = {},
    callerScope: 'ALL' | 'TEAM' | 'ASSIGNED' | 'OWN_ENTERED' = 'ALL',
    subordinateUserIds: string[] = []
  ) {
    let query = this.supabase
      .from('cases')
      .select(`
        id,
        doc_code,
        claim_no,
        policy_no,
        insured_name,
        patient_name,
        hospital_name,
        location_city,
        location_state,
        location_pincode,
        claim_amount,
        risk_level,
        status,
        outcome,
        rework_count,
        due_date,
        created_at,
        owner_manager_id,
        data_entry_user_id,
        clients:clients(id, name, code),
        case_types:case_types(id, name, code),
        owner_manager:users!cases_owner_manager_id_fkey(id, full_name)
      `, { count: 'exact' })
      .eq('agency_id', agencyId);

    // 1. Enforce Scope Security (Rule A5 & A9)
    if (callerScope === 'TEAM') {
      const allowedManagers = [actorUserId, ...subordinateUserIds];
      const { data: userRow } = await this.supabase
        .from('users')
        .select('reports_to_id')
        .eq('id', actorUserId)
        .single();
      if (userRow?.reports_to_id && !allowedManagers.includes(userRow.reports_to_id)) {
        allowedManagers.push(userRow.reports_to_id);
      }
      query = query.in('owner_manager_id', allowedManagers);
    } else if (callerScope === 'OWN_ENTERED') {
      query = query.eq('data_entry_user_id', actorUserId);
    } else if (callerScope === 'ASSIGNED') {
      const { data: assigned } = await this.supabase
        .from('case_investigators')
        .select('case_id')
        .eq('agency_id', agencyId)
        .eq('is_active', true)
        .or(`investigator_id.eq.${actorUserId},assigned_by.eq.${actorUserId}`);
      const caseIds = (assigned || []).map((a) => a.case_id);
      query = query.in('id', caseIds.length > 0 ? caseIds : ['00000000-0000-0000-0000-000000000000']);
    }

    // 2. Tile preset filters
    if (filters.tile) {
      const now = new Date();
      switch (filters.tile) {
        case 'NEW':
          const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
          query = query.eq('status', 'DATA_ENTRY').gte('created_at', oneDayAgo);
          break;
        case 'VERIFICATION_PENDING':
          query = query.in('status', ['DATA_ENTRY', 'VERIFICATION']);
          break;
        case 'ASSIGNMENT_PENDING':
          query = query.eq('status', 'ASSIGNMENT');
          break;
        case 'INVESTIGATOR_PENDING':
          query = query.eq('status', 'ACCEPTANCE_PENDING');
          break;
        case 'IN_PROGRESS':
          query = query.in('status', ['FIELD_INVESTIGATION', 'EVIDENCE_GATHERING']);
          break;
        case 'REPORT_PENDING':
          query = query.eq('status', 'REPORT_DRAFTING');
          break;
        case 'CORRECTIONS_PENDING':
          query = query.eq('status', 'REPORT_DRAFTING').gt('rework_count', 0);
          break;
        case 'RESUBMITTED':
          query = query.eq('status', 'REPORT_REVIEW').gt('rework_count', 0);
          break;
        case 'APPROVAL_PENDING':
          query = query.in('status', ['REPORT_REVIEW', 'ESCALATED_REVIEW']);
          break;
        case 'HARDCOPY_PENDING':
          query = query.eq('status', 'HARDCOPY_TRANSIT');
          break;
        case 'BILLING_PENDING':
          query = query.eq('status', 'CLOSED');
          break;
        case 'PAYMENT_PENDING':
          query = query.in('status', ['INVOICED', 'PARTIALLY_PAID']);
          break;
        case 'SLA_BREACHED':
          query = query.lt('due_date', now.toISOString()).not('status', 'in', '(PAID_IN_FULL,FINANCIALLY_CLOSED)');
          break;
      }
    }

    // 3. Entity Filters
    if (filters.client_id) {
      query = query.eq('client_id', filters.client_id);
    }
    if (filters.case_type_id) {
      query = query.eq('case_type_id', filters.case_type_id);
    }
    if (filters.status && !filters.tile) {
      query = query.eq('status', filters.status);
    }
    if (filters.risk_level) {
      query = query.eq('risk_level', filters.risk_level);
    }
    if (filters.location_city) {
      query = query.ilike('location_city', `%${filters.location_city}%`);
    }
    if (filters.location_state) {
      query = query.ilike('location_state', `%${filters.location_state}%`);
    }
    if (filters.date_from) {
      query = query.gte('created_at', `${filters.date_from}T00:00:00Z`);
    }
    if (filters.date_to) {
      query = query.lte('created_at', `${filters.date_to}T23:59:59Z`);
    }

    // 4. Pending Age filter
    if (filters.pending_age_days) {
      const ageThreshold = new Date(Date.now() - filters.pending_age_days * 24 * 60 * 60 * 1000).toISOString();
      query = query.lte('created_at', ageThreshold);
    }

    // 5. Investigator filter (Filter cases where investigator is actively assigned)
    if (filters.investigator_id) {
      const { data: invCases } = await this.supabase
        .from('case_investigators')
        .select('case_id')
        .eq('agency_id', agencyId)
        .eq('investigator_id', filters.investigator_id)
        .eq('is_active', true);
      const caseIds = (invCases || []).map((c) => c.case_id);
      query = query.in('id', caseIds.length > 0 ? caseIds : ['00000000-0000-0000-0000-000000000000']);
    }

    // 6. Free text search (Claim No, Policy No, Insured Name, Doc Code)
    if (filters.search_query && filters.search_query.trim().length > 0) {
      const s = filters.search_query.trim();
      query = query.or(`doc_code.ilike.%${s}%,claim_no.ilike.%${s}%,policy_no.ilike.%${s}%,insured_name.ilike.%${s}%`);
    }

    // 7. Ordering & Pagination
    const page = pagination.page || 1;
    const pageSize = pagination.pageSize || 25;
    const fromIndex = (page - 1) * pageSize;
    const toIndex = fromIndex + pageSize - 1;

    const sortBy = pagination.sortBy || 'created_at';
    const sortAsc = pagination.sortDirection === 'asc';

    query = query.order(sortBy, { ascending: sortAsc }).range(fromIndex, toIndex);

    const { data, count, error } = await query;
    if (error) {
      throw new Error(`Failed to query command center cases: ${error.message}`);
    }

    return {
      cases: data || [],
      totalCount: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    };
  }

  /**
   * Saved Filters Management (A9 & A10)
   */
  async saveFilter(userId: string, agencyId: string, name: string, criteria: CommandCenterFilters, isDefault = false) {
    const { data, error } = await this.supabase
      .from('command_center_saved_filters')
      .upsert({
        agency_id: agencyId,
        user_id: userId,
        name: name.trim(),
        filter_criteria: criteria,
        is_default: isDefault,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agency_id,user_id,name' })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save filter preset: ${error.message}`);
    }

    return data;
  }

  async listSavedFilters(userId: string, agencyId: string) {
    const { data, error } = await this.supabase
      .from('command_center_saved_filters')
      .select('*')
      .eq('agency_id', agencyId)
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    if (error) {
      throw new Error(`Failed to list saved filters: ${error.message}`);
    }

    return data || [];
  }

  async deleteSavedFilter(userId: string, agencyId: string, filterId: string) {
    const { error } = await this.supabase
      .from('command_center_saved_filters')
      .delete()
      .eq('id', filterId)
      .eq('agency_id', agencyId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to delete saved filter: ${error.message}`);
    }

    return { success: true };
  }

  /**
   * Safe Bulk Operations
   * Executes bulk verification, bulk assignment, or priority change.
   * Isolates failures so that an error on one case does not abort valid updates.
   */
  async executeBulkAction(
    actorUserId: string,
    agencyId: string,
    action: 'BULK_VERIFY' | 'BULK_PRIORITY' | 'BULK_ASSIGN',
    caseIds: string[],
    payload: {
      investigator_id?: string;
      risk_level?: string;
      reason?: string;
    } = {},
    userPermissions: string[] = []
  ) {
    if (!caseIds || caseIds.length === 0) {
      return { succeeded: 0, failed: 0, errors: [] };
    }

    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ caseId: string; message: string }> = [];

    for (const caseId of caseIds) {
      try {
        if (action === 'BULK_VERIFY') {
          if (!userPermissions.includes('cases.verify') && !userPermissions.includes('*')) {
            throw new Error("Missing 'cases.verify' permission");
          }
          const { data: c } = await this.supabase
            .from('cases')
            .select('status, version')
            .eq('id', caseId)
            .eq('agency_id', agencyId)
            .single();

          if (!c) throw new Error('Case not found');
          if (c.status !== 'VERIFICATION' && c.status !== 'DATA_ENTRY') {
            throw new Error(`Case in status '${c.status}' cannot be verified`);
          }

          await this.supabase
            .from('cases')
            .update({
              status: 'ASSIGNMENT',
              version: c.version + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', caseId)
            .eq('agency_id', agencyId);

          succeeded++;
        } else if (action === 'BULK_PRIORITY') {
          if (!payload.risk_level) throw new Error('Target risk level required');
          const { data: c } = await this.supabase
            .from('cases')
            .select('version')
            .eq('id', caseId)
            .eq('agency_id', agencyId)
            .single();

          if (!c) throw new Error('Case not found');

          await this.supabase
            .from('cases')
            .update({
              risk_level: payload.risk_level,
              version: c.version + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', caseId)
            .eq('agency_id', agencyId);

          succeeded++;
        } else if (action === 'BULK_ASSIGN') {
          if (!payload.investigator_id) throw new Error('Target investigator required');
          if (!userPermissions.includes('cases.assign') && !userPermissions.includes('*')) {
            throw new Error("Missing 'cases.assign' permission");
          }

          const { data: c } = await this.supabase
            .from('cases')
            .select('id, status, version')
            .eq('id', caseId)
            .eq('agency_id', agencyId)
            .single();

          if (!c) throw new Error('Case not found');

          await this.supabase
            .from('case_investigators')
            .insert({
              agency_id: agencyId,
              case_id: caseId,
              investigator_id: payload.investigator_id,
              assigned_by: actorUserId,
              assignment_scope: 'PRIMARY',
              status: 'PENDING_ACCEPTANCE',
              agreed_fee: 500,
              travel_allowance: 0,
              is_active: true,
              version: 1,
            });

          if (c.status === 'ASSIGNMENT') {
            await this.supabase
              .from('cases')
              .update({
                status: 'ACCEPTANCE_PENDING',
                version: c.version + 1,
                updated_at: new Date().toISOString(),
              })
              .eq('id', caseId)
              .eq('agency_id', agencyId);
          }

          succeeded++;
        }

        await recordAuditLog(this.supabase, {
          agency_id: agencyId,
          user_id: actorUserId,
          entity_type: 'cases',
          entity_id: caseId,
          action: action,
          new_values: { payload },
        });
      } catch (err: any) {
        failed++;
        errors.push({ caseId, message: err.message || 'Operation failed' });
      }
    }

    return {
      succeeded,
      failed,
      errors,
    };
  }
}
