import { HospitalRiskLevel } from '../investigators/investigator-types';

export interface HospitalStatsInput {
  hospital_name: string;
  city?: string;
  district?: string;
  state?: string;
  total_cases: number;
  fraud_cases: number;
  suspicious_cases: number;
  genuine_cases: number;
  is_blacklisted?: boolean;
}

export interface HospitalRiskProfile {
  hospital_name: string;
  city: string;
  total_cases: number;
  fraud_cases: number;
  suspicious_cases: number;
  genuine_cases: number;
  fraud_rate_percent: number;
  risk_level: HospitalRiskLevel;
  is_blacklisted: boolean;
  warning_message: string;
}

export interface DispatchWarningResult {
  should_warn: boolean;
  severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'NONE';
  hospital_name: string;
  fraud_rate_percent: number;
  risk_level: HospitalRiskLevel;
  warning_title: string;
  warning_message: string;
  is_blacklisted: boolean;
  requires_manager_override: boolean;
  recommended_actions: string[];
}

/**
 * Calculates risk level and generates hospital risk profile.
 */
export function calculateHospitalRiskProfile(stats: HospitalStatsInput): HospitalRiskProfile {
  const total = stats.total_cases;
  const adverseCount = stats.fraud_cases + stats.suspicious_cases;
  let fraudRate = 0;
  if (total > 0) {
    fraudRate = Number(((adverseCount / total) * 100).toFixed(2));
  }

  const isBlacklisted = !!stats.is_blacklisted;
  let riskLevel: HospitalRiskLevel = 'LOW';
  let warningMessage = 'Standard hospital investigation protocol applies.';

  if (isBlacklisted || fraudRate >= 40.0) {
    riskLevel = 'CRITICAL';
    warningMessage = `CRITICAL ALERT: ${stats.hospital_name} has a ${fraudRate}% adverse claim history (${stats.fraud_cases} fraud / ${total} cases). High probability of paper hospital or inflated billing.`;
  } else if (fraudRate >= 25.0) {
    riskLevel = 'HIGH';
    warningMessage = `HIGH RISK WARNING: ${stats.hospital_name} exhibits ${fraudRate}% adverse rate. Mandatory physical verification of IPD indoor case papers and treating doctor credentials required.`;
  } else if (fraudRate >= 10.0) {
    riskLevel = 'MEDIUM';
    warningMessage = `MODERATE RISK: Periodic suspicious billings recorded at ${stats.hospital_name} (${fraudRate}% adverse rate). Verify pharmacy and implant bills.`;
  } else {
    riskLevel = 'LOW';
  }

  return {
    hospital_name: stats.hospital_name,
    city: stats.city || '',
    total_cases: total,
    fraud_cases: stats.fraud_cases,
    suspicious_cases: stats.suspicious_cases,
    genuine_cases: stats.genuine_cases,
    fraud_rate_percent: fraudRate,
    risk_level: riskLevel,
    is_blacklisted: isBlacklisted,
    warning_message: warningMessage,
  };
}

/**
 * Evaluates whether dispatch warning is triggered when assigning/dispatching an investigator to a case.
 */
export function generateDispatchWarning(profile: HospitalRiskProfile): DispatchWarningResult {
  if (profile.is_blacklisted) {
    return {
      should_warn: true,
      severity: 'CRITICAL',
      hospital_name: profile.hospital_name,
      fraud_rate_percent: profile.fraud_rate_percent,
      risk_level: 'CRITICAL',
      warning_title: 'BLACKLISTED HOSPITAL - DISPATCH RESTRICTED',
      warning_message: `Hospital "${profile.hospital_name}" is on the insurer/agency blacklist. Assignment requires explicit manager override and dual-investigator deployment.`,
      is_blacklisted: true,
      requires_manager_override: true,
      recommended_actions: [
        'Require Manager Override with recorded justification',
        'Deploy Senior Investigator or dual-investigator roster',
        'Cross-verify patient geo-location and OT register signatures',
      ],
    };
  }

  if (profile.risk_level === 'CRITICAL') {
    return {
      should_warn: true,
      severity: 'CRITICAL',
      hospital_name: profile.hospital_name,
      fraud_rate_percent: profile.fraud_rate_percent,
      risk_level: 'CRITICAL',
      warning_title: 'CRITICAL FRAUD HEATMAP WARNING',
      warning_message: profile.warning_message,
      is_blacklisted: false,
      requires_manager_override: true,
      recommended_actions: [
        'Mandatory physical verification of IPD admission register',
        'Collect video statement of treating doctor and RMO',
        'Verify hospital pharmacy stock register against patient billing',
      ],
    };
  }

  if (profile.risk_level === 'HIGH') {
    return {
      should_warn: true,
      severity: 'WARNING',
      hospital_name: profile.hospital_name,
      fraud_rate_percent: profile.fraud_rate_percent,
      risk_level: 'HIGH',
      warning_title: 'HIGH FRAUD RISK HOSPITAL DETECTED',
      warning_message: profile.warning_message,
      is_blacklisted: false,
      requires_manager_override: false,
      recommended_actions: [
        'Check for bill date and timing anomalies',
        'Verify doctor registration number on Medical Council registry',
        'Capture timestamped photos of hospital bed and diagnostic equipment',
      ],
    };
  }

  if (profile.risk_level === 'MEDIUM') {
    return {
      should_warn: true,
      severity: 'INFO',
      hospital_name: profile.hospital_name,
      fraud_rate_percent: profile.fraud_rate_percent,
      risk_level: 'MEDIUM',
      warning_title: 'MODERATE RISK NOTICE',
      warning_message: profile.warning_message,
      is_blacklisted: false,
      requires_manager_override: false,
      recommended_actions: [
        'Standard enhanced verification on laboratory reports and itemized pharmacy bills',
      ],
    };
  }

  return {
    should_warn: false,
    severity: 'NONE',
    hospital_name: profile.hospital_name,
    fraud_rate_percent: profile.fraud_rate_percent,
    risk_level: 'LOW',
    warning_title: 'NORMAL',
    warning_message: 'Hospital within standard risk parameters.',
    is_blacklisted: false,
    requires_manager_override: false,
    recommended_actions: [],
  };
}
