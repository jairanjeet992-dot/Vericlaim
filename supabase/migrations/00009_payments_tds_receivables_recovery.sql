-- ==============================================================================
-- Vericlaim Multi-Tenant SaaS: Payments, TDS, Receivables & Recovery (Phase 7B)
-- Migration: 00009_payments_tds_receivables_recovery.sql
-- ==============================================================================

-- 1. CLIENT PAYMENTS (Remittances, Advances, Bulk Receipts)
CREATE TABLE IF NOT EXISTS public.client_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  client_branch_id uuid REFERENCES public.client_branches(id) ON DELETE SET NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  unapplied_amount numeric(14,2) NOT NULL DEFAULT 0.00 CHECK (unapplied_amount >= 0),
  payment_mode varchar(32) NOT NULL DEFAULT 'NEFT' CHECK (payment_mode IN ('NEFT', 'RTGS', 'IMPS', 'CHEQUE', 'UPI', 'BANK_TRANSFER', 'CASH')),
  utr_number varchar(128),
  bank_name varchar(128),
  reference_note text,
  is_advance boolean NOT NULL DEFAULT false,
  idempotency_key varchar(128),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_client_payments_agency_utr UNIQUE (agency_id, utr_number),
  CONSTRAINT uq_client_payments_idempotency UNIQUE (agency_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_client_payments_agency_client ON public.client_payments(agency_id, client_id);
CREATE INDEX IF NOT EXISTS idx_client_payments_date ON public.client_payments(agency_id, payment_date);

ALTER TABLE public.client_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_payments_tenant_read" ON public.client_payments;
CREATE POLICY "client_payments_tenant_read" ON public.client_payments
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "client_payments_tenant_modify" ON public.client_payments;
CREATE POLICY "client_payments_tenant_modify" ON public.client_payments
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 2. PAYMENT ALLOCATIONS (Append-only allocation of remittance to invoices/cases)
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.client_payments(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  allocated_amount numeric(14,2) NOT NULL CHECK (allocated_amount > 0),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON public.payment_allocations(agency_id, payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON public.payment_allocations(agency_id, invoice_id);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_allocations_tenant_read" ON public.payment_allocations;
CREATE POLICY "payment_allocations_tenant_read" ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "payment_allocations_tenant_modify" ON public.payment_allocations;
CREATE POLICY "payment_allocations_tenant_modify" ON public.payment_allocations
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 3. TDS RECEIVABLES (Section 194J / 194C Client Deductions)
CREATE TABLE IF NOT EXISTS public.tds_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.client_payments(id) ON DELETE SET NULL,
  section varchar(16) NOT NULL DEFAULT '194J' CHECK (section IN ('194J', '194C', '194H', '194Q', 'OTHER')),
  rate numeric(5,2) NOT NULL DEFAULT 10.00 CHECK (rate >= 0.00 AND rate <= 100.00),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  is_valid boolean NOT NULL DEFAULT true,
  certificate_number varchar(128),
  form_26as_status varchar(32) NOT NULL DEFAULT 'PENDING' CHECK (form_26as_status IN ('PENDING', 'MATCHED', 'MISMATCHED', 'CLAIMED')),
  match_metadata jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tds_receivables_invoice ON public.tds_receivables(agency_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_tds_receivables_client ON public.tds_receivables(agency_id, client_id);

ALTER TABLE public.tds_receivables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tds_receivables_tenant_read" ON public.tds_receivables;
CREATE POLICY "tds_receivables_tenant_read" ON public.tds_receivables
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "tds_receivables_tenant_modify" ON public.tds_receivables;
CREATE POLICY "tds_receivables_tenant_modify" ON public.tds_receivables
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 4. FORM 26AS / AIS IMPORT RECORDS
CREATE TABLE IF NOT EXISTS public.form_26as_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  financial_year varchar(9) NOT NULL,
  deductor_tan varchar(20) NOT NULL,
  deductor_name varchar(255),
  section varchar(16) NOT NULL DEFAULT '194J',
  transaction_date date,
  booking_date date,
  amount_paid numeric(14,2) NOT NULL DEFAULT 0.00,
  tds_deducted numeric(14,2) NOT NULL DEFAULT 0.00,
  status varchar(32) NOT NULL DEFAULT 'UNMATCHED' CHECK (status IN ('UNMATCHED', 'MATCHED', 'PARTIALLY_MATCHED')),
  matched_tds_id uuid REFERENCES public.tds_receivables(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_26as_records_agency ON public.form_26as_records(agency_id, financial_year, deductor_tan);

ALTER TABLE public.form_26as_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "form_26as_records_tenant_read" ON public.form_26as_records;
CREATE POLICY "form_26as_records_tenant_read" ON public.form_26as_records
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "form_26as_records_tenant_modify" ON public.form_26as_records;
CREATE POLICY "form_26as_records_tenant_modify" ON public.form_26as_records
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- ==============================================================================
-- 5. OUTSTANDING CALCULATION FUNCTION (Rule A6)
-- Outstanding = invoice total - received - valid TDS
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_invoice_outstanding(p_invoice_id uuid)
RETURNS numeric(14,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_total numeric(14,2);
  v_allocated numeric(14,2);
  v_valid_tds numeric(14,2);
  v_outstanding numeric(14,2);
BEGIN
  SELECT total_amount INTO v_total
  FROM public.invoices
  WHERE id = p_invoice_id;

  IF v_total IS NULL THEN
    RETURN 0.00;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0.00) INTO v_allocated
  FROM public.payment_allocations
  WHERE invoice_id = p_invoice_id;

  SELECT COALESCE(SUM(amount), 0.00) INTO v_valid_tds
  FROM public.tds_receivables
  WHERE invoice_id = p_invoice_id AND is_valid = true;

  v_outstanding := v_total - (v_allocated + v_valid_tds);
  IF v_outstanding < 0 THEN
    v_outstanding := 0.00;
  END IF;

  RETURN v_outstanding;
END;
$$;

-- ==============================================================================
-- 6. ATOMIC PAYMENT ALLOCATION STORED PROCEDURE (Race-Free, Row-Locked)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.allocate_payment_transaction(
  p_agency_id uuid,
  p_payment_id uuid,
  p_invoice_id uuid,
  p_allocated_amount numeric(14,2),
  p_case_id uuid DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment RECORD;
  v_invoice RECORD;
  v_current_allocated numeric(14,2);
  v_valid_tds numeric(14,2);
  v_outstanding numeric(14,2);
  v_new_allocation_id uuid;
  v_new_status varchar(32);
BEGIN
  -- 1. Lock payment row
  SELECT * INTO v_payment
  FROM public.client_payments
  WHERE id = p_payment_id AND agency_id = p_agency_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A6 Error: Payment record not found.';
  END IF;

  IF v_payment.unapplied_amount < p_allocated_amount THEN
    RAISE EXCEPTION 'A6 Violation: Allocated amount (%) exceeds unapplied payment balance (%).', 
      p_allocated_amount, v_payment.unapplied_amount;
  END IF;

  -- 2. Lock invoice row
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND agency_id = p_agency_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A6 Error: Invoice record not found.';
  END IF;

  IF v_invoice.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'A6 Error: Cannot allocate payment to cancelled invoice.';
  END IF;

  -- 3. Calculate current outstanding
  SELECT COALESCE(SUM(allocated_amount), 0.00) INTO v_current_allocated
  FROM public.payment_allocations
  WHERE invoice_id = p_invoice_id;

  SELECT COALESCE(SUM(amount), 0.00) INTO v_current_tds
  FROM public.tds_receivables
  WHERE invoice_id = p_invoice_id AND is_valid = true;

  v_outstanding := v_invoice.total_amount - (v_current_allocated + v_current_tds);

  -- 4. Over-allocation check
  IF p_allocated_amount > v_outstanding THEN
    RAISE EXCEPTION 'A6 Violation: Over-allocation rejected. Allocated amount (%) exceeds remaining invoice outstanding (%).',
      p_allocated_amount, v_outstanding;
  END IF;

  -- 5. Insert allocation
  INSERT INTO public.payment_allocations (
    agency_id, payment_id, invoice_id, case_id, allocated_amount, created_by
  ) VALUES (
    p_agency_id, p_payment_id, p_invoice_id, p_case_id, p_allocated_amount, p_actor_id
  ) RETURNING id INTO v_new_allocation_id;

  -- 6. Decrement unapplied balance on payment
  UPDATE public.client_payments
  SET 
    unapplied_amount = unapplied_amount - p_allocated_amount,
    updated_at = now()
  WHERE id = p_payment_id;

  -- 7. Update invoice status
  IF (v_outstanding - p_allocated_amount) <= 0.00 THEN
    v_new_status := 'PAID';
  ELSE
    v_new_status := 'PARTIALLY_PAID';
  END IF;

  UPDATE public.invoices
  SET 
    status = v_new_status,
    updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'allocation_id', v_new_allocation_id,
    'invoice_status', v_new_status,
    'remaining_invoice_outstanding', (v_outstanding - p_allocated_amount),
    'remaining_payment_unapplied', (v_payment.unapplied_amount - p_allocated_amount)
  );
END;
$$;

-- ==============================================================================
-- 7. IMMUTABILITY TRIGGER: APPEND-ONLY PAYMENT ALLOCATIONS (Rule A6)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.prevent_payment_allocations_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'A6 Security Violation: Payment allocations are append-only audit records and cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_payment_allocations_mutation
  BEFORE UPDATE OR DELETE ON public.payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_payment_allocations_mutation();
