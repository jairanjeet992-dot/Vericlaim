-- ============================================================================
-- VERICLAIM MULTI-TENANT SAAS
-- MIGRATION: 00007_reports_review_rework_hardcopy.sql
-- PHASE 6: Reports, Review, Rework Engine, and Hardcopy Chain of Custody
-- ============================================================================

-- 1. REPORTS TABLE
-- Tracks the primary investigation report per docket
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Investigation Report',
  status varchar(32) NOT NULL DEFAULT 'DRAFT',
  current_version integer NOT NULL DEFAULT 1,
  author_id uuid REFERENCES public.users(id),
  reviewer_id uuid REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approval_notes text,
  is_immutable boolean NOT NULL DEFAULT false,
  pdf_r2_key text,
  pdf_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_report_status CHECK (
    status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SENT_BACK', 'CORRECTED', 'RESUBMITTED', 'APPROVED', 'FINAL')
  ),
  CONSTRAINT uq_reports_agency_case UNIQUE (agency_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_agency_case ON public.reports(agency_id, case_id);
CREATE INDEX IF NOT EXISTS idx_reports_agency_status ON public.reports(agency_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_agency_author ON public.reports(agency_id, author_id);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_tenant_select" ON public.reports
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND EXISTS (
      SELECT 1 FROM public.cases c 
      WHERE c.id = case_id 
        AND public.can_view_case(c.id, c.owner_manager_id, c.data_entry_user_id)
    )
  );

CREATE POLICY "reports_tenant_all" ON public.reports
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id())
  WITH CHECK (agency_id = public.current_agency_id());

-- 2. REPORT VERSIONS TABLE (Rule A6: Append-only history)
-- Every edit, correction, and resubmission stores a discrete version
CREATE TABLE IF NOT EXISTS public.report_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status varchar(32) NOT NULL,
  author_id uuid NOT NULL REFERENCES public.users(id),
  summary text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_summary text,
  rework_cycle_id uuid,
  pdf_r2_key text,
  pdf_sha256 text,
  is_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_versions_unique_ver UNIQUE (report_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_report_versions_report_ver ON public.report_versions(agency_id, report_id, version_number);
CREATE INDEX IF NOT EXISTS idx_report_versions_case ON public.report_versions(agency_id, case_id);

ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_versions_tenant_select" ON public.report_versions
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND EXISTS (
      SELECT 1 FROM public.cases c 
      WHERE c.id = case_id 
        AND public.can_view_case(c.id, c.owner_manager_id, c.data_entry_user_id)
    )
  );

CREATE POLICY "report_versions_tenant_insert" ON public.report_versions
  FOR INSERT TO authenticated
  WITH CHECK (agency_id = public.current_agency_id());

-- Immutability of report versions (no UPDATE or DELETE)
CREATE OR REPLACE FUNCTION public.prevent_report_versions_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A6 Security Violation: report_versions is append-only. Historical report versions cannot be modified or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_report_versions_mutation ON public.report_versions;
CREATE TRIGGER trg_prevent_report_versions_mutation
  BEFORE UPDATE OR DELETE ON public.report_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_report_versions_mutation();

-- Immutability of approved reports
CREATE OR REPLACE FUNCTION public.prevent_approved_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_immutable = true OR OLD.status IN ('APPROVED', 'FINAL') THEN
    IF TG_OP = 'UPDATE' THEN
      -- Allow only administrative setting of immutable flag from false to true in the same step
      IF OLD.is_immutable = false AND NEW.is_immutable = true THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'A6 Security Violation: Approved report is sealed and immutable. Content and state cannot be modified.';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'A6 Security Violation: Approved report cannot be deleted.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_approved_report_mutation ON public.reports;
CREATE TRIGGER trg_prevent_approved_report_mutation
  BEFORE UPDATE OR DELETE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_approved_report_mutation();

-- 3. REPORT COMMENTS TABLE
-- Reviewer comments anchored to Section, Evidence document, or Claim/Report Field
CREATE TABLE IF NOT EXISTS public.report_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  target_type varchar(32) NOT NULL,
  target_id text NOT NULL,
  target_label text,
  comment text NOT NULL,
  author_id uuid NOT NULL REFERENCES public.users(id),
  status varchar(32) NOT NULL DEFAULT 'OPEN',
  resolution_notes text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_comment_target_type CHECK (
    target_type IN ('SECTION', 'EVIDENCE', 'FIELD')
  ),
  CONSTRAINT chk_comment_status CHECK (
    status IN ('OPEN', 'RESOLVED', 'REJECTED')
  )
);

