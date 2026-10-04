import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { InvestigatorService } from '@/modules/investigators/investigator-service';

async function getContext() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const context = await getUserContext(supabase, user.id);
  if (!context) return null;

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  return {
    supabase,
    userId: context.id,
    agencyId: context.agency_id,
    permissions: userPerms.effective_permissions,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const investigatorId = searchParams.get('investigator_id');

  try {
    let query = ctx.supabase
      .from('investigator_expenses')
      .select('*, investigator:investigators(id, code, full_name), case:cases(id, case_number)')
      .eq('agency_id', ctx.agencyId)
      .order('submitted_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (investigatorId) query = query.eq('investigator_id', investigatorId);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ expenses: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const service = new InvestigatorService(ctx.supabase);
    const result = await service.submitExpense(
      ctx.agencyId,
      body.investigator_id,
      ctx.userId,
      body
    );
    return NextResponse.json({ success: true, expense: result }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
