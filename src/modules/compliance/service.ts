import { SupabaseClient } from '@supabase/supabase-js';
import { computeBlindIndex } from '@/lib/security/encryption';
import { recordAuditLog } from '@/modules/audit/service';
import {
  ConsentRecord,
  DataDeletionRequest,
  BreachLog,
  DataRetentionPolicy
} from './types';

export class ComplianceService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Records explicit, purpose-specific consent under DPDP Act 2023 Section 6
   */
  async recordConsent(
    agencyId: string,
    userId: string,
    params: {
      caseId?: string;
      dataPrincipalName: string;
      dataPrincipalPhone?: string;
      consentPurpose: string;
      consentType?: 'DIGITAL' | 'PHYSICAL_FORM' | 'AUDIO_RECORDING' | 'POLICY_TERMS';
      evidenceDocumentId?: string;
    }
  ): Promise<ConsentRecord> {
    const phoneBlindIndex = params.dataPrincipalPhone
      ? computeBlindIndex(params.dataPrincipalPhone)
      : null;

    const { data, error } = await this.supabase
      .from('consent_records')
      .insert({
        agency_id: agencyId,
        case_id: params.caseId || null,
        data_principal_name: params.dataPrincipalName.trim(),
        data_principal_phone_blind_index: phoneBlindIndex,
        consent_purpose: params.consentPurpose,
        consent_type: params.consentType || 'DIGITAL',
        status: 'ACTIVE',
        evidence_document_id: params.evidenceDocumentId || null,
        created_by: userId,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to record consent: ${error.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: userId,
      action: 'CONSENT_RECORDED',
      entity_type: 'consent_record',
      entity_id: data.id,
      new_values: {
        principal: params.dataPrincipalName,
        purpose: params.consentPurpose,
        type: params.consentType || 'DIGITAL',
      },
    });

    return data;
  }

  /**
   * Logs a withdrawal of consent under Section 6(4) DPDP Act
   */
  async withdrawConsent(
    agencyId: string,
    consentId: string,
    userId: string
  ): Promise<ConsentRecord> {
    const { data, error } = await this.supabase
      .from('consent_records')
      .update({
        status: 'WITHDRAWN',
        withdrawn_at: new Date().toISOString(),
      })
      .eq('id', consentId)
      .eq('agency_id', agencyId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to withdraw consent: ${error.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: userId,
      action: 'CONSENT_WITHDRAWN',
      entity_type: 'consent_record',
      entity_id: consentId,
    });

    return data;
  }

  /**
   * Submits a formal Data Deletion / Erasure request under DPDP Act Section 12
   */
  async submitErasureRequest(
    agencyId: string,
    params: {
      dataPrincipalName: string;
      dataPrincipalIdentifier: string;
      requestType: 'ERASURE' | 'ANONYMIZATION' | 'DATA_PORTABILITY' | 'RECTIFICATION';
    }
  ): Promise<DataDeletionRequest> {
    const reqNumber = `ERAS-${Date.now().toString().slice(-8)}`;

    const { data, error } = await this.supabase
      .from('data_deletion_requests')
      .insert({
        agency_id: agencyId,
        request_number: reqNumber,
        data_principal_name: params.dataPrincipalName.trim(),
        data_principal_identifier: params.dataPrincipalIdentifier.trim(),
        request_type: params.requestType,
        status: 'PENDING',
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to submit deletion request: ${error.message}`);
    }

    return data;
  }

  /**
   * Evaluates and processes an Erasure request.
   * If legal retention overrides exist (e.g. CGST Act Section 36 - 8 year retention on tax invoices),
   * the request is rejected with explicit statutory basis under Section 17 of DPDP Act 2023.
   */
  async evaluateErasureRequest(
    agencyId: string,
    requestId: string,
    userId: string,
    decision: 'APPROVE' | 'REJECT_LEGAL_OVERRIDE',
    legalBasis?: string,
    notes?: string
  ): Promise<DataDeletionRequest> {
    const status = decision === 'APPROVE' ? 'COMPLETED' : 'REJECTED_LEGAL_OVERRIDE';

    const { data, error } = await this.supabase
      .from('data_deletion_requests')
      .update({
        status,
        rejection_legal_basis: decision === 'REJECT_LEGAL_OVERRIDE' ? legalBasis || 'Statutory retention requirement under Section 17(1)(b) DPDP Act (CGST Act Sec 36)' : null,
        processed_at: new Date().toISOString(),
        processed_by: userId,
        audit_notes: notes || null,
      })
      .eq('id', requestId)
      .eq('agency_id', agencyId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to evaluate deletion request: ${error.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: userId,
      action: decision === 'APPROVE' ? 'DATA_ERASURE_COMPLETED' : 'DATA_ERASURE_REJECTED_STATUTORY',
      entity_type: 'data_deletion_request',
      entity_id: requestId,
      new_values: {
        decision,
        legal_basis: legalBasis,
      },
    });

    return data;
  }

  /**
   * Logs a security breach incident to the mandatory register.
   * CERT-In requires notification within 6 hours of discovery;
   * Data Protection Board of India requires notification within 72 hours.
   */
  async logBreachIncident(
    agencyId: string,
    userId: string,
    params: {
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      affectedPrincipalsCount: number;
      natureOfBreach: string;
      compromisedDataCategories: string[];
      detectedAt?: string;
      reportedToDpb?: boolean;
      reportedToCertIn?: boolean;
      remediationActions?: string;
    }
  ): Promise<BreachLog> {
    const incNumber = `INC-${Date.now().toString().slice(-8)}`;

    const { data, error } = await this.supabase
      .from('breach_logs')
      .insert({
        agency_id: agencyId,
        incident_number: incNumber,
        severity: params.severity,
        affected_principals_count: params.affectedPrincipalsCount,
        nature_of_breach: params.natureOfBreach,
        compromised_data_categories: params.compromisedDataCategories,
        detected_at: params.detectedAt || new Date().toISOString(),
        reported_to_dpb: params.reportedToDpb || false,
        dpb_reported_at: params.reportedToDpb ? new Date().toISOString() : null,
        reported_to_cert_in: params.reportedToCertIn || false,
        cert_in_reported_at: params.reportedToCertIn ? new Date().toISOString() : null,
        remediation_actions: params.remediationActions || null,
        status: 'OPEN',
        created_by: userId,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to log breach incident: ${error.message}`);
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: userId,
      action: 'SECURITY_BREACH_LOGGED',
      entity_type: 'breach_log',
      entity_id: data.id,
      new_values: {
        severity: params.severity,
        affected_principals: params.affectedPrincipalsCount,
      },
    });

    return data;
  }
}
