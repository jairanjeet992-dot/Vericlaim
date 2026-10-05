import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import {
  SmartPasteInputSchema,
  SmartPasteParser,
  ExistingCaseSnapshot
} from '@/modules/migration';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rawBody = await req.json();
    const parsed = SmartPasteInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid smart paste input', details: parsed.error.format() }, { status: 400 });
    }

    const { raw_tsv_text, delimiter, has_headers } = parsed.data;

    const rows = SmartPasteParser.parsePastedText(raw_tsv_text, delimiter, has_headers);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data detected in pasted text' }, { status: 400 });
    }

    // Fetch existing cases for diff matching
    const { data: existingCases } = await supabase
      .from('cases')
      .select(`
        doc_code,
        claim_no,
        insured_name,
        outcome,
        total_investigator_cost,
        clients ( name )
      `)
      .eq('agency_id', context.agency_id);

    const existingMap = new Map<string, ExistingCaseSnapshot>();
    (existingCases || []).forEach((c: any) => {
      const snap: ExistingCaseSnapshot = {
        doc_code: c.doc_code,
        claim_no: c.claim_no,
        insured_name: c.insured_name,
        client_name: c.clients?.name || 'Unknown',
        investigators: [],
        total_payable: Number(c.total_investigator_cost || 0),
        outcome: c.outcome
      };
      if (c.doc_code) existingMap.set(c.doc_code.toUpperCase().trim(), snap);
      if (c.claim_no) existingMap.set(c.claim_no.toUpperCase().trim(), snap);
    });

    const diffPreview = SmartPasteParser.generateDiffPreview(rows, existingMap);

    return NextResponse.json({
      success: true,
      preview: diffPreview,
      parsed_rows: rows
    });
  } catch (err: any) {
    console.error('Smart paste preview error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
