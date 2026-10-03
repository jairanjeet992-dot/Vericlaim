import { z } from 'zod';
import Decimal from 'decimal.js';
import { encryptField, computeBlindIndex, decryptField, maskPan, maskBankAccount } from '@/lib/security/encryption';

export const PaymentTypeSchema = z.enum(['PER_CASE', 'SALARY']);
export type PaymentType = z.infer<typeof PaymentTypeSchema>;

export const InvestigatorPaymentTermSchema = z.object({
  id: z.string().uuid().optional(),
  agency_id: z.string().uuid().optional(),
  investigator_id: z.string().uuid(),
  payment_type: PaymentTypeSchema,
  base_fee_or_salary: z.number().nonnegative(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required'),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required').optional().nullable(),
});

export type InvestigatorPaymentTerm = z.infer<typeof InvestigatorPaymentTermSchema>;

export const CreateInvestigatorSchema = z.object({
  user_id: z.string().uuid().optional().nullable(),
  code: z.string().min(2).max(32).transform((v) => v.trim().toUpperCase()),
  full_name: z.string().min(2),
  phone: z.string().min(10),
  email: z.string().email().optional().nullable(),
  // Raw PII inputs to be encrypted
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid Indian PAN format').optional().nullable(),
  bank_account: z.string().min(9).max(18).optional().nullable(),
  bank_account_number: z.string().min(9).max(18).optional().nullable(),
  bank_name: z.string().optional().nullable(),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid Indian IFSC code').optional().nullable(),
  bank_ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid Indian IFSC code').optional().nullable(),
  // Coverage
  state: z.string().default('Madhya Pradesh'),
  district: z.string().default('Indore'),
  city: z.string().default('Indore'),
  areas: z.array(z.string()).default([]),
  pincodes: z.array(z.string()).default([]),
  radius_km: z.number().int().positive().default(50),
  // Capacity & Specialization
  is_available: z.boolean().default(true),
  max_active_cases: z.number().int().positive().default(15),
  specializations: z.array(z.string()).default(['Hospitalization', 'Accident']),
  case_types: z.array(z.string()).default(['PA', 'Cashless', 'Reimbursement']),
  initial_payment_term: z.object({
    payment_type: PaymentTypeSchema,
    base_fee_or_salary: z.number().nonnegative(),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).optional(),
});

export type CreateInvestigatorInput = z.input<typeof CreateInvestigatorSchema>;

/**
 * Resolves the effective payment term for an investigator on a specific case date.
 * Compliant with Golden Tests TEST-03, TEST-04.
 */
export function resolveEffectivePaymentTerm(
  terms: InvestigatorPaymentTerm[],
  caseDate: string
): InvestigatorPaymentTerm | null {
  if (!terms || terms.length === 0) return null;

  // Filter eligible terms where effective_from <= caseDate AND (effective_to IS NULL OR effective_to >= caseDate)
  const eligible = terms.filter((term) => {
    const isAfterStart = term.effective_from <= caseDate;
    const isBeforeEnd = !term.effective_to || term.effective_to >= caseDate;
    return isAfterStart && isBeforeEnd;
  });

  if (eligible.length === 0) return null;

  // Sort by effective_from descending (most recently applicable term takes precedence)
  eligible.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return eligible[0];
}

export interface FeeCalculationResult {
  effective_fee: number;
  effective_ta: number;
  total_payable: number;
  is_salaried: boolean;
  exception_applied?: string | null;
}

/**
 * Calculates investigator payable fee for a case based on effective payment terms,
 * salary transitions, and exception rules (TEST-01 to TEST-05).
 */
export function calculateInvestigatorFeeForCase(params: {
  term: InvestigatorPaymentTerm | null;
  enteredFee: number;
  enteredTa: number;
  exceptionType?: string | null;
}): FeeCalculationResult {
  const { term, enteredFee, enteredTa, exceptionType } = params;

  // 1. Exception Rule (TEST-05): Withdrawn case forces investigator payable to 0
  if (exceptionType === 'Withdrawn') {
    return {
      effective_fee: 0,
      effective_ta: 0,
      total_payable: 0,
      is_salaried: term?.payment_type === 'SALARY',
      exception_applied: 'Withdrawn',
    };
  }

  const ta = new Decimal(enteredTa || 0);

  // 2. Salaried Investigator Rule (TEST-03): Fee is 0.00, TA is preserved
  if (term && term.payment_type === 'SALARY') {
    return {
      effective_fee: 0,
      effective_ta: ta.toNumber(),
      total_payable: ta.toNumber(),
      is_salaried: true,
      exception_applied: null,
    };
  }

  // 3. Per Case Investigator Rule (TEST-01, TEST-04): Fee + TA
  const fee = new Decimal(enteredFee || 0);
  const total = fee.plus(ta);

  return {
    effective_fee: fee.toNumber(),
    effective_ta: ta.toNumber(),
    total_payable: total.toNumber(),
    is_salaried: false,
    exception_applied: null,
  };
}

/**
 * Prepares encrypted database record for an investigator
 */
export function prepareInvestigatorDbRecord(agencyId: string, input: CreateInvestigatorInput) {
  const parsed = CreateInvestigatorSchema.parse(input);
  return {
    agency_id: agencyId,
    user_id: parsed.user_id || null,
    code: parsed.code,
    full_name: parsed.full_name,
    phone: parsed.phone,
    email: parsed.email || null,
    // PII encryption with HMAC blind index
    pan_encrypted: parsed.pan ? encryptField(parsed.pan) : null,
    pan_blind_index: parsed.pan ? computeBlindIndex(parsed.pan) : null,
    bank_account_encrypted: (parsed.bank_account || parsed.bank_account_number)
      ? encryptField((parsed.bank_account || parsed.bank_account_number)!)
      : null,
    ifsc_encrypted: (parsed.ifsc || parsed.bank_ifsc)
      ? encryptField((parsed.ifsc || parsed.bank_ifsc)!)
      : null,
    state: parsed.state,
    district: parsed.district,
    city: parsed.city,
    areas: parsed.areas,
    pincodes: parsed.pincodes,
    radius_km: parsed.radius_km,
    is_available: parsed.is_available,
    max_active_cases: parsed.max_active_cases,
    specializations: parsed.specializations,
    case_types: parsed.case_types,
    is_active: true,
  };
}
