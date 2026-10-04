-- Migration 00011: Global Search, Operational/Financial Reports, Export Auditing & Notifications (Phase 9A)
-- Implements scope-filtered search, trigram indexing, export auditing, and multi-channel notification engine.

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. TRIGRAM & GIN INDEXES FOR ULTRA-FAST SUB-300MS SEARCH (Gate 1)
CREATE INDEX IF NOT EXISTS idx_cases_doc_code_trgm ON public.cases USING gin (doc_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cases_claim_no_trgm ON public.cases USING gin (normalized_claim_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cases_policy_no_trgm ON public.cases USING gin (policy_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cases_insured_name_trgm ON public.cases USING gin (insured_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cases_city_trgm ON public.cases USING gin (location_city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cases_hospital_trgm ON public.cases USING gin (hospital_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_invoices_number_trgm ON public.invoices USING gin (invoice_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_payments_utr_trgm ON public.client_payments USING gin (utr_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_dockets_awb_trgm ON public.courier_dockets USING gin (awb_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_dockets_number_trgm ON public.courier_dockets USING gin (docket_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_investigators_name_trgm ON public.investigators USING gin (full_name gin_trgm_ops);


-- 3. EXPORT AUDITING LOGS (Rule A6: Append-Only, Audited & Permission-Gated)
CREATE TABLE IF NOT EXISTS public.export_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id),
  export_type varchar(64) NOT NULL,
  format varchar(16) NOT NULL CHECK (format IN ('CSV', 'EXCEL', 'PDF')),
  filter_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  sha256 varchar(64),
  status varchar(32) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'DENIED', 'FAILED')),
  denial_reason text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_logs_agency ON public.export_logs(agency_id, created_at);
CREATE INDEX IF NOT EXISTS idx_export_logs_user ON public.export_logs(agency_id, user_id);

ALTER TABLE public.export_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'export_logs' AND policyname = 'export_logs_tenant_read'
  ) THEN
    CREATE POLICY "export_logs_tenant_read" ON public.export_logs
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'export_logs' AND policyname = 'export_logs_tenant_insert'
  ) THEN
    CREATE POLICY "export_logs_tenant_insert" ON public.export_logs
      FOR INSERT TO authenticated
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 4. MULTI-CHANNEL NOTIFICATIONS TABLE (Rule A11: In-App, Email, SMS/WhatsApp Stubs)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  notification_type varchar(64) NOT NULL,
  channel varchar(32) NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS_STUB', 'WHATSAPP_STUB')),
  priority varchar(16) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  action_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(agency_id, user_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications(agency_id, notification_type);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications_tenant_read'
  ) THEN
    CREATE POLICY "notifications_tenant_read" ON public.notifications
      FOR SELECT TO authenticated
      USING (
        (agency_id = public.current_agency_id() AND user_id = auth.uid()) 
        OR public.is_platform_admin()
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications_tenant_modify'
  ) THEN
    CREATE POLICY "notifications_tenant_modify" ON public.notifications
      FOR ALL TO authenticated
      USING (
        (agency_id = public.current_agency_id() AND user_id = auth.uid()) 
        OR public.is_platform_admin()
      )
      WITH CHECK (
        (agency_id = public.current_agency_id() AND user_id = auth.uid()) 
        OR public.is_platform_admin()
      );
  END IF;
END $$;


-- 5. UNIFIED GLOBAL SEARCH STORED FUNCTION (Always Scope-Filtered, Gate 1 & Gate 2)
CREATE OR REPLACE FUNCTION public.search_global_agency_data(
  p_agency_id uuid,
  p_query text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  doc_code text,
  status text,
  similarity_score real,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_clean_query text;
  v_upper_query text;
  v_caller_id uuid;
BEGIN
  v_clean_query := trim(p_query);
  v_upper_query := upper(v_clean_query);

  IF length(v_clean_query) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- 1. Cases Search (Scope-Filtered via can_view_case)
  SELECT 
    'CASE'::text AS entity_type,
    c.id AS entity_id,
    COALESCE(c.insured_name, 'Unknown Insured') AS title,
    'Claim: ' || COALESCE(c.claim_no, 'N/A') || ' | Policy: ' || COALESCE(c.policy_no, 'N/A') AS subtitle,
    COALESCE(c.doc_code, '') AS doc_code,
    c.status::text AS status,
    GREATEST(
      similarity(c.doc_code, v_upper_query),
      similarity(c.normalized_claim_no, v_upper_query),
      similarity(c.policy_no, v_upper_query),
      similarity(c.insured_name, v_clean_query),
      similarity(c.location_city, v_clean_query)
    ) AS similarity_score,
    jsonb_build_object(
      'city', c.location_city,
      'state', c.location_state,
      'hospital', c.hospital_name,
      'outcome', c.outcome,
      'created_at', c.created_at
    ) AS metadata
  FROM public.cases c
  WHERE c.agency_id = p_agency_id
    AND public.can_view_case(c.id, c.owner_manager_id, c.data_entry_user_id)
    AND (
      c.doc_code ILIKE '%' || v_clean_query || '%'
      OR c.normalized_claim_no ILIKE '%' || v_upper_query || '%'
      OR c.policy_no ILIKE '%' || v_clean_query || '%'
      OR c.insured_name ILIKE '%' || v_clean_query || '%'
      OR c.location_city ILIKE '%' || v_clean_query || '%'
      OR c.hospital_name ILIKE '%' || v_clean_query || '%'
      OR c.insured_phone_blind_index = v_clean_query
    )

  UNION ALL

  -- 2. Invoices Search
  SELECT 
    'INVOICE'::text AS entity_type,
    inv.id AS entity_id,
    inv.invoice_number AS title,
    'Total: ₹' || inv.total_amount::text || ' | FY: ' || inv.financial_year AS subtitle,
    inv.invoice_number AS doc_code,
    inv.status::text AS status,
    similarity(inv.invoice_number, v_upper_query) AS similarity_score,
    jsonb_build_object(
      'total_amount', inv.total_amount,
      'taxable_amount', inv.taxable_amount,
      'issue_date', inv.issue_date
    ) AS metadata
  FROM public.invoices inv
  WHERE inv.agency_id = p_agency_id
    AND inv.invoice_number ILIKE '%' || v_clean_query || '%'

  UNION ALL

  -- 3. Payments / Remittances Search (UTR)
  SELECT 
    'PAYMENT'::text AS entity_type,
    cp.id AS entity_id,
    'UTR: ' || cp.utr_number AS title,
    'Amount: ₹' || cp.amount::text || ' | Mode: ' || cp.payment_mode AS subtitle,
    cp.utr_number AS doc_code,
    CASE WHEN cp.unapplied_amount = 0 THEN 'FULLY_APPLIED' ELSE 'UNAPPLIED' END AS status,
    similarity(cp.utr_number, v_upper_query) AS similarity_score,
    jsonb_build_object(
      'amount', cp.amount,
      'unapplied_amount', cp.unapplied_amount,
      'payment_date', cp.payment_date,
      'bank_name', cp.bank_name
    ) AS metadata
  FROM public.client_payments cp
  WHERE cp.agency_id = p_agency_id
    AND cp.utr_number ILIKE '%' || v_clean_query || '%'

  UNION ALL

  -- 4. Hardcopy Courier Dockets Search (AWB & Docket Number)
  SELECT 
    'COURIER_DOCKET'::text AS entity_type,
    cd.id AS entity_id,
    'AWB: ' || cd.awb_number AS title,
    'Courier: ' || cd.courier_partner || ' | Docket: ' || cd.docket_number AS subtitle,
    cd.docket_number AS doc_code,
    cd.delivery_status::text AS status,
    GREATEST(
      similarity(cd.awb_number, v_upper_query),
      similarity(cd.docket_number, v_upper_query)
    ) AS similarity_score,
    jsonb_build_object(
      'courier_partner', cd.courier_partner,
      'dispatched_at', cd.dispatched_at,
      'delivered_at', cd.delivered_at
    ) AS metadata
  FROM public.courier_dockets cd
  WHERE cd.agency_id = p_agency_id
    AND (
      cd.awb_number ILIKE '%' || v_clean_query || '%'
      OR cd.docket_number ILIKE '%' || v_clean_query || '%'
    )

  UNION ALL

  -- 5. Investigators Search (Code & Full Name)
  SELECT 
    'INVESTIGATOR'::text AS entity_type,
    i.id AS entity_id,
    i.full_name AS title,
    'Code: ' || i.code || ' | ' || i.city || ', ' || i.state AS subtitle,
    i.code AS doc_code,
    CASE WHEN i.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
    GREATEST(
      similarity(i.code, v_upper_query),
      similarity(i.full_name, v_clean_query)
    ) AS similarity_score,
    jsonb_build_object(
      'phone', i.phone,
      'city', i.city,
      'state', i.state,
      'max_active_cases', i.max_active_cases
    ) AS metadata
  FROM public.investigators i
  WHERE i.agency_id = p_agency_id
    AND (
      i.code ILIKE '%' || v_clean_query || '%'
      OR i.full_name ILIKE '%' || v_clean_query || '%'
    )

  ORDER BY similarity_score DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 6. SYSTEM PERMISSIONS SEED FOR EXPORT & ANALYTICS
INSERT INTO public.permissions (id, module, name, description) VALUES 
  ('reports.export', 'Reports', 'Export Reports', 'Export operational, financial and audit reports to CSV, Excel, PDF'),
  ('reports.view_analytics', 'Reports', 'View Analytics', 'View operations, financial and logistics analytics dashboards')
ON CONFLICT (id) DO NOTHING;
