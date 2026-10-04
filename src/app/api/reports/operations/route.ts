import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { calculateOperationalMetrics, CaseReportingRecord } from '@/modules/reports';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  const clientId = searchParams.get('client_id');
  const caseTypeId = searchParams.get('case_type_id');

  try {
    // 1. Fetch cases strictly respecting scope (Rule A5 & A9)
    let query = supabase
      .from('cases')
      .select('id, agency_id, client_id, case_type_id, status, outcome, location_city, location_state, rework_count, created_at, verified_at, assigned_at, submitted_at, approved_at, closed_at, owner_manager_id, data_entry_user_id')
      .eq('agency_id', context.agency_id);

    // Apply Scope Filter
    if (context.scope === 'TEAM') {
      const allowedManagers = [context.id];
      if (context.reports_to_id) allowedManagers.push(context.reports_to_id);
      query = query.in('owner_manager_id', allowedManagers);
    } else if (context.scope === 'OWN_ENTERED') {
      query = query.eq('data_entry_user_id', context.id);
    } else if (context.scope === 'ASSIGNED') {
      // Find assigned case ids
      const { data: assigned } = await supabase
        .from('case_investigators')
        .select('case_id')
        .eq('agency_id', context.agency_id)
        .eq('is_active', true)
        .or(`investigator_id.eq.${context.id}`);
      const caseIds = (assigned || []).map((a) => a.case_id);
      query = query.in('id', caseIds);
    }

    if (startDate) query = query.gte('created_at', `${startDate}T00:00:00Z`);
    if (endDate) query = query.lte('created_at', `${endDate}T23:59:59Z`);
    if (clientId) query = query.eq('client_id', clientId);
    if (caseTypeId) query = query.eq('case_type_id', caseTypeId);

    const { data: casesData, error: casesError } = await query;
    if (casesError) throw casesError;

    // 2. Fetch clients and case types maps for naming
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name')
      .eq('agency_id', context.agency_id);
    const clientsMap = new Map((clients || []).map((c) => [c.id, c.name]));

    const { data: caseTypes } = await supabase
      .from('case_types')
      .select('id, name')
      .eq('agency_id', context.agency_id);
    const caseTypesMap = new Map((caseTypes || []).map((ct) => [ct.id, ct.name]));

    const { data: investigators } = await supabase
      .from('investigators')
      .select('id, full_name')
      .eq('agency_id', context.agency_id);
    const investigatorsMap = new Map((investigators || []).map((i) => [i.id, i.full_name]));

    // 3. Compute pure operational metrics
    const metrics = calculateOperationalMetrics(
      (casesData || []) as CaseReportingRecord[],
      clientsMap,
      investigatorsMap,
      caseTypesMap
    );

    return NextResponse.json({ success: true, data: metrics });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
