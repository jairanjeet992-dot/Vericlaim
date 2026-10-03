import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { getUserEffectivePermissions } from '@/modules/rbac/service';
import { AssignmentService } from '@/modules/assignment/service';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const body = await req.json();
  const permissions = await getUserEffectivePermissions(supabase, context.agency_id, context.id);

  const assignmentService = new AssignmentService(supabase);
  try {
    const updated = await assignmentService.rejectAssignment(
      context.id,
      context.agency_id,
      body,
      permissions
    );
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
