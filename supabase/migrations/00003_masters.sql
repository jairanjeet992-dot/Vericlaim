-- ==============================================================================
-- Vericlaim Multi-Tenant SaaS: Master Entities, Configurable Rules & Coverage
-- Migration: 00003_masters.sql
-- ==============================================================================

-- 1. ENHANCE CLIENTS TABLE (Add billing & SLA config)
ALTER TABLE public.clients 
  ADD COLUMN IF NOT EXISTS type varchar(16) NOT NULL DEFAULT 'INSURER' CHECK (type IN ('INSURER', 'TPA', 'CORPORATE')),
  ADD COLUMN IF NOT EXISTS default_payment_terms_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS default_sla_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS billing_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. CLIENT BRANCHES TABLE
CREATE TABLE IF NOT EXISTS public.client_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  branch_name varchar(128) NOT NULL,
  branch_code varchar(32) NOT NULL,
  legal_name text NOT NULL,
  gstin varchar(15) NOT NULL,
  state varchar(64) NOT NULL,
  state_code varchar(2) NOT NULL,
  billing_address text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_client_branch_code UNIQUE (agency_id, client_id, branch_code)
);

CREATE INDEX IF NOT EXISTS idx_client_branches_agency ON public.client_branches(agency_id, client_id);
ALTER TABLE public.client_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_branches_tenant_read" ON public.client_branches;
CREATE POLICY "client_branches_tenant_read" ON public.client_branches
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "client_branches_tenant_modify" ON public.client_branches;
CREATE POLICY "client_branches_tenant_modify" ON public.client_branches
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 3. CLIENT CONTACTS TABLE
CREATE TABLE IF NOT EXISTS public.client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.client_branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  designation varchar(64),
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_contacts_tenant_read" ON public.client_contacts;
CREATE POLICY "client_contacts_tenant_read" ON public.client_contacts
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "client_contacts_tenant_modify" ON public.client_contacts;
CREATE POLICY "client_contacts_tenant_modify" ON public.client_contacts
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 4. CLIENT RATE CARDS TABLE
CREATE TABLE IF NOT EXISTS public.client_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_type varchar(32) NOT NULL,
  base_fee numeric(14,2) NOT NULL DEFAULT 0.00,
  extra_km_rate numeric(14,2) NOT NULL DEFAULT 0.00,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_client_rate_card UNIQUE (agency_id, client_id, case_type, effective_from)
);

ALTER TABLE public.client_rate_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_rate_cards_tenant_read" ON public.client_rate_cards;
CREATE POLICY "client_rate_cards_tenant_read" ON public.client_rate_cards
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "client_rate_cards_tenant_modify" ON public.client_rate_cards;
CREATE POLICY "client_rate_cards_tenant_modify" ON public.client_rate_cards
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 5. CONFIGURABLE CASE TYPES (JSON-driven custom fields & rules)
CREATE TABLE IF NOT EXISTS public.case_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  code varchar(32) NOT NULL,
  name text NOT NULL,
  default_sla_hours integer NOT NULL DEFAULT 48,
  default_fee_rule jsonb NOT NULL DEFAULT '{"base_fee": 1500.00}'::jsonb,
  custom_field_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_case_type_code UNIQUE (agency_id, code)
);

ALTER TABLE public.case_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_types_tenant_read" ON public.case_types;
CREATE POLICY "case_types_tenant_read" ON public.case_types
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "case_types_tenant_modify" ON public.case_types;
CREATE POLICY "case_types_tenant_modify" ON public.case_types
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 6. OUTCOMES & EXCEPTION FINANCIAL RULES TABLE
CREATE TABLE IF NOT EXISTS public.outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  code varchar(32) NOT NULL,
  name text NOT NULL,
  category varchar(32) NOT NULL CHECK (category IN ('PENDING', 'GENUINE', 'FRAUD', 'SUSPICIOUS', 'REPUDIATED', 'EXCEPTION')),
  financial_rule jsonb NOT NULL DEFAULT '{"investigator_payable_percent": 100}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_outcome_code UNIQUE (agency_id, code)
);

ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outcomes_tenant_read" ON public.outcomes;
CREATE POLICY "outcomes_tenant_read" ON public.outcomes
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "outcomes_tenant_modify" ON public.outcomes;
CREATE POLICY "outcomes_tenant_modify" ON public.outcomes
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 7. SLA POLICIES TABLE (12h, 24h, 48h, 72h, 120h, custom with one agency default)
CREATE TABLE IF NOT EXISTS public.sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  name varchar(64) NOT NULL,
  target_hours integer NOT NULL CHECK (target_hours > 0),
  warning_threshold_percent integer NOT NULL DEFAULT 75,
  is_agency_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_sla_name UNIQUE (agency_id, name)
);

ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sla_policies_tenant_read" ON public.sla_policies;
CREATE POLICY "sla_policies_tenant_read" ON public.sla_policies
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "sla_policies_tenant_modify" ON public.sla_policies;
CREATE POLICY "sla_policies_tenant_modify" ON public.sla_policies
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 8. INVESTIGATORS TABLE (With Encrypted Sensitive Fields & Coverage)
CREATE TABLE IF NOT EXISTS public.investigators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  code varchar(32) NOT NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  email text,
  -- Encrypted PII per A7
  pan_encrypted text,
  pan_blind_index text,
  bank_account_encrypted text,
  ifsc_encrypted text,
  -- Geographic Coverage
  state varchar(64) NOT NULL DEFAULT '',
  district varchar(64) NOT NULL DEFAULT '',
  city varchar(64) NOT NULL DEFAULT '',
  areas text[] NOT NULL DEFAULT '{}',
  pincodes text[] NOT NULL DEFAULT '{}',
  radius_km integer NOT NULL DEFAULT 50,
  -- Operational Capacity
  is_available boolean NOT NULL DEFAULT true,
  max_active_cases integer NOT NULL DEFAULT 15,
  specializations text[] NOT NULL DEFAULT '{}',
  case_types text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_investigator_code UNIQUE (agency_id, code)
);

