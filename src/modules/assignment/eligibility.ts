/**
 * Pure Eligibility Ranking Engine for Field Investigators
 * PHASE 4B: Location, availability, workload, specialization, SLA, cluster distance
 * Zero DB / UI imports - 100% pure unit testable
 */

export interface InvestigatorCandidate {
  id: string;
  code: string;
  full_name: string;
  phone: string;
  email?: string | null;
  state: string;
  district: string;
  city: string;
  pincodes: string[];
  radius_km: number;
  is_available: boolean;
  is_active: boolean;
  max_active_cases: number;
  current_active_cases: number;
  specializations: string[];
  case_types: string[];
  existing_case_pincodes_today?: string[];
  existing_case_cities_today?: string[];
}

export interface CaseEligibilityContext {
  id: string;
  claim_no: string;
  case_type_code: string;
  location_state?: string | null;
  location_city?: string | null;
  location_pincode?: string | null;
  hospital_city?: string | null;
  hospital_pincode?: string | null;
  risk_level?: string;
  due_date?: string | null;
}

export interface EligibilityScoreBreakdown {
  location_score: number;       // 0 to 35
  workload_score: number;       // 0 to 25
  specialization_score: number; // 0 to 20
  cluster_score: number;        // 0 to 10
  sla_rating_score: number;     // 0 to 10
}

export interface RankedInvestigator {
  investigator: InvestigatorCandidate;
  total_score: number;
  rank: number;
  is_eligible: boolean;
  is_available: boolean;
  is_overloaded: boolean;
  breakdown: EligibilityScoreBreakdown;
  recommendation_reason: string;
  warnings: string[];
}

export function rankInvestigatorsForCase(
  candidates: InvestigatorCandidate[],
  caseCtx: CaseEligibilityContext
): RankedInvestigator[] {
  const ranked = candidates.map((inv) => {
    const warnings: string[] = [];
    let locationScore = 0;
    let workloadScore = 0;
    let specializationScore = 0;
    let clusterScore = 0;
    const slaScore = 10; // Baseline SLA adherence score

    const targetCity = (caseCtx.location_city || caseCtx.hospital_city || '').trim().toLowerCase();
    const targetState = (caseCtx.location_state || '').trim().toLowerCase();
    const targetPincode = (caseCtx.location_pincode || caseCtx.hospital_pincode || '').trim();

    // 1. Location Matching (Max 35 points)
    const invPincodes = (inv.pincodes || []).map((p) => p.trim());
    const invCity = (inv.city || '').trim().toLowerCase();
    const invState = (inv.state || '').trim().toLowerCase();

    if (targetPincode && invPincodes.includes(targetPincode)) {
      locationScore = 35;
    } else if (targetCity && invCity && (invCity === targetCity || targetCity.includes(invCity))) {
      locationScore = 25;
    } else if (targetState && invState && invState === targetState) {
      locationScore = 10;
      warnings.push(`Outside primary city (${inv.city}), state match only`);
    } else {
      locationScore = 0;
      warnings.push(`Outside primary coverage territory`);
    }

    // 2. Availability & Workload (Max 25 points)
    const isAvailable = inv.is_available && inv.is_active;
    const isOverloaded = inv.current_active_cases >= inv.max_active_cases;

    if (!isAvailable) {
      workloadScore = 0;
      warnings.push('Investigator marked unavailable or inactive');
    } else if (isOverloaded) {
      workloadScore = 0;
      warnings.push(`Capacity exceeded (${inv.current_active_cases}/${inv.max_active_cases} active cases)`);
    } else {
      const remainingSlots = inv.max_active_cases - inv.current_active_cases;
      const ratio = remainingSlots / inv.max_active_cases;
      workloadScore = Math.round(ratio * 25);
      if (ratio < 0.25) {
        warnings.push(`Near capacity limit (${inv.current_active_cases}/${inv.max_active_cases} cases)`);
      }
    }

    // 3. Specialization & Case Type (Max 20 points)
    const invCaseTypes = (inv.case_types || []).map((c) => c.toUpperCase());
    const targetCaseType = (caseCtx.case_type_code || '').toUpperCase();
    if (invCaseTypes.includes(targetCaseType) || invCaseTypes.includes('ALL')) {
      specializationScore += 10;
    } else {
      warnings.push(`Not tagged for case type '${caseCtx.case_type_code}'`);
    }

    const invSpecs = (inv.specializations || []).map((s) => s.toUpperCase());
    if (caseCtx.risk_level === 'CRITICAL' || caseCtx.risk_level === 'HIGH') {
      if (invSpecs.includes('FRAUD') || invSpecs.includes('MEDICO-LEGAL') || invSpecs.includes('COMPLEX')) {
        specializationScore += 10;
      }
    } else {
      specializationScore += 10; // Standard match
    }

    // 4. Cluster / Proximity to existing cases today (Max 10 points)
    if (targetPincode && inv.existing_case_pincodes_today?.includes(targetPincode)) {
      clusterScore = 10;
    } else if (targetCity && inv.existing_case_cities_today?.map((c) => c.toLowerCase()).includes(targetCity)) {
      clusterScore = 5;
    }

    const totalScore = locationScore + workloadScore + specializationScore + clusterScore + slaScore;
    const isEligible = isAvailable && !isOverloaded && locationScore >= 10;

    let recommendationReason = 'Standard match for assignment.';
    if (locationScore === 35 && workloadScore >= 15 && clusterScore > 0) {
      recommendationReason = 'Optimal candidate: Exact pincode coverage, available capacity, and active area cluster.';
    } else if (locationScore === 35) {
      recommendationReason = 'High priority: Direct pincode coverage.';
    } else if (locationScore === 25) {
      recommendationReason = 'Good candidate: City-level coverage match.';
    } else if (!isEligible) {
      recommendationReason = 'Not recommended: Requires manual supervisor override.';
    }

    return {
      investigator: inv,
      total_score: totalScore,
      rank: 1, // Will be set after sorting
      is_eligible: isEligible,
      is_available: isAvailable,
      is_overloaded: isOverloaded,
      breakdown: {
        location_score: locationScore,
        workload_score: workloadScore,
        specialization_score: specializationScore,
        cluster_score: clusterScore,
        sla_rating_score: slaScore,
      },
      recommendation_reason: recommendationReason,
      warnings,
    };
  });

  // Sort descending by total_score, then ascending by current_active_cases (load balancing)
  ranked.sort((a, b) => {
    if (b.total_score !== a.total_score) {
      return b.total_score - a.total_score;
    }
    return a.investigator.current_active_cases - b.investigator.current_active_cases;
  });

  // Set 1-indexed ranks
  ranked.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  return ranked;
}