CREATE INDEX IF NOT EXISTS idx_report_comments_report ON public.report_comments(agency_id, report_id, version_number);
CREATE INDEX IF NOT EXISTS idx_report_comments_target ON public.report_comments(agency_id, target_type, target_id);

ALTER TABLE public.report_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_comments_tenant_select" ON public.report_comments
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND EXISTS (
      SELECT 1 FROM public.cases c 
      WHERE c.id = case_id 
        AND public.can_view_case(c.id, c.owner_manager_id, c.data_entry_user_id)
    )
  );

CREATE POLICY "report_comments_tenant_all" ON public.report_comments
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id())
  WITH CHECK (agency_id = public.current_agency_id());

-- 4. REWORK CYCLES TABLE
-- Actionable send-back tracking with auto-escalation after N cycles
CREATE TABLE IF NOT EXISTS public.rework_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  report_id uuid REFERENCES public.reports(id) ON DELETE CASCADE,
  cycle_number integer NOT NULL,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  target_recipient_type varchar(32) NOT NULL,
  target_user_id uuid REFERENCES public.users(id),
  reason_category varchar(64) NOT NULL,
  instructions text NOT NULL,
  priority varchar(16) NOT NULL DEFAULT 'MEDIUM',
  deadline timestamptz,
  target_sections text[] DEFAULT '{}',
  target_field_names text[] DEFAULT '{}',
  target_evidence_ids uuid[] DEFAULT '{}',
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  is_escalated boolean NOT NULL DEFAULT false,
  escalation_reason text,
  escalated_to_id uuid REFERENCES public.users(id),
  correction_notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_rework_recipient CHECK (
    target_recipient_type IN (
      'INVESTIGATOR', 'BACK_OFFICE', 'DATA_ENTRY', 'REVIEWER', 
      'CASE_MANAGER', 'REPORT_AUTHOR', 'PREVIOUS_ASSIGNEE'
    )
  ),
  CONSTRAINT chk_rework_priority CHECK (
    priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')
  ),
  CONSTRAINT chk_rework_status CHECK (
    status IN ('PENDING', 'IN_PROGRESS', 'CORRECTED', 'RESUBMITTED', 'ESCALATED', 'WAIVED')
  )
);

CREATE INDEX IF NOT EXISTS idx_rework_cycles_case ON public.rework_cycles(agency_id, case_id, cycle_number);
CREATE INDEX IF NOT EXISTS idx_rework_cycles_target ON public.rework_cycles(agency_id, target_user_id, status);

ALTER TABLE public.rework_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rework_cycles_tenant_select" ON public.rework_cycles
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND EXISTS (
      SELECT 1 FROM public.cases c 
      WHERE c.id = case_id 
        AND public.can_view_case(c.id, c.owner_manager_id, c.data_entry_user_id)
    )
  );

CREATE POLICY "rework_cycles_tenant_all" ON public.rework_cycles
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id())
  WITH CHECK (agency_id = public.current_agency_id());

-- 5. COURIER DOCKETS TABLE
-- Bulk dispatch dockets for client hardcopy manifests
CREATE TABLE IF NOT EXISTS public.courier_dockets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  docket_number varchar(64) NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  client_branch_id uuid REFERENCES public.client_branches(id),
  courier_partner varchar(64) NOT NULL,
  awb_number varchar(64) NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  dispatched_by uuid NOT NULL REFERENCES public.users(id),
  delivery_status varchar(32) NOT NULL DEFAULT 'IN_TRANSIT',
  delivered_at timestamptz,
  recipient_name text,
  acknowledgement_notes text,
  proof_of_delivery_r2_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_delivery_status CHECK (
    delivery_status IN ('PENDING', 'IN_TRANSIT', 'DELIVERED', 'RETURNED')
  ),
  CONSTRAINT uq_courier_dockets_agency_number UNIQUE (agency_id, docket_number)
);

CREATE INDEX IF NOT EXISTS idx_courier_dockets_agency_awb ON public.courier_dockets(agency_id, awb_number);
CREATE INDEX IF NOT EXISTS idx_courier_dockets_agency_client ON public.courier_dockets(agency_id, client_id);

ALTER TABLE public.courier_dockets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "courier_dockets_tenant_select" ON public.courier_dockets
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id());

CREATE POLICY "courier_dockets_tenant_all" ON public.courier_dockets
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id())
  WITH CHECK (agency_id = public.current_agency_id());

