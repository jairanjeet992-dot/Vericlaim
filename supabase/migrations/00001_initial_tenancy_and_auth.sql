-- ==============================================================================
-- Vericlaim Multi-Tenant SaaS: Initial Tenancy, Auth & Audit Schema Migration
-- Migration: 00001_initial_tenancy_and_auth.sql
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. PLATFORM LEVEL ENTITIES (Super-Admin)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE auth_user_id = auth.uid() AND is_active = true
  );
$$;

DROP POLICY IF EXISTS "platform_admins_read" ON public.platform_admins;
CREATE POLICY "platform_admins_read" ON public.platform_admins
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ==============================================================================
-- 3. PLANS & SUBSCRIPTIONS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  tier text NOT NULL CHECK (tier IN ('free', 'starter', 'professional', 'enterprise')),
  max_users integer NOT NULL DEFAULT 5,
  max_cases_per_month integer NOT NULL DEFAULT 100,
  show_branding_footer boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_read_all" ON public.plans;
CREATE POLICY "plans_read_all" ON public.plans
  FOR SELECT TO authenticated
  USING (true);

-- Seed default plans
INSERT INTO public.plans (id, name, tier, max_users, max_cases_per_month, show_branding_footer)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'Free Starter', 'free', 5, 100, true),
  ('00000000-0000-0000-0000-000000000002', 'Professional Agency', 'professional', 25, 1000, false),
  ('00000000-0000-0000-0000-000000000003', 'Enterprise Scale', 'enterprise', 100, 10000, false)
ON CONFLICT (name) DO NOTHING;

-- ==============================================================================
-- 4. AGENCIES (TENANTS)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(16) NOT NULL UNIQUE,
  name text NOT NULL,
  slug varchar(64) NOT NULL UNIQUE,
  gstin varchar(15),
  state_code varchar(2) NOT NULL DEFAULT '23',
  address text NOT NULL DEFAULT '',
  phone text,
  email text,
  logo_r2_key text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_agency_code_format CHECK (code = upper(trim(code)) AND length(code) >= 2)
);

CREATE INDEX IF NOT EXISTS idx_agencies_code ON public.agencies(code);
CREATE INDEX IF NOT EXISTS idx_agencies_is_active ON public.agencies(is_active);

ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;

-- Helper function to resolve the current caller's agency_id from their user record
CREATE OR REPLACE FUNCTION public.current_agency_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT agency_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- RLS: Agency users can view their own agency. Platform admins can view/manage all.
DROP POLICY IF EXISTS "agencies_tenant_read" ON public.agencies;
CREATE POLICY "agencies_tenant_read" ON public.agencies
  FOR SELECT TO authenticated
  USING (id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "agencies_platform_admin_all" ON public.agencies;
CREATE POLICY "agencies_platform_admin_all" ON public.agencies
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Agency Subscriptions
CREATE TABLE IF NOT EXISTS public.agency_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'cancelled')),
  current_period_start date NOT NULL DEFAULT CURRENT_DATE,
  current_period_end date NOT NULL DEFAULT (CURRENT_DATE + interval '1 year'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_active_subscription UNIQUE (agency_id)
);

ALTER TABLE public.agency_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_tenant_read" ON public.agency_subscriptions;
CREATE POLICY "subscriptions_tenant_read" ON public.agency_subscriptions
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "subscriptions_platform_admin_all" ON public.agency_subscriptions;
CREATE POLICY "subscriptions_platform_admin_all" ON public.agency_subscriptions
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- ==============================================================================
-- 5. USERS & SUBORDINATE HIERARCHY
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE RESTRICT,
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  synthetic_auth_email text NOT NULL UNIQUE,
  username varchar(64) NOT NULL,
  full_name text NOT NULL,
  phone text,
  scope text NOT NULL DEFAULT 'OWN_ENTERED' CHECK (scope IN ('ALL', 'TEAM', 'ASSIGNED', 'OWN_ENTERED')),
  reports_to_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_username UNIQUE (agency_id, username)
);

CREATE INDEX IF NOT EXISTS idx_users_agency ON public.users(agency_id);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_reports_to ON public.users(reports_to_id);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_tenant_read" ON public.users;
CREATE POLICY "users_tenant_read" ON public.users
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "users_tenant_modify" ON public.users;
CREATE POLICY "users_tenant_modify" ON public.users
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- Trigger: 5-level depth cap and cycle detection on management tree
CREATE OR REPLACE FUNCTION public.check_user_subtree_depth()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_depth integer := 0;
  v_cur uuid := NEW.reports_to_id;
