import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { EvidenceService } from '@/modules/evidence/service';

export async function POST(req: NextRequest) {
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

    const res = await evidenceService.initUpload(userScopeContext, body);
    return NextResponse.json({ success: true, ...res }, { status: 201 });
  } catch (err: any) {
    const isForbidden = err.message?.includes('403 Forbidden');
    return NextResponse.json(
      { error: err.message },
      { status: isForbidden ? 403 : 400 }
    );
  }
}
