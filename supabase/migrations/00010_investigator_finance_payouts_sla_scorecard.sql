-- Migration 00010: Investigator Finance, Effective-Dated Terms, Expenses, Payout Batches, SLA Engine & Scorecard (Phase 8)
-- Implements Phase 8 verification gates and data safety guarantees.

-- 1. INVESTIGATOR FEE RULES (Per Case Type / Client / Location)
CREATE TABLE IF NOT EXISTS public.investigator_fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_type_id uuid REFERENCES public.case_types(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  state varchar(64) NOT NULL DEFAULT '',
  city varchar(64) NOT NULL DEFAULT '',
  base_fee numeric(14,2) NOT NULL DEFAULT 0.00,
  default_ta numeric(14,2) NOT NULL DEFAULT 0.00,
  special_allowance numeric(14,2) NOT NULL DEFAULT 0.00,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fee_rule_scope UNIQUE (agency_id, case_type_id, client_id, state, city)
);

CREATE INDEX IF NOT EXISTS idx_fee_rules_agency ON public.investigator_fee_rules(agency_id);
CREATE INDEX IF NOT EXISTS idx_fee_rules_lookup ON public.investigator_fee_rules(agency_id, case_type_id, client_id);

ALTER TABLE public.investigator_fee_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investigator_fee_rules' AND policyname = 'investigator_fee_rules_read'
  ) THEN
    CREATE POLICY "investigator_fee_rules_read" ON public.investigator_fee_rules
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investigator_fee_rules' AND policyname = 'investigator_fee_rules_modify'
  ) THEN
    CREATE POLICY "investigator_fee_rules_modify" ON public.investigator_fee_rules
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 2. PAYOUT BATCHES (Monthly bulk payment runs)
CREATE TABLE IF NOT EXISTS public.payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  batch_number varchar(64) NOT NULL,
  payout_month varchar(7) NOT NULL, -- Format: YYYY-MM
  status varchar(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FINALIZED', 'PAID', 'CANCELLED')),
  total_investigators integer NOT NULL DEFAULT 0,
  total_gross numeric(14,2) NOT NULL DEFAULT 0.00,
  total_tds numeric(14,2) NOT NULL DEFAULT 0.00,
  total_advances_deducted numeric(14,2) NOT NULL DEFAULT 0.00,
  total_net_disbursable numeric(14,2) NOT NULL DEFAULT 0.00,
  excel_r2_key text,
  excel_sha256 varchar(64),
  payment_reference text, -- UTR or bank bulk payment reference
  paid_at timestamptz,
  paid_by uuid REFERENCES public.users(id),
  created_by uuid REFERENCES public.users(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payout_batches_agency_batch UNIQUE (agency_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_payout_batches_agency_month ON public.payout_batches(agency_id, payout_month);
CREATE INDEX IF NOT EXISTS idx_payout_batches_status ON public.payout_batches(agency_id, status);

ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payout_batches' AND policyname = 'payout_batches_tenant_read'
  ) THEN
    CREATE POLICY "payout_batches_tenant_read" ON public.payout_batches
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payout_batches' AND policyname = 'payout_batches_tenant_modify'
  ) THEN
    CREATE POLICY "payout_batches_tenant_modify" ON public.payout_batches
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 3. INVESTIGATOR PAYOUTS (Per investigator per monthly batch)
CREATE TABLE IF NOT EXISTS public.investigator_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.payout_batches(id) ON DELETE CASCADE,
  investigator_id uuid NOT NULL REFERENCES public.investigators(id) ON DELETE RESTRICT,
  payout_month varchar(7) NOT NULL,
  payment_type varchar(16) NOT NULL CHECK (payment_type IN ('PER_CASE', 'SALARY')),
  base_salary_or_fee numeric(14,2) NOT NULL DEFAULT 0.00,
  total_case_fees numeric(14,2) NOT NULL DEFAULT 0.00,
  total_expenses numeric(14,2) NOT NULL DEFAULT 0.00,
  total_bonuses numeric(14,2) NOT NULL DEFAULT 0.00,
  total_advances_deducted numeric(14,2) NOT NULL DEFAULT 0.00,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0.00,
  gross_payable numeric(14,2) NOT NULL DEFAULT 0.00,
  tds_section varchar(16) NOT NULL DEFAULT '194J' CHECK (tds_section IN ('194J', '194C', '194H', 'OTHER')),
  tds_rate numeric(5,2) NOT NULL DEFAULT 10.00 CHECK (tds_rate >= 0.00 AND tds_rate <= 100.00),
  tds_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  net_payable numeric(14,2) NOT NULL DEFAULT 0.00,
  status varchar(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FINALIZED', 'PAID')),
  bank_name text,
  account_number text,
  ifsc_code text,
  pan_number text,
  pdf_r2_key text,
  pdf_sha256 varchar(64),
  is_supplement boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_investigator_payouts_open_month 
  ON public.investigator_payouts(agency_id, investigator_id, payout_month) 
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_investigator_payouts_batch ON public.investigator_payouts(agency_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_investigator_payouts_inv ON public.investigator_payouts(agency_id, investigator_id);

ALTER TABLE public.investigator_payouts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investigator_payouts' AND policyname = 'investigator_payouts_tenant_read'
  ) THEN
    CREATE POLICY "investigator_payouts_tenant_read" ON public.investigator_payouts
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investigator_payouts' AND policyname = 'investigator_payouts_tenant_modify'
  ) THEN
    CREATE POLICY "investigator_payouts_tenant_modify" ON public.investigator_payouts
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 4. INVESTIGATOR EXPENSES & TA CLAIMS
CREATE TABLE IF NOT EXISTS public.investigator_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  investigator_id uuid NOT NULL REFERENCES public.investigators(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  expense_type varchar(32) NOT NULL CHECK (
    expense_type IN (
      'TRAVEL_ALLOWANCE', 'FUEL', 'HOTEL', 'PRINTING_STATIONERY', 
      'HOSPITAL_RECORD_FEE', 'INFORMANT_FEE', 'BONUS', 'ADVANCE', 
      'DEDUCTION', 'OTHER'
    )
  ),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  receipt_r2_key text,
  receipt_sha256 varchar(64),
  requires_receipt boolean NOT NULL DEFAULT true,
  claim_notes text,
  status varchar(32) NOT NULL DEFAULT 'SUBMITTED' CHECK (
    status IN ('SUBMITTED', 'REVIEW', 'APPROVED', 'REJECTED', 'IN_PAYOUT', 'PAID')
  ),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  review_notes text,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  rejection_reason text,
  payout_id uuid REFERENCES public.investigator_payouts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_investigator_expenses_inv ON public.investigator_expenses(agency_id, investigator_id, status);
CREATE INDEX IF NOT EXISTS idx_investigator_expenses_case ON public.investigator_expenses(agency_id, case_id);
CREATE INDEX IF NOT EXISTS idx_investigator_expenses_payout ON public.investigator_expenses(payout_id);

ALTER TABLE public.investigator_expenses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investigator_expenses' AND policyname = 'investigator_expenses_tenant_read'
  ) THEN
    CREATE POLICY "investigator_expenses_tenant_read" ON public.investigator_expenses
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investigator_expenses' AND policyname = 'investigator_expenses_tenant_modify'
  ) THEN
    CREATE POLICY "investigator_expenses_tenant_modify" ON public.investigator_expenses
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 5. PAYOUT ITEMS (Line item details of fees, expenses, bonuses, and deductions)
CREATE TABLE IF NOT EXISTS public.payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  payout_id uuid NOT NULL REFERENCES public.investigator_payouts(id) ON DELETE CASCADE,
  item_type varchar(32) NOT NULL CHECK (
    item_type IN (
      'CASE_FEE', 'EXPENSE', 'BONUS', 'ADVANCE_DEDUCTION', 
      'OTHER_DEDUCTION', 'SALARY_BASE', 'SUPPLEMENTAL_ADJUSTMENT'
    )
  ),
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  case_investigator_id uuid REFERENCES public.case_investigators(id) ON DELETE SET NULL,
  expense_id uuid REFERENCES public.investigator_expenses(id) ON DELETE SET NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  is_deduction boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- CRITICAL VERIFICATION GATE 1: An expense/fee item belongs to only ONE payout!
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_items_expense 
  ON public.payout_items(agency_id, expense_id) 
  WHERE expense_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_items_case_investigator 
  ON public.payout_items(agency_id, case_investigator_id) 
  WHERE case_investigator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payout_items_payout ON public.payout_items(payout_id);

