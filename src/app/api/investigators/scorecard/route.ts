import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { 
  calculateInvestigatorScorecard, 
  DEFAULT_SCORECARD_WEIGHTS, 
  ScorecardWeights 
} from '@/modules/scorecard/scorecard-engine';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const investigatorId = searchParams.get('investigator_id');

  try {
    // 1. Fetch scorecard weights
    const { data: config } = await supabase
      .from('investigator_scorecard_configs')
      .select('*')
      .eq('agency_id', context.agency_id)
      .single();

    const weights: ScorecardWeights = config ? {
      tat_weight: Number(config.tat_weight),
      fraud_rate_weight: Number(config.fraud_rate_weight),
      quality_weight: Number(config.quality_weight),
      volume_weight: Number(config.volume_weight),
    } : DEFAULT_SCORECARD_WEIGHTS;

    // 2. Fetch investigators
    let invQuery = supabase
      .from('investigators')
      .select('id, code, full_name')
      .eq('agency_id', context.agency_id)
      .eq('is_active', true);

    if (investigatorId) {
      invQuery = invQuery.eq('id', investigatorId);
    }

    const { data: investigators, error: invErr } = await invQuery;
    if (invErr) throw invErr;

    // 3. For each investigator, calculate stats and scorecard
    const scorecards = [];
    for (const inv of investigators || []) {
      // Fetch case assignments
      const { data: assignments } = await supabase
        .from('case_investigators')
        .select('*, case:cases(id, case_number, status, outcome_code)')
        .eq('agency_id', context.agency_id)
        .eq('investigator_id', inv.id);

      const totalAssigned = assignments?.length || 0;
      const totalCompleted = assignments?.filter(a => ['COMPLETED', 'PAID', 'IN_PAYOUT'].includes(a.payout_status) || a.case?.status === 'CLOSED').length || 0;
      
      const fraudDetected = assignments?.filter(a => a.case?.outcome_code === 'FRAUD').length || 0;
      const suspiciousDetected = assignments?.filter(a => a.case?.outcome_code === 'SUSPICIOUS').length || 0;

      // Mock or fetch rework cycles count
      const { count: reworkCount } = await supabase
        .from('rework_cycles')
        .select('*', { count: 'exact', head: true })
        .eq('agency_id', context.agency_id)
        .eq('target_user_id', inv.id);

      const firstPassApproved = Math.max(0, totalCompleted - (reworkCount || 0));

      const scorecard = calculateInvestigatorScorecard({
        total_assigned: totalAssigned,
        total_completed: totalCompleted,
        completed_within_sla: Math.round(totalCompleted * 0.9), // 90% SLA baseline or real
        fraud_detected_count: fraudDetected,
        suspicious_detected_count: suspiciousDetected,
        first_pass_approved_count: firstPassApproved,
        total_rework_cycles: reworkCount || 0,
        target_monthly_capacity: 15,
      }, weights);

      scorecards.push({
        investigator: inv,
        scorecard,
      });
    }

    return NextResponse.json({ scorecards });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
