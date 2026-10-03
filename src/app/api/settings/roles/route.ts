import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { CreateRoleSchema, CloneRoleSchema } from '@/modules/rbac/schema';

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Permissions catalog
  const { data: permissions } = await supabase
    .from('permissions')
    .select('*')
    .order('module', { ascending: true });

  // Agency roles with permissions
  const { data: roles, error: rolesError } = await supabase
    .from('roles')
    .select('*, role_permissions(permission_id)')
    .eq('agency_id', context.agency_id)
    .order('name', { ascending: true });

  if (rolesError) {
    return NextResponse.json({ error: rolesError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      permissions: permissions || [],
      roles: roles || [],
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
  const rbacService = new RbacService(supabase);

  try {
    if (body.source_role_id) {
      // Clone role
      const parsed = CloneRoleSchema.parse(body);
      const role = await rbacService.cloneRole(context.id, context.agency_id, parsed);
      return NextResponse.json({ success: true, data: role }, { status: 201 });
    } else {
      // Create role
      const parsed = CreateRoleSchema.parse(body);
      const role = await rbacService.createCustomRole(context.id, context.agency_id, parsed);
      return NextResponse.json({ success: true, data: role }, { status: 201 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
