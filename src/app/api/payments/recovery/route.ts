import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { PaymentService } from '@/modules/finance';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const service = new PaymentService(supabase);
    const recoveryItems = await service.getRecoveryHub(context.agency_id);

    return NextResponse.json({ success: true, data: recoveryItems });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
