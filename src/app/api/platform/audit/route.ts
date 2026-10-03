import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyPlatformAdmin } from '@/modules/platform/service';

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !(await verifyPlatformAdmin(supabase, user.id))) {
    return NextResponse.json({ error: 'Unauthorized: Platform admin only' }, { status: 403 });
  }

  try {
    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('*')
      .not('platform_admin_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, data: logs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
