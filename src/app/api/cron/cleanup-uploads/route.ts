import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { EvidenceService } from '@/modules/evidence/service';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const searchParams = req.nextUrl.searchParams;
  const hours = parseInt(searchParams.get('hours') || '2', 10);

  try {
    const evidenceService = new EvidenceService(supabase);
    const result = await evidenceService.cleanupStalePendingUploads(hours);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
