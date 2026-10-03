import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { getUserEffectiveScope, getUserSubtree } from '@/modules/rbac/service';
import { CommandCenterService } from '@/modules/cases/command-center';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const scope = await getUserEffectiveScope(supabase, context.agency_id, context.id);
  const subordinates = scope === 'TEAM' ? await getUserSubtree(supabase, context.id) : [];

  const commandCenter = new CommandCenterService(supabase);
  try {
    const tiles = await commandCenter.getTileMetrics(
      context.id,
      context.agency_id,
      scope,
      subordinates
    );
    return NextResponse.json({ success: true, data: tiles });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
