/**
 * Vericlaim Multi-Tenant SaaS: Payment, TDS, Recovery & Profit Service (Phase 7B)
 * Implements business workflows, atomic database transactions, idempotency, and audit logging.
 *
 * Mark: CA-VERIFY
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Decimal from 'decimal.js';
import { recordAuditLog } from '../audit/service';
import {
  calculateInvoiceOutstanding,
  detectShortSettlementTds,
  match26ASRecord,
  calculateAgingBuckets,
  calculateProfitAndLoss,
  classifyRecoveryItems,
  AgingInvoiceData,
  InternalTdsCandidate,
} from './payments';
import {
  ClientPayment,
  PaymentAllocation,
  TdsReceivable,
  Form26ASRecord,
  ShortSettlementSuggestion,
  AgingReportSummary,
  ClientLedgerEntry,
  ProfitAndLossReport,
  RecoveryHubItem,
} from './payment-types';
import {
  RecordPaymentInput,
  AllocatePaymentInput,
  BulkAllocatePaymentInput,
  RecordTdsInput,
  Import26ASInput,
  RecordPaymentInputSchema,
  AllocatePaymentInputSchema,
  BulkAllocatePaymentInputSchema,
  RecordTdsInputSchema,
  Import26ASInputSchema,
} from './payment-schema';
import { UserScopeContext } from './service';

export class PaymentService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  private checkPermission(context: UserScopeContext, requiredPermission: string) {
    if (!context.permissions.includes(requiredPermission) && !context.permissions.includes('*')) {
      throw new Error(`Permission denied: Missing '${requiredPermission}'`);
    }
  }

  /**
   * 1. Record Client Payment (Remittance / Advance / Bulk Receipt)
   * Idempotent: returns existing payment if idempotency_key is present.
   * Enforces unique UTR per agency.
   */
  async recordPayment(
    context: UserScopeContext,
    rawInput: RecordPaymentInput
  ): Promise<ClientPayment> {
    this.checkPermission(context, 'payments.record');
    const input = RecordPaymentInputSchema.parse(rawInput);

    // 1. Idempotency Check
    if (input.idempotency_key) {
      const { data: existingPayment } = await this.supabase
        .from('client_payments')
        .select('*')
        .eq('agency_id', context.agencyId)
        .eq('idempotency_key', input.idempotency_key)
        .maybeSingle();

      if (existingPayment) {
        return existingPayment as ClientPayment;
      }
    }

    // 2. Duplicate UTR Check
    if (input.utr_number) {
      const { data: duplicateUtr } = await this.supabase
        .from('client_payments')
        .select('id, utr_number')
        .eq('agency_id', context.agencyId)
        .eq('utr_number', input.utr_number)
        .maybeSingle();

      if (duplicateUtr) {
        throw new Error(
          `A6 Violation: Duplicate UTR number '${input.utr_number}'. This remittance is already recorded.`
        );
      }
    }

    // 3. Insert Payment
    const paymentAmount = new Decimal(input.amount).toFixed(2);
    const { data: payment, error } = await this.supabase
      .from('client_payments')
      .insert({
        agency_id: context.agencyId,
        client_id: input.client_id,
        client_branch_id: input.client_branch_id || null,
        payment_date: input.payment_date || new Date().toISOString().split('T')[0],
        amount: paymentAmount,
        unapplied_amount: paymentAmount,
        payment_mode: input.payment_mode,
        utr_number: input.utr_number || null,
        bank_name: input.bank_name || null,
        reference_note: input.reference_note || null,
        is_advance: input.is_advance,
        idempotency_key: input.idempotency_key || null,
        created_by: context.userId,
      })
      .select('*')
      .single();

    if (error || !payment) {
      throw new Error(`Failed to record payment: ${error?.message || 'Database error'}`);
    }

    // 4. Audit Log
    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'PAYMENT_RECORDED',
      entity_type: 'client_payment',
      entity_id: payment.id,
      new_values: payment,
    });

    return payment as ClientPayment;
  }

  /**
   * 2. Allocate Payment to an Invoice (Atomic & Race-Free via Stored Procedure)
   */
  async allocatePayment(
    context: UserScopeContext,
    rawInput: AllocatePaymentInput
  ): Promise<{
    allocation_id: string;
    invoice_status: string;
    remaining_invoice_outstanding: number;
    remaining_payment_unapplied: number;
  }> {
    this.checkPermission(context, 'payments.record');
    const input = AllocatePaymentInputSchema.parse(rawInput);
    const allocatedAmount = new Decimal(input.allocated_amount).toFixed(2);

    // Call atomic PostgreSQL stored procedure with FOR UPDATE row locks
    const { data, error } = await this.supabase.rpc('allocate_payment_transaction', {
      p_agency_id: context.agencyId,
      p_payment_id: input.payment_id,
      p_invoice_id: input.invoice_id,
      p_allocated_amount: allocatedAmount,
      p_case_id: input.case_id || null,
      p_actor_id: context.userId,
    });

    if (error) {
      throw new Error(`Payment allocation failed: ${error.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'PAYMENT_ALLOCATED',
      entity_type: 'payment_allocation',
      entity_id: data.allocation_id,
      new_values: data,
    });

    return data;
  }

  /**
   * 3. Bulk Remittance Allocation across multiple invoices/cases
   */
  async bulkAllocatePayment(
    context: UserScopeContext,
    rawInput: BulkAllocatePaymentInput
  ): Promise<{ success: boolean; allocations: Array<{ invoice_id: string; allocation_id: string }> }> {
    this.checkPermission(context, 'payments.record');
    const input = BulkAllocatePaymentInputSchema.parse(rawInput);

    const results: Array<{ invoice_id: string; allocation_id: string }> = [];

    for (const alloc of input.allocations) {
      const res = await this.allocatePayment(context, {
        payment_id: input.payment_id,
        invoice_id: alloc.invoice_id,
        allocated_amount: alloc.allocated_amount,
        case_id: alloc.case_id,
      });
      results.push({
        invoice_id: alloc.invoice_id,
        allocation_id: res.allocation_id,
      });
    }

    return { success: true, allocations: results };
  }

  /**
   * 4. Record TDS Receivable (Section 194J / 194C)
   */
  async recordTds(
    context: UserScopeContext,
    rawInput: RecordTdsInput
  ): Promise<TdsReceivable> {
    this.checkPermission(context, 'payments.record');
    const input = RecordTdsInputSchema.parse(rawInput);
    const amount = new Decimal(input.amount).toFixed(2);

    // Verify invoice belongs to this agency and client
    const { data: invoice, error: invErr } = await this.supabase
      .from('invoices')
      .select('id, total_amount, status')
      .eq('id', input.invoice_id)
      .eq('agency_id', context.agencyId)
      .eq('client_id', input.client_id)
      .single();

    if (invErr || !invoice) {
      throw new Error('Invoice not found or does not belong to specified client.');
    }

    const { data: tds, error } = await this.supabase
      .from('tds_receivables')
      .insert({
        agency_id: context.agencyId,
        client_id: input.client_id,
        invoice_id: input.invoice_id,
        payment_id: input.payment_id || null,
        section: input.section,
        rate: new Decimal(input.rate).toFixed(2),
        amount,
        is_valid: input.is_valid,
        certificate_number: input.certificate_number || null,
        form_26as_status: 'PENDING',
        created_by: context.userId,
      })
      .select('*')
      .single();

    if (error || !tds) {
      throw new Error(`Failed to record TDS: ${error?.message || 'Database error'}`);
    }

    // Check outstanding after TDS insertion and update invoice status if settled
    const { data: outstandingData } = await this.supabase.rpc('get_invoice_outstanding', {
      p_invoice_id: input.invoice_id,
    });

    if (outstandingData !== null && outstandingData !== undefined) {
      const remaining = new Decimal(outstandingData);
      if (remaining.isZero() && invoice.status !== 'PAID') {
        await this.supabase
          .from('invoices')
          .update({ status: 'PAID', updated_at: new Date().toISOString() })
          .eq('id', input.invoice_id);
      } else if (remaining.greaterThan(0) && invoice.status === 'ISSUED') {
        await this.supabase
          .from('invoices')
          .update({ status: 'PARTIALLY_PAID', updated_at: new Date().toISOString() })
          .eq('id', input.invoice_id);
      }
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'TDS_RECORDED',
      entity_type: 'tds_receivable',
      entity_id: tds.id,
      new_values: tds,
    });

    return tds as TdsReceivable;
  }

  /**
   * 5. Short-settlement Auto-suggestion
   * Suggests Section 194J 10% TDS deduction if shortfall matches ~10%.
   */
  async checkShortSettlementSuggestion(
    agencyId: string,
    invoiceId: string,
    receivedAmount: string | Decimal,
    toleranceRupees = 5.0
  ): Promise<ShortSettlementSuggestion | null> {
    const { data: invoice } = await this.supabase
      .from('invoices')
      .select('total_amount, taxable_amount')
      .eq('id', invoiceId)
      .eq('agency_id', agencyId)
      .single();

    if (!invoice) return null;

    return detectShortSettlementTds({
      invoiceTotal: invoice.total_amount,
      taxableAmount: invoice.taxable_amount,
      receivedAmount,
      toleranceRupees,
    });
  }

  /**
   * 6. Form 26AS / AIS Ingestion & Reconciliation Matcher
   */
  async importAndReconcile26AS(
    context: UserScopeContext,
    rawInput: Import26ASInput
  ): Promise<{
    importedCount: number;
    matchedCount: number;
    partiallyMatchedCount: number;
    unmatchedCount: number;
  }> {
    this.checkPermission(context, 'payments.record');
    const input = Import26ASInputSchema.parse(rawInput);

    // Fetch existing recorded TDS for this agency that are not yet MATCHED
    const { data: candidateRows } = await this.supabase
      .from('tds_receivables')
      .select('id, amount, section, is_valid, invoice_id')
      .eq('agency_id', context.agencyId)
      .neq('form_26as_status', 'MATCHED');

    const candidates: InternalTdsCandidate[] = (candidateRows || []).map((r) => ({
      id: r.id,
      amount: r.amount,
      section: r.section,
      isValid: r.is_valid,
    }));

    let matchedCount = 0;
    let partiallyMatchedCount = 0;
    let unmatchedCount = 0;

    for (const rec of input.records) {
      const matchRes = match26ASRecord(
        {
          deductorTan: input.deductor_tan,
          financialYear: input.financial_year,
          section: rec.section,
          tdsDeducted: rec.tds_deducted,
          amountPaid: rec.amount_paid,
        },
        candidates
      );

      const { data: insertedRec } = await this.supabase
        .from('form_26as_records')
        .insert({
          agency_id: context.agencyId,
          financial_year: input.financial_year,
          deductor_tan: input.deductor_tan,
          deductor_name: input.deductor_name || null,
          section: rec.section,
          transaction_date: rec.transaction_date || null,
          booking_date: rec.booking_date || null,
          amount_paid: rec.amount_paid,
          tds_deducted: rec.tds_deducted,
          status: matchRes.status,
          matched_tds_id: matchRes.matchedTdsId || null,
        })
        .select('id')
        .single();

      if (matchRes.status === 'MATCHED' && matchRes.matchedTdsId) {
        matchedCount++;
        // Update the internal TDS receivable status to MATCHED
        await this.supabase
          .from('tds_receivables')
          .update({
            form_26as_status: 'MATCHED',
            match_metadata: {
              form_26as_record_id: insertedRec?.id,
              deductor_tan: input.deductor_tan,
              financial_year: input.financial_year,
              matched_at: new Date().toISOString(),
            },
          })
          .eq('id', matchRes.matchedTdsId);
      } else if (matchRes.status === 'PARTIALLY_MATCHED') {
        partiallyMatchedCount++;
      } else {
        unmatchedCount++;
      }
    }

    return {
      importedCount: input.records.length,
      matchedCount,
      partiallyMatchedCount,
      unmatchedCount,
    };
  }

  /**
   * 7. Client Ledger & Running Balance
   */
  async getClientLedger(
    agencyId: string,
    clientId: string
  ): Promise<ClientLedgerEntry[]> {
    // 1. Fetch Invoices (Debits)
    const { data: invoices } = await this.supabase
      .from('invoices')
      .select('id, invoice_number, issue_date, total_amount, status')
      .eq('agency_id', agencyId)
      .eq('client_id', clientId)
      .neq('status', 'CANCELLED');

    // 2. Fetch Allocations (Credits)
    const { data: allocations } = await this.supabase
      .from('payment_allocations')
      .select('id, allocated_amount, created_at, payment_id, client_payments(utr_number, payment_mode)')
      .eq('agency_id', agencyId);

    // 3. Fetch TDS Receivables (Credits)
    const { data: tdsRecords } = await this.supabase
      .from('tds_receivables')
      .select('id, amount, created_at, section, invoice_id')
      .eq('agency_id', agencyId)
      .eq('client_id', clientId)
      .eq('is_valid', true);

    const rawEntries: Array<{
      date: string;
      transactionType: 'INVOICE' | 'PAYMENT' | 'TDS_CREDIT' | 'CREDIT_NOTE';
      referenceId: string;
      referenceNumber: string;
      debit: Decimal;
      credit: Decimal;
      note?: string;
    }> = [];

    (invoices || []).forEach((inv) => {
      rawEntries.push({
        date: inv.issue_date,
        transactionType: 'INVOICE',
        referenceId: inv.id,
        referenceNumber: inv.invoice_number,
        debit: new Decimal(inv.total_amount),
        credit: new Decimal('0.00'),
        note: `Tax Invoice Issued`,
      });
    });

    (allocations || []).forEach((alloc) => {
      const pm = (alloc as any).client_payments;
      rawEntries.push({
        date: alloc.created_at.split('T')[0],
        transactionType: 'PAYMENT',
        referenceId: alloc.id,
        referenceNumber: pm?.utr_number || 'REMITTANCE',
        debit: new Decimal('0.00'),
        credit: new Decimal(alloc.allocated_amount),
        note: `Payment Allocation (${pm?.payment_mode || 'BANK'})`,
      });
    });

    (tdsRecords || []).forEach((tds) => {
      rawEntries.push({
        date: tds.created_at.split('T')[0],
        transactionType: 'TDS_CREDIT',
        referenceId: tds.id,
        referenceNumber: `TDS-${tds.section}`,
        debit: new Decimal('0.00'),
        credit: new Decimal(tds.amount),
        note: `Section ${tds.section} Withheld`,
      });
    });

    // Sort chronologically
    rawEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Compute running balance
    let currentBalance = new Decimal('0.00');
    return rawEntries.map((e) => {
      currentBalance = currentBalance.plus(e.debit).minus(e.credit);
      return {
        date: e.date,
        transactionType: e.transactionType,
        referenceId: e.referenceId,
        referenceNumber: e.referenceNumber,
        debit: e.debit.toFixed(2),
        credit: e.credit.toFixed(2),
        balance: currentBalance.toFixed(2),
        note: e.note,
      };
    });
  }

  /**
   * 8. Aging Analysis (0-30, 31-60, 61-90, 90+ days)
   */
  async getAgingSummary(
    agencyId: string,
    asOfDate?: string
  ): Promise<AgingReportSummary> {
    const { data: invoices } = await this.supabase
      .from('invoices')
      .select('id, invoice_number, issue_date, due_date, total_amount, status')
      .eq('agency_id', agencyId)
      .neq('status', 'CANCELLED');

    const invoiceIds = (invoices || []).map((i) => i.id);

    const { data: allocations } = await this.supabase
      .from('payment_allocations')
      .select('invoice_id, allocated_amount')
      .eq('agency_id', agencyId)
      .in('invoice_id', invoiceIds.length > 0 ? invoiceIds : ['00000000-0000-0000-0000-000000000000']);

    const { data: tdsList } = await this.supabase
      .from('tds_receivables')
      .select('invoice_id, amount, is_valid')
      .eq('agency_id', agencyId)
      .eq('is_valid', true)
      .in('invoice_id', invoiceIds.length > 0 ? invoiceIds : ['00000000-0000-0000-0000-000000000000']);

    const allocMap = new Map<string, Decimal>();
    (allocations || []).forEach((a) => {
      const prev = allocMap.get(a.invoice_id) || new Decimal('0.00');
      allocMap.set(a.invoice_id, prev.plus(new Decimal(a.allocated_amount)));
    });

    const tdsMap = new Map<string, Decimal>();
    (tdsList || []).forEach((t) => {
      const prev = tdsMap.get(t.invoice_id) || new Decimal('0.00');
      tdsMap.set(t.invoice_id, prev.plus(new Decimal(t.amount)));
    });

    const agingData: AgingInvoiceData[] = (invoices || []).map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      issueDate: inv.issue_date,
      dueDate: inv.due_date,
      totalAmount: inv.total_amount,
      allocatedAmount: (allocMap.get(inv.id) || new Decimal('0.00')).toFixed(2),
      validTds: (tdsMap.get(inv.id) || new Decimal('0.00')).toFixed(2),
    }));

    return calculateAgingBuckets(agingData, asOfDate);
  }

  /**
   * 9. Recovery Hub Categorization
   */
  async getRecoveryHub(agencyId: string): Promise<RecoveryHubItem[]> {
    // 1. Fetch unbilled closed/approved cases
    const { data: unbilledCases } = await this.supabase
      .from('cases')
      .select('id, case_number, claim_number, status, approved_at, clients(id, name), client_branches(branch_name)')
      .eq('agency_id', agencyId)
      .in('status', ['APPROVED', 'CLOSED'])
      .is('invoice_id', null);

    // 2. Fetch unpaid issued invoices
    const { data: unpaidInvoices } = await this.supabase
      .from('invoices')
      .select('id, invoice_number, issue_date, total_amount, status, client_id, clients(name), client_branches(branch_name)')
      .eq('agency_id', agencyId)
      .in('status', ['ISSUED', 'PARTIALLY_PAID']);

    const invoiceIds = (unpaidInvoices || []).map((i) => i.id);

    const { data: allocations } = await this.supabase
      .from('payment_allocations')
      .select('invoice_id, allocated_amount')
      .eq('agency_id', agencyId)
      .in('invoice_id', invoiceIds.length > 0 ? invoiceIds : ['00000000-0000-0000-0000-000000000000']);

    const { data: tdsList } = await this.supabase
      .from('tds_receivables')
      .select('invoice_id, amount')
      .eq('agency_id', agencyId)
      .eq('is_valid', true)
      .in('invoice_id', invoiceIds.length > 0 ? invoiceIds : ['00000000-0000-0000-0000-000000000000']);

    const allocMap = new Map<string, Decimal>();
    (allocations || []).forEach((a) => {
      const prev = allocMap.get(a.invoice_id) || new Decimal('0.00');
      allocMap.set(a.invoice_id, prev.plus(new Decimal(a.allocated_amount)));
    });

    const tdsMap = new Map<string, Decimal>();
    (tdsList || []).forEach((t) => {
      const prev = tdsMap.get(t.invoice_id) || new Decimal('0.00');
      tdsMap.set(t.invoice_id, prev.plus(new Decimal(t.amount)));
    });

    const invoiceItems = (unpaidInvoices || []).map((inv) => {
      const total = new Decimal(inv.total_amount);
      const rec = allocMap.get(inv.id) || new Decimal('0.00');
      const tds = tdsMap.get(inv.id) || new Decimal('0.00');
      const outstanding = calculateInvoiceOutstanding(total, rec, tds);

      return {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        clientId: inv.client_id,
        clientName: (inv.clients as any)?.name || 'Unknown Client',
        branchName: (inv.client_branches as any)?.branch_name,
        issueDate: inv.issue_date,
        totalAmount: inv.total_amount,
        outstandingAmount: outstanding.toFixed(2),
        status: inv.status,
      };
    });

    const caseItems = (unbilledCases || []).map((c) => ({
      id: c.id,
      caseNumber: c.case_number,
      claimNumber: c.claim_number,
      clientName: (c.clients as any)?.name || 'Unknown Client',
      clientId: (c.clients as any)?.id || '',
      branchName: (c.client_branches as any)?.branch_name,
      status: c.status,
      approvedDate: c.approved_at,
      estimatedFee: '0.00',
    }));

    return classifyRecoveryItems(invoiceItems, caseItems);
  }

  /**
   * 10. Statutory Profit & Loss Report (Q-CA-01)
   * Strictly separates GST collected from agency revenue.
   */
  async getProfitReport(
    agencyId: string,
    periodStart?: string,
    periodEnd?: string,
    includeLegacy = false
  ): Promise<ProfitAndLossReport> {
    let invQuery = this.supabase
      .from('invoices')
      .select('taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, status')
      .eq('agency_id', agencyId);

    if (periodStart) invQuery = invQuery.gte('issue_date', periodStart);
    if (periodEnd) invQuery = invQuery.lte('issue_date', periodEnd);

    const { data: invoices } = await invQuery;

    let payQuery = this.supabase
      .from('client_payments')
      .select('amount')
      .eq('agency_id', agencyId);

    if (periodStart) payQuery = payQuery.gte('payment_date', periodStart);
    if (periodEnd) payQuery = payQuery.lte('payment_date', periodEnd);

    const { data: payments } = await payQuery;

    const { data: tdsList } = await this.supabase
      .from('tds_receivables')
      .select('amount, is_valid')
      .eq('agency_id', agencyId);

    // Fetch investigator payables (when payouts table is ready, currently stubbed or fetched from cases)
    const investigatorPayables: Array<{ amount: string; isApproved: boolean }> = [];

    const mappedInvoices = (invoices || []).map((i) => ({
      taxableAmount: i.taxable_amount,
      cgstAmount: i.cgst_amount,
      sgstAmount: i.sgst_amount,
      igstAmount: i.igst_amount,
      totalAmount: i.total_amount,
      status: i.status,
    }));

    const mappedTds = (tdsList || []).map((t) => ({
      amount: t.amount,
      isValid: t.is_valid,
    }));

    return calculateProfitAndLoss({
      periodStart,
      periodEnd,
      invoices: mappedInvoices,
      payments: payments || [],
      tdsRecords: mappedTds,
      investigatorPayables,
      includeLegacyComparison: includeLegacy,
    });
  }
}
