import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { recordAuditLog } from '@/modules/audit/service';
import {
  LegacyCaseRow,
  CommitImportBatchSchema,
  EntityRegistry,
  EntityResolver,
  LegacyBatchImporter,
  ParityReconciliationEngine,
  normalizeEntityText
} from '@/modules/migration';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  if (context.scope !== 'ALL' && !userPerms.effective_permissions.includes('cases.create')) {
    return NextResponse.json({ error: 'Forbidden: Admin privilege required to commit legacy import' }, { status: 403 });
  }

  try {
    const rawBody = await req.json();
    const parsed = CommitImportBatchSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid commit parameters', details: parsed.error.format() }, { status: 400 });
    }

    const { batch_id, resolutions } = parsed.data;
    const rows: LegacyCaseRow[] = rawBody.rows || [];

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'Missing legacy rows dataset for commit execution' }, { status: 400 });
    }

    // 1. Process and persist approved entity resolutions
    const approvedMappings = new Map<string, string>(); // key -> target_id

    for (const res of resolutions) {
      let targetId = res.target_id;
      const norm = normalizeEntityText(res.raw_text);

      if (res.action === 'CREATE_NEW' && res.new_entity_name) {
        if (res.entity_type === 'CLIENT') {
          const { data: newClient } = await supabase.from('clients').insert({
            agency_id: context.agency_id,
            name: res.new_entity_name.trim(),
            created_by: context.id
          }).select('id').single();
          if (newClient) targetId = newClient.id;
        } else if (res.entity_type === 'INVESTIGATOR') {
          const { data: newInv } = await supabase.from('investigators').insert({
            agency_id: context.agency_id,
            full_name: res.new_entity_name.trim(),
            status: 'ACTIVE',
            created_by: context.id
          }).select('id').single();
          if (newInv) targetId = newInv.id;
        }
      }

      if (targetId) {
        const mappingKey = `${res.entity_type.toLowerCase()}:${norm}`;
        approvedMappings.set(mappingKey, targetId);

        // Cache in DB for future migrations
        await supabase.from('legacy_entity_mappings').upsert({
          agency_id: context.agency_id,
          entity_type: res.entity_type,
          raw_name: res.raw_text,
          normalized_name: norm,
          target_id: targetId,
          is_verified: true
        }, { onConflict: 'agency_id, entity_type, normalized_name' });
      }
    }

    // 2. Fetch full entity registry
    const [clientsRes, investigatorsRes, hospitalsRes, caseTypesRes, aliasesRes, termsRes] = await Promise.all([
      supabase.from('clients').select('id, name').eq('agency_id', context.agency_id),
      supabase.from('investigators').select('id, full_name').eq('agency_id', context.agency_id),
      supabase.from('hospitals').select('id, name').eq('agency_id', context.agency_id),
      supabase.from('agency_case_types').select('id, name').eq('agency_id', context.agency_id),
      supabase.from('legacy_entity_mappings').select('raw_name, normalized_name, target_id').eq('agency_id', context.agency_id),
      supabase.from('investigator_payment_terms').select('investigator_id, payment_type, base_salary, effective_from').eq('agency_id', context.agency_id)
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

    // Populate approved mappings into customAliases
    approvedMappings.forEach((val, key) => {
      const parts = key.split(':');
      if (parts.length === 2) {
        customAliases.set(parts[1], val);
      }
    });

    const termsMap = new Map();
    (termsRes.data || []).forEach(t => {
      termsMap.set(t.investigator_id, {
        payment_type: t.payment_type,
        salary_amount: t.base_salary,
        payment_type_changed_at: t.effective_from
      });
    });

    const resolver = new EntityResolver(registry, customAliases);
    const importer = new LegacyBatchImporter(context.agency_id, batch_id, resolver, termsMap);

    const { validRecords, skippedRows } = importer.transformRows(rows, approvedMappings);

    if (skippedRows.length > 0) {
      return NextResponse.json({
        error: `Cannot commit: ${skippedRows.length} rows contain unresolved entities. All entities must be resolved before commit.`,
        skipped_rows: skippedRows
      }, { status: 400 });
    }

    // 3. Persist imported records into Database
    // Insert Cases
    const casesToInsert = validRecords.map(vr => ({
      id: vr.id.startsWith('mig_case_') ? undefined : vr.id,
      agency_id: vr.agency_id,
      import_batch_id: vr.import_batch_id,
      legacy_id: vr.legacy_id,
      doc_code: vr.doc_code,
      claim_no: vr.claim_no,
      policy_no: vr.policy_no,
      insured_name: vr.insured_name,
      client_id: vr.client_id,
      location: vr.location,
      outcome: vr.outcome,
      status: vr.outcome && vr.outcome !== 'Pending' ? 'CLOSED' : 'ALLOCATED',
      allocated_at: vr.allocated_at,
      sla_hours: vr.sla_hours,
      sla_due_date: vr.sla_due_date,
      completed_at: vr.completed_at,
      risk_level: vr.risk_level,
      exception_type: vr.exception_type,
      exception_reason: vr.exception_reason,
      total_investigator_cost: vr.total_investigator_cost,
      owner_manager_id: context.id,
      created_by: context.id
    }));

    // Batch upsert cases
    const { data: insertedCases, error: casesError } = await supabase
      .from('cases')
      .upsert(casesToInsert, { onConflict: 'agency_id, doc_code' })
      .select('id, doc_code');

    if (casesError) {
      console.error('Failed to insert cases:', casesError);
      return NextResponse.json({ error: `Database error inserting cases: ${casesError.message}` }, { status: 500 });
    }

    const docCodeToCaseId = new Map<string, string>();
    (insertedCases || []).forEach(c => docCodeToCaseId.set(c.doc_code, c.id));

    // Insert Case Investigators (Multi-Investigator N Rows)
    const invRowsToInsert: any[] = [];
    for (const vr of validRecords) {
      const realCaseId = docCodeToCaseId.get(vr.doc_code) || vr.id;
      for (const inv of vr.investigators) {
        invRowsToInsert.push({
          agency_id: context.agency_id,
          case_id: realCaseId,
          investigator_id: inv.investigator_id,
          agreed_fee: inv.agreed_fee,
          travel_allowance: inv.travel_allowance,
          payout_status: inv.payout_status,
          import_batch_id: vr.import_batch_id,
          assigned_at: vr.allocated_at || new Date().toISOString()
        });
      }
    }

    if (invRowsToInsert.length > 0) {
      const { error: invError } = await supabase
        .from('case_investigators')
        .insert(invRowsToInsert);
      if (invError) {
        console.warn('Case investigators insert warning:', invError.message);
      }
    }

    // 4. Generate Authoritative Parity Reconciliation Report
    const reconciliationReport = ParityReconciliationEngine.generateReport(
      batch_id,
      rows,
      validRecords
    );

    // 5. Update import_batches record to COMMITTED
    await supabase.from('import_batches').update({
      status: 'COMMITTED',
      imported_cases_count: validRecords.length,
      imported_investigators_count: invRowsToInsert.length,
      reconciliation_report: reconciliationReport,
      is_approved: true,
      approved_by: context.id,
      approved_at: new Date().toISOString(),
      committed_at: new Date().toISOString()
    }).eq('id', batch_id);

    // 6. Record Audit Log
    await recordAuditLog(supabase, {
      agency_id: context.agency_id,
      user_id: context.id,
      action: 'MIGRATION_BATCH_COMMITTED',
      entity_type: 'import_batch',
      entity_id: batch_id,
      new_values: {
        total_rows: rows.length,
        imported_cases: validRecords.length,
        investigators_assigned: invRowsToInsert.length,
        is_parity_achieved: reconciliationReport.is_parity_achieved
      }
    });

    return NextResponse.json({
      success: true,
      batch_id,
      imported_cases_count: validRecords.length,
      imported_investigators_count: invRowsToInsert.length,
      reconciliation_report: reconciliationReport
    });
  } catch (err: any) {
    console.error('Migration commit error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
