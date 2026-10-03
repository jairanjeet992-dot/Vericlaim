import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { UserScopeContext } from '@/modules/finance/service';

async function getContext(req: NextRequest): Promise<{ supabase: any; scopeContext: UserScopeContext } | null> {
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
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('client_id');

  try {
    let query = ctx.supabase
      .from('cases')
      .select('id, docket_no, claim_no, insured_name, case_type, client_id, location_city, status, completed_at, clients(id, name)')
      .eq('agency_id', ctx.scopeContext.agencyId)
      .in('status', ['CLOSED', 'APPROVED', 'HARDCOPY_TRANSIT'])
      .order('completed_at', { ascending: false });

    if (clientId) {
      query = query.eq('client_id', clientId);
    }

    const { data: cases, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: cases || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