CREATE INDEX IF NOT EXISTS idx_investigators_agency ON public.investigators(agency_id);
CREATE INDEX IF NOT EXISTS idx_investigators_pan_blind ON public.investigators(agency_id, pan_blind_index);

ALTER TABLE public.investigators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investigators_tenant_read" ON public.investigators;
CREATE POLICY "investigators_tenant_read" ON public.investigators
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "investigators_tenant_modify" ON public.investigators;
CREATE POLICY "investigators_tenant_modify" ON public.investigators
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 9. INVESTIGATOR PAYMENT TERMS (Effective-Dated Terms Ledger)
CREATE TABLE IF NOT EXISTS public.investigator_payment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  investigator_id uuid NOT NULL REFERENCES public.investigators(id) ON DELETE CASCADE,
  payment_type varchar(16) NOT NULL CHECK (payment_type IN ('PER_CASE', 'SALARY')),
  base_fee_or_salary numeric(14,2) NOT NULL DEFAULT 0.00,
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_effective_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_inv_payment_terms_lookup 
  ON public.investigator_payment_terms(agency_id, investigator_id, effective_from, effective_to);

ALTER TABLE public.investigator_payment_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investigator_payment_terms_read" ON public.investigator_payment_terms;
CREATE POLICY "investigator_payment_terms_read" ON public.investigator_payment_terms
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "investigator_payment_terms_modify" ON public.investigator_payment_terms;
CREATE POLICY "investigator_payment_terms_modify" ON public.investigator_payment_terms
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 10. SEED DEFAULT OUTCOMES & SLA POLICIES FUNCTION
CREATE OR REPLACE FUNCTION public.seed_agency_masters(p_agency_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Seed Standard Outcomes
  INSERT INTO public.outcomes (agency_id, code, name, category, financial_rule) VALUES
    (p_agency_id, 'PENDING', 'Investigation Pending', 'PENDING', '{"investigator_payable_percent": 100}'::jsonb),
    (p_agency_id, 'GENUINE', 'Claim Genuine', 'GENUINE', '{"investigator_payable_percent": 100}'::jsonb),
    (p_agency_id, 'FRAUD', 'Confirmed Fraud', 'FRAUD', '{"investigator_payable_percent": 100}'::jsonb),
    (p_agency_id, 'SUSPICIOUS', 'Suspicious / Inconclusive', 'SUSPICIOUS', '{"investigator_payable_percent": 100}'::jsonb),
    (p_agency_id, 'REPUDIATED', 'Repudiated by Insurer', 'REPUDIATED', '{"investigator_payable_percent": 100}'::jsonb),
    (p_agency_id, 'WITHDRAWN', 'Case Withdrawn by Insurer', 'EXCEPTION', '{"investigator_payable_percent": 0}'::jsonb)
  ON CONFLICT (agency_id, code) DO NOTHING;

  -- Seed Default SLA Policies
  INSERT INTO public.sla_policies (agency_id, name, target_hours, warning_threshold_percent, is_agency_default) VALUES
    (p_agency_id, 'Standard TAT (48 Hours)', 48, 75, true),
    (p_agency_id, 'Express Spot (24 Hours)', 24, 80, false),
    (p_agency_id, 'Urgent Cashless (12 Hours)', 12, 85, false),
    (p_agency_id, 'Complex Project (120 Hours)', 120, 70, false)
  ON CONFLICT (agency_id, name) DO NOTHING;

  -- Seed Default Case Types
  INSERT INTO public.case_types (agency_id, code, name, default_sla_hours, default_fee_rule) VALUES
    (p_agency_id, 'PA', 'Personal Accident', 48, '{"base_fee": 1500.00}'::jsonb),
    (p_agency_id, 'Cashless', 'Cashless Hospitalization', 24, '{"base_fee": 1200.00}'::jsonb),
    (p_agency_id, 'Reimbursement', 'Reimbursement Claim', 48, '{"base_fee": 1500.00}'::jsonb),
    (p_agency_id, 'MB', 'Mediclaim Bill Verification', 48, '{"base_fee": 1000.00}'::jsonb),
    (p_agency_id, 'FVR', 'Field Verification Report', 48, '{"base_fee": 1200.00}'::jsonb),
    (p_agency_id, 'Spot', 'Spot Accident Investigation', 24, '{"base_fee": 2000.00}'::jsonb),
    (p_agency_id, 'Project', 'Special Project Investigation', 120, '{"base_fee": 3500.00}'::jsonb),
    (p_agency_id, 'Hospicash', 'Hospital Daily Cash', 48, '{"base_fee": 1000.00}'::jsonb),
    (p_agency_id, 'Post Facto', 'Post Facto Verification', 72, '{"base_fee": 1800.00}'::jsonb)
  ON CONFLICT (agency_id, code) DO NOTHING;
END;
$$;
