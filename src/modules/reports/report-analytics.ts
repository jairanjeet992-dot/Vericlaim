import { Decimal } from 'decimal.js';
import { FinancialMetrics, OperationalMetrics, PhysicalLogisticsMetrics } from './analytics-types';

export interface CaseReportingRecord {
  id: string;
  agency_id: string;
  client_id: string;
  case_type_id: string;
  status: string;
  outcome: string;
  location_city: string;
  location_state: string;
  rework_count: number;
  sla_status?: 'NORMAL' | 'APPROACHING' | 'URGENT' | 'BREACHED' | 'MET';
  created_at: string;
  verified_at?: string | null;
  assigned_at?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  closed_at?: string | null;
  assigned_investigator_id?: string | null;
  owner_manager_id: string;
  data_entry_user_id: string;
}

export interface InvoiceReportingRecord {
  id: string;
  agency_id: string;
  invoice_number: string;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED';
  issue_date: string;
  taxable_amount: number | string;
  cgst_amount: number | string;
  sgst_amount: number | string;
  igst_amount: number | string;
  total_amount: number | string;
  outstanding_amount: number | string;
  tds_amount?: number | string;
  tds_is_reconciled?: boolean;
}

export interface PaymentReportingRecord {
  id: string;
  agency_id: string;
  amount: number | string;
  unapplied_amount: number | string;
  payment_date: string;
}

export interface DirectCostReportingRecord {
  investigator_id: string;
  case_fees_payable: number | string;
  approved_expenses: number | string;
}

export interface PacketReportingRecord {
  id: string;
  status: 'INWARDED' | 'ARCHIVED' | 'DISPATCHED' | 'DELIVERED';
  inwarded_at: string;
  delivered_at?: string | null;
  courier_partner?: string | null;
}

export interface DocketReportingRecord {
  id: string;
  courier_partner: string;
  delivery_status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'RETURNED';
  dispatched_at: string;
  delivered_at?: string | null;
}

/**
 * Computes pure operational telemetry across multiple operational dimensions.
 */
