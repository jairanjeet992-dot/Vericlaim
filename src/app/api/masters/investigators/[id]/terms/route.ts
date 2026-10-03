import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { MastersService } from '@/modules/masters/service';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const body = await req.json();
  const service = new MastersService(supabase);

  try {
    const term = await service.addPaymentTerm(context.id, context.agency_id, {
      investigator_id: params.id,
      payment_type: body.payment_type,
      base_fee_or_salary: Number(body.base_fee_or_salary),
      effective_from: body.effective_from,
      effective_to: body.effective_to || null,
    });
    return NextResponse.json({ success: true, data: term }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