BEGIN
  IF NEW.reports_to_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id = NEW.reports_to_id THEN
    RAISE EXCEPTION 'A user cannot report to themselves.';
  END IF;

  WHILE v_cur IS NOT NULL LOOP
    v_depth := v_depth + 1;
    IF v_depth > 5 THEN
      RAISE EXCEPTION 'Reporting hierarchy exceeds maximum depth limit of 5 levels.';
    END IF;
    IF v_cur = NEW.id THEN
      RAISE EXCEPTION 'Cycle detected in management reporting hierarchy.';
    END IF;

    SELECT reports_to_id INTO v_cur FROM public.users WHERE id = v_cur;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_user_subtree_depth ON public.users;
CREATE TRIGGER trg_check_user_subtree_depth
BEFORE INSERT OR UPDATE OF reports_to_id ON public.users
FOR EACH ROW EXECUTE FUNCTION public.check_user_subtree_depth();

-- ==============================================================================
-- 6. PERMISSIONS & ROLES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.permissions (
  id varchar(64) PRIMARY KEY,
  module varchar(32) NOT NULL,
  name text NOT NULL,
  description text NOT NULL
);

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permissions_read_all" ON public.permissions;
CREATE POLICY "permissions_read_all" ON public.permissions
  FOR SELECT TO authenticated
  USING (true);

-- Seed System Permission Catalog
INSERT INTO public.permissions (id, module, name, description) VALUES
  ('cases.create', 'Cases', 'Create Case', 'Create new cases in data entry'),
  ('cases.view', 'Cases', 'View Cases', 'View cases within scope'),
  ('cases.edit_entry', 'Cases', 'Edit Entry', 'Edit case during data entry'),
  ('cases.edit_verified', 'Cases', 'Edit Verified', 'Amend case after verification'),
  ('cases.verify', 'Cases', 'Verify Case', 'Verify intake and route to manager'),
  ('cases.assign', 'Cases', 'Assign Case', 'Assign field investigators'),
  ('cases.reassign', 'Cases', 'Reassign Case', 'Reassign investigators'),
  ('cases.accept', 'Cases', 'Accept Assignment', 'Accept or decline case assignment'),
  ('cases.withdraw', 'Cases', 'Withdraw Case', 'Mark case as Withdrawn'),
  ('cases.reject', 'Cases', 'Reject Case', 'Mark case as Rejected by insurer'),
  ('cases.close', 'Cases', 'Close Case', 'Mark case operationally closed'),
  ('cases.delete', 'Cases', 'Delete Case', 'Soft delete case record'),
  ('evidence.upload', 'Evidence', 'Upload Evidence', 'Upload field photos and video to R2'),
  ('evidence.view', 'Evidence', 'View Evidence', 'View and download evidence files'),
  ('evidence.delete', 'Evidence', 'Delete Evidence', 'Soft delete evidence files'),
  ('reports.write', 'Reports', 'Write Report', 'Draft investigation reports'),
  ('reports.submit', 'Reports', 'Submit Report', 'Submit report for review'),
  ('reports.review', 'Reports', 'Review Report', 'Review and send-back report'),
  ('reports.approve', 'Reports', 'Approve Report', 'Approve report and generate PDF'),
  ('reports.escalate', 'Reports', 'Escalate Report', 'Resolve escalated reviews (rework >= 3)'),
  ('hardcopy.dispatch', 'Logistics', 'Dispatch Hardcopy', 'Generate courier manifests'),
  ('hardcopy.receive', 'Logistics', 'Receive Hardcopy', 'Acknowledge physical document receipt'),
  ('invoices.generate', 'Finance', 'Generate Invoice', 'Issue sequential GST invoices'),
  ('invoices.credit_note', 'Finance', 'Credit Note', 'Issue GST credit/debit notes'),
  ('payments.record', 'Finance', 'Record Payment', 'Record client bank payments and TDS'),
  ('payouts.prepare', 'Finance', 'Prepare Payouts', 'Stage monthly investigator payouts'),
  ('payouts.approve_ta', 'Finance', 'Approve TA', '1-click approve outstation travel allowance'),
  ('payouts.disburse', 'Finance', 'Disburse Payouts', 'Mark payouts paid and generate bank Excel'),
  ('team.manage', 'Users', 'Manage Team', 'Invite staff and configure manager subtrees'),
  ('team.delegate', 'Users', 'Delegate Permissions', 'Delegate permissions within subtree'),
  ('settings.agency', 'Settings', 'Agency Settings', 'Manage agency profile and GSTIN'),
  ('settings.roles', 'Settings', 'Manage Roles', 'Configure custom roles and permission matrix'),
  ('audit.view', 'Audit', 'View Audit Logs', 'Inspect append-only audit trail')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  name varchar(64) NOT NULL,
  description text,
  default_scope text NOT NULL DEFAULT 'TEAM' CHECK (default_scope IN ('ALL', 'TEAM', 'ASSIGNED', 'OWN_ENTERED')),
  is_system_template boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_role_name UNIQUE (agency_id, name)
);

