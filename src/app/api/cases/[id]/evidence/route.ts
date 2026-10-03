import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { EvidenceService } from '@/modules/evidence/service';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'User context not found' }, { status: 404 });

  try {
    const searchParams = req.nextUrl.searchParams;
    const category = searchParams.get('category') as any;
    const activityId = searchParams.get('activity_id') || undefined;
    const status = searchParams.get('status') as any;

    const evidenceService = new EvidenceService(supabase);
    const userScopeContext = {
      agencyId: context.agency_id,
      userId: context.id,
      scope: (context.scope || 'ALL') as 'ALL' | 'TEAM' | 'ASSIGNED' | 'OWN_ENTERED',
      reportsToId: context.reports_to_id,
    };

    const documents = await evidenceService.listDocumentsForCase(
      userScopeContext,
      params.id,
      {
        category,
        activity_id: activityId,
        status,
      }
    );

    return NextResponse.json({ success: true, data: documents });
  } catch (err: any) {
    const isForbidden = err.message?.includes('403 Forbidden');
    return NextResponse.json(
      { error: err.message },
      { status: isForbidden ? 403 : 400 }
    );
  }
}
