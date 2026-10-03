import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { ReportsService, UserScopeContext } from '@/modules/reports/service';
import { CreateReportSchema, SaveDraftReportSchema } from '@/modules/reports/schema';

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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const service = new ReportsService(ctx.supabase);
    const data = await service.getReportByCaseId(ctx.scopeContext, params.id);
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const service = new ReportsService(ctx.supabase);

    if (body.action === 'save_draft') {
      const parsed = SaveDraftReportSchema.parse(body);
      const updated = await service.saveDraft(ctx.scopeContext, parsed);
      return NextResponse.json({ success: true, data: updated });
    }

    const parsed = CreateReportSchema.parse({ ...body, case_id: params.id });
    const report = await service.createOrGetReport(ctx.scopeContext, parsed);
    return NextResponse.json({ success: true, data: report });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
