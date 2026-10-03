-- ==============================================================================
-- Vericlaim Multi-Tenant SaaS: Invoicing, GST & Credit Notes Migration (Phase 7A)
-- Migration: 00008_invoicing_gst_credit_notes.sql
-- ==============================================================================

-- 1. SEQUENTIAL GAPLESS INVOICE NUMBERING TABLE
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  financial_year varchar(9) NOT NULL,
  doc_type varchar(16) NOT NULL DEFAULT 'INV',
  current_val integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_invoice_sequences PRIMARY KEY (agency_id, financial_year, doc_type)
);

ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_sequences_tenant_all" ON public.invoice_sequences
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- Function for atomic, gapless sequential numbering per financial year
CREATE OR REPLACE FUNCTION public.get_next_gapless_invoice_number(
  p_agency_id uuid,
  p_fy varchar,
  p_doc_type varchar DEFAULT 'INV'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_val integer;
  v_prefix text;
  v_formatted text;
BEGIN
  -- Row lock and monotonic increment in atomic transaction
  INSERT INTO public.invoice_sequences (agency_id, financial_year, doc_type, current_val, updated_at)
  VALUES (p_agency_id, p_fy, p_doc_type, 1, now())
  ON CONFLICT (agency_id, financial_year, doc_type)
  DO UPDATE SET 
    current_val = public.invoice_sequences.current_val + 1,
    updated_at = now()
  RETURNING current_val INTO v_next_val;

  v_prefix := CASE 
    WHEN p_doc_type = 'CN' THEN 'CN'
    WHEN p_doc_type = 'DN' THEN 'DN'
    ELSE 'INV'
  END;

  v_formatted := v_prefix || '/' || p_fy || '/' || lpad(v_next_val::text, 4, '0');
  RETURN v_formatted;
END;
$$;

-- 2. INVOICES TABLE
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  invoice_number varchar(64) NOT NULL,
  financial_year varchar(9) NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  client_branch_id uuid NOT NULL REFERENCES public.client_branches(id) ON DELETE RESTRICT,
  status varchar(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED')),
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  place_of_supply_state_code varchar(2) NOT NULL,
  is_intra_state boolean NOT NULL,
  is_reverse_charge boolean NOT NULL DEFAULT false,
  is_sez boolean NOT NULL DEFAULT false,
  calculation_mode varchar(32) NOT NULL DEFAULT 'FORWARD' CHECK (calculation_mode IN ('FORWARD', 'TOTAL_INCLUSIVE')),
  subtotal_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  taxable_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  cgst_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  sgst_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  igst_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  total_tax_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  total_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  amount_in_words text NOT NULL,
  notes text,
  terms_and_conditions text,
  pdf_r2_key text,
  pdf_sha256 varchar(64),
  is_immutable boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancellation_reason text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_invoice_number UNIQUE (agency_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_agency_status ON public.invoices(agency_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_client_branch ON public.invoices(agency_id, client_id, client_branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_financial_year ON public.invoices(agency_id, financial_year);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_tenant_read" ON public.invoices
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "invoices_tenant_modify" ON public.invoices
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 3. INVOICE ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  item_type varchar(32) NOT NULL DEFAULT 'PROFESSIONAL_FEE',
  description text NOT NULL,
  sac_code varchar(16) NOT NULL DEFAULT '998311',
  quantity numeric(10,2) NOT NULL DEFAULT 1.00,
  unit_rate numeric(14,2) NOT NULL DEFAULT 0.00,
  taxable_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  tax_rate numeric(5,2) NOT NULL DEFAULT 18.00,
  cgst_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  sgst_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  igst_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  total_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_case ON public.invoice_items(case_id);

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_items_tenant_read" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "invoice_items_tenant_modify" ON public.invoice_items
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 4. INVOICE TAXES TABLE (Grouped Tax Breakdown)
CREATE TABLE IF NOT EXISTS public.invoice_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  tax_type varchar(16) NOT NULL CHECK (tax_type IN ('CGST', 'SGST', 'IGST')),
  rate numeric(5,2) NOT NULL,
  taxable_base numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_invoice_tax_type UNIQUE (agency_id, invoice_id, tax_type)
);

CREATE INDEX IF NOT EXISTS idx_invoice_taxes_invoice ON public.invoice_taxes(invoice_id);

ALTER TABLE public.invoice_taxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_taxes_tenant_read" ON public.invoice_taxes
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "invoice_taxes_tenant_modify" ON public.invoice_taxes
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 5. CREDIT & DEBIT NOTES TABLE
CREATE TABLE IF NOT EXISTS public.credit_debit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  note_number varchar(64) NOT NULL,
  note_type varchar(16) NOT NULL CHECK (note_type IN ('CREDIT_NOTE', 'DEBIT_NOTE')),
  original_invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  financial_year varchar(9) NOT NULL,
  reason text NOT NULL,
  taxable_amount numeric(14,2) NOT NULL,
  cgst_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  sgst_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  igst_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  total_amount numeric(14,2) NOT NULL,
  pdf_r2_key text,
  pdf_sha256 varchar(64),
  is_immutable boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_note_number UNIQUE (agency_id, note_number)
);

CREATE INDEX IF NOT EXISTS idx_credit_debit_notes_invoice ON public.credit_debit_notes(original_invoice_id);

ALTER TABLE public.credit_debit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_debit_notes_tenant_read" ON public.credit_debit_notes
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "credit_debit_notes_tenant_modify" ON public.credit_debit_notes
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- ==============================================================================
-- 6. IMMUTABILITY ENFORCEMENT TRIGGERS (Rule A6)
-- ==============================================================================

-- Trigger Function: Protect Issued Invoices from Modification or Hard Deletion
CREATE OR REPLACE FUNCTION public.prevent_issued_invoice_mutation()
RETURNS TRIGGER AS $$
BEGIN
  -- If previous record was issued or immutable
  IF OLD.is_immutable = true OR OLD.status IN ('ISSUED', 'PAID', 'PARTIALLY_PAID') THEN
    -- Check if this is an authorized cancellation
    IF TG_OP = 'UPDATE' AND NEW.status = 'CANCELLED' AND OLD.status != 'CANCELLED' THEN
      IF NEW.cancellation_reason IS NULL OR trim(NEW.cancellation_reason) = '' THEN
        RAISE EXCEPTION 'A6 Security Violation: Cancellation of issued invoice requires mandatory cancellation_reason.';
      END IF;
      RETURN NEW;
    END IF;

    -- Check if this is a payment reconciliation update (status change to PAID / PARTIALLY_PAID)
    IF TG_OP = 'UPDATE' AND (NEW.status IN ('PAID', 'PARTIALLY_PAID') OR NEW.updated_at != OLD.updated_at)
       AND NEW.total_amount = OLD.total_amount 
       AND NEW.taxable_amount = OLD.taxable_amount 
       AND NEW.invoice_number = OLD.invoice_number THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'A6 Security Violation: Issued invoices are immutable. Financial figures, items, and tax amounts cannot be modified or deleted. Use Credit/Debit Notes for corrections.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_immutable = true OR OLD.status != 'DRAFT' THEN
      RAISE EXCEPTION 'A6 Security Violation: Issued invoices cannot be deleted.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_issued_invoice_mutation
  BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_issued_invoice_mutation();

-- Trigger Function: Protect Invoice Items of Issued Invoices
CREATE OR REPLACE FUNCTION public.prevent_invoice_items_mutation()
RETURNS TRIGGER AS $$
DECLARE
  v_is_immutable boolean;
  v_status text;
  v_inv_id uuid;
BEGIN
  v_inv_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT is_immutable, status INTO v_is_immutable, v_status
  FROM public.invoices
  WHERE id = v_inv_id;

  IF v_is_immutable = true OR v_status IN ('ISSUED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'A6 Security Violation: Line items of issued invoices are immutable and cannot be added, edited, or deleted.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_invoice_items_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_invoice_items_mutation();

-- Trigger Function: Protect Credit/Debit Notes (Append-Only)
CREATE OR REPLACE FUNCTION public.prevent_credit_notes_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'A6 Security Violation: Credit and debit notes are append-only historical records and cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_credit_notes_mutation
  BEFORE UPDATE OR DELETE ON public.credit_debit_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_credit_notes_mutation();