-- 6. HARDCOPY PACKETS TABLE
-- Individual case physical packet tracking with item counts and location
CREATE TABLE IF NOT EXISTS public.hardcopy_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  packet_no varchar(64) NOT NULL,
  investigator_id uuid REFERENCES public.investigators(id),
  received_from_user_id uuid REFERENCES public.users(id),
  received_by_user_id uuid REFERENCES public.users(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  item_counts jsonb NOT NULL DEFAULT '{"bills": 0, "prescriptions": 0, "reports": 0, "photos": 0, "total_pages": 0}'::jsonb,
  condition_notes text,
  storage_location jsonb NOT NULL DEFAULT '{"rack": "R1", "shelf": "S1", "box": "B1"}'::jsonb,
  current_status varchar(32) NOT NULL DEFAULT 'RECEIVED',
  courier_docket_id uuid REFERENCES public.courier_dockets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_packet_status CHECK (
    current_status IN ('RECEIVED', 'STORED', 'RETRIEVED', 'PACKED', 'DISPATCHED', 'DELIVERED', 'RETURNED')
  ),
  CONSTRAINT uq_hardcopy_packets_agency_no UNIQUE (agency_id, packet_no)
);

CREATE INDEX IF NOT EXISTS idx_hardcopy_packets_case ON public.hardcopy_packets(agency_id, case_id);
CREATE INDEX IF NOT EXISTS idx_hardcopy_packets_docket ON public.hardcopy_packets(agency_id, courier_docket_id);

ALTER TABLE public.hardcopy_packets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hardcopy_packets_tenant_select" ON public.hardcopy_packets
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND EXISTS (
      SELECT 1 FROM public.cases c 
      WHERE c.id = case_id 
        AND public.can_view_case(c.id, c.owner_manager_id, c.data_entry_user_id)
    )
  );

CREATE POLICY "hardcopy_packets_tenant_all" ON public.hardcopy_packets
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id())
  WITH CHECK (agency_id = public.current_agency_id());

-- 7. HARDCOPY MOVEMENTS TABLE (Rule A6: Append-Only Chain of Custody)
-- Every physical location shift and custody handover is permanently logged
CREATE TABLE IF NOT EXISTS public.hardcopy_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  packet_id uuid REFERENCES public.hardcopy_packets(id) ON DELETE CASCADE,
  movement_type varchar(32) NOT NULL,
  from_location text NOT NULL,
  to_location text NOT NULL,
  handler_id uuid NOT NULL REFERENCES public.users(id),
  docket_id uuid REFERENCES public.courier_dockets(id) ON DELETE SET NULL,
  notes text,
  item_counts jsonb,
  moved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_movement_type CHECK (
    movement_type IN (
      'RECEIVED_FROM_INVESTIGATOR', 'STORED_IN_ARCHIVE', 'RETRIEVED_FOR_REVIEW',
      'PACKED_FOR_DISPATCH', 'DISPATCHED_TO_CLIENT', 'DELIVERY_ACKNOWLEDGED', 'RETURNED'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_hardcopy_movements_case ON public.hardcopy_movements(agency_id, case_id);
CREATE INDEX IF NOT EXISTS idx_hardcopy_movements_packet ON public.hardcopy_movements(agency_id, packet_id);
CREATE INDEX IF NOT EXISTS idx_hardcopy_movements_handler ON public.hardcopy_movements(agency_id, handler_id);

ALTER TABLE public.hardcopy_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hardcopy_movements_tenant_select" ON public.hardcopy_movements
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND EXISTS (
      SELECT 1 FROM public.cases c 
      WHERE c.id = case_id 
        AND public.can_view_case(c.id, c.owner_manager_id, c.data_entry_user_id)
    )
  );

CREATE POLICY "hardcopy_movements_tenant_insert" ON public.hardcopy_movements
  FOR INSERT TO authenticated
  WITH CHECK (agency_id = public.current_agency_id());

-- Immutability enforcement on hardcopy_movements (cannot be edited or deleted)
CREATE OR REPLACE FUNCTION public.prevent_hardcopy_movements_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A6 Security Violation: hardcopy_movements is append-only. Hardcopy chain of custody movements cannot be edited or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_hardcopy_movements_mutation ON public.hardcopy_movements;
CREATE TRIGGER trg_prevent_hardcopy_movements_mutation
  BEFORE UPDATE OR DELETE ON public.hardcopy_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_hardcopy_movements_mutation();
