import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { ReportsService } from '@/modules/reports/service';

export async function GET(
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
    const service = new ReportsService(supabase);
    const history = await service.getChainOfCustody(
      {
        userId: context.id,
        agencyId: context.agency_id,
        role: context.roles[0],
        scope: context.scope,
        permissions: userPerms.effective_permissions,
      },
      params.id
    );

    return NextResponse.json({ success: true, data: history });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