export function calculateOperationalMetrics(
  cases: CaseReportingRecord[],
  clientsMap: Map<string, string> = new Map(),
  investigatorsMap: Map<string, string> = new Map(),
  caseTypesMap: Map<string, string> = new Map()
): OperationalMetrics {
  const totalCases = cases.length;
  let openCases = 0;
  let closedCases = 0;
  let reworkCount = 0;
  let escalatedCount = 0;

  // Trackers for breakdown
  const companyCounts: Record<string, number> = {};
  const investigatorCounts: Record<string, number> = {};
  const locationCounts: Record<string, number> = {};
  const caseTypeCounts: Record<string, number> = {};
  const outcomeCounts: Record<string, number> = {};

  // SLA Trackers
  let metSla = 0;
  let breachedSla = 0;
  let approachingSla = 0;
  let totalTrackedSla = 0;

  // TAT Trackers (sum hours and count for each phase)
  let sumIntakeToVerif = 0;
  let countIntakeToVerif = 0;
  let sumVerifToAssign = 0;
  let countVerifToAssign = 0;
  let sumFieldInvest = 0;
  let countFieldInvest = 0;
  let sumReportReview = 0;
  let countReportReview = 0;
  let sumOverallClosure = 0;
  let countOverallClosure = 0;

  // Monthly trends map
  const trendsMap: Record<string, { intake: number; closed: number }> = {};

  for (const c of cases) {
    if (c.status === 'CLOSED') {
      closedCases++;
    } else {
      openCases++;
    }

    if (c.rework_count > 0) {
      reworkCount += c.rework_count;
    }
    if (c.rework_count >= 3 || c.status === 'ESCALATED_REVIEW') {
      escalatedCount++;
    }

    // Company breakdown
    const clientName = clientsMap.get(c.client_id) || c.client_id || 'Unknown Client';
    companyCounts[clientName] = (companyCounts[clientName] || 0) + 1;

    // Investigator breakdown
    if (c.assigned_investigator_id) {
      const invName = investigatorsMap.get(c.assigned_investigator_id) || c.assigned_investigator_id;
      investigatorCounts[invName] = (investigatorCounts[invName] || 0) + 1;
    }

    // Location breakdown
    const locKey = `${c.location_state || 'N/A'}|${c.location_city || 'N/A'}`;
    locationCounts[locKey] = (locationCounts[locKey] || 0) + 1;

    // Case Type breakdown
    const ctName = caseTypesMap.get(c.case_type_id) || c.case_type_id || 'STANDARD';
    caseTypeCounts[ctName] = (caseTypeCounts[ctName] || 0) + 1;

    // Outcome breakdown
    const outcome = c.outcome || 'PENDING';
    outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;

    // SLA tracking
    if (c.sla_status) {
      totalTrackedSla++;
      if (c.sla_status === 'MET' || c.sla_status === 'NORMAL') metSla++;
      else if (c.sla_status === 'BREACHED') breachedSla++;
      else if (c.sla_status === 'APPROACHING' || c.sla_status === 'URGENT') approachingSla++;
    }

    // TAT calculation
    const createdAtMs = new Date(c.created_at).getTime();
    if (c.verified_at) {
      const diffHours = (new Date(c.verified_at).getTime() - createdAtMs) / (1000 * 3600);
      if (diffHours >= 0) {
        sumIntakeToVerif += diffHours;
        countIntakeToVerif++;
      }
    }
    if (c.verified_at && c.assigned_at) {
      const diffHours = (new Date(c.assigned_at).getTime() - new Date(c.verified_at).getTime()) / (1000 * 3600);
      if (diffHours >= 0) {
        sumVerifToAssign += diffHours;
        countVerifToAssign++;
      }
    }
    if (c.assigned_at && c.submitted_at) {
      const diffHours = (new Date(c.submitted_at).getTime() - new Date(c.assigned_at).getTime()) / (1000 * 3600);
      if (diffHours >= 0) {
        sumFieldInvest += diffHours;
        countFieldInvest++;
      }
    }
    if (c.submitted_at && c.approved_at) {
      const diffHours = (new Date(c.approved_at).getTime() - new Date(c.submitted_at).getTime()) / (1000 * 3600);
      if (diffHours >= 0) {
        sumReportReview += diffHours;
        countReportReview++;
      }
    }
    if (c.closed_at) {
      const diffHours = (new Date(c.closed_at).getTime() - createdAtMs) / (1000 * 3600);
      if (diffHours >= 0) {
        sumOverallClosure += diffHours;
        countOverallClosure++;
      }
    }

    // Trends grouping by YYYY-MM
    const monthKey = c.created_at.substring(0, 7);
    if (!trendsMap[monthKey]) trendsMap[monthKey] = { intake: 0, closed: 0 };
    trendsMap[monthKey].intake++;
    if (c.closed_at) {
      const closedMonthKey = c.closed_at.substring(0, 7);
      if (!trendsMap[closedMonthKey]) trendsMap[closedMonthKey] = { intake: 0, closed: 0 };
      trendsMap[closedMonthKey].closed++;
    }
  }

  // Format Breakdowns
  const byCompany = Object.entries(companyCounts).map(([client_name, count]) => ({
    client_id: client_name,
    client_name,
    count,
    percentage: totalCases > 0 ? Number(((count / totalCases) * 100).toFixed(1)) : 0,
  }));

  const byInvestigator = Object.entries(investigatorCounts).map(([investigator_name, count]) => ({
    investigator_id: investigator_name,
    investigator_name,
    count,
  }));

  const byLocation = Object.entries(locationCounts).map(([key, count]) => {
    const [state, city] = key.split('|');
    return { state, city, count };
  });

  const byCaseType = Object.entries(caseTypeCounts).map(([case_type_name, count]) => ({
    case_type_id: case_type_name,
    case_type_name,
    count,
  }));

  const byOutcome = Object.entries(outcomeCounts).map(([outcome, count]) => ({
    outcome,
    count,
    percentage: totalCases > 0 ? Number(((count / totalCases) * 100).toFixed(1)) : 0,
  }));

  const complianceRate =
    totalTrackedSla > 0 ? Number(((metSla / totalTrackedSla) * 100).toFixed(1)) : 100.0;

  const timelineTrends = Object.entries(trendsMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({
      period,
      intake_count: data.intake,
      closed_count: data.closed,
    }));

  return {
    total_cases: totalCases,
    open_cases: openCases,
    closed_cases: closedCases,
    rework_count: reworkCount,
    escalated_count: escalatedCount,
    by_company: byCompany,
    by_investigator: byInvestigator,
    by_location: byLocation,
    by_case_type: byCaseType,
    by_outcome: byOutcome,
    sla_metrics: {
      total_tracked: totalTrackedSla,
      met_sla_count: metSla,
      breached_count: breachedSla,
      approaching_count: approachingSla,
      compliance_rate: complianceRate,
    },
    tat_metrics: {
      avg_intake_to_verification_hours: countIntakeToVerif > 0 ? Number((sumIntakeToVerif / countIntakeToVerif).toFixed(1)) : 0,
      avg_verification_to_assignment_hours: countVerifToAssign > 0 ? Number((sumVerifToAssign / countVerifToAssign).toFixed(1)) : 0,
      avg_field_investigation_hours: countFieldInvest > 0 ? Number((sumFieldInvest / countFieldInvest).toFixed(1)) : 0,
      avg_report_review_hours: countReportReview > 0 ? Number((sumReportReview / countReportReview).toFixed(1)) : 0,
      avg_overall_closure_hours: countOverallClosure > 0 ? Number((sumOverallClosure / countOverallClosure).toFixed(1)) : 0,
    },
    timeline_trends: timelineTrends,
  };
}

