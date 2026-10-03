import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { ReportsService } from '@/modules/reports/service';
import { InwardHardcopySchema } from '@/modules/reports/schema';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  try {
    const { data: packets } = await supabase
      .from('hardcopy_packets')
      .select('*, courier_dockets(docket_number, courier_partner, awb_number, delivery_status)')
      .eq('case_id', params.id)
      .eq('agency_id', context.agency_id)
      .order('created_at', { ascending: false });

    return NextResponse.json({ success: true, data: packets || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  try {
    const body = await req.json();
    const parsed = InwardHardcopySchema.parse({
      ...body,
      case_id: params.id,
    });

    const service = new ReportsService(supabase);
    const packet = await service.inwardPacket(
      {
        userId: context.id,
        agencyId: context.agency_id,
        role: context.roles[0],
        scope: context.scope,
        permissions: userPerms.effective_permissions,
      },
      parsed
    );

    return NextResponse.json({ success: true, data: packet });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
