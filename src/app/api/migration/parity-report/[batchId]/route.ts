import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';

export async function GET(
  req: NextRequest,
  { params }: { params: { batchId: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { batchId } = params;

  try {
    const { data: batch, error } = await supabase
      .from('import_batches')
      .select('*')
      .eq('id', batchId)
      .eq('agency_id', context.agency_id)
      .single();

    if (error || !batch) {
      return NextResponse.json({ error: 'Batch not found in this agency' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      batch_id: batch.id,
      batch_number: batch.batch_number,
      status: batch.status,
      report: batch.reconciliation_report || null,
      summary: batch.dry_run_summary || null,
      unresolved_report: batch.unresolved_report || null
    });
  } catch (err: any) {
    console.error('Parity report retrieval error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
