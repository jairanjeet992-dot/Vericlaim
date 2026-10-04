-- ============================================================================
-- VERICLAIM MULTI-TENANT SAAS
-- MIGRATION: 00006_investigation_evidence_pwa.sql
-- PHASE 5: Investigation Activities, Evidence Pipeline (R2), Versioning, PWA
-- ============================================================================

-- 1. INVESTIGATION ACTIVITIES TABLE
-- Tracks field tasks, verification visits, interviews, and inspections
CREATE TABLE IF NOT EXISTS public.investigation_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  activity_type varchar(64) NOT NULL,
  custom_type_name text,
  task_title text NOT NULL,
  instructions text,
  assigned_to_id uuid REFERENCES public.users(id),
  due_date timestamptz,
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  notes text,
  completion_notes text,
  completed_at timestamptz,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_activity_status CHECK (
    status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  )
);

CREATE INDEX IF NOT EXISTS idx_activities_agency_case 
  ON public.investigation_activities(agency_id, case_id);

CREATE INDEX IF NOT EXISTS idx_activities_assigned 
  ON public.investigation_activities(agency_id, assigned_to_id, status);

CREATE INDEX IF NOT EXISTS idx_activities_due 
  ON public.investigation_activities(agency_id, status, due_date);

-- Enable RLS for activities
ALTER TABLE public.investigation_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activities_tenant_select" ON public.investigation_activities;
CREATE POLICY "activities_tenant_select" ON public.investigation_activities
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND EXISTS (
      SELECT 1 FROM public.cases c 
      WHERE c.id = case_id 
        AND public.can_view_case(c.id, c.owner_manager_id, c.data_entry_user_id)
    )
  );

DROP POLICY IF EXISTS "activities_tenant_all" ON public.investigation_activities;
CREATE POLICY "activities_tenant_all" ON public.investigation_activities
  FOR ALL TO authenticated
  USING (
    agency_id = public.current_agency_id()
  )
  WITH CHECK (
    agency_id = public.current_agency_id()
  );

-- 2. DOCUMENTS & EVIDENCE TABLE (PER A8)
-- Private S3/R2 storage references, claimed GPS, verification status, versioning
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  activity_id uuid REFERENCES public.investigation_activities(id) ON DELETE SET NULL,
  uploaded_by uuid NOT NULL REFERENCES public.users(id),
  storage_key text NOT NULL,
  file_name text NOT NULL,
  file_size bigint NOT NULL,
  mime_type text NOT NULL,
  sha256_hash text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  evidence_category varchar(64) NOT NULL DEFAULT 'OTHER',
  claimed_latitude numeric(10, 7),
  claimed_longitude numeric(10, 7),
  claimed_accuracy numeric(8, 2),
  claimed_captured_at timestamptz,
  verified_at timestamptz,
  is_sensitive boolean NOT NULL DEFAULT false,
  parent_document_id uuid REFERENCES public.documents(id),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  delete_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_document_status CHECK (
    status IN ('PENDING', 'VERIFIED', 'REJECTED')
  )
);

CREATE INDEX IF NOT EXISTS idx_documents_agency_case 
  ON public.documents(agency_id, case_id, status);

CREATE INDEX IF NOT EXISTS idx_documents_activity 
  ON public.documents(agency_id, activity_id);

CREATE INDEX IF NOT EXISTS idx_documents_storage_key 
  ON public.documents(storage_key);

CREATE INDEX IF NOT EXISTS idx_documents_parent_version 
  ON public.documents(agency_id, parent_document_id, version);

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by 
  ON public.documents(agency_id, uploaded_by);

-- Enable RLS on documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documents_tenant_select" ON public.documents;
CREATE POLICY "documents_tenant_select" ON public.documents
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.cases c 
      WHERE c.id = case_id 
        AND public.can_view_case(c.id, c.owner_manager_id, c.data_entry_user_id)
    )
  );

DROP POLICY IF EXISTS "documents_tenant_insert" ON public.documents;
CREATE POLICY "documents_tenant_insert" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    agency_id = public.current_agency_id()
  );

DROP POLICY IF EXISTS "documents_tenant_update" ON public.documents;
CREATE POLICY "documents_tenant_update" ON public.documents
  FOR UPDATE TO authenticated
  USING (
    agency_id = public.current_agency_id()
  )
  WITH CHECK (
    agency_id = public.current_agency_id()
  );

-- 3. APPEND-ONLY ENFORCEMENT ON DOCUMENTS (A6 & A8)
-- Documents cannot be deleted physically by normal roles (soft delete only)
CREATE OR REPLACE FUNCTION public.prevent_documents_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A6/A8 Security Violation: Hard deletes on documents are strictly forbidden. Use soft delete (deleted_at, delete_reason).';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_documents_hard_delete ON public.documents;
CREATE TRIGGER trg_prevent_documents_hard_delete
  BEFORE DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_documents_hard_delete();

-- 4. STALE UPLOAD CLEANUP FUNCTION (CRON SUPPORT)
-- Identifies and prunes pending documents older than threshold
CREATE OR REPLACE FUNCTION public.prune_stale_pending_uploads(
  p_threshold_interval interval DEFAULT interval '2 hours'
)
RETURNS TABLE (
  pruned_document_id uuid,
  pruned_storage_key text,
  pruned_agency_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  DELETE FROM public.documents
  WHERE status = 'PENDING'
    AND created_at < (now() - p_threshold_interval)
  RETURNING id, storage_key, agency_id;
END;
$$;
