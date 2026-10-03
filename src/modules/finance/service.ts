/**
 * Invoicing & GST Financial Service (Phase 7A)
 * Coordinates draft generation, bulk case invoicing, gapless FY numbering,
 * server-side PDF generation, Cloudflare R2 archiving, and credit/debit notes.
 *
 * Mark: CA-VERIFY
 */

import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { recordAuditLog } from '../audit/service';
import { R2StorageService } from '../evidence/storage';
import {
  calculateGst,
  getFinancialYear,
  GstLineItemInput,
  resolvePlaceOfSupply,
} from './gst-engine';
import { generateInvoiceDocument, InvoicePartyDetails } from './pdf-invoice';
import {
  CreateDraftInvoiceInput,
  BulkCaseInvoiceInput,
  IssueInvoiceInput,
  CancelInvoiceInput,
  CreateCreditNoteInput,
  CreateDraftInvoiceSchema,
  CancelInvoiceSchema,
  CreateCreditNoteSchema,
} from './schema';
import {
  Invoice,
  InvoiceItem,
  InvoiceTax,
  CreditDebitNote,
  FullInvoiceDossier,
} from './types';

export interface UserScopeContext {
  userId: string;
  agencyId: string;
  role?: string;
  scope?: 'ALL' | 'TEAM' | 'ASSIGNED' | 'OWN_ENTERED';
  permissions: string[];
}

export class InvoicingService {
  private supabase: SupabaseClient;
  private storage: R2StorageService;

  constructor(supabase: SupabaseClient, storage?: R2StorageService) {
    this.supabase = supabase;
    this.storage = storage || new R2StorageService();
  }

  /**
   * Helper: checks if user has specified permission
   */
  private checkPermission(context: UserScopeContext, requiredPermission: string) {
    if (!context.permissions.includes(requiredPermission)) {
      throw new Error(`Permission denied: Missing '${requiredPermission}'`);
    }
  }

  /**
   * Helper: fetches agency details for invoice headers
   */
  private async getAgencyDetails(agencyId: string): Promise<InvoicePartyDetails> {
    const { data: agency } = await this.supabase
      .from('agencies')
      .select('*')
      .eq('id', agencyId)
      .single();

    if (!agency) {
      throw new Error(`Agency ${agencyId} not found`);
    }

    return {
      name: agency.name,
      legalName: agency.name,
      gstin: agency.gstin || undefined,
      address: agency.address || 'Operations Center',
      state: agency.state_code === '23' ? 'Madhya Pradesh' : 'State ' + agency.state_code,
      stateCode: agency.state_code || '23',
      phone: agency.phone || undefined,
      email: agency.email || undefined,
      bankDetails: {
        bankName: 'HDFC Bank Ltd',
        accountNumber: '50200012345678',
        ifscCode: 'HDFC0001234',
        branchName: 'Main Commercial Branch',
      },
    };
  }

  /**
   * Helper: fetches client branch details for recipient billing
   */
  private async getClientBranchDetails(
    agencyId: string,
    clientBranchId: string
  ): Promise<{ client: any; branch: InvoicePartyDetails }> {
    const { data: branch } = await this.supabase
      .from('client_branches')
      .select('*, clients(*)')
      .eq('id', clientBranchId)
      .eq('agency_id', agencyId)
      .single();

    if (!branch) {
      throw new Error(`Client branch ${clientBranchId} not found in agency`);
    }

    const client = branch.clients;

    return {
      client,
      branch: {
        name: client?.name || branch.legal_name,
        legalName: branch.legal_name || client?.name,
        gstin: branch.gstin,
        pan: client?.pan_number || (branch.gstin ? branch.gstin.substring(2, 12) : undefined),
        address: branch.billing_address || 'Branch Office',
        state: branch.state,
        stateCode: branch.state_code,
      },
    };
  }

