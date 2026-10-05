import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { RollbackBatchSchema, rollbackImportBatch } from '@/modules/migration';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  // Rollback requires Admin or Owner
  if (context.scope !== 'ALL') {
    return NextResponse.json({ error: 'Forbidden: Admin scope required for migration rollback' }, { status: 403 });
  }

  try {
    const rawBody = await req.json();
    const parsed = RollbackBatchSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid rollback parameters', details: parsed.error.format() }, { status: 400 });
    }

    const { batch_id, reason } = parsed.data;

    // Verify batch belongs to agency
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .select('id, agency_id, status, batch_number')
      .eq('id', batch_id)
      .eq('agency_id', context.agency_id)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: 'Batch not found in this agency' }, { status: 404 });
    }

    if (batch.status === 'ROLLED_BACK') {
      return NextResponse.json({ error: 'Batch has already been rolled back' }, { status: 400 });
    }

    // Execute atomic stored procedure rollback
    const result = await rollbackImportBatch(supabase, batch_id, context.id, reason);

    return NextResponse.json({
      batch_number: batch.batch_number,
      ...result
    });
  } catch (err: any) {
    console.error('Batch rollback error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
