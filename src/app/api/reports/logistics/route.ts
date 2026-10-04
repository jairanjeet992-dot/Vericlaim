import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import {
  calculatePhysicalLogisticsMetrics,
  PacketReportingRecord,
  DocketReportingRecord,
} from '@/modules/reports';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // 1. Fetch Hardcopy Packets
    const { data: packets, error: packErr } = await supabase
      .from('hardcopy_packets')
      .select('id, status, inwarded_at, delivered_at')
      .eq('agency_id', context.agency_id);
    if (packErr) throw packErr;

    // 2. Fetch Courier Dockets
    const { data: dockets, error: dockErr } = await supabase
      .from('courier_dockets')
      .select('id, courier_partner, delivery_status, dispatched_at, delivered_at')
      .eq('agency_id', context.agency_id);
    if (dockErr) throw dockErr;

    // 3. Compute physical logistics metrics
    const metrics = calculatePhysicalLogisticsMetrics(
      (packets || []) as PacketReportingRecord[],
      (dockets || []) as DocketReportingRecord[]
    );

    return NextResponse.json({ success: true, data: metrics });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
