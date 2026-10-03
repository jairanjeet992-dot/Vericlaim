import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { ReportsService } from '@/modules/reports/service';
import { DispatchHardcopySchema } from '@/modules/reports/schema';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  try {
    const { data: dockets } = await supabase
      .from('courier_dockets')
      .select('*, clients(id, name), client_branches(branch_name, city), users!courier_dockets_dispatched_by_fkey(full_name)')
      .eq('agency_id', context.agency_id)
      .order('dispatched_at', { ascending: false });

    return NextResponse.json({ success: true, data: dockets || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  try {
    const body = await req.json();
    const parsed = DispatchHardcopySchema.parse(body);

    const service = new ReportsService(supabase);
    const docket = await service.dispatchHardcopy(
      {
        userId: context.id,
        agencyId: context.agency_id,
        role: context.roles[0],
        scope: context.scope,
        permissions: userPerms.effective_permissions,
      },
      parsed
    );

    return NextResponse.json({ success: true, data: docket });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
