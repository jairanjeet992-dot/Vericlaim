import { SlaStatus } from '../investigators/investigator-types';

export interface SlaTargetParams {
  received_at: Date | string;
  target_hours: number;
  approved_extension_hours?: number;
}

export interface SlaEvaluationParams {
  received_at: Date | string;
  target_deadline: Date | string;
  current_time?: Date | string; // Optional for fake clock injection in tests
  warning_threshold_percent?: number; // Default 75%
  urgent_threshold_hours?: number; // Default 4 hours
}

export interface SlaEvaluationResult {
  status: SlaStatus;
  elapsed_hours: number;
  remaining_hours: number;
  elapsed_percent: number;
  is_breached: boolean;
  target_deadline: string; // ISO
}

/**
 * Calculates the authoritative SLA deadline from intake time, policy target hours, and approved extensions.
 */
export function calculateSlaTarget(params: SlaTargetParams): Date {
  const start = new Date(params.received_at);
  const totalHours = params.target_hours + (params.approved_extension_hours || 0);
  const deadline = new Date(start.getTime() + totalHours * 60 * 60 * 1000);
  return deadline;
}

/**
 * Evaluates current SLA status: NORMAL, APPROACHING, URGENT, or BREACHED.
 * Deterministic with fake clock support for testing.
 */
export function evaluateSlaStatus(params: SlaEvaluationParams): SlaEvaluationResult {
  const start = new Date(params.received_at).getTime();
  const deadline = new Date(params.target_deadline).getTime();
  const now = params.current_time ? new Date(params.current_time).getTime() : Date.now();

  const totalDurationMs = deadline - start;
  const elapsedMs = now - start;
  const remainingMs = deadline - now;

  const totalHours = totalDurationMs / (1000 * 60 * 60);
  const elapsedHours = Number((elapsedMs / (1000 * 60 * 60)).toFixed(2));
  const remainingHours = Number((remainingMs / (1000 * 60 * 60)).toFixed(2));

  let elapsedPercent = totalDurationMs > 0 ? (elapsedMs / totalDurationMs) * 100 : 100;
  elapsedPercent = Number(elapsedPercent.toFixed(2));

  const warningThreshold = params.warning_threshold_percent || 75.0;
  const urgentHoursThreshold = params.urgent_threshold_hours || 4.0;

  let status: SlaStatus = 'NORMAL';
  const isBreached = now >= deadline;

  if (isBreached) {
    status = 'BREACHED';
  } else if (remainingHours <= urgentHoursThreshold || elapsedPercent >= 90.0) {
    status = 'URGENT';
  } else if (elapsedPercent >= warningThreshold) {
    status = 'APPROACHING';
  } else {
    status = 'NORMAL';
  }

  return {
    status,
    elapsed_hours: Math.max(0, elapsedHours),
    remaining_hours: remainingHours,
    elapsed_percent: Math.max(0, elapsedPercent),
    is_breached: isBreached,
    target_deadline: new Date(deadline).toISOString(),
  };
}

export interface SlaTickerInputCase {
  case_id: string;
  case_number: string;
  received_at: Date | string;
  target_deadline: Date | string;
}

export interface SlaTickerSummary {
  normal_count: number;
  approaching_count: number;
  urgent_count: number;
  breached_count: number;
  total_cases: number;
  results: Array<{
    case_id: string;
    case_number: string;
    evaluation: SlaEvaluationResult;
  }>;
}

/**
 * Background ticker engine evaluating active cases at a given point in time.
 */
export function processSlaTicker(
  cases: SlaTickerInputCase[],
  currentTime?: Date | string
): SlaTickerSummary {
  let normal = 0;
  let approaching = 0;
  let urgent = 0;
  let breached = 0;

  const results = cases.map(c => {
    const evaluation = evaluateSlaStatus({
      received_at: c.received_at,
      target_deadline: c.target_deadline,
      current_time: currentTime,
    });

    switch (evaluation.status) {
      case 'NORMAL':
        normal++;
        break;
      case 'APPROACHING':
        approaching++;
        break;
      case 'URGENT':
        urgent++;
        break;
      case 'BREACHED':
        breached++;
        break;
    }

    return {
      case_id: c.case_id,
      case_number: c.case_number,
      evaluation,
    };
  });

  return {
    normal_count: normal,
    approaching_count: approaching,
    urgent_count: urgent,
    breached_count: breached,
    total_cases: cases.length,
    results,
  };
}
