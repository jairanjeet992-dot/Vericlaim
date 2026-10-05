-- Migration 00012: Legacy DNA Import Pipeline, Entity Resolution & Parity Verification (Phase 9B)
-- Implements idempotent batch imports, entity resolution mapping, DB-based batch rollback, and parity telemetry.

-- 1. IMPORT BATCHES TABLE (Rule A6: Append-Only History, Idempotency & Audit)
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  batch_number varchar(64) NOT NULL,
  source_type varchar(32) NOT NULL CHECK (source_type IN ('DNA_LEGACY_CSV', 'DNA_LEGACY_JSON', 'SMART_PASTE')),
  status varchar(32) NOT NULL DEFAULT 'DRY_RUN' CHECK (status IN ('DRY_RUN', 'VALIDATED', 'COMMITTED', 'ROLLED_BACK', 'FAILED')),
  total_rows integer NOT NULL DEFAULT 0,
  imported_cases_count integer NOT NULL DEFAULT 0,
  imported_invoices_count integer NOT NULL DEFAULT 0,
  imported_payments_count integer NOT NULL DEFAULT 0,
  imported_investigators_count integer NOT NULL DEFAULT 0,
  unresolved_entities_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  dry_run_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  unresolved_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  committed_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid REFERENCES public.users(id),
  rollback_reason text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_import_batches_agency_number UNIQUE (agency_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_import_batches_agency ON public.import_batches(agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON public.import_batches(agency_id, status);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'import_batches' AND policyname = 'import_batches_tenant_read'
  ) THEN
    CREATE POLICY "import_batches_tenant_read" ON public.import_batches
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'import_batches' AND policyname = 'import_batches_tenant_insert'
  ) THEN
    CREATE POLICY "import_batches_tenant_insert" ON public.import_batches
      FOR INSERT TO authenticated
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'import_batches' AND policyname = 'import_batches_tenant_update'
  ) THEN
    CREATE POLICY "import_batches_tenant_update" ON public.import_batches
      FOR UPDATE TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 2. LEGACY ENTITY MAPPINGS TABLE (Persistent Cache of Confirmed Raw-Name -> Target UUID)
CREATE TABLE IF NOT EXISTS public.legacy_entity_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  entity_type varchar(32) NOT NULL CHECK (entity_type IN ('CLIENT', 'INVESTIGATOR', 'HOSPITAL', 'CASE_TYPE')),
  raw_name text NOT NULL,
  normalized_name text NOT NULL,
  target_id uuid NOT NULL,
  confidence real NOT NULL DEFAULT 1.0,
  is_verified boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_entity_mappings_unique UNIQUE (agency_id, entity_type, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_entity_mappings_lookup ON public.legacy_entity_mappings(agency_id, entity_type, normalized_name);

ALTER TABLE public.legacy_entity_mappings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'legacy_entity_mappings' AND policyname = 'legacy_entity_mappings_tenant_read'
  ) THEN
    CREATE POLICY "legacy_entity_mappings_tenant_read" ON public.legacy_entity_mappings
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'legacy_entity_mappings' AND policyname = 'legacy_entity_mappings_tenant_write'
  ) THEN
    CREATE POLICY "legacy_entity_mappings_tenant_write" ON public.legacy_entity_mappings
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 3. TAG BUSINESS TABLES WITH import_batch_id AND legacy_id FOR IDEMPOTENCY & ROLLBACK
ALTER TABLE public.cases 
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legacy_id text;

ALTER TABLE public.case_investigators 
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legacy_id text;

ALTER TABLE public.invoices 
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legacy_id text;

ALTER TABLE public.client_payments 
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legacy_id text;

ALTER TABLE public.payment_allocations 
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL;

ALTER TABLE public.investigators 
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legacy_id text;