/**
 * Computes financial metrics with strict statutory GST separation and zero-float decimal.js arithmetic.
 * Invariant: Service Revenue = Taxable Base (excluding GST).
 * Invariant: Gross Profit = Taxable Service Revenue - Direct Costs.
 * Invariant: Output GST is tracked purely as statutory liability, never profit!
 */
export function calculateFinancialMetrics(
  invoices: InvoiceReportingRecord[],
  payments: PaymentReportingRecord[] = [],
  directCosts: DirectCostReportingRecord[] = [],
  operationalOverhead: number = 0,
  referenceDate: Date = new Date()
): FinancialMetrics {
  let totalBilledGross = new Decimal(0);
  let totalBilledTaxable = new Decimal(0);
  let issuedCount = 0;
  let paidCount = 0;
  let cancelledCount = 0;
  let draftCount = 0;

  let totalOutputGst = new Decimal(0);
  let cgstCollected = new Decimal(0);
  let sgstCollected = new Decimal(0);
  let igstCollected = new Decimal(0);

  let totalOutstanding = new Decimal(0);
  let aging0To30 = new Decimal(0);
  let aging31To60 = new Decimal(0);
  let aging61To90 = new Decimal(0);
  let agingOver90 = new Decimal(0);

  let totalTdsDeducted = new Decimal(0);
  let reconciled26as = new Decimal(0);
  let unreconciled26as = new Decimal(0);

  const refTime = referenceDate.getTime();

  for (const inv of invoices) {
    if (inv.status === 'CANCELLED') {
      cancelledCount++;
      continue; // Exclude cancelled invoices from active financials
    }
    if (inv.status === 'DRAFT') {
      draftCount++;
      continue;
    }

    if (inv.status === 'ISSUED') issuedCount++;
    if (inv.status === 'PAID') paidCount++;

    const gross = new Decimal(inv.total_amount || 0);
    const taxable = new Decimal(inv.taxable_amount || 0);
    const cgst = new Decimal(inv.cgst_amount || 0);
    const sgst = new Decimal(inv.sgst_amount || 0);
    const igst = new Decimal(inv.igst_amount || 0);
    const outstanding = new Decimal(inv.outstanding_amount || 0);

    totalBilledGross = totalBilledGross.plus(gross);
    totalBilledTaxable = totalBilledTaxable.plus(taxable);

    cgstCollected = cgstCollected.plus(cgst);
    sgstCollected = sgstCollected.plus(sgst);
    igstCollected = igstCollected.plus(igst);
    totalOutputGst = totalOutputGst.plus(cgst).plus(sgst).plus(igst);

    if (outstanding.gt(0)) {
      totalOutstanding = totalOutstanding.plus(outstanding);

      // Compute aging bucket based on days since issue_date
      const issueTime = new Date(inv.issue_date).getTime();
      const ageDays = Math.max(0, Math.floor((refTime - issueTime) / (1000 * 3600 * 24)));

      if (ageDays <= 30) {
        aging0To30 = aging0To30.plus(outstanding);
      } else if (ageDays <= 60) {
        aging31To60 = aging31To60.plus(outstanding);
      } else if (ageDays <= 90) {
        aging61To90 = aging61To90.plus(outstanding);
      } else {
        agingOver90 = agingOver90.plus(outstanding);
      }
    }

    // TDS Tracking
    if (inv.tds_amount) {
      const tds = new Decimal(inv.tds_amount);
      totalTdsDeducted = totalTdsDeducted.plus(tds);
      if (inv.tds_is_reconciled) {
        reconciled26as = reconciled26as.plus(tds);
      } else {
        unreconciled26as = unreconciled26as.plus(tds);
      }
    }
  }

  // Collections received
  let totalCollections = new Decimal(0);
  let unappliedCash = new Decimal(0);
  for (const pay of payments) {
    totalCollections = totalCollections.plus(new Decimal(pay.amount || 0));
    unappliedCash = unappliedCash.plus(new Decimal(pay.unapplied_amount || 0));
  }

  // Direct investigator costs
  let totalCaseFees = new Decimal(0);
  let totalExpenses = new Decimal(0);
  for (const dc of directCosts) {
    totalCaseFees = totalCaseFees.plus(new Decimal(dc.case_fees_payable || 0));
    totalExpenses = totalExpenses.plus(new Decimal(dc.approved_expenses || 0));
  }
  const totalDirectCosts = totalCaseFees.plus(totalExpenses);

  // Profitability calculations (Rule A1, A6, A12 & CA-VERIFY Q-CA-01)
  // Revenue is TAXABLE base only, excluding statutory GST
  const netServiceRevenue = totalBilledTaxable;
  const grossProfit = netServiceRevenue.minus(totalDirectCosts);
  const grossMarginPct = netServiceRevenue.gt(0)
    ? grossProfit.dividedBy(netServiceRevenue).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber()
    : 0;

  const overheadDec = new Decimal(operationalOverhead);
  const netProfit = grossProfit.minus(overheadDec);
  const netMarginPct = netServiceRevenue.gt(0)
    ? netProfit.dividedBy(netServiceRevenue).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber()
    : 0;

  return {
    total_billed_gross: totalBilledGross.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    total_billed_taxable: totalBilledTaxable.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    invoices_issued_count: issuedCount,
    invoices_paid_count: paidCount,
    invoices_cancelled_count: cancelledCount,
    invoices_draft_count: draftCount,

    total_collections_received: totalCollections.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    unapplied_cash_balance: unappliedCash.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),

    total_outstanding: totalOutstanding.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    aging_buckets: {
      current_0_30: aging0To30.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      aging_31_60: aging31To60.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      aging_61_90: aging61To90.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      over_90: agingOver90.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    },

    statutory_gst: {
      total_output_gst_collected: totalOutputGst.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      cgst_collected: cgstCollected.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      sgst_collected: sgstCollected.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      igst_collected: igstCollected.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    },

    tds_receivables: {
      total_tds_deducted_by_clients: totalTdsDeducted.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      reconciled_with_26as: reconciled26as.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      unreconciled_26as: unreconciled26as.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    },

    direct_costs: {
      investigator_case_fees_payable: totalCaseFees.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      investigator_approved_expenses: totalExpenses.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      total_direct_costs: totalDirectCosts.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    },

    profitability: {
      net_service_revenue: netServiceRevenue.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      direct_investigation_cost: totalDirectCosts.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      gross_profit: grossProfit.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      gross_margin_percentage: grossMarginPct,
      operational_overhead: overheadDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      net_profit: netProfit.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      net_margin_percentage: netMarginPct,
    },
  };
}

