import { SupabaseClient } from '@supabase/supabase-js';
import { validateGstin } from '@/lib/validation/gstin';
import { maskPan, maskBankAccount, decryptField } from '@/lib/security/encryption';
import { recordAuditLog } from '../audit/service';
import {
  CreateInvestigatorInput,
  InvestigatorPaymentTerm,
  prepareInvestigatorDbRecord,
} from './investigators';
import { CaseTypeInput } from './case-types';

export class MastersService {
  constructor(private supabase: SupabaseClient) {}

  // ---------------------------------------------------------------------------
  // 1. CLIENTS & BRANCHES
  // ---------------------------------------------------------------------------
  async createClient(actorUserId: string, agencyId: string, input: {
    name: string;
    code: string;
    type?: 'INSURER' | 'TPA' | 'CORPORATE';
    default_payment_terms_days?: number;
    default_sla_hours?: number;
  }) {
    const { data, error } = await this.supabase
      .from('clients')
      .insert({
        agency_id: agencyId,
        name: input.name,
        code: input.code.trim().toUpperCase(),
        type: input.type || 'INSURER',
        default_payment_terms_days: input.default_payment_terms_days || 30,
        default_sla_hours: input.default_sla_hours || 48,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create client: ${error.message}`);

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'CLIENT_CREATE',
      entity_type: 'client',
      entity_id: data.id,
      new_values: { name: data.name, code: data.code },
    });

    return data;
  }

  async createClientBranch(actorUserId: string, agencyId: string, input: {
    client_id: string;
    branch_name: string;
    branch_code: string;
    legal_name: string;
    gstin: string;
    state: string;
    state_code: string;
    billing_address?: string;
    is_default?: boolean;
  }) {
    // 1. GSTIN format + checksum validation
    const gstinValidation = validateGstin(input.gstin, input.state_code);
    if (!gstinValidation.isValid) {
      throw new Error(`GSTIN Validation Failed: ${gstinValidation.error}`);
    }

    const { data, error } = await this.supabase
      .from('client_branches')
      .insert({
        agency_id: agencyId,
        client_id: input.client_id,
        branch_name: input.branch_name,
        branch_code: input.branch_code.trim().toUpperCase(),
        legal_name: input.legal_name,
        gstin: input.gstin.trim().toUpperCase(),
        state: input.state,
        state_code: input.state_code,
        billing_address: input.billing_address || '',
        is_default: input.is_default || false,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create client branch: ${error.message}`);

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'CLIENT_BRANCH_CREATE',
      entity_type: 'client_branch',
      entity_id: data.id,
      new_values: { branch_name: data.branch_name, gstin: data.gstin },
    });

