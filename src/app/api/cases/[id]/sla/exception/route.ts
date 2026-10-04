import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { SlaExceptionRequestSchema } from '@/modules/investigators/investigator-types';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const validated = SlaExceptionRequestSchema.parse({
      case_id: params.id,
      extension_hours: body.extension_hours,
      reason: body.reason,
    });

    const { data, error } = await supabase
      .from('sla_exceptions')
      .insert({
        agency_id: context.agency_id,
        case_id: validated.case_id,
        requested_by: context.id,
        extension_hours: validated.extension_hours,
        reason: validated.reason,
        status: 'PENDING',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, exception: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!['Owner', 'Admin', 'Manager', 'Case Manager'].includes(context.roles[0])) {
    return NextResponse.json({ error: 'Forbidden: Only managers can approve SLA exceptions' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const exceptionId = body.exception_id;
    const action = body.action; // 'APPROVED' or 'REJECTED'

    if (!['APPROVED', 'REJECTED'].includes(action)) {
      return NextResponse.json({ error: 'Action must be APPROVED or REJECTED' }, { status: 400 });
    }

    const { data: exception, error: exErr } = await supabase
      .from('sla_exceptions')
      .update({
        status: action,
        reviewed_by: context.id,
        reviewed_at: new Date().toISOString(),
        review_notes: body.review_notes || null,
      })
      .eq('id', exceptionId)
      .eq('case_id', params.id)
      .eq('agency_id', context.agency_id)
      .select()
      .single();

    if (exErr) throw exErr;

    return NextResponse.json({ success: true, exception });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
