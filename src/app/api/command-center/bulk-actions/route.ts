import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { getUserEffectivePermissions } from '@/modules/rbac/service';
import { CommandCenterService } from '@/modules/cases/command-center';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const permissions = await getUserEffectivePermissions(supabase, context.agency_id, context.id);
  const body = await req.json();
  const { action, case_ids, payload } = body;

  if (!action || !['BULK_VERIFY', 'BULK_PRIORITY', 'BULK_ASSIGN'].includes(action)) {
    return NextResponse.json({ error: 'Invalid bulk action' }, { status: 400 });
  }

  if (!Array.isArray(case_ids) || case_ids.length === 0) {
    return NextResponse.json({ error: 'No cases selected for bulk action' }, { status: 400 });
  }

  const commandCenter = new CommandCenterService(supabase);
  try {
    const result = await commandCenter.executeBulkAction(
      context.id,
      context.agency_id,
      action,
      case_ids,
      payload || {},
      permissions
    );
    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
