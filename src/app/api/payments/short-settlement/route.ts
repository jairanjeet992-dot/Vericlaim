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
  const invoiceId = searchParams.get('invoice_id');
  const receivedAmount = searchParams.get('received_amount');

  if (!invoiceId || !receivedAmount) {
    return NextResponse.json(
      { error: 'Both invoice_id and received_amount are required' },
      { status: 400 }
    );
  }

  try {
    const service = new PaymentService(supabase);
    const suggestion = await service.checkShortSettlementSuggestion(
      context.agency_id,
      invoiceId,
      receivedAmount
    );

    return NextResponse.json({ success: true, suggestion });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
