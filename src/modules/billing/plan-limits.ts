export type PlanTier = 'free' | 'starter' | 'professional' | 'enterprise';

export interface PlanLimits {
  tier: PlanTier;
  name: string;
  monthlyCaseQuota: number; // -1 for unlimited
  storageQuotaBytes: number; // in bytes
  investigatorQuota: number; // -1 for unlimited
  showBrandingFooter: boolean;
  canExportReports: boolean;
  canUseSmartPaste: boolean;
  customReportBranding: boolean;
}

export const PLAN_CONFIGURATIONS: Record<PlanTier, PlanLimits> = {
  free: {
    tier: 'free',
    name: 'Free Community Tier',
    monthlyCaseQuota: 100,
    storageQuotaBytes: 2 * 1024 * 1024 * 1024, // 2 GB
    investigatorQuota: 3,
    showBrandingFooter: true,
    canExportReports: true,
    canUseSmartPaste: true,
    customReportBranding: false,
  },
  starter: {
    tier: 'starter',
    name: 'Starter Tier',
    monthlyCaseQuota: 500,
    storageQuotaBytes: 15 * 1024 * 1024 * 1024, // 15 GB
    investigatorQuota: 10,
    showBrandingFooter: true,
    canExportReports: true,
    canUseSmartPaste: true,
    customReportBranding: false,
  },
  professional: {
    tier: 'professional',
    name: 'Professional Tier',
    monthlyCaseQuota: 2500,
    storageQuotaBytes: 100 * 1024 * 1024 * 1024, // 100 GB
    investigatorQuota: 50,
    showBrandingFooter: true,
    canExportReports: true,
    canUseSmartPaste: true,
    customReportBranding: true,
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise Agency Tier',
    monthlyCaseQuota: -1, // Unlimited
    storageQuotaBytes: 1024 * 1024 * 1024 * 1024, // 1 TB
    investigatorQuota: -1, // Unlimited
    showBrandingFooter: false, // White-label (Rule A10)
    canExportReports: true,
    canUseSmartPaste: true,
    customReportBranding: true,
  },
};

export interface UsageMetrics {
  currentMonthlyCases: number;
  currentStorageBytes: number;
  activeInvestigators: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  metric: 'CASES' | 'STORAGE' | 'INVESTIGATORS';
  currentUsage: number;
  quotaLimit: number;
  percentageUsed: number;
  message?: string;
}

/**
 * Checks whether an agency can create an additional case under its plan tier (Rule A1)
 */
export function checkCaseCreationQuota(
  tier: PlanTier,
  currentMonthlyCases: number
): QuotaCheckResult {
  const plan = PLAN_CONFIGURATIONS[tier] || PLAN_CONFIGURATIONS.free;
  if (plan.monthlyCaseQuota === -1) {
    return {
      allowed: true,
      metric: 'CASES',
      currentUsage: currentMonthlyCases,
      quotaLimit: -1,
      percentageUsed: 0,
    };
  }

  const allowed = currentMonthlyCases < plan.monthlyCaseQuota;
  const percentage = Math.round((currentMonthlyCases / plan.monthlyCaseQuota) * 100);

  return {
    allowed,
    metric: 'CASES',
    currentUsage: currentMonthlyCases,
    quotaLimit: plan.monthlyCaseQuota,
    percentageUsed: percentage,
    message: allowed
      ? undefined
      : `Monthly case creation limit (${plan.monthlyCaseQuota}) reached for ${plan.name}. Please upgrade to increase quota.`,
  };
}

/**
 * Checks storage quota compliance
 */
export function checkStorageQuota(
  tier: PlanTier,
  currentStorageBytes: number,
  additionalBytesToAdd = 0
): QuotaCheckResult {
  const plan = PLAN_CONFIGURATIONS[tier] || PLAN_CONFIGURATIONS.free;
  const newTotal = currentStorageBytes + additionalBytesToAdd;
  const allowed = newTotal <= plan.storageQuotaBytes;
  const percentage = Math.round((newTotal / plan.storageQuotaBytes) * 100);

  return {
    allowed,
    metric: 'STORAGE',
    currentUsage: newTotal,
    quotaLimit: plan.storageQuotaBytes,
    percentageUsed: percentage,
    message: allowed
      ? undefined
      : `Storage quota (${(plan.storageQuotaBytes / (1024 * 1024 * 1024)).toFixed(1)} GB) exceeded for ${plan.name}.`,
  };
}

/**
 * Checks active investigator seat quota compliance
 */
export function checkInvestigatorSeatQuota(
  tier: PlanTier,
  currentActiveInvestigators: number
): QuotaCheckResult {
  const plan = PLAN_CONFIGURATIONS[tier] || PLAN_CONFIGURATIONS.free;
  if (plan.investigatorQuota === -1) {
    return {
      allowed: true,
      metric: 'INVESTIGATORS',
      currentUsage: currentActiveInvestigators,
      quotaLimit: -1,
      percentageUsed: 0,
    };
  }

  const allowed = currentActiveInvestigators < plan.investigatorQuota;
  const percentage = Math.round((currentActiveInvestigators / plan.investigatorQuota) * 100);

  return {
    allowed,
    metric: 'INVESTIGATORS',
    currentUsage: currentActiveInvestigators,
    quotaLimit: plan.investigatorQuota,
    percentageUsed: percentage,
    message: allowed
      ? undefined
      : `Investigator seat quota (${plan.investigatorQuota}) reached for ${plan.name}.`,
  };
}
