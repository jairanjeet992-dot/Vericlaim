import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyPlatformAdmin, createFirstOwner } from '@/modules/platform/service';
import { CreateFirstOwnerSchema } from '@/modules/platform/schema';

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
    const parsed = CreateFirstOwnerSchema.safeParse({
      agency_id: params.id,
      username: body.username,
      full_name: body.full_name,
      password: body.password,
      phone: body.phone,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }

    const owner = await createFirstOwner(supabase, user.id, parsed.data);
    return NextResponse.json({ success: true, data: owner }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
