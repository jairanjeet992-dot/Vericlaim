import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  const canView = userPerms.effective_permissions.includes('audit.view') ||
                  userPerms.effective_permissions.includes('reports.export') ||
                  userPerms.effective_permissions.includes('*');

  if (!canView) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions to view export logs' }, { status: 403 });
  }

  try {
    const { data: logs, error } = await supabase
      .from('export_logs')
      .select('*, users(id, full_name, email)')
      .eq('agency_id', context.agency_id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({ success: true, data: logs || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
