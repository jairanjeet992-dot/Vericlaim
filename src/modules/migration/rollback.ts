import { SupabaseClient } from '@supabase/supabase-js';

export interface RollbackResult {
  success: boolean;
  batch_id: string;
  deleted_cases: number;
  deleted_invoices: number;
  deleted_payments: number;
  deleted_allocations: number;
  message: string;
}

/**
 * Executes atomic server-side batch rollback via Postgres stored function.
 * Strictly DB-based — zero reliance on browser localStorage.
 */
export async function rollbackImportBatch(
  supabase: SupabaseClient,
  batchId: string,
  userId: string,
  reason: string
): Promise<RollbackResult> {
  if (!reason || reason.trim().length < 5) {
    throw new Error('Mandatory rollback reason (minimum 5 characters) is required.');
  }

  const { data, error } = await supabase.rpc('rollback_import_batch', {
    p_batch_id: batchId,
    p_user_id: userId,
    p_reason: reason.trim()
  });

  if (error) {
    throw new Error(`Rollback failed: ${error.message}`);
  }

  return {
    success: true,
    batch_id: batchId,
    deleted_cases: data?.deleted_cases || 0,
    deleted_invoices: data?.deleted_invoices || 0,
    deleted_payments: data?.deleted_payments || 0,
    deleted_allocations: data?.deleted_allocations || 0,
    message: data?.message || 'Import batch rolled back cleanly.'
  };
}
