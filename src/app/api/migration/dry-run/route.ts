import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import {
  LegacyCaseRow,
  LegacyImportValidator,
  EntityResolver,
  EntityRegistry,
  SmartPasteParser
} from '@/modules/migration';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  // Migration dry-run requires manager or admin level
  if (context.scope !== 'ALL' && !userPerms.effective_permissions.includes('cases.create')) {
    return NextResponse.json({ error: 'Forbidden: Insufficient privileges for migration dry-run' }, { status: 403 });
  }

  try {
    const body = await req.json();
    let rows: LegacyCaseRow[] = [];
    const sourceType = body.source_type || 'DNA_LEGACY_JSON';

    if (Array.isArray(body.rows)) {
      rows = body.rows;
    } else if (typeof body.raw_tsv === 'string') {
      rows = SmartPasteParser.parsePastedText(body.raw_tsv, body.delimiter || '\t', body.has_headers ?? true);
    } else {
      return NextResponse.json({ error: 'Invalid input: Expected array of rows or raw_tsv string' }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data rows found for dry-run analysis' }, { status: 400 });
    }

    // 1. Fetch registry entities for tenant
    const [clientsRes, investigatorsRes, hospitalsRes, caseTypesRes, aliasesRes, casesRes] = await Promise.all([
      supabase.from('clients').select('id, name').eq('agency_id', context.agency_id),
      supabase.from('investigators').select('id, full_name').eq('agency_id', context.agency_id),
      supabase.from('hospitals').select('id, name').eq('agency_id', context.agency_id),
      supabase.from('agency_case_types').select('id, name').eq('agency_id', context.agency_id),
      supabase.from('legacy_entity_mappings').select('raw_name, normalized_name, target_id').eq('agency_id', context.agency_id),
      supabase.from('cases').select('doc_code, claim_no, client_id').eq('agency_id', context.agency_id)
    ]);

    const registry: EntityRegistry = {
      clients: (clientsRes.data || []).map(c => ({ id: c.id, name: c.name })),
      investigators: (investigatorsRes.data || []).map(i => ({ id: i.id, name: i.full_name })),
      hospitals: (hospitalsRes.data || []).map(h => ({ id: h.id, name: h.name })),
      caseTypes: (caseTypesRes.data || []).map(ct => ({ id: ct.id, name: ct.name }))
    };

    const customAliases = new Map<string, string>();
    (aliasesRes.data || []).forEach(a => {
      customAliases.set(a.normalized_name, a.target_id);
    });

    const existingDocCodes = (casesRes.data || []).map(c => c.doc_code);
    const existingClaimKeys = (casesRes.data || []).map(c => `${c.client_id}:::${c.claim_no}`);

    const resolver = new EntityResolver(registry, customAliases);
    const validator = new LegacyImportValidator(existingClaimKeys, existingDocCodes);

    const batchNumber = `BATCH-${new Date().toISOString().replace(/[^\d]/g, '').slice(0, 14)}`;
    const batchId = crypto.randomUUID();

    const validationResult = validator.validateBatch(
      rows,
      context.agency_id,
      batchId,
      resolver
    );

    // Save batch record as DRY_RUN in DB
    const { error: insertError } = await supabase.from('import_batches').insert({
      id: batchId,
      agency_id: context.agency_id,
      batch_number: batchNumber,
      source_type: sourceType,
      status: validationResult.is_valid ? 'VALIDATED' : 'DRY_RUN',
      total_rows: rows.length,
      unresolved_entities_count: validationResult.unresolved_report.exceptions.length,
      error_count: validationResult.error_count,
      dry_run_summary: {
        total_rows: validationResult.total_rows,
        valid_rows_count: validationResult.valid_rows_count,
        error_count: validationResult.error_count,
        warning_count: validationResult.warning_count,
        errors: validationResult.errors
      },
      unresolved_report: validationResult.unresolved_report,
      created_by: context.id
    });

    if (insertError) {
      console.error('Failed to create import_batches record:', insertError);
    }

    return NextResponse.json({
      success: true,
      batch_id: batchId,
      batch_number: batchNumber,
      validation_result: validationResult
    });
  } catch (err: any) {
    console.error('Dry-run migration error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
