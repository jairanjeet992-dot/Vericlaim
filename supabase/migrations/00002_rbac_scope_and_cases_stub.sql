-- ==============================================================================
-- Vericlaim Multi-Tenant SaaS: RBAC, Scope, Delegation, Routing & Cases Stub
-- Migration: 00002_rbac_scope_and_cases_stub.sql
-- ==============================================================================

-- 1. CLIENTS TABLE (Required for manager_scopes routing)
CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code varchar(32) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_client_code UNIQUE (agency_id, code)
);

CREATE INDEX IF NOT EXISTS idx_clients_agency ON public.clients(agency_id);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_tenant_read" ON public.clients;
CREATE POLICY "clients_tenant_read" ON public.clients
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "clients_tenant_modify" ON public.clients;
CREATE POLICY "clients_tenant_modify" ON public.clients
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 2. MANAGER SCOPES TABLE ((client, case_type) to manager routing mapping)
CREATE TABLE IF NOT EXISTS public.manager_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_type varchar(32) NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_manager_client_case_type UNIQUE (agency_id, manager_id, client_id, case_type)
);

CREATE INDEX IF NOT EXISTS idx_manager_scopes_lookup 
  ON public.manager_scopes(agency_id, client_id, case_type, is_default);
CREATE INDEX IF NOT EXISTS idx_manager_scopes_mgr 
  ON public.manager_scopes(agency_id, manager_id);

ALTER TABLE public.manager_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manager_scopes_tenant_read" ON public.manager_scopes;
CREATE POLICY "manager_scopes_tenant_read" ON public.manager_scopes
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "manager_scopes_tenant_modify" ON public.manager_scopes;
CREATE POLICY "manager_scopes_tenant_modify" ON public.manager_scopes
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 3. CASES STUB TABLE (To prove RLS, routing, and scope isolation)
CREATE TABLE IF NOT EXISTS public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  doc_code varchar(32) NOT NULL,
  claim_number text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT,
  case_type varchar(32) NOT NULL,
  owner_manager_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  data_entry_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  status varchar(32) NOT NULL DEFAULT 'DATA_ENTRY',
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_doc_code UNIQUE (agency_id, doc_code)
);

CREATE INDEX IF NOT EXISTS idx_cases_agency_status ON public.cases(agency_id, status);
CREATE INDEX IF NOT EXISTS idx_cases_owner_manager ON public.cases(agency_id, owner_manager_id);
CREATE INDEX IF NOT EXISTS idx_cases_data_entry ON public.cases(agency_id, data_entry_user_id);
CREATE INDEX IF NOT EXISTS idx_cases_routing ON public.cases(agency_id, client_id, case_type);

-- 4. CASE INVESTIGATORS STUB TABLE
CREATE TABLE IF NOT EXISTS public.case_investigators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  investigator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status varchar(32) NOT NULL DEFAULT 'ASSIGNED',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_case_investigator UNIQUE (case_id, investigator_id)
);

CREATE INDEX IF NOT EXISTS idx_case_investigators_lookup 
  ON public.case_investigators(agency_id, investigator_id, case_id);

ALTER TABLE public.case_investigators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_investigators_tenant_read" ON public.case_investigators;
CREATE POLICY "case_investigators_tenant_read" ON public.case_investigators
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 5. FUNCTION: get_user_subtree (Returns subordinate subtree user IDs with depth cap)
CREATE OR REPLACE FUNCTION public.get_user_subtree(p_user_id uuid)
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE subordinates AS (
    SELECT u.id, 1 as depth
    FROM public.users u
    WHERE u.reports_to_id = p_user_id
    UNION ALL
    SELECT u.id, s.depth + 1
    FROM public.users u
    JOIN subordinates s ON u.reports_to_id = s.id
    WHERE s.depth < 5
  )
  SELECT subordinates.id FROM subordinates;
$$;

-- 6. FUNCTION: can_view_case (Fast, indexed scope resolution)
CREATE OR REPLACE FUNCTION public.can_view_case(
  p_case_agency_id uuid,
  p_owner_manager_id uuid,
  p_data_entry_user_id uuid,
  p_case_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_agency_id uuid;
  v_scope text;
  v_manager_id uuid;
BEGIN
  -- Resolve user from session
  SELECT id, agency_id, scope, reports_to_id 
  INTO v_user_id, v_agency_id, v_scope, v_manager_id
  FROM public.users 
  WHERE auth_user_id = auth.uid() LIMIT 1;

  IF v_user_id IS NULL OR v_agency_id <> p_case_agency_id THEN
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
      WHERE ci.case_id = p_case_id AND ci.investigator_id = v_user_id
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
    IF EXISTS (SELECT 1 FROM public.get_user_subtree(v_user_id) sub WHERE sub.id = p_owner_manager_id) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

-- 7. ROW LEVEL SECURITY ON CASES TABLE
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cases_tenant_and_scope_read" ON public.cases;
CREATE POLICY "cases_tenant_and_scope_read" ON public.cases
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND public.has_permission('cases.view')
    AND public.can_view_case(agency_id, owner_manager_id, data_entry_user_id, id)
  );

