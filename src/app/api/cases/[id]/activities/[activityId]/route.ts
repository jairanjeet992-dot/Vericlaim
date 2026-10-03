import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { EvidenceService } from '@/modules/evidence/service';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; activityId: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User context not found' }, { status: 404 });

  try {
    const body = await req.json();
    const evidenceService = new EvidenceService(supabase);

    const userScopeContext = {
      agencyId: context.agency_id,
      userId: context.id,
      scope: (context.scope || 'ALL') as 'ALL' | 'TEAM' | 'ASSIGNED' | 'OWN_ENTERED',
      reportsToId: context.reports_to_id,
    };

    if (body.action === 'complete' || body.status === 'COMPLETED') {
      const updated = await evidenceService.completeActivity(
        userScopeContext,
        params.activityId,
        body.completion_notes || 'Activity completed successfully',
        body.completed_at
      );
      return NextResponse.json({ success: true, data: updated });
    }

    const updated = await evidenceService.updateActivity(
      userScopeContext,
      params.activityId,
      body
    );
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    const isForbidden = err.message?.includes('403 Forbidden');
    const isNotFound = err.message?.includes('404 Not Found');
    const status = isForbidden ? 403 : isNotFound ? 404 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
