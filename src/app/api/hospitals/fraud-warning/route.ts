import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { calculateHospitalRiskProfile, generateDispatchWarning } from '@/modules/scorecard/hospital-fraud-engine';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const hospitalName = searchParams.get('hospital_name');
  if (!hospitalName || hospitalName.trim().length === 0) {
    return NextResponse.json({ error: 'hospital_name parameter is required' }, { status: 400 });
  }

  try {
    const { data: profile } = await supabase
      .from('hospital_profiles')
      .select('*')
      .eq('agency_id', context.agency_id)
      .ilike('hospital_name', hospitalName.trim())
      .maybeSingle();

    if (!profile) {
      // Return safe defaults for unrated/new hospitals
      return NextResponse.json({
        profile: {
          hospital_name: hospitalName,
          risk_level: 'LOW',
          fraud_rate_percent: 0,
          total_cases: 0,
        },
        warning: {
          should_warn: false,
          severity: 'NONE',
          hospital_name: hospitalName,
          warning_title: 'NORMAL',
          warning_message: 'Hospital has no adverse history recorded.',
          requires_manager_override: false,
          recommended_actions: [],
        },
      });
    }

    const riskProfile = calculateHospitalRiskProfile({
      hospital_name: profile.hospital_name,
      city: profile.city,
      total_cases: profile.total_cases,
      fraud_cases: profile.fraud_cases,
      suspicious_cases: profile.suspicious_cases,
      genuine_cases: profile.genuine_cases,
      is_blacklisted: profile.is_blacklisted,
    });

    const warning = generateDispatchWarning(riskProfile);

    return NextResponse.json({
      profile: riskProfile,
      warning,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
