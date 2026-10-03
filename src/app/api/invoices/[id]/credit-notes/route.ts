import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { InvoicingService, UserScopeContext } from '@/modules/finance/service';
import { CreateCreditNoteSchema } from '@/modules/finance/schema';

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const service = new InvoicingService(ctx.supabase);
    const note = await service.createCreditNote(ctx.scopeContext, {
      original_invoice_id: params.id,
      note_type: body.note_type || 'CREDIT_NOTE',
      reason: body.reason,
      taxable_amount: body.taxable_amount,
      tax_rate: body.tax_rate,
    });
    return NextResponse.json({ success: true, data: note });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
