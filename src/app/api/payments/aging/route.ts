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

  const { searchParams } = new URL(req.url);
  const asOfDate = searchParams.get('as_of_date') || undefined;

  try {
    const service = new PaymentService(supabase);
    const summary = await service.getAgingSummary(context.agency_id, asOfDate);

    return NextResponse.json({ success: true, data: summary });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
