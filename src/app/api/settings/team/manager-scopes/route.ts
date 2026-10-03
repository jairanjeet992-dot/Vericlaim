import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { CreateManagerScopeSchema } from '@/modules/rbac/schema';

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: scopes, error } = await supabase
    .from('manager_scopes')
    .select(`
      id,
      manager_id,
      client_id,
      case_type,
      is_default,
      users ( id, full_name, username ),
      clients ( id, name, code )
    `)
    .eq('agency_id', context.agency_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also fetch list of clients and managers for dropdowns
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, code')
    .eq('agency_id', context.agency_id);

  const { data: managers } = await supabase
    .from('users')
    .select('id, full_name, username')
    .eq('agency_id', context.agency_id)
    .in('scope', ['ALL', 'TEAM']);

  return NextResponse.json({
    success: true,
    data: {
      scopes: scopes || [],
      clients: clients || [],
      managers: managers || [],
    },
  });
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const body = await req.json();
  const parsed = CreateManagerScopeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
  }

  // If setting is_default, optionally unset other defaults for same client + case_type
  if (parsed.data.is_default) {
    await supabase
      .from('manager_scopes')
      .update({ is_default: false })
      .eq('agency_id', context.agency_id)
      .eq('client_id', parsed.data.client_id)
      .eq('case_type', parsed.data.case_type);
  }

  const { data: created, error } = await supabase
    .from('manager_scopes')
    .insert({
      agency_id: context.agency_id,
      manager_id: parsed.data.manager_id,
      client_id: parsed.data.client_id,
      case_type: parsed.data.case_type,
      is_default: parsed.data.is_default,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const scopeId = searchParams.get('id');

  if (!scopeId) {
    return NextResponse.json({ error: 'Scope ID is required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('manager_scopes')
    .delete()
    .eq('id', scopeId)
    .eq('agency_id', context.agency_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
