import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyPlatformAdmin, listAgencies, createAgency } from '@/modules/platform/service';
import { CreateAgencySchema } from '@/modules/platform/schema';

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !(await verifyPlatformAdmin(supabase, user.id))) {
    return NextResponse.json({ error: 'Unauthorized: Platform admin only' }, { status: 403 });
  }

  try {
    const agencies = await listAgencies(supabase);
    return NextResponse.json({ success: true, data: agencies });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !(await verifyPlatformAdmin(supabase, user.id))) {
    return NextResponse.json({ error: 'Unauthorized: Platform admin only' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = CreateAgencySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }

    const agency = await createAgency(supabase, user.id, parsed.data);
    return NextResponse.json({ success: true, data: agency }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
