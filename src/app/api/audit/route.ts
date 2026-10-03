import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User context not found' }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const entityType = searchParams.get('entity_type');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200);

  try {
    let query = supabase
      .from('audit_logs')
      .select('id, agency_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, created_at, users(full_name, username)')
      .eq('agency_id', context.agency_id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (action) {
      query = query.ilike('action', `%${action}%`);
    }
    if (entityType) {
      query = query.eq('entity_type', entityType);
    }

    const { data: logs, error } = await query;

    if (error) {
      // If users relation doesn't have FK in postgrest, fall back to simple select
      const fallbackQuery = await supabase
        .from('audit_logs')
        .select('*')
        .eq('agency_id', context.agency_id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (fallbackQuery.error) throw new Error(fallbackQuery.error.message);
      return NextResponse.json({ success: true, data: fallbackQuery.data || [] });
    }

    return NextResponse.json({ success: true, data: logs || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
