import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { DelegatePermissionSchema } from '@/modules/rbac/schema';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const body = await req.json();
  const parsed = DelegatePermissionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
  }

  const rbacService = new RbacService(supabase);
  try {
    const res = await rbacService.delegatePermission(
      context.id,
      context.agency_id,
      parsed.data.target_user_id,
      parsed.data.permission_id,
      parsed.data.effect
    );
    return NextResponse.json({ success: true, data: res });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
