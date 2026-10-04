import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { InvestigatorService } from '@/modules/investigators/investigator-service';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  if (!userPerms.effective_permissions.includes('finance.approve') && 
      !['Owner', 'Admin', 'Accountant'].includes(context.roles[0])) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions to mark payout batch paid' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const service = new InvestigatorService(supabase);
    const result = await service.markBatchPaid(
      context.agency_id,
      context.id,
      params.id,
      body.payment_reference
    );

    return NextResponse.json({ success: true, batch: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
