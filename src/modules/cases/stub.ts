import { SupabaseClient } from '@supabase/supabase-js';

export interface CaseStub {
  id: string;
  agency_id: string;
  doc_code: string;
  claim_number: string;
  client_id: string;
  case_type: string;
  owner_manager_id: string;
  data_entry_user_id: string;
  status: string;
  created_at: string;
}

export class CasesStubService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a stub case
   */
  async createCase(
    agencyId: string,
    data: {
      doc_code: string;
      claim_number: string;
      client_id: string;
      case_type: string;
      owner_manager_id: string;
      data_entry_user_id: string;
      status?: string;
    }
  ): Promise<CaseStub> {
    const { data: created, error } = await this.supabase
      .from('cases')
      .insert({
        agency_id: agencyId,
        doc_code: data.doc_code,
        claim_number: data.claim_number,
        client_id: data.client_id,
        case_type: data.case_type,
        owner_manager_id: data.owner_manager_id,
        data_entry_user_id: data.data_entry_user_id,
        status: data.status || 'DATA_ENTRY',
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create case: ${error.message}`);
    return created;
  }

  /**
   * Assign Investigator to Case
   */
  async assignInvestigator(
    agencyId: string,
    caseId: string,
    investigatorUserId: string
  ) {
    const { data, error } = await this.supabase
      .from('case_investigators')
      .insert({
        agency_id: agencyId,
        case_id: caseId,
        investigator_id: investigatorUserId,
        status: 'ASSIGNED',
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to assign investigator: ${error.message}`);
    return data;
  }

  /**
   * Query cases filtered through RLS and scope
   */
  async listCases(agencyId: string, limit = 50): Promise<CaseStub[]> {
    const { data, error } = await this.supabase
      .from('cases')
      .select('*')
      .eq('agency_id', agencyId)
      .limit(limit);

    if (error) throw new Error(`Failed to list cases: ${error.message}`);
    return data || [];
  }
}
