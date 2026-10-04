export interface ReportDateFilter {
  startDate: string; // ISO date string YYYY-MM-DD
  endDate: string;   // ISO date string YYYY-MM-DD
}

export interface OperationalMetrics {
  total_cases: number;
  open_cases: number;
  closed_cases: number;
  rework_count: number;
  escalated_count: number;
  
  // Breakdown by Dimension
  by_company: Array<{ client_id: string; client_name: string; count: number; percentage: number }>;
  by_investigator: Array<{ investigator_id: string; investigator_name: string; count: number }>;
  by_location: Array<{ state: string; city: string; count: number }>;
  by_case_type: Array<{ case_type_id: string; case_type_name: string; count: number }>;
  by_outcome: Array<{ outcome: string; count: number; percentage: number }>;

  // SLA Performance
  sla_metrics: {
    total_tracked: number;
    met_sla_count: number;
    breached_count: number;
    approaching_count: number;
    compliance_rate: number; // 0.0 - 100.0%
  };

  // Turnaround Time (TAT) in hours
  tat_metrics: {
    avg_intake_to_verification_hours: number;
    avg_verification_to_assignment_hours: number;
    avg_field_investigation_hours: number;
    avg_report_review_hours: number;
    avg_overall_closure_hours: number;
  };

  // Intake & Closure Trends
  timeline_trends: Array<{
    period: string; // YYYY-MM or YYYY-MM-DD
    intake_count: number;
    closed_count: number;
  }>;
}

export interface FinancialMetrics {
  // Billing
  total_billed_gross: number;
  total_billed_taxable: number;
  invoices_issued_count: number;
  invoices_paid_count: number;
  invoices_cancelled_count: number;
  invoices_draft_count: number;

  // Collections & Remittances
  total_collections_received: number;
  unapplied_cash_balance: number;

  // Outstanding Receivables & Aging Buckets
  total_outstanding: number;
  aging_buckets: {
    current_0_30: number;
    aging_31_60: number;
    aging_61_90: number;
    over_90: number;
  };

  // Statutory GST Separation (Rule A1, A6, A12 & CA-VERIFY Q-CA-01)
  // GST collected is statutory government liability, strictly separated from service income!
  statutory_gst: {
    total_output_gst_collected: number;
    cgst_collected: number;
    sgst_collected: number;
    igst_collected: number;
  };

  // TDS Receivables (Section 194J / 194C)
  tds_receivables: {
    total_tds_deducted_by_clients: number;
    reconciled_with_26as: number;
    unreconciled_26as: number;
  };

  // Investigator Compensation & Field Expenses
  direct_costs: {
    investigator_case_fees_payable: number;
    investigator_approved_expenses: number;
    total_direct_costs: number;
  };

  // Statutory Profitability (Zero-float decimal.js calculation)
  profitability: {
    net_service_revenue: number; // Taxable base, NOT gross including GST!
    direct_investigation_cost: number;
    gross_profit: number;        // net_service_revenue - direct_investigation_cost
    gross_margin_percentage: number;
    operational_overhead: number;
    net_profit: number;          // gross_profit - operational_overhead
    net_margin_percentage: number;
  };
}

export interface PhysicalLogisticsMetrics {
  total_packets_inwarded: number;
  packets_in_archive: number;
  packets_in_transit: number;
  packets_delivered: number;
  delivery_acknowledgment_rate: number; // 0.0 - 100.0%
  avg_transit_time_days: number;
  courier_performance: Array<{
    courier_partner: string;
    docket_count: number;
    delivered_count: number;
    avg_delivery_days: number;
  }>;
}

export interface ExportLogRecord {
  id: string;
  agency_id: string;
  user_id: string;
  export_type: string;
  format: 'CSV' | 'EXCEL' | 'PDF';
  filter_params: Record<string, unknown>;
  row_count: number;
  sha256?: string;
  status: 'COMPLETED' | 'DENIED' | 'FAILED';
  denial_reason?: string;
  ip_address?: string;
  created_at: string;
}
