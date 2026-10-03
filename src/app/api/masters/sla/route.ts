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
    const policies = await service.listSlaPolicies(context.agency_id);
    return NextResponse.json({ success: true, data: policies });
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
    const policy = await service.createSlaPolicy(context.id, context.agency_id, {
      name: body.name,
      target_hours: Number(body.target_hours),
      warning_threshold_percent: body.warning_threshold_percent ? Number(body.warning_threshold_percent) : undefined,
      is_agency_default: Boolean(body.is_agency_default),
    });
    return NextResponse.json({ success: true, data: policy }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
