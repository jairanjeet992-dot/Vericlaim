-- Migration 00013: DPDP Act 2023 Compliance, Data Governance & Plan Limits (Phase 10)
-- Implements consent logs, retention schedules, data deletion/erasure workflows, breach logs, and usage quotas.

-- 1. CONSENT RECORDS TABLE (DPDP Act 2023 Section 6 - Purpose-specific, explicit consent)
CREATE TABLE IF NOT EXISTS public.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  data_principal_name varchar(255) NOT NULL,
  data_principal_phone_blind_index text,
  consent_purpose varchar(128) NOT NULL, -- e.g. 'INSURANCE_CLAIM_INVESTIGATION', 'MEDICAL_RECORD_VERIFICATION'
  consent_type varchar(32) NOT NULL DEFAULT 'DIGITAL' CHECK (consent_type IN ('DIGITAL', 'PHYSICAL_FORM', 'AUDIO_RECORDING', 'POLICY_TERMS')),
  status varchar(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN', 'EXPIRED')),
  obtained_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  evidence_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_records_agency ON public.consent_records(agency_id, case_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_status ON public.consent_records(agency_id, status);

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'consent_records' AND policyname = 'consent_records_tenant_read'
  ) THEN
    CREATE POLICY "consent_records_tenant_read" ON public.consent_records
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'consent_records' AND policyname = 'consent_records_tenant_insert'
  ) THEN
    CREATE POLICY "consent_records_tenant_insert" ON public.consent_records
      FOR INSERT TO authenticated
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'consent_records' AND policyname = 'consent_records_tenant_update'
  ) THEN
    CREATE POLICY "consent_records_tenant_update" ON public.consent_records
      FOR UPDATE TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 2. DATA RETENTION POLICIES TABLE (Statutory 8-Year GST & Investigation Archival Schedule)
CREATE TABLE IF NOT EXISTS public.data_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  entity_category varchar(64) NOT NULL, -- 'TAX_INVOICES', 'PAYMENT_RECEIPTS', 'CASE_EVIDENCE', 'AUDIT_LOGS'
  retention_period_months integer NOT NULL, -- e.g. 96 months (8 years) for GST/Invoices per CGST Act Sec 36
  statutory_basis varchar(128) NOT NULL, -- 'CGST_ACT_SEC_36', 'IRDAI_PROTECTION_POLICYHOLDERS', 'DPDP_ACT_SEC_8'
  auto_archive_enabled boolean NOT NULL DEFAULT true,
  auto_delete_enabled boolean NOT NULL DEFAULT false, -- Never delete tax/financial records automatically
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_entity_retention UNIQUE (agency_id, entity_category)
);

ALTER TABLE public.data_retention_policies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'data_retention_policies' AND policyname = 'retention_policies_tenant_read'
  ) THEN
    CREATE POLICY "retention_policies_tenant_read" ON public.data_retention_policies
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'data_retention_policies' AND policyname = 'retention_policies_tenant_write'
  ) THEN
    CREATE POLICY "retention_policies_tenant_write" ON public.data_retention_policies
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 3. DATA ERASURE & ANONYMIZATION REQUESTS TABLE (DPDP Act Section 12 - Right to Correction and Erasure)
CREATE TABLE IF NOT EXISTS public.data_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  request_number varchar(64) NOT NULL,
  data_principal_name varchar(255) NOT NULL,
  data_principal_identifier text NOT NULL, -- Normalized identifier
  request_type varchar(32) NOT NULL CHECK (request_type IN ('ERASURE', 'ANONYMIZATION', 'DATA_PORTABILITY', 'RECTIFICATION')),
  status varchar(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED_LEGAL_OVERRIDE', 'COMPLETED')),
  rejection_legal_basis text, -- e.g. 'Active tax investigation or pending insurance repudiation litigation under Section 17 DPDP'
  processed_at timestamptz,
  processed_by uuid REFERENCES public.users(id),
  audit_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_erasure_request_number UNIQUE (agency_id, request_number)
);

CREATE INDEX IF NOT EXISTS idx_data_deletion_agency ON public.data_deletion_requests(agency_id, status);

ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'data_deletion_requests' AND policyname = 'deletion_requests_tenant_read'
  ) THEN
    CREATE POLICY "deletion_requests_tenant_read" ON public.data_deletion_requests
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'data_deletion_requests' AND policyname = 'deletion_requests_tenant_write'
  ) THEN
    CREATE POLICY "deletion_requests_tenant_write" ON public.data_deletion_requests
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;


-- 4. BREACH NOTIFICATION LOGS TABLE (CERT-In 6-Hour & DPDP Act Board 72-Hour Reporting Register)
CREATE TABLE IF NOT EXISTS public.breach_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  incident_number varchar(64) NOT NULL,
  severity varchar(32) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  affected_principals_count integer NOT NULL DEFAULT 0,
  nature_of_breach text NOT NULL,
  compromised_data_categories text[] NOT NULL DEFAULT '{}',
  detected_at timestamptz NOT NULL,
  reported_to_dpb boolean NOT NULL DEFAULT false,
  dpb_reported_at timestamptz,
  reported_to_cert_in boolean NOT NULL DEFAULT false,
  cert_in_reported_at timestamptz,
  remediation_actions text,
  status varchar(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED')),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_breach_incident_number UNIQUE (agency_id, incident_number)
);

CREATE INDEX IF NOT EXISTS idx_breach_logs_agency ON public.breach_logs(agency_id, status);

ALTER TABLE public.breach_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'breach_logs' AND policyname = 'breach_logs_tenant_read'
  ) THEN
    CREATE POLICY "breach_logs_tenant_read" ON public.breach_logs
      FOR SELECT TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'breach_logs' AND policyname = 'breach_logs_tenant_write'
  ) THEN
    CREATE POLICY "breach_logs_tenant_write" ON public.breach_logs
      FOR ALL TO authenticated
      USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
      WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());
  END IF;
END $$;