DROP POLICY IF EXISTS "cases_tenant_insert" ON public.cases;
CREATE POLICY "cases_tenant_insert" ON public.cases
  FOR INSERT TO authenticated
  WITH CHECK (
    agency_id = public.current_agency_id()
    AND public.has_permission('cases.create')
  );

DROP POLICY IF EXISTS "cases_tenant_update" ON public.cases;
CREATE POLICY "cases_tenant_update" ON public.cases
  FOR UPDATE TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND public.can_view_case(agency_id, owner_manager_id, data_entry_user_id, id)
  )
  WITH CHECK (
    agency_id = public.current_agency_id()
  );

-- 8. DELEGATION PROTOCOL STORED PROCEDURE (Enforces A9 Delegation Rules)
CREATE OR REPLACE FUNCTION public.delegate_user_permission(
  p_target_user_id uuid,
  p_permission_id text,
  p_effect text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_agency uuid;
  v_target_agency uuid;
  v_is_subtree boolean;
  v_caller_has_perm boolean;
BEGIN
  -- 1. Identify caller
  SELECT id, agency_id INTO v_caller_id, v_caller_agency
  FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Unauthenticated user cannot delegate permissions.';
  END IF;

  -- 2. Disallow self-delegation (Rule A9)
  IF v_caller_id = p_target_user_id THEN
    RAISE EXCEPTION 'A9 Violation: A manager cannot modify their own permissions or delegate to themselves.';
  END IF;

  -- 3. Verify target user exists and belongs to the same agency
  SELECT agency_id INTO v_target_agency FROM public.users WHERE id = p_target_user_id;
  IF v_target_agency IS NULL OR v_target_agency <> v_caller_agency THEN
    RAISE EXCEPTION 'A9 Violation: Target user does not exist in this agency.';
  END IF;

  -- 4. Verify target user is in caller's subtree (unless caller has ALL scope / Owner / Admin)
  SELECT EXISTS (
    SELECT 1 FROM public.get_user_subtree(v_caller_id) WHERE id = p_target_user_id
  ) INTO v_is_subtree;

  IF NOT v_is_subtree THEN
    -- Check if caller is Owner/Admin with ALL scope
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_caller_id AND scope = 'ALL') THEN
      RAISE EXCEPTION 'A9 Violation: A manager can only delegate permissions to users within their subordinate subtree.';
    END IF;
  END IF;

  -- 5. Subset Constraint: Caller must possess the permission they are delegating (Rule A9)
  SELECT public.has_permission(p_permission_id) INTO v_caller_has_perm;
  IF NOT v_caller_has_perm THEN
    RAISE EXCEPTION 'A9 Violation: A manager cannot delegate a permission they do not personally hold (%s).', p_permission_id;
  END IF;

  -- 6. Upsert user_permissions override
  INSERT INTO public.user_permissions (user_id, permission_id, effect, granted_by, granted_at)
  VALUES (p_target_user_id, p_permission_id, p_effect, v_caller_id, now())
  ON CONFLICT (user_id, permission_id) 
  DO UPDATE SET effect = p_effect, granted_by = v_caller_id, granted_at = now();

  -- 7. Immutable Audit Log Entry
  INSERT INTO public.audit_logs (
    agency_id, user_id, action, entity_type, entity_id, new_values
  ) VALUES (
    v_caller_agency, v_caller_id, 'PERMISSION_DELEGATED', 'user_permission', p_target_user_id,
    jsonb_build_object('permission_id', p_permission_id, 'effect', p_effect, 'target_user_id', p_target_user_id)
  );

  RETURN true;
END;
$$;

-- 9. TRIGGER: Block Deactivating or Removing Manager with Open Cases (Rule A9)
CREATE OR REPLACE FUNCTION public.check_manager_deactivation_constraints()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_open_case_count integer;
  v_subordinate_count integer;
  v_scope_count integer;
