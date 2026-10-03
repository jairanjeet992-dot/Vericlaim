/**
 * E-Invoice (IRN / E-Way Bill) Integration Interface & Stub
 *
 * NOTE: Rule A11 explicitly mandates that live e-invoicing is not built yet.
 * This file provides the standardized domain interface and stub implementation,
 * marked as "NOT IMPLEMENTED / STUB ONLY (CA-VERIFY)".
 */

export interface EInvoiceAuthCredentials {
  gstin: string;
  username: string;
  password?: string;
  appKey?: string;
}

export interface GenerateIrnRequest {
  invoiceId: string;
  invoiceNumber: string;
  financialYear: string;
  supplierGstin: string;
  recipientGstin: string;
  taxableAmount: string;
  totalTaxAmount: string;
  totalAmount: string;
  placeOfSupplyStateCode: string;
  isIntraState: boolean;
  isReverseCharge: boolean;
}

export interface GenerateIrnResponse {
  isSuccess: boolean;
  irn?: string;
  ackNo?: string;
  ackDate?: string;
  signedQrCode?: string;
  signedInvoice?: string;
  status: 'PENDING' | 'GENERATED' | 'FAILED' | 'NOT_IMPLEMENTED';
  errorMessage?: string;
}

export interface CancelIrnRequest {
  irn: string;
  cancellationReasonCode: '1' | '2' | '3' | '4'; // 1=Duplicate, 2=Data entry mistake, 3=Order cancelled, 4=Others
  cancellationRemarks: string;
}

export interface CancelIrnResponse {
  isSuccess: boolean;
  cancelDate?: string;
  status: 'CANCELLED' | 'FAILED' | 'NOT_IMPLEMENTED';
  errorMessage?: string;
}

export interface EInvoiceProvider {
  generateIrn(request: GenerateIrnRequest): Promise<GenerateIrnResponse>;
  cancelIrn(request: CancelIrnRequest): Promise<CancelIrnResponse>;
  isLive(): boolean;
}

/**
 * Stub implementation of EInvoiceProvider.
 * Emits clearly documented "NOT_IMPLEMENTED" responses.
 */
export class StubEInvoiceProvider implements EInvoiceProvider {
  isLive(): boolean {
    return false;
  }

  async generateIrn(request: GenerateIrnRequest): Promise<GenerateIrnResponse> {
    return {
      isSuccess: false,
      status: 'NOT_IMPLEMENTED',
      errorMessage:
        'CA-VERIFY: E-Invoice IRN API generation is disabled in current phase per Architecture Rule A11. Invoices are issued locally under standard GST compliance with sequential gapless numbering and R2 PDF archiving.',
    };
  }

  async cancelIrn(request: CancelIrnRequest): Promise<CancelIrnResponse> {
    return {
      isSuccess: false,
      status: 'NOT_IMPLEMENTED',
      errorMessage:
        'CA-VERIFY: E-Invoice IRN cancellation is disabled in current phase per Architecture Rule A11.',
    };
  }
}

export const defaultEInvoiceProvider = new StubEInvoiceProvider();
