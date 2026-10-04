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
  const periodStart = searchParams.get('period_start') || undefined;
  const periodEnd = searchParams.get('period_end') || undefined;
  const includeLegacy = searchParams.get('include_legacy') === 'true';

  try {
    const service = new PaymentService(supabase);
    const report = await service.getProfitReport(
      context.agency_id,
      periodStart,
      periodEnd,
      includeLegacy
    );

    return NextResponse.json({ success: true, data: report });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
