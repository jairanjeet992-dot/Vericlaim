import { ScorecardTier } from '../investigators/investigator-types';

export interface ScorecardWeights {
  tat_weight: number; // default 35
  fraud_rate_weight: number; // default 25
  quality_weight: number; // default 25
  volume_weight: number; // default 15
}

export const DEFAULT_SCORECARD_WEIGHTS: ScorecardWeights = {
  tat_weight: 35.0,
  fraud_rate_weight: 25.0,
  quality_weight: 25.0,
  volume_weight: 15.0,
};

export interface InvestigatorPerformanceStats {
  total_assigned: number;
  total_completed: number;
  completed_within_sla: number;
  fraud_detected_count: number;
  suspicious_detected_count: number;
  first_pass_approved_count: number;
  total_rework_cycles: number;
  target_monthly_capacity?: number;
}

export interface ScorecardEvaluationResult {
  tat_score: number; // 0 - 100
  fraud_score: number; // 0 - 100
  quality_score: number; // 0 - 100
  volume_score: number; // 0 - 100
  composite_score: number; // 0 - 100
  tier: ScorecardTier;
  weights: ScorecardWeights;
  metrics_summary: {
    sla_compliance_rate: number;
    detection_rate: number;
    first_pass_approval_rate: number;
    average_reworks_per_case: number;
  };
}

/**
 * Calculates performance tier based on composite score:
 * >= 85: ELITE
 * >= 70: PROFICIENT
 * >= 50: AVERAGE
 * < 50:  NEEDS_IMPROVEMENT
 */
export function resolveScorecardTier(score: number): ScorecardTier {
  if (score >= 85.0) return 'ELITE';
  if (score >= 70.0) return 'PROFICIENT';
  if (score >= 50.0) return 'AVERAGE';
  return 'NEEDS_IMPROVEMENT';
}

/**
 * Pure scorecard evaluation engine implementing Rule A12 weighted scoring model.
 */
export function calculateInvestigatorScorecard(
  stats: InvestigatorPerformanceStats,
  weights: ScorecardWeights = DEFAULT_SCORECARD_WEIGHTS
): ScorecardEvaluationResult {
  const totalCompleted = stats.total_completed;

  // 1. TAT Score: % of cases completed within SLA
  let tatScore = 0;
  let slaComplianceRate = 0;
  if (totalCompleted > 0) {
    slaComplianceRate = Number(((stats.completed_within_sla / totalCompleted) * 100).toFixed(2));
    tatScore = Math.min(100, Math.max(0, slaComplianceRate));
  }

  // 2. Fraud & Suspicious Detection Score
  // Normalized score: industry baseline is ~15-30% fraud/suspicious in referred claims
  let fraudScore = 0;
  let detectionRate = 0;
  if (totalCompleted > 0) {
    const totalDetections = stats.fraud_detected_count + stats.suspicious_detected_count;
    detectionRate = Number(((totalDetections / totalCompleted) * 100).toFixed(2));
    // Score based on active investigative rigor (scale: 25% detection = 100 score, capped at 100)
    fraudScore = Math.min(100, Math.max(0, Number((detectionRate * 4).toFixed(2))));
  }

  // 3. Quality Score: First-pass report approval rate minus penalty for rework loops
  let qualityScore = 0;
  let firstPassRate = 0;
  let avgReworks = 0;
  if (totalCompleted > 0) {
    firstPassRate = Number(((stats.first_pass_approved_count / totalCompleted) * 100).toFixed(2));
    avgReworks = Number((stats.total_rework_cycles / totalCompleted).toFixed(2));
    // Penalty: 10 points deducted per average rework per case
    const reworkPenalty = avgReworks * 10;
    qualityScore = Math.min(100, Math.max(0, Number((firstPassRate - reworkPenalty).toFixed(2))));
  }

  // 4. Volume Score: Productivity vs target capacity (default 15 cases/month)
  const targetCapacity = stats.target_monthly_capacity || 15;
  const volumeRate = targetCapacity > 0 ? (totalCompleted / targetCapacity) * 100 : 100;
  const volumeScore = Math.min(100, Math.max(0, Number(volumeRate.toFixed(2))));

  // Composite Score
  const totalWeight = weights.tat_weight + weights.fraud_rate_weight + weights.quality_weight + weights.volume_weight;
  const rawComposite = 
    (tatScore * weights.tat_weight) +
    (fraudScore * weights.fraud_rate_weight) +
    (qualityScore * weights.quality_weight) +
    (volumeScore * weights.volume_weight);

  const compositeScore = totalWeight > 0 ? Number((rawComposite / totalWeight).toFixed(2)) : 0;
  const tier = resolveScorecardTier(compositeScore);

  return {
    tat_score: tatScore,
    fraud_score: fraudScore,
    quality_score: qualityScore,
    volume_score: volumeScore,
    composite_score: compositeScore,
    tier,
    weights,
    metrics_summary: {
      sla_compliance_rate: slaComplianceRate,
      detection_rate: detectionRate,
      first_pass_approval_rate: firstPassRate,
      average_reworks_per_case: avgReworks,
    },
  };
}
