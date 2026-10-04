import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { InvestigatorService } from '@/modules/investigators/investigator-service';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  if (!userPerms.effective_permissions.includes('finance.approve') && 
      !['Owner', 'Admin', 'Accountant'].includes(context.roles[0])) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions to compile payout batch' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const payoutMonth = body.payout_month; // YYYY-MM
    if (!payoutMonth || !/^\d{4}-\d{2}$/.test(payoutMonth)) {
      return NextResponse.json({ error: 'Valid payout_month (YYYY-MM) is required' }, { status: 400 });
    }

    const batchNumber = body.batch_number || `PO-${payoutMonth}-${Date.now().toString().slice(-4)}`;

    const service = new InvestigatorService(supabase);
    const batch = await service.compileMonthlyBatch(
      context.agency_id,
      context.id,
      payoutMonth,
      batchNumber
    );

    return NextResponse.json({ success: true, batch }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
