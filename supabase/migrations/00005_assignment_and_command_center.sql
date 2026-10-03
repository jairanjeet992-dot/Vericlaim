-- ============================================================================
-- VERICLAIM MULTI-TENANT SAAS
-- MIGRATION: 00005_assignment_and_command_center.sql
-- PHASE 4B: Assignment Engine, Multi-Investigator Roster, Command Center
-- ============================================================================

-- 1. ENHANCE CASE_INVESTIGATORS TABLE FOR FULL LIFECYCLE (N PER CASE)
-- If table exists from stub in 00002, adapt and expand it
DO $$
BEGIN
  -- Drop obsolete unique constraint if present
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_case_investigator'
  ) THEN
    ALTER TABLE public.case_investigators DROP CONSTRAINT uq_case_investigator;
  END IF;

  -- Drop legacy foreign key to users if it was pointing to users(id) instead of investigators(id)
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'case_investigators_investigator_id_fkey'
  ) THEN
    ALTER TABLE public.case_investigators DROP CONSTRAINT case_investigators_investigator_id_fkey;
  END IF;
END $$;

-- Alter / Add columns to case_investigators
ALTER TABLE public.case_investigators
  ADD COLUMN IF NOT EXISTS assignment_scope varchar(32) NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS agreed_fee numeric(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS travel_allowance numeric(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS payout_status varchar(32) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS hardcopy_status varchar(32) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reassignment_reason text,
  ADD COLUMN IF NOT EXISTS reassigned_to_id uuid,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS reassigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Add foreign key to investigators table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_case_investigators_investigator'
  ) THEN
    ALTER TABLE public.case_investigators
      ADD CONSTRAINT fk_case_investigators_investigator
      FOREIGN KEY (investigator_id) REFERENCES public.investigators(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Create performance indexes for command center and assignment roster
CREATE INDEX IF NOT EXISTS idx_case_investigators_agency_case 
  ON public.case_investigators(agency_id, case_id);

CREATE INDEX IF NOT EXISTS idx_case_investigators_active 
  ON public.case_investigators(agency_id, case_id, is_active);

CREATE INDEX IF NOT EXISTS idx_case_investigators_inv_active 
  ON public.case_investigators(agency_id, investigator_id, is_active);

CREATE INDEX IF NOT EXISTS idx_case_investigators_payout 
  ON public.case_investigators(agency_id, payout_status);

CREATE INDEX IF NOT EXISTS idx_case_investigators_hardcopy 
  ON public.case_investigators(agency_id, hardcopy_status);

-- 2. COMMAND CENTER SAVED FILTERS TABLE
CREATE TABLE IF NOT EXISTS public.command_center_saved_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  filter_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_saved_filter_name UNIQUE (agency_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_user 
  ON public.command_center_saved_filters(agency_id, user_id);

ALTER TABLE public.command_center_saved_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_filters_tenant_user_all" ON public.command_center_saved_filters
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() AND user_id = auth.uid())
  WITH CHECK (agency_id = public.current_agency_id() AND user_id = auth.uid());

-- 3. HIGH-SPEED INDEXES ON CASES FOR COMMAND CENTER QUERIES
CREATE INDEX IF NOT EXISTS idx_cases_command_center_status 
  ON public.cases(agency_id, status, risk_level, due_date);

CREATE INDEX IF NOT EXISTS idx_cases_command_center_manager 
  ON public.cases(agency_id, owner_manager_id, status);

CREATE INDEX IF NOT EXISTS idx_cases_command_center_client 
  ON public.cases(agency_id, client_id, status);

CREATE INDEX IF NOT EXISTS idx_cases_command_center_location 
  ON public.cases(agency_id, location_city, location_state);

-- 4. UPDATE CAN_VIEW_CASE FUNCTION FOR INVESTIGATORS
-- Supports both direct user_id matches and investigator master profile mapping
CREATE OR REPLACE FUNCTION public.can_view_case(
  p_case_id uuid,
  p_owner_manager_id uuid,
  p_data_entry_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_agency_id uuid;
  v_scope text;
  v_manager_id uuid;
BEGIN
  -- Identify caller
  SELECT id, agency_id, scope, reports_to_id 
  INTO v_user_id, v_agency_id, v_scope, v_manager_id
  FROM public.users
  WHERE auth_user_id = auth.uid() OR id = auth.uid()
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Scope ALL: Full visibility across agency
  IF v_scope = 'ALL' THEN
    RETURN true;
  END IF;

  -- 2. Scope OWN_ENTERED: Creator visibility only
  IF v_scope = 'OWN_ENTERED' THEN
    RETURN p_data_entry_user_id = v_user_id;
  END IF;

  -- 3. Scope ASSIGNED: Assigned field investigator visibility
  IF v_scope = 'ASSIGNED' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.case_investigators ci
      LEFT JOIN public.investigators inv ON ci.investigator_id = inv.id
      WHERE ci.case_id = p_case_id 
        AND ci.is_active = true
        AND (ci.investigator_id = v_user_id OR inv.user_id = v_user_id)
    );
  END IF;

  -- 4. Scope TEAM: Manager's subtree or Staff's manager's cases
  IF v_scope = 'TEAM' THEN
    IF p_owner_manager_id = v_user_id THEN
      RETURN true;
    END IF;
    IF v_manager_id IS NOT NULL AND p_owner_manager_id = v_manager_id THEN
      RETURN true;
    END IF;
    -- Subordinate manager check
    IF EXISTS (
      SELECT 1 FROM public.get_user_subtree(v_user_id) sub 
      WHERE sub.id = p_owner_manager_id
    ) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;
