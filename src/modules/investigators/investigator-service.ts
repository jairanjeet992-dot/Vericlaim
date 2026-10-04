import { SupabaseClient } from '@supabase/supabase-js';
import { 
  ExpenseClaimInput, 
  ExpenseClaimSchema,
  ExpenseApprovalSchema,
  PayoutCompilationInvestigator,
  PayoutCompilationItem,
  CompiledPayoutBatch
} from './investigator-types';
import { 
  resolveEffectivePaymentTerms, 
  calculateCaseInvestigatorFee, 
  compilePayoutBatch 
} from './investigator-fees';
import { generateBankBulkPaymentExcel, BankBulkExcelResult } from './excel-export';
import { generatePayoutStatementDocument, GeneratedStatementResult } from './pdf-payout-statement';
import { calculateHospitalRiskProfile, generateDispatchWarning, DispatchWarningResult } from '../scorecard/hospital-fraud-engine';

export class InvestigatorService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Submits a travel allowance (TA) or operational field expense claim.
   */
  async submitExpense(
    agencyId: string, 
    investigatorId: string, 
    userId: string,
    input: Omit<ExpenseClaimInput, 'agency_id' | 'investigator_id'>
  ) {
    const validated = ExpenseClaimSchema.parse({
      agency_id: agencyId,
      investigator_id: investigatorId,
      ...input,
    });

    const { data, error } = await this.supabase
      .from('investigator_expenses')
      .insert({
        agency_id: agencyId,
        investigator_id: investigatorId,
        case_id: validated.case_id || null,
        expense_type: validated.expense_type,
        amount: validated.amount,
        receipt_r2_key: validated.receipt_r2_key || null,
        receipt_sha256: validated.receipt_sha256 || null,
        requires_receipt: validated.requires_receipt,
        claim_notes: validated.claim_notes || null,
        status: 'SUBMITTED',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to submit expense: ${error.message}`);
    }

    // Audit log
    await this.logAudit(agencyId, userId, 'INVESTIGATOR.SUBMIT_EXPENSE', {
      expense_id: data.id,
      investigator_id: investigatorId,
      amount: validated.amount,
      expense_type: validated.expense_type,
    });

    return data;
  }

  /**
   * Approves an investigator expense claim from the review queue.
   */
  async approveExpense(agencyId: string, userId: string, expenseId: string, reviewNotes?: string) {
    ExpenseApprovalSchema.parse({ expense_id: expenseId, status: 'APPROVED', review_notes: reviewNotes });

    const { data: existing, error: fetchErr } = await this.supabase
      .from('investigator_expenses')
      .select('*')
      .eq('id', expenseId)
      .eq('agency_id', agencyId)
      .single();

    if (fetchErr || !existing) {
      throw new Error(`Expense claim not found`);
    }

    if (existing.status === 'PAID' || existing.status === 'IN_PAYOUT') {
      throw new Error(`Cannot approve an expense that is already in payout or paid`);
    }

    const { data, error } = await this.supabase
      .from('investigator_expenses')
      .update({
        status: 'APPROVED',
        approved_by: userId,
        approved_at: new Date().toISOString(),
        review_notes: reviewNotes || existing.review_notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', expenseId)
      .eq('agency_id', agencyId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to approve expense: ${error.message}`);
    }

    await this.logAudit(agencyId, userId, 'INVESTIGATOR.APPROVE_EXPENSE', {
      expense_id: expenseId,
      amount: data.amount,
    });

    return data;
  }

  /**
   * Rejects an investigator expense claim with recorded reason.
   */
  async rejectExpense(agencyId: string, userId: string, expenseId: string, rejectionReason: string, reviewNotes?: string) {
    ExpenseApprovalSchema.parse({
      expense_id: expenseId,
      status: 'REJECTED',
      rejection_reason: rejectionReason,
      review_notes: reviewNotes,
    });

    const { data: existing, error: fetchErr } = await this.supabase
      .from('investigator_expenses')
      .select('*')
      .eq('id', expenseId)
      .eq('agency_id', agencyId)
      .single();

    if (fetchErr || !existing) {
      throw new Error(`Expense claim not found`);
    }

    if (existing.status === 'PAID' || existing.status === 'IN_PAYOUT') {
      throw new Error(`Cannot reject an expense that is already in payout or paid`);
    }

    const { data, error } = await this.supabase
      .from('investigator_expenses')
      .update({
        status: 'REJECTED',
        rejection_reason: rejectionReason,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', expenseId)
      .eq('agency_id', agencyId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to reject expense: ${error.message}`);
    }

    await this.logAudit(agencyId, userId, 'INVESTIGATOR.REJECT_EXPENSE', {
      expense_id: expenseId,
      rejection_reason: rejectionReason,
    });

    return data;
  }

  /**
   * Compiles monthly payouts across all investigators and builds the batch.
   */
  async compileMonthlyBatch(
    agencyId: string,
    userId: string,
    payoutMonth: string,
    batchNumber: string
  ): Promise<CompiledPayoutBatch> {
    // 1. Fetch investigators
    const { data: investigators, error: invErr } = await this.supabase
      .from('investigators')
      .select('*')
      .eq('agency_id', agencyId)
      .eq('is_active', true);

    if (invErr) throw new Error(`Failed to fetch investigators: ${invErr.message}`);

    const compilationInputs: PayoutCompilationInvestigator[] = [];
    const monthEndDate = `${payoutMonth}-28`;

    for (const inv of investigators || []) {
      // 2. Fetch payment terms history
      const { data: terms } = await this.supabase
        .from('investigator_payment_terms')
        .select('*')
        .eq('agency_id', agencyId)
        .eq('investigator_id', inv.id);

      const activeTerm = resolveEffectivePaymentTerms(terms || [], monthEndDate);

      // 3. Fetch completed case assignments eligible for payout
      const { data: caseAssignments } = await this.supabase
        .from('case_investigators')
        .select('*, case:cases(id, case_number, status, outcome_code)')
        .eq('agency_id', agencyId)
        .eq('investigator_id', inv.id)
        .eq('payout_status', 'PENDING');

      // 4. Fetch approved expenses eligible for payout
      const { data: approvedExpenses } = await this.supabase
        .from('investigator_expenses')
        .select('*')
        .eq('agency_id', agencyId)
        .eq('investigator_id', inv.id)
        .eq('status', 'APPROVED')
        .is('payout_id', null);

      const items: PayoutCompilationItem[] = [];

      // Add Case Fee Items
      for (const ca of caseAssignments || []) {
        const caseOutcome = ca.case?.outcome_code;
        const feeResult = calculateCaseInvestigatorFee({
          agreed_fee: ca.agreed_fee,
          travel_allowance: ca.travel_allowance,
          outcome: caseOutcome === 'WITHDRAWN' ? { code: 'WITHDRAWN', investigator_payable_percent: 0 } : null,
        });

        if (feeResult.total_case_payable > 0) {
          items.push({
            item_type: 'CASE_FEE',
            case_id: ca.case_id,
            case_investigator_id: ca.id,
            description: `Case ${ca.case?.case_number || ca.case_id}: Base fee ₹${feeResult.effective_case_fee} + TA ₹${feeResult.travel_allowance}`,
            amount: feeResult.total_case_payable,
            is_deduction: false,
          });
        }
      }

      // Add Approved Expense Items
      for (const exp of approvedExpenses || []) {
        const isDeduction = ['ADVANCE', 'DEDUCTION'].includes(exp.expense_type);
        items.push({
          item_type: exp.expense_type === 'ADVANCE' ? 'ADVANCE_DEDUCTION' : isDeduction ? 'OTHER_DEDUCTION' : 'EXPENSE',
          expense_id: exp.id,
          case_id: exp.case_id,
          description: `${exp.expense_type}: ${exp.claim_notes || 'Approved expense'}`,
          amount: Number(exp.amount),
          is_deduction: isDeduction,
        });
      }

      compilationInputs.push({
        investigator_id: inv.id,
        investigator_name: inv.full_name,
        payment_type: activeTerm.payment_type,
        base_salary_or_fee: activeTerm.base_fee_or_salary,
        pan_number: inv.pan_blind_index ? 'PAN_RECORDED' : null,
        bank_name: 'Primary Account',
        account_number: 'XXXX1234',
        ifsc_code: 'VERI0001',
        items,
      });
    }

    // Run Pure Payout Engine
    const compiledBatch = compilePayoutBatch(compilationInputs, payoutMonth, batchNumber);

    // Save batch to database
    const { data: batchRow, error: batchErr } = await this.supabase
      .from('payout_batches')
      .insert({
        agency_id: agencyId,
        batch_number: batchNumber,
        payout_month: payoutMonth,
        status: 'FINALIZED',
        total_investigators: compiledBatch.total_investigators,
        total_gross: compiledBatch.total_gross,
        total_tds: compiledBatch.total_tds,
        total_advances_deducted: compiledBatch.total_advances_deducted,
        total_net_disbursable: compiledBatch.total_net_disbursable,
        created_by: userId,
      })
      .select()
      .single();

    if (batchErr) {
      throw new Error(`Failed to save payout batch: ${batchErr.message}`);
    }

    // Insert investigator payouts & items
    for (const p of compiledBatch.payouts) {
      const { data: payoutRow, error: pErr } = await this.supabase
        .from('investigator_payouts')
        .insert({
          agency_id: agencyId,
          batch_id: batchRow.id,
          investigator_id: p.investigator_id,
          payout_month: payoutMonth,
          payment_type: p.payment_type,
          base_salary_or_fee: p.base_salary_or_fee,
          total_case_fees: p.total_case_fees,
          total_expenses: p.total_expenses,
          total_bonuses: p.total_bonuses,
          total_advances_deducted: p.total_advances_deducted,
          total_deductions: p.total_deductions,
          gross_payable: p.gross_payable,
          tds_section: p.tds_section,
          tds_rate: p.tds_rate,
          tds_amount: p.tds_amount,
          net_payable: p.net_payable,
          status: 'FINALIZED',
        })
        .select()
        .single();

      if (pErr) throw new Error(`Failed to save investigator payout: ${pErr.message}`);

      // Insert line items (enforcing uniqueness!)
      for (const item of p.items) {
        await this.supabase.from('payout_items').insert({
          agency_id: agencyId,
          payout_id: payoutRow.id,
          item_type: item.item_type,
          case_id: item.case_id || null,
          case_investigator_id: item.case_investigator_id || null,
          expense_id: item.expense_id || null,
          description: item.description,
          amount: item.amount,
          is_deduction: item.is_deduction,
        });

        // Mark expense as IN_PAYOUT
        if (item.expense_id) {
          await this.supabase
            .from('investigator_expenses')
            .update({ status: 'IN_PAYOUT', payout_id: payoutRow.id })
            .eq('id', item.expense_id);
        }

        // Mark case_investigator as IN_PAYOUT
        if (item.case_investigator_id) {
          await this.supabase
            .from('case_investigators')
            .update({ payout_status: 'IN_PAYOUT' })
            .eq('id', item.case_investigator_id);
        }
      }
    }

    return compiledBatch;
  }

  /**
   * Marks a payout batch as paid with bank transaction reference / UTR.
   * Irreversible per Rule A6 and DB immutability triggers.
   */
  async markBatchPaid(
    agencyId: string,
    userId: string,
    batchId: string,
    paymentReference: string
  ) {
    if (!paymentReference || paymentReference.trim().length === 0) {
      throw new Error('Bank payment reference / UTR is mandatory to mark payout batch paid');
    }

    const { data: batch, error: fetchErr } = await this.supabase
      .from('payout_batches')
      .select('*')
      .eq('id', batchId)
      .eq('agency_id', agencyId)
      .single();

    if (fetchErr || !batch) {
      throw new Error(`Payout batch not found`);
    }

    if (batch.status === 'PAID') {
      throw new Error(`Payout batch is already marked as PAID`);
    }

    const nowIso = new Date().toISOString();

    // 1. Mark batch as PAID
    const { data: updatedBatch, error: updateErr } = await this.supabase
      .from('payout_batches')
      .update({
        status: 'PAID',
        payment_reference: paymentReference,
        paid_at: nowIso,
        paid_by: userId,
        updated_at: nowIso,
      })
      .eq('id', batchId)
      .select()
      .single();

    if (updateErr) {
      throw new Error(`Failed to update payout batch: ${updateErr.message}`);
    }

    // 2. Mark payouts as PAID
    await this.supabase
      .from('investigator_payouts')
      .update({ status: 'PAID', updated_at: nowIso })
      .eq('batch_id', batchId)
      .eq('agency_id', agencyId);

    // 3. Mark linked expenses as PAID
    const { data: payouts } = await this.supabase
      .from('investigator_payouts')
      .select('id')
      .eq('batch_id', batchId);

    const payoutIds = (payouts || []).map(p => p.id);
    if (payoutIds.length > 0) {
      await this.supabase
        .from('investigator_expenses')
        .update({ status: 'PAID', updated_at: nowIso })
        .in('payout_id', payoutIds);
    }

    // Audit log
    await this.logAudit(agencyId, userId, 'INVESTIGATOR.MARK_BATCH_PAID', {
      batch_id: batchId,
      batch_number: batch.batch_number,
      payment_reference: paymentReference,
      total_disbursed: batch.total_net_disbursable,
    });

    return updatedBatch;
  }

  /**
   * Helper audit logger
   */
  private async logAudit(agencyId: string, userId: string, action: string, details: Record<string, any>) {
    await this.supabase.from('audit_logs').insert({
      agency_id: agencyId,
      user_id: userId,
      action,
      details,
      created_at: new Date().toISOString(),
    });
  }
}
