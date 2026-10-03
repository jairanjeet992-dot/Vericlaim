/**
 * Financial & Invoicing Domain Types (Phase 7A)
 */

import { CalculationMode } from './gst-engine';
export type { CalculationMode };

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'PARTIALLY_PAID' | 'CANCELLED';

export type InvoiceItemType =
  | 'PROFESSIONAL_FEE'
  | 'TRAVEL_CONVEYANCE'
  | 'STATIONERY_PRINTING'
  | 'MEDICAL_RECORD_FEES'
  | 'OTHER';

export type NoteType = 'CREDIT_NOTE' | 'DEBIT_NOTE';

export interface Invoice {
  id: string;
  agency_id: string;
  invoice_number: string;
  financial_year: string;
  client_id: string;
  client_branch_id: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string | null;
  place_of_supply_state_code: string;
  is_intra_state: boolean;
  is_reverse_charge: boolean;
  is_sez: boolean;
  calculation_mode: CalculationMode;
  subtotal_amount: string;
  discount_amount: string;
  taxable_amount: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  total_tax_amount: string;
  total_amount: string;
  amount_in_words: string;
  notes?: string | null;
  terms_and_conditions?: string | null;
  pdf_r2_key?: string | null;
  pdf_sha256?: string | null;
  is_immutable: boolean;
  version: number;
  created_by?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  agency_id: string;
  invoice_id: string;
  case_id?: string | null;
  item_type: InvoiceItemType;
  description: string;
  sac_code: string;
  quantity: string;
  unit_rate: string;
  taxable_amount: string;
  tax_rate: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  total_amount: string;
  created_at?: string;
}

export interface InvoiceTax {
  id: string;
  agency_id: string;
  invoice_id: string;
  tax_type: 'CGST' | 'SGST' | 'IGST';
  rate: string;
  taxable_base: string;
  tax_amount: string;
}

export interface CreditDebitNote {
  id: string;
  agency_id: string;
  note_number: string;
  note_type: NoteType;
  original_invoice_id: string;
  financial_year: string;
  reason: string;
  taxable_amount: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  total_amount: string;
  pdf_r2_key?: string | null;
  pdf_sha256?: string | null;
  is_immutable: boolean;
  created_by?: string | null;
  created_at: string;
}

export interface FullInvoiceDossier {
  invoice: Invoice;
  items: InvoiceItem[];
  taxes: InvoiceTax[];
  creditNotes: CreditDebitNote[];
  client?: {
    id: string;
    name: string;
    pan_number?: string;
  };
  clientBranch?: {
    id: string;
    branch_name: string;
    branch_code: string;
    legal_name: string;
    gstin: string;
    state: string;
    state_code: string;
    billing_address: string;
  };
  agency?: {
    id: string;
    name: string;
    gstin?: string;
    state_code: string;
    address: string;
  };
}
