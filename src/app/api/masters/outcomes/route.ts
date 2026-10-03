import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { MastersService } from '@/modules/masters/service';

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const service = new MastersService(supabase);
  try {
    const outcomes = await service.listOutcomes(context.agency_id);
    return NextResponse.json({ success: true, data: outcomes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const body = await req.json();
  const service = new MastersService(supabase);

  try {
    const outcome = await service.createOutcome(context.id, context.agency_id, {
      code: body.code,
      name: body.name,
      category: body.category,
      financial_rule: body.financial_rule,
    });
    return NextResponse.json({ success: true, data: outcome }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