ALTER TABLE public.payout_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payout_items' AND policyname = 'payout_items_tenant_read'
  ) THEN
    CREATE POLICY "payout_items_tenant_read" ON public.payout_items
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payout_items' AND policyname = 'payout_items_tenant_modify'
  ) THEN
    CREATE POLICY "payout_items_tenant_modify" ON public.payout_items
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 6. IMMUTABILITY ENFORCEMENT ON PAID BATCHES (Rule A6: Paid batches immutable)
CREATE OR REPLACE FUNCTION public.prevent_paid_payout_batch_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PAID' THEN
      RAISE EXCEPTION 'A6 Immutability Violation: Cannot delete a PAID payout batch (%). Financial payouts are permanent.', OLD.batch_number;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'PAID' AND NEW.status != 'PAID' THEN
      RAISE EXCEPTION 'A6 Immutability Violation: Cannot revert or alter a PAID payout batch (%).', OLD.batch_number;
    END IF;
    IF OLD.status = 'PAID' THEN
      IF OLD.total_gross != NEW.total_gross OR 
         OLD.total_tds != NEW.total_tds OR 
         OLD.total_net_disbursable != NEW.total_net_disbursable THEN
        RAISE EXCEPTION 'A6 Immutability Violation: Cannot alter financial figures of a PAID payout batch.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_paid_payout_batch_mutation'
  ) THEN
    CREATE TRIGGER trg_prevent_paid_payout_batch_mutation
      BEFORE UPDATE OR DELETE ON public.payout_batches
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_paid_payout_batch_mutation();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.prevent_paid_payout_items_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_payout_status varchar(32);
BEGIN
  SELECT status INTO v_payout_status FROM public.investigator_payouts WHERE id = COALESCE(OLD.payout_id, NEW.payout_id);
  IF v_payout_status = 'PAID' THEN
    RAISE EXCEPTION 'A6 Immutability Violation: Cannot modify or delete payout items belonging to a PAID payout.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_paid_payout_items_mutation'
  ) THEN
    CREATE TRIGGER trg_prevent_paid_payout_items_mutation
      BEFORE UPDATE OR DELETE ON public.payout_items
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_paid_payout_items_mutation();
  END IF;
