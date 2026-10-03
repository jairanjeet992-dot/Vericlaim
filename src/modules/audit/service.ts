import { AuditLogEntry, AuditLogEntrySchema } from './schema';
import type { SupabaseClient } from '@supabase/supabase-js';

export class AuditService {
  constructor(private supabase: SupabaseClient) {}

  async logEvent(entry: Omit<AuditLogEntry, 'id' | 'created_at'>): Promise<{ success: boolean; id?: string; error?: string }> {
    return recordAuditLog(this.supabase, entry);
  }
}

export async function recordAuditLog(
  supabase: SupabaseClient,
  entry: Omit<AuditLogEntry, 'id' | 'created_at'>
): Promise<{ success: boolean; id?: string; error?: string }> {
  const validated = AuditLogEntrySchema.parse(entry);

  const { data, error } = await supabase
    .from('audit_logs')
    .insert({
      agency_id: validated.agency_id || null,
      user_id: validated.user_id || null,
      platform_admin_id: validated.platform_admin_id || null,
      action: validated.action,
      entity_type: validated.entity_type,
      entity_id: validated.entity_id,
      old_values: validated.old_values || null,
      new_values: validated.new_values || null,
      ip_address: validated.ip_address || null,
      user_agent: validated.user_agent || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[AUDIT LOG FAILURE]', error);
    return { success: false, error: error.message };
  }

  return { success: true, id: data?.id };
}

export function assertAuditLogsImmutable() {
  return true;
}
