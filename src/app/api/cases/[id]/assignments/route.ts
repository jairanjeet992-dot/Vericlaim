import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { getUserEffectivePermissions } from '@/modules/rbac/service';
import { AssignmentService } from '@/modules/assignment/service';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const assignmentService = new AssignmentService(supabase);
  try {
    const assignments = await assignmentService.getCaseAssignments(context.agency_id, params.id);
    return NextResponse.json({ success: true, data: assignments });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const permissions = await getUserEffectivePermissions(supabase, context.agency_id, context.id);
  const body = await req.json();

  const assignmentService = new AssignmentService(supabase);
  try {
    const assignment = await assignmentService.assignInvestigator(
      context.id,
      context.agency_id,
      params.id,
      body,
      permissions
    );
    return NextResponse.json({ success: true, data: assignment }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