END $$;


-- 7. SLA EXCEPTIONS & TAT EXTENSION WORKFLOW
CREATE TABLE IF NOT EXISTS public.sla_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  extension_hours integer NOT NULL CHECK (extension_hours > 0),
  reason text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sla_exceptions_case ON public.sla_exceptions(agency_id, case_id);
CREATE INDEX IF NOT EXISTS idx_sla_exceptions_status ON public.sla_exceptions(agency_id, status);

ALTER TABLE public.sla_exceptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sla_exceptions' AND policyname = 'sla_exceptions_tenant_read'
  ) THEN
    CREATE POLICY "sla_exceptions_tenant_read" ON public.sla_exceptions
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sla_exceptions' AND policyname = 'sla_exceptions_tenant_modify'
  ) THEN
    CREATE POLICY "sla_exceptions_tenant_modify" ON public.sla_exceptions
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 8. HOSPITAL PROFILES & FRAUD HEATMAP
CREATE TABLE IF NOT EXISTS public.hospital_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  hospital_name varchar(255) NOT NULL,
  city varchar(64) NOT NULL DEFAULT '',
  district varchar(64) NOT NULL DEFAULT '',
  state varchar(64) NOT NULL DEFAULT '',
  total_cases integer NOT NULL DEFAULT 0,
  fraud_cases integer NOT NULL DEFAULT 0,
  suspicious_cases integer NOT NULL DEFAULT 0,
  genuine_cases integer NOT NULL DEFAULT 0,
  fraud_rate_percent numeric(5,2) NOT NULL DEFAULT 0.00,
  risk_level varchar(32) NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  is_blacklisted boolean NOT NULL DEFAULT false,
  warning_message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hospital_agency_name UNIQUE (agency_id, hospital_name, city)
);

CREATE INDEX IF NOT EXISTS idx_hospital_profiles_lookup ON public.hospital_profiles(agency_id, hospital_name);
CREATE INDEX IF NOT EXISTS idx_hospital_profiles_risk ON public.hospital_profiles(agency_id, risk_level);

ALTER TABLE public.hospital_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hospital_profiles' AND policyname = 'hospital_profiles_tenant_read'
  ) THEN
    CREATE POLICY "hospital_profiles_tenant_read" ON public.hospital_profiles
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hospital_profiles' AND policyname = 'hospital_profiles_tenant_modify'
  ) THEN
    CREATE POLICY "hospital_profiles_tenant_modify" ON public.hospital_profiles
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 9. INVESTIGATOR SCORECARD CONFIGS
CREATE TABLE IF NOT EXISTS public.investigator_scorecard_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  tat_weight numeric(5,2) NOT NULL DEFAULT 35.00,
  fraud_rate_weight numeric(5,2) NOT NULL DEFAULT 25.00,
  quality_weight numeric(5,2) NOT NULL DEFAULT 25.00,
  volume_weight numeric(5,2) NOT NULL DEFAULT 15.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_scorecard_config_agency UNIQUE (agency_id),
  CONSTRAINT chk_total_weight CHECK (tat_weight + fraud_rate_weight + quality_weight + volume_weight = 100.00)
);

ALTER TABLE public.investigator_scorecard_configs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investigator_scorecard_configs' AND policyname = 'scorecard_configs_tenant_read'
  ) THEN
    CREATE POLICY "scorecard_configs_tenant_read" ON public.investigator_scorecard_configs
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investigator_scorecard_configs' AND policyname = 'scorecard_configs_tenant_modify'
  ) THEN
    CREATE POLICY "scorecard_configs_tenant_modify" ON public.investigator_scorecard_configs
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;
