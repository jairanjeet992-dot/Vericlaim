import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { ExportService, ExportRequestSchema, ExportColumnDef } from '@/modules/reports';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const parsed = ExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid export parameters', details: parsed.error.format() }, { status: 400 });
  }

  const { export_type, format, filter_params } = parsed.data;
  const exportService = new ExportService(supabase);
  const ipAddress = req.headers.get('x-forwarded-for') || req.ip || '127.0.0.1';

  try {
    // 1. Prepare Data based on export_type
    let title = 'Report Export';
    let columns: ExportColumnDef[] = [];
    let rows: Record<string, any>[] = [];
    let summaryRow: Record<string, any> | undefined;

    if (export_type === 'CASES_LIST') {
      title = 'Cases List Export';
      columns = [
        { header: 'Doc Code', key: 'doc_code', width: 14 },
        { header: 'Claim No', key: 'claim_no', width: 18 },
        { header: 'Policy No', key: 'policy_no', width: 16 },
        { header: 'Insured Name', key: 'insured_name', width: 24 },
        { header: 'City', key: 'location_city', width: 16 },
        { header: 'State', key: 'location_state', width: 16 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Outcome', key: 'outcome', width: 14 },
        { header: 'Created Date', key: 'created_at', width: 14, format: 'date' },
      ];

      const { data: casesData } = await supabase
        .from('cases')
        .select('*')
        .eq('agency_id', context.agency_id)
        .order('created_at', { ascending: false })
        .limit(1000);

      rows = casesData || [];
    } else if (export_type === 'INVOICES_LIST') {
      title = 'Invoices List Export';
      columns = [
        { header: 'Invoice Number', key: 'invoice_number', width: 18 },
        { header: 'Financial Year', key: 'financial_year', width: 14 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Taxable Base (₹)', key: 'taxable_amount', width: 18, format: 'currency' },
        { header: 'CGST (₹)', key: 'cgst_amount', width: 14, format: 'currency' },
        { header: 'SGST (₹)', key: 'sgst_amount', width: 14, format: 'currency' },
        { header: 'IGST (₹)', key: 'igst_amount', width: 14, format: 'currency' },
        { header: 'Total Gross (₹)', key: 'total_amount', width: 18, format: 'currency' },
        { header: 'Outstanding (₹)', key: 'outstanding_amount', width: 18, format: 'currency' },
        { header: 'Issue Date', key: 'issue_date', width: 14, format: 'date' },
      ];

      const { data: invoicesData } = await supabase
        .from('invoices')
        .select('*')
        .eq('agency_id', context.agency_id)
        .order('issue_date', { ascending: false });

      rows = invoicesData || [];
    } else if (export_type === 'PAYMENTS_LIST') {
      title = 'Client Payments Export';
      columns = [
        { header: 'UTR Number', key: 'utr_number', width: 22 },
        { header: 'Payment Date', key: 'payment_date', width: 14, format: 'date' },
        { header: 'Bank Name', key: 'bank_name', width: 20 },
        { header: 'Payment Mode', key: 'payment_mode', width: 14 },
        { header: 'Remitted Amount (₹)', key: 'amount', width: 20, format: 'currency' },
        { header: 'Unapplied Cash (₹)', key: 'unapplied_amount', width: 20, format: 'currency' },
      ];

      const { data: paymentsData } = await supabase
        .from('client_payments')
        .select('*')
        .eq('agency_id', context.agency_id)
        .order('payment_date', { ascending: false });

      rows = paymentsData || [];
    } else {
      // Default summary export
      title = `${export_type} Summary Export`;
      columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 },
      ];
      rows = [
        { metric: 'Agency Exported', value: context.agency_id },
        { metric: 'Timestamp', value: new Date().toISOString() },
      ];
    }

    // 2. Perform permission-gated, scope-filtered export
    const exportResult = await exportService.export({
      agency_id: context.agency_id,
      user_id: context.id,
      user_permissions: userPerms.effective_permissions,
      user_scope: context.scope,
      subordinate_user_ids: [],
      export_type,
      format,
      filter_params,
      ip_address: ipAddress,
      data: {
        title,
        columns,
        rows,
        summaryRow,
      },
    });

    return new NextResponse(new Uint8Array(exportResult.buffer), {
      status: 200,
      headers: {
        'Content-Type': exportResult.mime_type,
        'Content-Disposition': `attachment; filename="${exportResult.filename}"`,
        'X-Export-SHA256': exportResult.sha256,
        'X-Export-Row-Count': String(exportResult.row_count),
        'X-Export-Log-Id': exportResult.log_id,
      },
    });
  } catch (err: any) {
    if (err.message.includes('Unauthorized')) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
