import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyPlatformAdmin, suspendAgency } from '@/modules/platform/service';
import { SuspendAgencySchema } from '@/modules/platform/schema';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !(await verifyPlatformAdmin(supabase, user.id))) {
    return NextResponse.json({ error: 'Unauthorized: Platform admin only' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = SuspendAgencySchema.safeParse({
      agency_id: params.id,
      is_active: body.is_active,
      reason: body.reason,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }

    const updated = await suspendAgency(supabase, user.id, parsed.data);
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
