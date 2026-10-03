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
    const branch = await service.createClientBranch(context.id, context.agency_id, {
      client_id: params.id,
      branch_name: body.branch_name,
      branch_code: body.branch_code,
      legal_name: body.legal_name,
      gstin: body.gstin,
      state: body.state,
      state_code: body.state_code,
      billing_address: body.billing_address,
      is_default: body.is_default,
    });
    return NextResponse.json({ success: true, data: branch }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