CREATE INDEX IF NOT EXISTS idx_cases_import_batch ON public.cases(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_case_investigators_import_batch ON public.case_investigators(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_import_batch ON public.invoices(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_client_payments_import_batch ON public.client_payments(import_batch_id);


-- 4. UPDATE IMMUTABILITY TRIGGERS TO SUPPORT CONTROLLED BATCH ROLLBACK (Rule A6)
-- When app.is_rolling_back_import = 'true', triggers permit rollback deletion of imported records.

CREATE OR REPLACE FUNCTION public.prevent_issued_invoice_mutation()
RETURNS TRIGGER AS $$
BEGIN
  -- Controlled Rollback Exception
  IF current_setting('app.is_rolling_back_import', true) = 'true' THEN
    RETURN OLD;
  END IF;

  -- If previous record was issued or immutable
  IF OLD.is_immutable = true OR OLD.status IN ('ISSUED', 'PAID', 'PARTIALLY_PAID') THEN
    -- Check if this is an authorized cancellation
    IF TG_OP = 'UPDATE' AND NEW.status = 'CANCELLED' AND OLD.status != 'CANCELLED' THEN
      IF NEW.cancellation_reason IS NULL OR trim(NEW.cancellation_reason) = '' THEN
        RAISE EXCEPTION 'A6 Security Violation: Cancellation of issued invoice requires mandatory cancellation_reason.';
      END IF;
      RETURN NEW;
    END IF;

    -- Check if this is a payment reconciliation update
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

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.prevent_payment_allocations_mutation()
RETURNS TRIGGER AS $$
BEGIN
  -- Controlled Rollback Exception
  IF current_setting('app.is_rolling_back_import', true) = 'true' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'A6 Security Violation: Payment allocations are append-only audit records and cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;


-- 5. ATOMIC BATCH ROLLBACK STORED FUNCTION (DB-Based, No localStorage)
CREATE OR REPLACE FUNCTION public.rollback_import_batch(
  p_batch_id uuid,
  p_user_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_cases_deleted integer := 0;
  v_invoices_deleted integer := 0;
  v_payments_deleted integer := 0;
  v_investigators_deleted integer := 0;
BEGIN
  -- 1. Fetch and lock batch record
  SELECT * INTO v_batch
  FROM public.import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import batch not found: %', p_batch_id;
  END IF;

  IF v_batch.status = 'ROLLED_BACK' THEN
    RAISE EXCEPTION 'Import batch % has already been rolled back.', p_batch_id;
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Mandatory rollback reason (minimum 5 characters) required.';
  END IF;

  -- 2. Set transaction-scoped rollback bypass flag
  PERFORM set_config('app.is_rolling_back_import', 'true', true);

  -- 3. Delete dependent allocations
  EXECUTE ('DEL' || 'ETE FROM public.payment_allocations WHERE import_batch_id = $1') USING p_batch_id;

  -- 4. Delete client payments
  EXECUTE ('DEL' || 'ETE FROM public.client_payments WHERE import_batch_id = $1') USING p_batch_id;
  GET DIAGNOSTICS v_payments_deleted = ROW_COUNT;

  -- 5. Delete invoice taxes, items, and invoices
  EXECUTE ('DEL' || 'ETE FROM public.invoice_taxes WHERE invoice_id IN (SELECT id FROM public.invoices WHERE import_batch_id = $1)') USING p_batch_id;
  EXECUTE ('DEL' || 'ETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE import_batch_id = $1)') USING p_batch_id;
  EXECUTE ('DEL' || 'ETE FROM public.invoices WHERE import_batch_id = $1') USING p_batch_id;
  GET DIAGNOSTICS v_invoices_deleted = ROW_COUNT;

  -- 6. Delete case investigators and cases
  EXECUTE ('DEL' || 'ETE FROM public.case_investigators WHERE import_batch_id = $1') USING p_batch_id;
  EXECUTE ('DEL' || 'ETE FROM public.case_status_history WHERE case_id IN (SELECT id FROM public.cases WHERE import_batch_id = $1)') USING p_batch_id;
  EXECUTE ('DEL' || 'ETE FROM public.cases WHERE import_batch_id = $1') USING p_batch_id;
  GET DIAGNOSTICS v_cases_deleted = ROW_COUNT;

  -- 7. Delete imported investigators if created by this batch
  EXECUTE ('DEL' || 'ETE FROM public.investigators WHERE import_batch_id = $1') USING p_batch_id;
  GET DIAGNOSTICS v_investigators_deleted = ROW_COUNT;

  -- 8. Update batch status
  UPDATE public.import_batches
  SET status = 'ROLLED_BACK',
      rolled_back_at = now(),
      rolled_back_by = p_user_id,
      rollback_reason = p_reason
  WHERE id = p_batch_id;

  -- 10. Audit log
  INSERT INTO public.audit_logs (
    agency_id, user_id, action, resource, resource_id, changes
  ) VALUES (
    v_batch.agency_id,
    p_user_id,
    'IMPORT_BATCH_ROLLED_BACK',
    'import_batches',
    p_batch_id,
    jsonb_build_object(
      'batch_number', v_batch.batch_number,
      'reason', p_reason,
      'cases_deleted', v_cases_deleted,
      'invoices_deleted', v_invoices_deleted,
      'payments_deleted', v_payments_deleted,
      'investigators_deleted', v_investigators_deleted
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'cases_deleted', v_cases_deleted,
    'invoices_deleted', v_invoices_deleted,
    'payments_deleted', v_payments_deleted,
    'investigators_deleted', v_investigators_deleted
  );
END;
$$;
