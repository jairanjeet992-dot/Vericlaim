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
  const clientId = searchParams.get('client_id');

  if (!clientId) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  }

  try {
    const service = new PaymentService(supabase);
    const ledger = await service.getClientLedger(context.agency_id, clientId);

    return NextResponse.json({ success: true, data: ledger });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
