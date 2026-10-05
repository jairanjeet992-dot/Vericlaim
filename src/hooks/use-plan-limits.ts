'use client';

import { useState, useMemo } from 'react';
import {
  PlanTier,
  PLAN_CONFIGURATIONS,
  checkCaseCreationQuota,
  checkStorageQuota,
  checkInvestigatorSeatQuota,
  UsageMetrics
} from '@/modules/billing/plan-limits';

export function usePlanLimits(planTier: PlanTier = 'free', initialUsage?: Partial<UsageMetrics>) {
  const [usage, setUsage] = useState<UsageMetrics>({
    currentMonthlyCases: initialUsage?.currentMonthlyCases || 0,
    currentStorageBytes: initialUsage?.currentStorageBytes || 0,
    activeInvestigators: initialUsage?.activeInvestigators || 0,
  });

  const plan = PLAN_CONFIGURATIONS[planTier] || PLAN_CONFIGURATIONS.free;

  const caseQuota = useMemo(
    () => checkCaseCreationQuota(planTier, usage.currentMonthlyCases),
    [planTier, usage.currentMonthlyCases]
  );

  const storageQuota = useMemo(
    () => checkStorageQuota(planTier, usage.currentStorageBytes),
    [planTier, usage.currentStorageBytes]
  );

  const investigatorQuota = useMemo(
    () => checkInvestigatorSeatQuota(planTier, usage.activeInvestigators),
    [planTier, usage.activeInvestigators]
  );

  const isNearingLimits =
    caseQuota.percentageUsed >= 85 ||
    storageQuota.percentageUsed >= 85 ||
    investigatorQuota.percentageUsed >= 85;

  return {
    tier: planTier,
    planName: plan.name,
    plan,
    usage,
    setUsage,
    caseQuota,
    storageQuota,
    investigatorQuota,
    isNearingLimits,
    showBrandingFooter: plan.showBrandingFooter,
  };
}
