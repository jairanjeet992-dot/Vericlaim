import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { EvidenceService } from '@/modules/evidence/service';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User context not found' }, { status: 404 });

  try {
    // 1. Fetch investigator record if exists
    const { data: invProfile } = await supabase
      .from('investigators')
      .select('id, full_name, phone, availability')
      .eq('user_id', context.id)
      .eq('agency_id', context.agency_id)
      .maybeSingle();

    const investigatorId = invProfile?.id;

    // 2. Fetch assigned cases ONLY (Rule A5 & A9 Gate: Investigator cannot see unassigned cases)
    let assignedCaseIds: string[] = [];
    const { data: assignments } = await supabase
      .from('case_investigators')
      .select('case_id, assignment_scope, agreed_fee, hardcopy_status, assigned_at')
      .eq('agency_id', context.agency_id)
      .eq('is_active', true)
      .or(`investigator_id.eq.${context.id}${investigatorId ? `,investigator_id.eq.${investigatorId}` : ''}`);

    if (assignments && assignments.length > 0) {
      assignedCaseIds = assignments.map((a) => a.case_id);
    }

    let assignedCases: any[] = [];
    if (assignedCaseIds.length > 0) {
      const { data: cases } = await supabase
        .from('cases')
        .select('id, doc_code, claim_no, insured_name, hospital_name, location_city, location_state, status, risk_level, due_date, created_at, clients(name, code)')
        .eq('agency_id', context.agency_id)
        .in('id', assignedCaseIds)
        .order('due_date', { ascending: true });

      assignedCases = cases || [];
    }

    // 3. Fetch activities assigned to the investigator
    const evidenceService = new EvidenceService(supabase);
    const activities = await evidenceService.listActivitiesForInvestigator(
      context.agency_id,
      context.id
    );

    return NextResponse.json({
      success: true,
      investigator: invProfile || { id: context.id, full_name: context.full_name },
      cases: assignedCases,
      activities: activities,
      metrics: {
        active_cases_count: assignedCases.length,
        pending_activities_count: activities.filter((a) => a.status === 'PENDING').length,
        in_progress_activities_count: activities.filter((a) => a.status === 'IN_PROGRESS').length,
        completed_activities_count: activities.filter((a) => a.status === 'COMPLETED').length,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
