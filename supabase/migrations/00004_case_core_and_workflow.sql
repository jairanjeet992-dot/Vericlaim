-- ==============================================================================
-- Vericlaim Multi-Tenant SaaS: Case Core, Workflow Engine & Transitions
-- Migration: 00004_case_core_and_workflow.sql
-- ==============================================================================

-- 1. DOC CODE SEQUENCE COUNTER PER AGENCY
CREATE TABLE IF NOT EXISTS public.agency_doc_sequences (
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  year_month varchar(6) NOT NULL, -- e.g. '202610'
  current_sequence integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, year_month)
);

ALTER TABLE public.agency_doc_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agency_doc_sequences_tenant" ON public.agency_doc_sequences;
CREATE POLICY "agency_doc_sequences_tenant" ON public.agency_doc_sequences
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 2. ENHANCE CASES TABLE
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS claim_no text,
  ADD COLUMN IF NOT EXISTS normalized_claim_no text,
  ADD COLUMN IF NOT EXISTS policy_no text,
  ADD COLUMN IF NOT EXISTS case_type_id uuid REFERENCES public.case_types(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS client_branch_id uuid REFERENCES public.client_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS insured_name text,
  ADD COLUMN IF NOT EXISTS patient_name text,
  ADD COLUMN IF NOT EXISTS claimant_name text,
  ADD COLUMN IF NOT EXISTS hospital_name text,
  ADD COLUMN IF NOT EXISTS hospital_city text,
  ADD COLUMN IF NOT EXISTS hospital_state text,
  ADD COLUMN IF NOT EXISTS hospital_pincode text,
  ADD COLUMN IF NOT EXISTS loss_date date,
  ADD COLUMN IF NOT EXISTS admission_date date,
  ADD COLUMN IF NOT EXISTS discharge_date date,
  ADD COLUMN IF NOT EXISTS claim_amount numeric(14,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS location_city text,
  ADD COLUMN IF NOT EXISTS location_district text,
  ADD COLUMN IF NOT EXISTS location_state text,
  ADD COLUMN IF NOT EXISTS location_pincode text,
  ADD COLUMN IF NOT EXISTS risk_level varchar(16) NOT NULL DEFAULT 'LOW',
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS outcome varchar(32) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS fraud_reason text,
  ADD COLUMN IF NOT EXISTS exception_type varchar(32),
  ADD COLUMN IF NOT EXISTS exception_reason text,
  ADD COLUMN IF NOT EXISTS exception_financial_rule jsonb,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rework_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Backfill claim_no from claim_number if empty
UPDATE public.cases 
SET claim_no = claim_number,
    normalized_claim_no = trim(upper(claim_number))
WHERE claim_no IS NULL AND claim_number IS NOT NULL;

-- Trigger to maintain normalized_claim_no on insert/update
CREATE OR REPLACE FUNCTION public.maintain_normalized_claim_no()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.claim_no IS NOT NULL THEN
    NEW.normalized_claim_no := trim(upper(NEW.claim_no));
    NEW.claim_number := NEW.claim_no; -- Keep legacy column in sync
  ELSIF NEW.claim_number IS NOT NULL THEN
    NEW.claim_no := NEW.claim_number;
    NEW.normalized_claim_no := trim(upper(NEW.claim_number));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_case_claim_no ON public.cases;
CREATE TRIGGER trg_normalize_case_claim_no
  BEFORE INSERT OR UPDATE OF claim_no, claim_number ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.maintain_normalized_claim_no();

-- Unique constraint: (agency_id, client_id, normalized_claim_no)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_agency_client_normalized_claim'
  ) THEN
    ALTER TABLE public.cases
      ADD CONSTRAINT uq_agency_client_normalized_claim
      UNIQUE (agency_id, client_id, normalized_claim_no);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cases_normalized_claim
  ON public.cases(agency_id, client_id, normalized_claim_no);

-- 3. WORKFLOW TRANSITIONS TABLE
CREATE TABLE IF NOT EXISTS public.case_status_transitions (
  from_status varchar(32) NOT NULL,
  to_status varchar(32) NOT NULL,
  required_permission varchar(64),
  requires_reason boolean NOT NULL DEFAULT false,
  description text,
  PRIMARY KEY (from_status, to_status)
);

-- Seed Transition Matrix per WORKFLOW.md
INSERT INTO public.case_status_transitions (from_status, to_status, required_permission, requires_reason, description)
VALUES
  ('DATA_ENTRY', 'VERIFICATION', 'cases.create', false, 'Submit data entry for verification'),
  ('VERIFICATION', 'DATA_ENTRY', 'cases.verify', true, 'Send back to data entry with reason'),
  ('VERIFICATION', 'ASSIGNMENT', 'cases.verify', false, 'Verify case data and route to assignment'),
  ('ASSIGNMENT', 'ACCEPTANCE_PENDING', 'cases.assign', false, 'Assign investigator to case'),
  ('ACCEPTANCE_PENDING', 'ASSIGNMENT', 'cases.accept', true, 'Investigator declines assignment with reason'),
  ('ACCEPTANCE_PENDING', 'FIELD_INVESTIGATION', 'cases.accept', false, 'Investigator accepts case'),
  ('FIELD_INVESTIGATION', 'EVIDENCE_GATHERING', 'evidence.upload', false, 'Upload geo-evidence and notes'),
  ('EVIDENCE_GATHERING', 'REPORT_DRAFTING', 'reports.write', false, 'Draft investigation report'),
  ('REPORT_DRAFTING', 'REPORT_REVIEW', 'reports.submit', false, 'Submit report for review'),
  ('REPORT_REVIEW', 'REPORT_DRAFTING', 'reports.review', true, 'Send back report for rework with reason'),
  ('REPORT_REVIEW', 'ESCALATED_REVIEW', NULL, false, 'Auto-escalate on 3+ reworks'),
  ('ESCALATED_REVIEW', 'REPORT_DRAFTING', 'reports.escalate', true, 'Admin override rework authorization'),
  ('REPORT_REVIEW', 'APPROVED', 'reports.approve', false, 'Approve investigation report'),
  ('ESCALATED_REVIEW', 'APPROVED', 'reports.approve', true, 'Executive approval with audit note'),
  ('APPROVED', 'HARDCOPY_TRANSIT', 'hardcopy.dispatch', false, 'Handover hardcopy docket to courier'),
  ('APPROVED', 'CLOSED', 'cases.close', false, 'Direct digital closure'),
  ('HARDCOPY_TRANSIT', 'CLOSED', 'hardcopy.receive', false, 'Courier delivery acknowledged by client'),
  ('CLOSED', 'INVOICED', 'invoices.generate', false, 'Issue GST tax invoice'),
  ('INVOICED', 'PARTIALLY_PAID', 'payments.record', false, 'Partial client payment recorded'),
  ('INVOICED', 'PAID_IN_FULL', 'payments.record', false, 'Full payment received'),
  ('PARTIALLY_PAID', 'PAID_IN_FULL', 'payments.record', false, 'Final remittance received'),
  ('PAID_IN_FULL', 'PAYOUT_QUEUED', 'payouts.prepare', false, 'Stage investigator payouts'),
  ('PAYOUT_QUEUED', 'FINANCIALLY_CLOSED', 'payouts.disburse', true, 'Disburse payout with bank reference'),
  -- Exception Transitions (Withdrawn / Rejected from active statuses)
  ('DATA_ENTRY', 'WITHDRAWN', 'cases.withdraw', true, 'Case withdrawn by insurer'),
  ('VERIFICATION', 'WITHDRAWN', 'cases.withdraw', true, 'Case withdrawn by insurer'),
  ('ASSIGNMENT', 'WITHDRAWN', 'cases.withdraw', true, 'Case withdrawn by insurer'),
  ('ACCEPTANCE_PENDING', 'WITHDRAWN', 'cases.withdraw', true, 'Case withdrawn by insurer'),
  ('FIELD_INVESTIGATION', 'WITHDRAWN', 'cases.withdraw', true, 'Case withdrawn by insurer'),
  ('EVIDENCE_GATHERING', 'WITHDRAWN', 'cases.withdraw', true, 'Case withdrawn by insurer'),
  ('REPORT_DRAFTING', 'WITHDRAWN', 'cases.withdraw', true, 'Case withdrawn by insurer'),
  ('REPORT_REVIEW', 'WITHDRAWN', 'cases.withdraw', true, 'Case withdrawn by insurer'),
  ('ESCALATED_REVIEW', 'WITHDRAWN', 'cases.withdraw', true, 'Case withdrawn by insurer'),
  ('APPROVED', 'WITHDRAWN', 'cases.withdraw', true, 'Case withdrawn by insurer')
ON CONFLICT (from_status, to_status) DO UPDATE
SET required_permission = EXCLUDED.required_permission,
    requires_reason = EXCLUDED.requires_reason,
    description = EXCLUDED.description;

-- 4. CASE STATUS HISTORY (Append-Only)
CREATE TABLE IF NOT EXISTS public.case_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  from_status varchar(32) NOT NULL,
  to_status varchar(32) NOT NULL,
  changed_by uuid NOT NULL REFERENCES public.users(id),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_status_history_case
  ON public.case_status_history(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_status_history_agency
  ON public.case_status_history(agency_id, created_at DESC);

ALTER TABLE public.case_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_status_history_read" ON public.case_status_history;
CREATE POLICY "case_status_history_read" ON public.case_status_history
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "case_status_history_insert" ON public.case_status_history;
CREATE POLICY "case_status_history_insert" ON public.case_status_history
  FOR INSERT TO authenticated
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- Immutable trigger for case_status_history
CREATE OR REPLACE FUNCTION public.prevent_case_status_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Security Violation: Case status history records are immutable and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_immutable_case_status_history ON public.case_status_history;
CREATE TRIGGER trg_immutable_case_status_history
  BEFORE UPDATE OR DELETE ON public.case_status_history
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_case_status_history_mutation();

-- 5. CASE NOTES & TASKS
CREATE TABLE IF NOT EXISTS public.case_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.users(id),
  note_type varchar(32) NOT NULL DEFAULT 'INTERNAL', -- 'INTERNAL', 'CLIENT', 'INVESTIGATOR', 'SEND_BACK'
  content text NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_notes_case ON public.case_notes(case_id, created_at DESC);
ALTER TABLE public.case_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_notes_read" ON public.case_notes;
CREATE POLICY "case_notes_read" ON public.case_notes
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "case_notes_insert" ON public.case_notes;
CREATE POLICY "case_notes_insert" ON public.case_notes
  FOR INSERT TO authenticated
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE TABLE IF NOT EXISTS public.case_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assigned_to uuid REFERENCES public.users(id),
  due_date timestamptz,
  status varchar(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_tasks_case ON public.case_tasks(case_id, status);
ALTER TABLE public.case_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_tasks_read" ON public.case_tasks;
CREATE POLICY "case_tasks_read" ON public.case_tasks
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "case_tasks_write" ON public.case_tasks;
CREATE POLICY "case_tasks_write" ON public.case_tasks
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 6. DOC CODE GENERATOR FUNCTION
CREATE OR REPLACE FUNCTION public.generate_case_doc_code(p_agency_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_month_str text;
  v_seq integer;
  v_doc_code text;
BEGIN
  -- Month code: e.g. OCT26
  v_month_str := upper(to_char(now(), 'MonYY'));

  -- Increment sequence atomically in agency_doc_sequences
  INSERT INTO public.agency_doc_sequences (agency_id, year_month, current_sequence, updated_at)
  VALUES (p_agency_id, to_char(now(), 'YYYYMM'), 1, now())
  ON CONFLICT (agency_id, year_month)
  DO UPDATE SET current_sequence = public.agency_doc_sequences.current_sequence + 1, updated_at = now()
  RETURNING current_sequence INTO v_seq;

  -- Format: e.g. OCT26-0001
  v_doc_code := v_month_str || '-' || lpad(v_seq::text, 4, '0');
  RETURN v_doc_code;
END;
$$;

-- 7. DB TRIGGER: ILLEGAL TRANSITIONS & OPTIMISTIC CONCURRENCY REJECTION
CREATE OR REPLACE FUNCTION public.validate_case_transition_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_valid boolean;
  v_requires_reason boolean;
BEGIN
  -- If status is unchanged, skip transition validation
  IF OLD.status = NEW.status THEN
    -- Check optimistic locking version
    IF NEW.version <> OLD.version AND NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Concurrent modification error: Expected version %, got %', OLD.version, NEW.version;
    END IF;
    RETURN NEW;
  END IF;

  -- 1. Check if transition exists in transition matrix
  SELECT true, requires_reason INTO v_is_valid, v_requires_reason
  FROM public.case_status_transitions
  WHERE from_status = OLD.status AND to_status = NEW.status;

  IF NOT COALESCE(v_is_valid, false) THEN
    RAISE EXCEPTION 'Illegal status transition from % to % is not allowed.', OLD.status, NEW.status;
  END IF;

  -- 2. Concurrency Check: optimistic locking version increment
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Concurrent modification error: Expected version % to advance to %, got %',
      OLD.version, OLD.version + 1, NEW.version;
  END IF;

  -- 3. Rework escalation rule ($N >= 3)
  IF OLD.status = 'REPORT_REVIEW' AND NEW.status = 'REPORT_DRAFTING' THEN
    NEW.rework_count := OLD.rework_count + 1;
    IF NEW.rework_count >= 3 THEN
      NEW.status := 'ESCALATED_REVIEW';
    END IF;
  END IF;

  -- 4. Mark completed_at on closure
  IF NEW.status IN ('CLOSED', 'FINANCIALLY_CLOSED') AND OLD.status NOT IN ('CLOSED', 'FINANCIALLY_CLOSED') THEN
    NEW.completed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_case_transition ON public.cases;
CREATE TRIGGER trg_validate_case_transition
  BEFORE UPDATE OF status, version ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_case_transition_trigger();

-- 8. DB TRIGGER: ENFORCE DATA ENTRY EDIT LOCK AFTER VERIFIED
CREATE OR REPLACE FUNCTION public.enforce_data_entry_edit_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_caller_user_id uuid;
  v_caller_scope text;
  v_is_data_entry boolean;
BEGIN
  -- If status is DATA_ENTRY or VERIFICATION, creator can edit
  IF OLD.status IN ('DATA_ENTRY', 'VERIFICATION') THEN
    RETURN NEW;
  END IF;

  -- When status is beyond VERIFICATION (e.g. ASSIGNMENT, FIELD_INVESTIGATION, CLOSED):
  -- Identify caller scope & role
  SELECT id, scope INTO v_caller_user_id, v_caller_scope
  FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;

  IF v_caller_user_id IS NOT NULL THEN
    -- Check if user has Data Entry role or OWN_ENTERED scope
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON ur.role_id = r.id
      WHERE ur.user_id = v_caller_user_id AND r.name ILIKE '%Data Entry%'
    ) INTO v_is_data_entry;

    IF v_caller_scope = 'OWN_ENTERED' OR v_is_data_entry THEN
      -- If core claim/case fields are being modified (not just internal flags)
      IF (OLD.claim_no <> NEW.claim_no OR
          OLD.policy_no <> NEW.policy_no OR
          OLD.insured_name <> NEW.insured_name OR
          OLD.client_id <> NEW.client_id OR
          OLD.case_type_id <> NEW.case_type_id OR
          OLD.claim_amount <> NEW.claim_amount) THEN
        RAISE EXCEPTION 'A9 Violation: Data entry cannot edit case after verification (current status: %).', OLD.status;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_data_entry_lock ON public.cases;
CREATE TRIGGER trg_enforce_data_entry_lock
  BEFORE UPDATE ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_data_entry_edit_lock();