    return data;
  }

  async listClients(agencyId: string) {
    const { data, error } = await this.supabase
      .from('clients')
      .select('*, client_branches(*)')
      .eq('agency_id', agencyId)
      .order('name');

    if (error) throw new Error(error.message);
    return data || [];
  }

  // ---------------------------------------------------------------------------
  // 2. CONFIGURABLE CASE TYPES
  // ---------------------------------------------------------------------------
  async createCaseType(actorUserId: string, agencyId: string, input: CaseTypeInput) {
    const { data, error } = await this.supabase
      .from('case_types')
      .insert({
        agency_id: agencyId,
        code: input.code,
        name: input.name,
        default_sla_hours: input.default_sla_hours,
        default_fee_rule: input.default_fee_rule,
        custom_field_definitions: input.custom_field_definitions,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create case type: ${error.message}`);

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'CASE_TYPE_CREATE',
      entity_type: 'case_type',
      entity_id: data.id,
      new_values: { code: data.code, name: data.name },
    });

    return data;
  }

  async listCaseTypes(agencyId: string) {
    const { data, error } = await this.supabase
      .from('case_types')
      .select('*')
      .eq('agency_id', agencyId)
      .order('name');

    if (error) throw new Error(error.message);
    return data || [];
  }

  // ---------------------------------------------------------------------------
  // 3. OUTCOMES & EXCEPTION RULES
  // ---------------------------------------------------------------------------
  async createOutcome(actorUserId: string, agencyId: string, input: {
    code: string;
    name: string;
    category: 'PENDING' | 'GENUINE' | 'FRAUD' | 'SUSPICIOUS' | 'REPUDIATED' | 'EXCEPTION';
    financial_rule?: Record<string, any>;
  }) {
    const { data, error } = await this.supabase
      .from('outcomes')
      .insert({
        agency_id: agencyId,
        code: input.code.trim().toUpperCase(),
        name: input.name,
        category: input.category,
        financial_rule: input.financial_rule || { investigator_payable_percent: 100 },
        is_active: true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create outcome: ${error.message}`);

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'OUTCOME_CREATE',
      entity_type: 'outcome',
      entity_id: data.id,
      new_values: { code: data.code, name: data.name, category: data.category },
    });

    return data;
  }

  async listOutcomes(agencyId: string) {
    const { data, error } = await this.supabase
      .from('outcomes')
      .select('*')
      .eq('agency_id', agencyId)
      .order('code');

    if (error) throw new Error(error.message);
    return data || [];
  }

  // ---------------------------------------------------------------------------
  // 4. SLA POLICIES
  // ---------------------------------------------------------------------------
  async createSlaPolicy(actorUserId: string, agencyId: string, input: {
    name: string;
    target_hours: number;
    warning_threshold_percent?: number;
    is_agency_default?: boolean;
  }) {
    // If setting default, unset existing default
    if (input.is_agency_default) {
      await this.supabase
        .from('sla_policies')
        .update({ is_agency_default: false })
        .eq('agency_id', agencyId);
    }

    const { data, error } = await this.supabase
      .from('sla_policies')
      .insert({
        agency_id: agencyId,
        name: input.name,
        target_hours: input.target_hours,
        warning_threshold_percent: input.warning_threshold_percent || 75,
        is_agency_default: input.is_agency_default || false,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create SLA policy: ${error.message}`);

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'SLA_POLICY_CREATE',
      entity_type: 'sla_policy',
      entity_id: data.id,
      new_values: { name: data.name, target_hours: data.target_hours },
    });

    return data;
  }

  async listSlaPolicies(agencyId: string) {
    const { data, error } = await this.supabase
      .from('sla_policies')
      .select('*')
      .eq('agency_id', agencyId)
      .order('target_hours');

    if (error) throw new Error(error.message);
    return data || [];
  }

  // ---------------------------------------------------------------------------
  // 5. INVESTIGATORS & PAYMENT TERMS
  // ---------------------------------------------------------------------------
  async createInvestigator(actorUserId: string, agencyId: string, input: CreateInvestigatorInput) {
    const dbRecord = prepareInvestigatorDbRecord(agencyId, input);

    const { data: inv, error: invError } = await this.supabase
      .from('investigators')
      .insert(dbRecord)
      .select()
      .single();

    if (invError || !inv) {
      throw new Error(`Failed to create investigator: ${invError?.message}`);
    }

    // Add initial payment term if specified
    if (input.initial_payment_term) {
      await this.supabase.from('investigator_payment_terms').insert({
        agency_id: agencyId,
        investigator_id: inv.id,
        payment_type: input.initial_payment_term.payment_type,
        base_fee_or_salary: input.initial_payment_term.base_fee_or_salary,
        effective_from: input.initial_payment_term.effective_from,
        created_by: actorUserId,
      });
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'INVESTIGATOR_CREATE',
      entity_type: 'investigator',
      entity_id: inv.id,
      new_values: { code: inv.code, full_name: inv.full_name, city: inv.city },
    });

    return inv;
  }

  async addPaymentTerm(actorUserId: string, agencyId: string, input: {
    investigator_id: string;
    payment_type: 'PER_CASE' | 'SALARY';
    base_fee_or_salary: number;
    effective_from: string;
    effective_to?: string | null;
  }) {
    const { data, error } = await this.supabase
      .from('investigator_payment_terms')
      .insert({
        agency_id: agencyId,
        investigator_id: input.investigator_id,
        payment_type: input.payment_type,
        base_fee_or_salary: input.base_fee_or_salary,
        effective_from: input.effective_from,
        effective_to: input.effective_to || null,
        created_by: actorUserId,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to add payment term: ${error.message}`);

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'INVESTIGATOR_PAYMENT_TERM_ADD',
      entity_type: 'investigator_payment_term',
      entity_id: data.id,
      new_values: {
        payment_type: data.payment_type,
        effective_from: data.effective_from,
        amount: data.base_fee_or_salary,
      },
    });

    return data;
  }

  async listInvestigators(agencyId: string) {
    const { data, error } = await this.supabase
      .from('investigators')
      .select('*, investigator_payment_terms(*)')
      .eq('agency_id', agencyId)
      .order('full_name');

    if (error) throw new Error(error.message);

    // Return records with masked PII for safe display
    return (data || []).map((inv: any) => {
      let maskedPanVal = 'Not on file';
      let maskedBankVal = 'Not on file';

      if (inv.pan_encrypted) {
        try {
          const rawPan = decryptField(inv.pan_encrypted);
          maskedPanVal = maskPan(rawPan);
        } catch {
          maskedPanVal = 'ENCRYPTED';
        }
      }

      if (inv.bank_account_encrypted) {
        try {
          const rawBank = decryptField(inv.bank_account_encrypted);
          maskedBankVal = maskBankAccount(rawBank);
        } catch {
          maskedBankVal = 'ENCRYPTED';
        }
      }

      return {
        ...inv,
        pan_display: maskedPanVal,
        bank_account_display: maskedBankVal,
        // Strip raw ciphertext from generic response
        pan_encrypted: undefined,
        bank_account_encrypted: undefined,
      };
    });
  }
}
