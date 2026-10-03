import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { InvoicingService, UserScopeContext } from '@/modules/finance/service';
import { CreateDraftInvoiceSchema } from '@/modules/finance/schema';

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
  const status = searchParams.get('status');
  const clientId = searchParams.get('client_id');

  try {
    let query = ctx.supabase
      .from('invoices')
      .select('*, clients(id, name), client_branches(id, branch_name, branch_code, gstin, state)')
      .eq('agency_id', ctx.scopeContext.agencyId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }
    if (clientId) {
      query = query.eq('client_id', clientId);
    }

    const { data: invoices, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: invoices || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const parsed = CreateDraftInvoiceSchema.parse(body);
    const service = new InvoicingService(ctx.supabase);
    const dossier = await service.createDraftInvoice(ctx.scopeContext, parsed);

    return NextResponse.json({ success: true, data: dossier });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