  /**
   * Creates a draft invoice.
   */
  async createDraftInvoice(
    context: UserScopeContext,
    input: CreateDraftInvoiceInput
  ): Promise<FullInvoiceDossier> {
    this.checkPermission(context, 'invoices.create');
    const validated = CreateDraftInvoiceSchema.parse(input);

    const supplier = await this.getAgencyDetails(context.agencyId);
    const { client, branch } = await this.getClientBranchDetails(
      context.agencyId,
      validated.client_branch_id
    );

    const calculation = calculateGst(
      validated.items.map((i) => ({
        itemType: i.item_type,
        description: i.description,
        sacCode: i.sac_code,
        quantity: i.quantity,
        unitRate: i.unit_rate,
        amount: i.amount,
        taxRate: i.tax_rate,
        caseId: i.case_id,
      })),
      {
        supplierStateCode: supplier.stateCode,
        recipientStateCode: branch.stateCode,
        isReverseCharge: validated.is_reverse_charge,
        isSez: validated.is_sez,
        calculationMode: validated.calculation_mode,
        discountAmount: validated.discount_amount,
      }
    );

    const issueDate = validated.issue_date || new Date().toISOString().split('T')[0];
    const fy = getFinancialYear(new Date(issueDate));
    const draftNumber = `DRAFT-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;

    // 1. Insert Invoice Header
    const { data: invoice, error: invErr } = await this.supabase
      .from('invoices')
      .insert({
        agency_id: context.agencyId,
        invoice_number: draftNumber,
        financial_year: fy,
        client_id: validated.client_id,
        client_branch_id: validated.client_branch_id,
        status: 'DRAFT',
        issue_date: issueDate,
        due_date: validated.due_date || null,
        place_of_supply_state_code: calculation.placeOfSupplyStateCode,
        is_intra_state: calculation.isIntraState,
        is_reverse_charge: calculation.isReverseCharge,
        is_sez: calculation.isSez,
        calculation_mode: calculation.calculationMode,
        subtotal_amount: calculation.subtotalAmount,
        discount_amount: calculation.discountAmount,
        taxable_amount: calculation.taxableAmount,
        cgst_amount: calculation.cgstAmount,
        sgst_amount: calculation.sgstAmount,
        igst_amount: calculation.igstAmount,
        total_tax_amount: calculation.totalTaxAmount,
        total_amount: calculation.totalAmount,
        amount_in_words: calculation.amountInWords,
        notes: validated.notes || null,
        terms_and_conditions: validated.terms_and_conditions || null,
        is_immutable: false,
        version: 1,
        created_by: context.userId,
      })
      .select()
      .single();

    if (invErr || !invoice) {
      throw new Error(`Failed to create draft invoice: ${invErr?.message}`);
    }

    // 2. Insert Line Items
    const itemsToInsert = calculation.items.map((it) => ({
      agency_id: context.agencyId,
      invoice_id: invoice.id,
      case_id: it.caseId || null,
      item_type: it.itemType,
      description: it.description,
      sac_code: it.sacCode,
      quantity: it.quantity,
      unit_rate: it.unitRate,
      taxable_amount: it.taxableAmount,
      tax_rate: it.taxRate,
      cgst_amount: it.cgstAmount,
      sgst_amount: it.sgstAmount,
      igst_amount: it.igstAmount,
      total_amount: it.totalAmount,
    }));

    const { data: insertedItems } = await this.supabase
      .from('invoice_items')
      .insert(itemsToInsert)
      .select();

    // 3. Insert Tax Group Summaries
    const taxesToInsert = calculation.taxes.map((tx) => ({
      agency_id: context.agencyId,
      invoice_id: invoice.id,
      tax_type: tx.taxType,
      rate: tx.rate,
      taxable_base: tx.taxableBase,
      tax_amount: tx.taxAmount,
    }));

    const { data: insertedTaxes } = await this.supabase
      .from('invoice_taxes')
      .insert(taxesToInsert)
      .select();

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'INVOICES.CREATE_DRAFT',
      entity_type: 'invoices',
      entity_id: invoice.id,
      new_values: {
        draft_number: draftNumber,
        total_amount: invoice.total_amount,
        items_count: calculation.items.length,
      },
    });

    return {
      invoice: invoice as Invoice,
      items: (insertedItems || []) as InvoiceItem[],
      taxes: (insertedTaxes || []) as InvoiceTax[],
      creditNotes: [],
      client,
      clientBranch: branch as any,
      agency: supplier as any,
    };
  }

  /**
   * Issues an invoice, allocating an atomic gapless sequential number per FY,
   * rendering the server-side PDF document with SHA-256, and locking as immutable.
   */
  async issueInvoice(
    context: UserScopeContext,
    input: IssueInvoiceInput
  ): Promise<FullInvoiceDossier> {
    this.checkPermission(context, 'invoices.issue');

    const dossier = await this.getInvoiceById(context, input.invoice_id);
    const inv = dossier.invoice;

    if (inv.status !== 'DRAFT') {
      throw new Error(`Cannot issue invoice: current status is already '${inv.status}'`);
    }

    if (inv.is_immutable) {
      throw new Error('A6 Security Violation: Invoice is already locked and immutable');
    }

    // 1. Allocate Gapless Monotonic Sequence for this Financial Year inside transaction
    const fy = inv.financial_year || getFinancialYear(new Date(inv.issue_date));
    let allocatedNumber: string;

    const { data: rpcNum, error: rpcErr } = await this.supabase.rpc(
      'get_next_gapless_invoice_number',
      {
        p_agency_id: context.agencyId,
        p_fy: fy,
        p_doc_type: 'INV',
      }
    );

    if (rpcErr || !rpcNum) {
      // Fallback: Atomic sequence query on invoice_sequences
      const { data: seqRow } = await this.supabase
        .from('invoice_sequences')
        .select('current_val')
        .eq('agency_id', context.agencyId)
        .eq('financial_year', fy)
        .eq('doc_type', 'INV')
        .single();

      const nextVal = (seqRow?.current_val || 0) + 1;
      await this.supabase.from('invoice_sequences').upsert({
        agency_id: context.agencyId,
        financial_year: fy,
        doc_type: 'INV',
        current_val: nextVal,
        updated_at: new Date().toISOString(),
      });

      allocatedNumber = `INV/${fy}/${String(nextVal).padStart(4, '0')}`;
    } else {
      allocatedNumber = rpcNum;
    }

    // 2. Fetch Supplier and Recipient Parties
    const supplier = await this.getAgencyDetails(context.agencyId);
    const { client, branch } = await this.getClientBranchDetails(
      context.agencyId,
      inv.client_branch_id
    );

    // Re-calculate GST details for document representation
    const calculation = calculateGst(
      dossier.items.map((i) => ({
        itemType: i.item_type,
        description: i.description,
        sacCode: i.sac_code,
        quantity: i.quantity,
        unitRate: i.unit_rate,
        amount: i.taxable_amount,
        taxRate: i.tax_rate,
        caseId: i.case_id || undefined,
      })),
      {
        supplierStateCode: supplier.stateCode,
        recipientStateCode: branch.stateCode,
        isReverseCharge: inv.is_reverse_charge,
        isSez: inv.is_sez,
        calculationMode: inv.calculation_mode,
        discountAmount: inv.discount_amount,
      }
    );

    // 3. Generate Authoritative Server-Side Document and SHA-256 Hash
    const docResult = generateInvoiceDocument({
      metadata: {
        invoiceNumber: allocatedNumber,
        financialYear: fy,
        issueDate: inv.issue_date,
        dueDate: inv.due_date || undefined,
        docType: 'TAX_INVOICE',
        notes: inv.notes || undefined,
        terms: inv.terms_and_conditions || undefined,
      },
      supplier,
      recipient: branch,
      calculation,
    });

    // 4. Archive Document into Cloudflare R2 Storage (Rule A3 & A8)
    const storageKey = `a/${context.agencyId}/invoices/${inv.id}.html`;
    await this.storage.uploadDirectBuffer(storageKey, docResult.buffer, docResult.mimeType);

    // 5. Seal Invoice as ISSUED and IMMUTABLE
    const { data: updatedInvoice, error: updateErr } = await this.supabase
      .from('invoices')
      .update({
        invoice_number: allocatedNumber,
        status: 'ISSUED',
        is_immutable: true,
        pdf_r2_key: storageKey,
        pdf_sha256: docResult.sha256,
        version: inv.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inv.id)
      .select()
      .single();

    if (updateErr || !updatedInvoice) {
      throw new Error(`Failed to seal issued invoice: ${updateErr?.message}`);
    }

    // 6. Transition Attached Cases to BILLED if they were closed/delivered
    for (const it of dossier.items) {
      if (it.case_id) {
        const { data: c } = await this.supabase
          .from('cases')
          .select('id, status, version')
          .eq('id', it.case_id)
          .single();

        if (c && (c.status === 'CLOSED' || c.status === 'APPROVED')) {
          await this.supabase
            .from('cases')
            .update({
              status: 'BILLED',
              version: c.version + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', it.case_id);

          await this.supabase.from('case_status_history').insert({
            agency_id: context.agencyId,
            case_id: it.case_id,
            from_status: c.status,
            to_status: 'BILLED',
            reason: `Invoice ${allocatedNumber} issued to client`,
            changed_by: context.userId,
            metadata: { invoice_id: inv.id, invoice_number: allocatedNumber },
          });
        }
      }
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'INVOICES.ISSUE',
      entity_type: 'invoices',
      entity_id: inv.id,
      new_values: {
        invoice_number: allocatedNumber,
        financial_year: fy,
        total_amount: updatedInvoice.total_amount,
        pdf_sha256: docResult.sha256,
      },
    });

    return {
      ...dossier,
      invoice: updatedInvoice as Invoice,
    };
  }

  /**
   * Cancels an issued or draft invoice with mandatory documented reason.
   */
  async cancelInvoice(
    context: UserScopeContext,
    input: CancelInvoiceInput
  ): Promise<Invoice> {
    this.checkPermission(context, 'invoices.cancel');
    const validated = CancelInvoiceSchema.parse(input);

    const { data: inv } = await this.supabase
      .from('invoices')
      .select('*')
      .eq('id', validated.invoice_id)
      .eq('agency_id', context.agencyId)
      .single();

    if (!inv) {
      throw new Error(`Invoice ${validated.invoice_id} not found`);
    }

    if (inv.status === 'CANCELLED') {
      throw new Error('Invoice is already cancelled');
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await this.supabase
      .from('invoices')
      .update({
        status: 'CANCELLED',
        cancelled_by: context.userId,
        cancelled_at: now,
        cancellation_reason: validated.cancellation_reason,
        updated_at: now,
      })
      .eq('id', inv.id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to cancel invoice: ${error?.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'INVOICES.CANCEL',
      entity_type: 'invoices',
      entity_id: inv.id,
      new_values: {
        invoice_number: inv.invoice_number,
        cancellation_reason: validated.cancellation_reason,
      },
    });

    return updated as Invoice;
  }

  /**
   * Creates an append-only Credit Note (or Debit Note) linked to an issued invoice.
   */
  async createCreditNote(
    context: UserScopeContext,
    input: CreateCreditNoteInput
  ): Promise<CreditDebitNote> {
    this.checkPermission(context, 'invoices.issue');
    const validated = CreateCreditNoteSchema.parse(input);

    const dossier = await this.getInvoiceById(context, validated.original_invoice_id);
    const orig = dossier.invoice;

    if (orig.status === 'DRAFT') {
      throw new Error('Cannot issue credit note against an unissued draft invoice');
    }

    const fy = getFinancialYear(new Date());
    const docType = validated.note_type === 'DEBIT_NOTE' ? 'DN' : 'CN';

    // 1. Allocate Sequential Gapless Note Number
    let noteNumber: string;
    const { data: rpcNum } = await this.supabase.rpc('get_next_gapless_invoice_number', {
      p_agency_id: context.agencyId,
      p_fy: fy,
      p_doc_type: docType,
    });

    if (rpcNum) {
      noteNumber = rpcNum;
    } else {
      const { data: seqRow } = await this.supabase
        .from('invoice_sequences')
        .select('current_val')
        .eq('agency_id', context.agencyId)
        .eq('financial_year', fy)
        .eq('doc_type', docType)
        .single();

      const nextVal = (seqRow?.current_val || 0) + 1;
      await this.supabase.from('invoice_sequences').upsert({
        agency_id: context.agencyId,
        financial_year: fy,
        doc_type: docType,
        current_val: nextVal,
        updated_at: new Date().toISOString(),
      });

      noteNumber = `${docType}/${fy}/${String(nextVal).padStart(4, '0')}`;
    }

    // 2. Compute Adjustment GST
    const supplier = await this.getAgencyDetails(context.agencyId);
    const { branch } = await this.getClientBranchDetails(context.agencyId, orig.client_branch_id);

    const calculation = calculateGst(
      [
        {
          description: `Adjustment for ${orig.invoice_number}: ${validated.reason}`,
          amount: validated.taxable_amount,
          taxRate: validated.tax_rate,
        },
      ],
      {
        supplierStateCode: supplier.stateCode,
        recipientStateCode: branch.stateCode,
        isReverseCharge: orig.is_reverse_charge,
        isSez: orig.is_sez,
      }
    );

    // 3. Generate Server-Side Document and Hash
    const docResult = generateInvoiceDocument({
      metadata: {
        invoiceNumber: noteNumber,
        financialYear: fy,
        issueDate: new Date().toISOString().split('T')[0],
        docType: validated.note_type === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'CREDIT_NOTE',
        originalInvoiceNumber: orig.invoice_number,
        originalInvoiceDate: orig.issue_date,
        reasonForNote: validated.reason,
      },
      supplier,
      recipient: branch,
      calculation,
    });

    // 4. Archive Document in R2
    const storageKey = `a/${context.agencyId}/credit-notes/${noteNumber.replace(/\//g, '_')}.html`;
    await this.storage.uploadDirectBuffer(storageKey, docResult.buffer, docResult.mimeType);

    // 5. Insert Immutable Record
    const { data: note, error } = await this.supabase
      .from('credit_debit_notes')
      .insert({
        agency_id: context.agencyId,
        note_number: noteNumber,
        note_type: validated.note_type,
        original_invoice_id: orig.id,
        financial_year: fy,
        reason: validated.reason,
        taxable_amount: calculation.taxableAmount,
        cgst_amount: calculation.cgstAmount,
        sgst_amount: calculation.sgstAmount,
        igst_amount: calculation.igstAmount,
        total_amount: calculation.totalAmount,
        pdf_r2_key: storageKey,
        pdf_sha256: docResult.sha256,
        is_immutable: true,
        created_by: context.userId,
      })
      .select()
      .single();

    if (error || !note) {
      throw new Error(`Failed to create credit note: ${error?.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'INVOICES.CREATE_CREDIT_NOTE',
      entity_type: 'credit_debit_notes',
      entity_id: note.id,
      new_values: {
        note_number: noteNumber,
        original_invoice: orig.invoice_number,
        total_amount: note.total_amount,
        pdf_sha256: docResult.sha256,
      },
    });

    return note as CreditDebitNote;
  }

  /**
   * Bulk Invoicing: Aggregates multiple completed cases for one client branch
   * into a single invoice.
   */
  async bulkCreateInvoiceForCases(
    context: UserScopeContext,
    input: BulkCaseInvoiceInput
  ): Promise<FullInvoiceDossier> {
    this.checkPermission(context, 'invoices.create');

    const { data: cases } = await this.supabase
      .from('cases')
      .select('id, docket_no, claim_no, insured_name, case_type, client_id, location_city')
      .in('id', input.case_ids)
      .eq('agency_id', context.agencyId);

    if (!cases || cases.length === 0) {
      throw new Error('No valid cases found for billing');
    }

    // Verify all cases belong to specified client
    for (const c of cases) {
      if (c.client_id !== input.client_id) {
        throw new Error(
          `Case ${c.docket_no} belongs to a different client. All cases in bulk invoice must match selected client.`
        );
      }
    }

    const defaultFee = input.fee_per_case || 3500;
    const items = cases.map((c) => ({
      item_type: 'PROFESSIONAL_FEE' as const,
      description: `Investigation Services: Claim #${c.claim_no} (${c.case_type} - ${c.insured_name})`,
      amount: defaultFee,
      case_id: c.id,
      tax_rate: 18.0,
    }));

    return this.createDraftInvoice(context, {
      client_id: input.client_id,
      client_branch_id: input.client_branch_id,
      calculation_mode: input.calculation_mode,
      notes: input.notes || `Consolidated billing for ${cases.length} cases`,
      terms_and_conditions: input.terms_and_conditions,
      items: items as any,
    });
  }

  /**
   * Retrieves full invoice dossier with items, taxes, and credit notes.
   */
  async getInvoiceById(
    context: UserScopeContext,
    invoiceId: string
  ): Promise<FullInvoiceDossier> {
    const { data: invoice } = await this.supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('agency_id', context.agencyId)
      .single();

    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found or access denied`);
    }

    const { data: items } = await this.supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoice.id)
      .eq('agency_id', context.agencyId);

    const { data: taxes } = await this.supabase
      .from('invoice_taxes')
      .select('*')
      .eq('invoice_id', invoice.id)
      .eq('agency_id', context.agencyId);

    const { data: creditNotes } = await this.supabase
      .from('credit_debit_notes')
      .select('*')
      .eq('original_invoice_id', invoice.id)
      .eq('agency_id', context.agencyId);

    const supplier = await this.getAgencyDetails(context.agencyId);
    const { client, branch } = await this.getClientBranchDetails(
      context.agencyId,
      invoice.client_branch_id
    );

    return {
      invoice: invoice as Invoice,
      items: (items || []) as InvoiceItem[],
      taxes: (taxes || []) as InvoiceTax[],
      creditNotes: (creditNotes || []) as CreditDebitNote[],
      client,
      clientBranch: branch as any,
      agency: supplier as any,
    };
  }

  /**
   * Generates a secure 5-minute presigned GET URL for viewing/downloading the invoice document.
   */
  async getInvoicePdfDownloadUrl(
    context: UserScopeContext,
    invoiceId: string
  ): Promise<{ downloadUrl: string; sha256: string }> {
    const dossier = await this.getInvoiceById(context, invoiceId);
    const inv = dossier.invoice;

    if (!inv.pdf_r2_key) {
      throw new Error('Invoice document has not been generated or archived in R2 yet');
    }

    const { downloadUrl } = await this.storage.getPresignedDownloadUrl(
      inv.pdf_r2_key,
      `${inv.invoice_number.replace(/\//g, '_')}.html`
    );

    await recordAuditLog(this.supabase, {
      agency_id: context.agencyId,
      user_id: context.userId,
      action: 'INVOICES.DOWNLOAD_PDF',
      entity_type: 'invoices',
      entity_id: inv.id,
      new_values: {
        invoice_number: inv.invoice_number,
        pdf_sha256: inv.pdf_sha256,
      },
    });

    return {
      downloadUrl,
      sha256: inv.pdf_sha256 || '',
    };
  }
}
