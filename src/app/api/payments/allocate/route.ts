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

export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const service = new PaymentService(ctx.supabase);

    if (Array.isArray(body.allocations)) {
      // Bulk allocation
      const result = await service.bulkAllocatePayment(ctx.scopeContext, body);
      return NextResponse.json({ success: true, data: result });
    } else {
      // Single allocation
      const result = await service.allocatePayment(ctx.scopeContext, body);
      return NextResponse.json({ success: true, data: result });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