/**
 * Computes physical logistics and hardcopy movement telemetry.
 */
export function calculatePhysicalLogisticsMetrics(
  packets: PacketReportingRecord[],
  dockets: DocketReportingRecord[] = []
): PhysicalLogisticsMetrics {
  const totalPackets = packets.length;
  let inArchive = 0;
  let inTransit = 0;
  let delivered = 0;

  for (const p of packets) {
    if (p.status === 'ARCHIVED') inArchive++;
    else if (p.status === 'DISPATCHED') inTransit++;
    else if (p.status === 'DELIVERED') delivered++;
  }

  const ackRate = totalPackets > 0 ? Number(((delivered / totalPackets) * 100).toFixed(1)) : 100.0;

  // Courier partner performance breakdown
  const courierMap: Record<string, { total: number; delivered: number; sumDays: number }> = {};

  let overallSumDays = 0;
  let overallDeliveredCount = 0;

  for (const d of dockets) {
    const partner = d.courier_partner || 'OTHER';
    if (!courierMap[partner]) {
      courierMap[partner] = { total: 0, delivered: 0, sumDays: 0 };
    }
    courierMap[partner].total++;

    if (d.delivery_status === 'DELIVERED' && d.delivered_at) {
      courierMap[partner].delivered++;
      const days = Math.max(
        0,
        (new Date(d.delivered_at).getTime() - new Date(d.dispatched_at).getTime()) / (1000 * 3600 * 24)
      );
      courierMap[partner].sumDays += days;
      overallSumDays += days;
      overallDeliveredCount++;
    }
  }

  const avgTransitTime =
    overallDeliveredCount > 0 ? Number((overallSumDays / overallDeliveredCount).toFixed(1)) : 0;

  const courierPerformance = Object.entries(courierMap).map(([partner, data]) => ({
    courier_partner: partner,
    docket_count: data.total,
    delivered_count: data.delivered,
    avg_delivery_days: data.delivered > 0 ? Number((data.sumDays / data.delivered).toFixed(1)) : 0,
  }));

  return {
    total_packets_inwarded: totalPackets,
    packets_in_archive: inArchive,
    packets_in_transit: inTransit,
    packets_delivered: delivered,
    delivery_acknowledgment_rate: ackRate,
    avg_transit_time_days: avgTransitTime,
    courier_performance: courierPerformance,
  };
}
