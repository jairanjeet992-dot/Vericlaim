import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { NotificationEngine } from '@/modules/notifications';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const engine = new NotificationEngine(supabase);
    await engine.markAllAsRead(context.agency_id, context.id);
    return NextResponse.json({ success: true, message: 'All notifications marked as read' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