BEGIN
  -- Only execute if manager is being deactivated
  IF (OLD.is_active = true AND NEW.is_active = false) THEN
    -- 1. Check open cases
    SELECT count(*) INTO v_open_case_count
    FROM public.cases
    WHERE owner_manager_id = NEW.id AND status NOT IN ('CLOSED', 'FINANCIALLY_CLOSED') AND is_deleted = false;

    IF v_open_case_count > 0 THEN
      RAISE EXCEPTION 'A9 Violation: Cannot deactivate manager with % open cases. You must complete the Manager Transfer Wizard first.', v_open_case_count;
    END IF;

    -- 2. Check subordinate staff reporting
    SELECT count(*) INTO v_subordinate_count
    FROM public.users
    WHERE reports_to_id = NEW.id AND is_active = true;

    IF v_subordinate_count > 0 THEN
      RAISE EXCEPTION 'A9 Violation: Cannot deactivate manager with % reporting subordinates. Transfer staff reporting hierarchy first.', v_subordinate_count;
    END IF;

    -- 3. Check active manager scopes
    SELECT count(*) INTO v_scope_count
    FROM public.manager_scopes
    WHERE manager_id = NEW.id;

    IF v_scope_count > 0 THEN
      RAISE EXCEPTION 'A9 Violation: Cannot deactivate manager with % active client scopes. Reassign manager scopes first.', v_scope_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_manager_deactivation ON public.users;
CREATE TRIGGER trg_check_manager_deactivation
BEFORE UPDATE OF is_active ON public.users
FOR EACH ROW EXECUTE FUNCTION public.check_manager_deactivation_constraints();

-- 10. ATOMIC MANAGER TRANSFER WIZARD PROCEDURE
CREATE OR REPLACE FUNCTION public.transfer_manager_responsibilities(
  p_old_manager_id uuid,
  p_new_manager_id uuid,
  p_transfer_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_agency uuid;
  v_old_agency uuid;
  v_new_agency uuid;
  v_transferred_cases integer;
  v_transferred_staff integer;
  v_transferred_scopes integer;
BEGIN
  -- Caller info
  SELECT id, agency_id INTO v_caller_id, v_caller_agency
  FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;

  -- Verify both managers belong to caller's agency
  SELECT agency_id INTO v_old_agency FROM public.users WHERE id = p_old_manager_id;
  SELECT agency_id INTO v_new_agency FROM public.users WHERE id = p_new_manager_id;

  IF v_old_agency IS NULL OR v_new_agency IS NULL OR v_old_agency <> v_caller_agency OR v_new_agency <> v_caller_agency THEN
    RAISE EXCEPTION 'Invalid transfer: Both managers must belong to your agency.';
  END IF;

  IF p_old_manager_id = p_new_manager_id THEN
    RAISE EXCEPTION 'Successor manager must be different from departing manager.';
  END IF;

  -- 1. Reassign open cases
  WITH updated_cases AS (
    UPDATE public.cases
    SET owner_manager_id = p_new_manager_id, updated_at = now()
    WHERE owner_manager_id = p_old_manager_id AND status NOT IN ('CLOSED', 'FINANCIALLY_CLOSED')
    RETURNING id
  )
  SELECT count(*) INTO v_transferred_cases FROM updated_cases;

  -- 2. Reassign reporting staff
  WITH updated_staff AS (
    UPDATE public.users
    SET reports_to_id = p_new_manager_id, updated_at = now()
    WHERE reports_to_id = p_old_manager_id
    RETURNING id
  )
  SELECT count(*) INTO v_transferred_staff FROM updated_staff;

  -- 3. Reassign or merge manager scopes
  -- Delete conflicts on new manager first to prevent duplicate key
  DELETE FROM public.manager_scopes
  WHERE manager_id = p_old_manager_id
    AND (client_id, case_type) IN (
      SELECT client_id, case_type FROM public.manager_scopes WHERE manager_id = p_new_manager_id
    );

  WITH updated_scopes AS (
    UPDATE public.manager_scopes
    SET manager_id = p_new_manager_id
    WHERE manager_id = p_old_manager_id
    RETURNING id
  )
  SELECT count(*) INTO v_transferred_scopes FROM updated_scopes;

  -- 4. Deactivate old manager
  UPDATE public.users
  SET is_active = false, updated_at = now()
  WHERE id = p_old_manager_id;

  -- 5. Audit Log
  INSERT INTO public.audit_logs (
    agency_id, user_id, action, entity_type, entity_id, new_values
  ) VALUES (
    v_caller_agency, v_caller_id, 'MANAGER_TRANSFER_WIZARD_COMPLETED', 'user', p_old_manager_id,
    jsonb_build_object(
      'from_manager_id', p_old_manager_id,
      'to_manager_id', p_new_manager_id,
      'transferred_cases', v_transferred_cases,
      'transferred_staff', v_transferred_staff,
      'transferred_scopes', v_transferred_scopes,
      'reason', p_transfer_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'transferred_cases', v_transferred_cases,
    'transferred_staff', v_transferred_staff,
    'transferred_scopes', v_transferred_scopes
  );
END;
$$;
