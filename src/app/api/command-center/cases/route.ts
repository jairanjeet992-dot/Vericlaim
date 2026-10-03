import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { getUserEffectiveScope, getUserSubtree } from '@/modules/rbac/service';
import { CommandCenterService, CommandCenterFilters, CommandCenterPagination } from '@/modules/cases/command-center';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const scope = await getUserEffectiveScope(supabase, context.agency_id, context.id);
  const subordinates = scope === 'TEAM' ? await getUserSubtree(supabase, context.id) : [];

  const { searchParams } = new URL(req.url);

  const filters: CommandCenterFilters = {
    tile: searchParams.get('tile') || null,
    client_id: searchParams.get('client_id') || null,
    case_type_id: searchParams.get('case_type_id') || null,
    investigator_id: searchParams.get('investigator_id') || null,
    location_city: searchParams.get('location_city') || null,
    location_state: searchParams.get('location_state') || null,
    risk_level: searchParams.get('risk_level') || null,
    status: searchParams.get('status') || null,
    date_from: searchParams.get('date_from') || null,
    date_to: searchParams.get('date_to') || null,
    pending_age_days: searchParams.get('pending_age_days') ? parseInt(searchParams.get('pending_age_days')!, 10) : null,
    search_query: searchParams.get('q') || searchParams.get('search') || null,
  };

  const pagination: CommandCenterPagination = {
    page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
    pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 25,
    sortBy: searchParams.get('sortBy') || 'created_at',
    sortDirection: (searchParams.get('sortDirection') as 'asc' | 'desc') || 'desc',
  };

  const commandCenter = new CommandCenterService(supabase);
  try {
    const result = await commandCenter.queryCases(
      context.id,
      context.agency_id,
      filters,
      pagination,
      scope,
      subordinates
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
