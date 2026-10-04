import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { generateBankBulkPaymentExcel } from '@/modules/investigators/excel-export';
import { CompiledPayoutBatch } from '@/modules/investigators/investigator-types';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // 1. Fetch batch
    const { data: batch, error: bErr } = await supabase
      .from('payout_batches')
      .select('*')
      .eq('id', params.id)
      .eq('agency_id', context.agency_id)
      .single();

    if (bErr || !batch) {
      return NextResponse.json({ error: 'Payout batch not found' }, { status: 404 });
    }

    // 2. Fetch payouts
    const { data: payouts, error: pErr } = await supabase
      .from('investigator_payouts')
      .select('*, investigator:investigators(id, code, full_name, pan_blind_index)')
      .eq('batch_id', params.id)
      .eq('agency_id', context.agency_id);

    if (pErr) throw pErr;

    const compiledBatch: CompiledPayoutBatch = {
      batch_number: batch.batch_number,
      payout_month: batch.payout_month,
      total_investigators: batch.total_investigators,
      total_gross: Number(batch.total_gross),
      total_tds: Number(batch.total_tds),
      total_advances_deducted: Number(batch.total_advances_deducted),
      total_net_disbursable: Number(batch.total_net_disbursable),
      payouts: (payouts || []).map(p => ({
        investigator_id: p.investigator_id,
        investigator_name: p.investigator?.full_name || 'Investigator',
        payment_type: p.payment_type,
        payout_month: p.payout_month,
        base_salary_or_fee: Number(p.base_salary_or_fee),
        total_case_fees: Number(p.total_case_fees),
        total_expenses: Number(p.total_expenses),
        total_bonuses: Number(p.total_bonuses),
        total_advances_deducted: Number(p.total_advances_deducted),
        total_deductions: Number(p.total_deductions),
        gross_payable: Number(p.gross_payable),
        tds_section: p.tds_section,
        tds_rate: Number(p.tds_rate),
        tds_amount: Number(p.tds_amount),
        net_payable: Number(p.net_payable),
        bank_name: p.bank_name || 'Primary Bank',
        account_number: p.account_number || '1234567890',
        ifsc_code: p.ifsc_code || 'HDFC0001234',
        pan_number: p.pan_number || 'ABCDE1234F',
        items: [],
      })),
    };

    const excelResult = await generateBankBulkPaymentExcel(compiledBatch);

    if (!excelResult.matches_db_total) {
      return NextResponse.json({
        error: 'Integrity Violation: Excel column total does not match DB batch net amount',
      }, { status: 500 });
    }

    return new NextResponse(new Uint8Array(excelResult.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="payout-${batch.batch_number}.xlsx"`,
        'X-Content-SHA256': excelResult.sha256,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