CREATE INDEX IF NOT EXISTS idx_roles_agency ON public.roles(agency_id);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_tenant_read" ON public.roles;
CREATE POLICY "roles_tenant_read" ON public.roles
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "roles_tenant_modify" ON public.roles;
CREATE POLICY "roles_tenant_modify" ON public.roles
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id varchar(64) NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_tenant_read" ON public.role_permissions;
CREATE POLICY "role_permissions_tenant_read" ON public.role_permissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r 
      WHERE r.id = role_permissions.role_id 
        AND (r.agency_id = public.current_agency_id() OR public.is_platform_admin())
    )
  );

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles_tenant_read" ON public.user_roles;
CREATE POLICY "user_roles_tenant_read" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.id = user_roles.user_id 
        AND (u.agency_id = public.current_agency_id() OR public.is_platform_admin())
    )
  );

CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  permission_id varchar(64) NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  effect varchar(8) NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
  granted_by uuid REFERENCES public.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_permission UNIQUE (user_id, permission_id)
);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_permissions_tenant_read" ON public.user_permissions;
CREATE POLICY "user_permissions_tenant_read" ON public.user_permissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.id = user_permissions.user_id 
        AND (u.agency_id = public.current_agency_id() OR public.is_platform_admin())
    )
  );

-- Fast Security Definer Function: has_permission()
CREATE OR REPLACE FUNCTION public.has_permission(p_permission_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_has boolean;
BEGIN
  SELECT id INTO v_user_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Check explicit user DENY override first (fast fail)
  IF EXISTS (
    SELECT 1 FROM public.user_permissions
    WHERE user_id = v_user_id AND permission_id = p_permission_id AND effect = 'DENY'
  ) THEN
    RETURN false;
  END IF;

  -- 2. Check explicit user ALLOW override
  IF EXISTS (
    SELECT 1 FROM public.user_permissions
    WHERE user_id = v_user_id AND permission_id = p_permission_id AND effect = 'ALLOW'
  ) THEN
    RETURN true;
  END IF;

  -- 3. Check role permissions
  SELECT EXISTS (
    SELECT 1 
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = v_user_id AND rp.permission_id = p_permission_id
  ) INTO v_has;

  RETURN v_has;
END;
$$;

-- ==============================================================================
-- 7. AUDIT LOGS (APPEND-ONLY IMMUTABLE LEDGER)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES public.agencies(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  platform_admin_id uuid REFERENCES public.platform_admins(id) ON DELETE SET NULL,
  action varchar(64) NOT NULL,
  entity_type varchar(64) NOT NULL,
  entity_id uuid NOT NULL,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_agency ON public.audit_logs(agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_tenant_read" ON public.audit_logs;
CREATE POLICY "audit_logs_tenant_read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id() 
    AND public.has_permission('audit.view')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    agency_id = public.current_agency_id() OR public.is_platform_admin()
  );

-- Database Trigger Enforcing Immutable Append-Only: Rejects any UPDATE or DELETE
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Security Violation: Audit log entries are immutable and cannot be updated or deleted.';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_modification ON public.audit_logs;
CREATE TRIGGER trg_prevent_audit_log_modification
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_modification();

-- ==============================================================================
-- 8. SEED DEFAULT ROLES & PERMISSIONS FOR NEW AGENCY
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.seed_agency_default_roles(p_agency_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_role_id uuid;
  v_admin_role_id uuid;
  v_case_mgr_role_id uuid;
  v_back_office_role_id uuid;
  v_data_entry_role_id uuid;
  v_inv_role_id uuid;
  v_reviewer_role_id uuid;
  v_approver_role_id uuid;
  v_accountant_role_id uuid;
  v_author_role_id uuid;
  v_auditor_role_id uuid;
  v_client_role_id uuid;
BEGIN
  -- 1. Agency Owner
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Agency Owner', 'Full operational, executive and financial authority', 'ALL', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_owner_role_id;

  -- Agency Owner gets all permissions
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_owner_role_id, id FROM public.permissions
  ON CONFLICT DO NOTHING;

  -- 2. Admin
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Admin', 'Operations, staff, and system management', 'ALL', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_admin_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_admin_role_id, id FROM public.permissions
  WHERE id NOT IN ('cases.delete', 'invoices.credit_note')
  ON CONFLICT DO NOTHING;

  -- 3. Case Manager
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Case Manager', 'Leads team of staff and investigators; case assignment and review', 'TEAM', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_case_mgr_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_case_mgr_role_id, id FROM public.permissions
  WHERE id IN (
    'cases.view', 'cases.edit_entry', 'cases.edit_verified', 'cases.verify',
    'cases.assign', 'cases.reassign', 'cases.withdraw', 'cases.reject', 'cases.close',
    'evidence.upload', 'evidence.view', 'reports.write', 'reports.review', 'reports.approve',
    'payouts.approve_ta', 'team.delegate'
  )
  ON CONFLICT DO NOTHING;

  -- 4. Back Office
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Back Office', 'Quality assurance, dispatch logistics, document verification', 'TEAM', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_back_office_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_back_office_role_id, id FROM public.permissions
  WHERE id IN (
    'cases.view', 'cases.verify', 'evidence.view', 'reports.review',
    'hardcopy.dispatch', 'hardcopy.receive'
  )
  ON CONFLICT DO NOTHING;

  -- 5. Data Entry
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Data Entry', 'High-speed intake of client claim intimations', 'OWN_ENTERED', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_data_entry_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_data_entry_role_id, id FROM public.permissions
  WHERE id IN ('cases.create', 'cases.view', 'cases.edit_entry')
  ON CONFLICT DO NOTHING;

  -- 6. Field Investigator
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Field Investigator', 'Field enquiries, camera evidence capture, mobile portal', 'ASSIGNED', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_inv_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_inv_role_id, id FROM public.permissions
  WHERE id IN ('cases.view', 'cases.accept', 'evidence.upload', 'reports.write')
  ON CONFLICT DO NOTHING;

  -- 7. Reviewer
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Reviewer', 'Scrutinizes field reports against insurer policy clauses', 'TEAM', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_reviewer_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_reviewer_role_id, id FROM public.permissions
  WHERE id IN ('cases.view', 'evidence.view', 'reports.review', 'reports.submit')
  ON CONFLICT DO NOTHING;

  -- 8. Approver
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Approver', 'Executive final sign-off for insurance submission', 'ALL', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_approver_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_approver_role_id, id FROM public.permissions
  WHERE id IN ('cases.view', 'evidence.view', 'reports.approve', 'reports.escalate')
  ON CONFLICT DO NOTHING;

  -- 9. Accountant
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Accountant', 'GST invoicing, recovery hub, client TDS, investigator payouts', 'ALL', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_accountant_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_accountant_role_id, id FROM public.permissions
  WHERE id IN (
    'cases.view', 'invoices.generate', 'invoices.credit_note', 
    'payments.record', 'payouts.prepare', 'payouts.approve_ta', 'payouts.disburse'
  )
  ON CONFLICT DO NOTHING;

  -- 10. Report Author
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Report Author', 'Drafts comprehensive investigation reports from field evidence', 'ASSIGNED', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_author_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_author_role_id, id FROM public.permissions
  WHERE id IN ('cases.view', 'evidence.view', 'reports.write', 'reports.submit')
  ON CONFLICT DO NOTHING;

  -- 11. Auditor
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Auditor', 'Read-only compliance and quality inspector', 'ALL', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_auditor_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_auditor_role_id, id FROM public.permissions
  WHERE id IN ('cases.view', 'evidence.view', 'audit.view')
  ON CONFLICT DO NOTHING;

  -- 12. Client User
  INSERT INTO public.roles (agency_id, name, description, default_scope, is_system_template)
  VALUES (p_agency_id, 'Client User', 'Insurer portal user with restricted case tracking view', 'ASSIGNED', true)
  ON CONFLICT (agency_id, name) DO UPDATE SET is_system_template = true
  RETURNING id INTO v_client_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_client_role_id, id FROM public.permissions
  WHERE id = 'cases.view'
  ON CONFLICT DO NOTHING;
END;
$$;
