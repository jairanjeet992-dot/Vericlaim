import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import {
  calculateFinancialMetrics,
  InvoiceReportingRecord,
  PaymentReportingRecord,
  DirectCostReportingRecord,
} from '@/modules/reports';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  const overhead = Number(searchParams.get('overhead') || '0');

  try {
    // 1. Fetch Invoices
    let invQuery = supabase
      .from('invoices')
      .select('id, agency_id, invoice_number, status, issue_date, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, outstanding_amount')
      .eq('agency_id', context.agency_id);

    if (startDate) invQuery = invQuery.gte('issue_date', startDate);
    if (endDate) invQuery = invQuery.lte('issue_date', endDate);

    const { data: invoices, error: invErr } = await invQuery;
    if (invErr) throw invErr;

    // 2. Fetch Payments
    let payQuery = supabase
      .from('client_payments')
      .select('id, agency_id, amount, unapplied_amount, payment_date')
      .eq('agency_id', context.agency_id);

    if (startDate) payQuery = payQuery.gte('payment_date', startDate);
    if (endDate) payQuery = payQuery.lte('payment_date', endDate);

    const { data: payments, error: payErr } = await payQuery;
    if (payErr) throw payErr;

    // 3. Fetch Direct Costs (Investigator case fees & approved expenses)
    const { data: expenseRows } = await supabase
      .from('investigator_expenses')
      .select('investigator_id, amount')
      .eq('agency_id', context.agency_id)
      .in('status', ['APPROVED', 'IN_PAYOUT', 'PAID']);

    const directCosts: DirectCostReportingRecord[] = (expenseRows || []).map((e) => ({
      investigator_id: e.investigator_id,
      case_fees_payable: 0,
      approved_expenses: e.amount,
    }));

    // 4. Compute financial metrics with statutory GST separation
    const metrics = calculateFinancialMetrics(
      (invoices || []) as InvoiceReportingRecord[],
      (payments || []) as PaymentReportingRecord[],
      directCosts,
      overhead
    );

    return NextResponse.json({ success: true, data: metrics });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
