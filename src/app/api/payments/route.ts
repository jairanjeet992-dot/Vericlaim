import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { PaymentService, UserScopeContext } from '@/modules/finance';

async function getContext(): Promise<{ supabase: any; scopeContext: UserScopeContext } | null> {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const context = await getUserContext(supabase, user.id);
  if (!context) return null;

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  return {
    supabase,
    scopeContext: {
      userId: context.id,
      agencyId: context.agency_id,
      role: context.roles[0],
      scope: context.scope,
      permissions: userPerms.effective_permissions,
    },
  };
}

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('client_id');
  const onlyUnapplied = searchParams.get('only_unapplied') === 'true';

  try {
    let query = ctx.supabase
      .from('client_payments')
      .select('*, clients(id, name), client_branches(id, branch_name)')
      .eq('agency_id', ctx.scopeContext.agencyId)
      .order('payment_date', { ascending: false });

    if (clientId) {
      query = query.eq('client_id', clientId);
    }
    if (onlyUnapplied) {
      query = query.gt('unapplied_amount', 0);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const service = new PaymentService(ctx.supabase);
    const payment = await service.recordPayment(ctx.scopeContext, body);

    return NextResponse.json({ success: true, data: payment });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
