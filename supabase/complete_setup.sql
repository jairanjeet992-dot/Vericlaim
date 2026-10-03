-- ==============================================================================
-- VERICLAIM MULTI-TENANT SAAS: COMPLETE DATABASE SCHEMA (PHASES 1-7A)
-- Run this in Supabase Dashboard -> SQL Editor
-- ==============================================================================


-- ==============================================================================
-- FILE: 00001_initial_tenancy_and_auth.sql
-- ==============================================================================

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
CREATE POLICY "agencies_tenant_read" ON public.agencies
  FOR SELECT TO authenticated
  USING (id = public.current_agency_id() OR public.is_platform_admin());

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

CREATE POLICY "subscriptions_tenant_read" ON public.agency_subscriptions
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

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

CREATE POLICY "users_tenant_read" ON public.users
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

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

CREATE POLICY "roles_tenant_read" ON public.roles
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

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

CREATE POLICY "audit_logs_tenant_read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id() 
    AND public.has_permission('audit.view')
    OR public.is_platform_admin()
  );

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


-- ==============================================================================
-- FILE: 00002_rbac_scope_and_cases_stub.sql
-- ==============================================================================

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

CREATE POLICY "clients_tenant_read" ON public.clients
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

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

CREATE POLICY "manager_scopes_tenant_read" ON public.manager_scopes
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

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

CREATE POLICY "cases_tenant_and_scope_read" ON public.cases
  FOR SELECT TO authenticated
  USING (
    agency_id = public.current_agency_id()
    AND public.has_permission('cases.view')
    AND public.can_view_case(agency_id, owner_manager_id, data_entry_user_id, id)
  );

CREATE POLICY "cases_tenant_insert" ON public.cases
  FOR INSERT TO authenticated
  WITH CHECK (
    agency_id = public.current_agency_id()
    AND public.has_permission('cases.create')
  );

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


-- ==============================================================================
-- FILE: 00003_masters.sql
-- ==============================================================================

-- ==============================================================================
-- Vericlaim Multi-Tenant SaaS: Master Entities, Configurable Rules & Coverage
-- Migration: 00003_masters.sql
-- ==============================================================================

-- 1. ENHANCE CLIENTS TABLE (Add billing & SLA config)
ALTER TABLE public.clients 
  ADD COLUMN IF NOT EXISTS type varchar(16) NOT NULL DEFAULT 'INSURER' CHECK (type IN ('INSURER', 'TPA', 'CORPORATE')),
  ADD COLUMN IF NOT EXISTS default_payment_terms_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS default_sla_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS billing_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. CLIENT BRANCHES TABLE
CREATE TABLE IF NOT EXISTS public.client_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  branch_name varchar(128) NOT NULL,
  branch_code varchar(32) NOT NULL,
  legal_name text NOT NULL,
  gstin varchar(15) NOT NULL,
  state varchar(64) NOT NULL,
  state_code varchar(2) NOT NULL,
  billing_address text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_client_branch_code UNIQUE (agency_id, client_id, branch_code)
);

CREATE INDEX IF NOT EXISTS idx_client_branches_agency ON public.client_branches(agency_id, client_id);
ALTER TABLE public.client_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_branches_tenant_read" ON public.client_branches
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "client_branches_tenant_modify" ON public.client_branches
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 3. CLIENT CONTACTS TABLE
CREATE TABLE IF NOT EXISTS public.client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.client_branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  designation varchar(64),
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_contacts_tenant_read" ON public.client_contacts
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "client_contacts_tenant_modify" ON public.client_contacts
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 4. CLIENT RATE CARDS TABLE
CREATE TABLE IF NOT EXISTS public.client_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_type varchar(32) NOT NULL,
  base_fee numeric(14,2) NOT NULL DEFAULT 0.00,
  extra_km_rate numeric(14,2) NOT NULL DEFAULT 0.00,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_client_rate_card UNIQUE (agency_id, client_id, case_type, effective_from)
);

ALTER TABLE public.client_rate_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_rate_cards_tenant_read" ON public.client_rate_cards
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "client_rate_cards_tenant_modify" ON public.client_rate_cards
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 5. CONFIGURABLE CASE TYPES (JSON-driven custom fields & rules)
CREATE TABLE IF NOT EXISTS public.case_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  code varchar(32) NOT NULL,
  name text NOT NULL,
  default_sla_hours integer NOT NULL DEFAULT 48,
  default_fee_rule jsonb NOT NULL DEFAULT '{"base_fee": 1500.00}'::jsonb,
  custom_field_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_case_type_code UNIQUE (agency_id, code)
);

ALTER TABLE public.case_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "case_types_tenant_read" ON public.case_types
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "case_types_tenant_modify" ON public.case_types
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 6. OUTCOMES & EXCEPTION FINANCIAL RULES TABLE
CREATE TABLE IF NOT EXISTS public.outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  code varchar(32) NOT NULL,
  name text NOT NULL,
  category varchar(32) NOT NULL CHECK (category IN ('PENDING', 'GENUINE', 'FRAUD', 'SUSPICIOUS', 'REPUDIATED', 'EXCEPTION')),
  financial_rule jsonb NOT NULL DEFAULT '{"investigator_payable_percent": 100}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_outcome_code UNIQUE (agency_id, code)
);

ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outcomes_tenant_read" ON public.outcomes
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "outcomes_tenant_modify" ON public.outcomes
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 7. SLA POLICIES TABLE (12h, 24h, 48h, 72h, 120h, custom with one agency default)
CREATE TABLE IF NOT EXISTS public.sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  name varchar(64) NOT NULL,
  target_hours integer NOT NULL CHECK (target_hours > 0),
  warning_threshold_percent integer NOT NULL DEFAULT 75,
  is_agency_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_sla_name UNIQUE (agency_id, name)
);

ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_policies_tenant_read" ON public.sla_policies
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "sla_policies_tenant_modify" ON public.sla_policies
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 8. INVESTIGATORS TABLE (With Encrypted Sensitive Fields & Coverage)
CREATE TABLE IF NOT EXISTS public.investigators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  code varchar(32) NOT NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  email text,
  -- Encrypted PII per A7
  pan_encrypted text,
  pan_blind_index text,
  bank_account_encrypted text,
  ifsc_encrypted text,
  -- Geographic Coverage
  state varchar(64) NOT NULL DEFAULT '',
  district varchar(64) NOT NULL DEFAULT '',
  city varchar(64) NOT NULL DEFAULT '',
  areas text[] NOT NULL DEFAULT '{}',
  pincodes text[] NOT NULL DEFAULT '{}',
  radius_km integer NOT NULL DEFAULT 50,
  -- Operational Capacity
  is_available boolean NOT NULL DEFAULT true,
  max_active_cases integer NOT NULL DEFAULT 15,
  specializations text[] NOT NULL DEFAULT '{}',
  case_types text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agency_investigator_code UNIQUE (agency_id, code)
);

CREATE INDEX IF NOT EXISTS idx_investigators_agency ON public.investigators(agency_id);
CREATE INDEX IF NOT EXISTS idx_investigators_pan_blind ON public.investigators(agency_id, pan_blind_index);

ALTER TABLE public.investigators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "investigators_tenant_read" ON public.investigators
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "investigators_tenant_modify" ON public.investigators
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 9. INVESTIGATOR PAYMENT TERMS (Effective-Dated Terms Ledger)
CREATE TABLE IF NOT EXISTS public.investigator_payment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  investigator_id uuid NOT NULL REFERENCES public.investigators(id) ON DELETE CASCADE,
  payment_type varchar(16) NOT NULL CHECK (payment_type IN ('PER_CASE', 'SALARY')),
  base_fee_or_salary numeric(14,2) NOT NULL DEFAULT 0.00,
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_effective_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_inv_payment_terms_lookup 
  ON public.investigator_payment_terms(agency_id, investigator_id, effective_from, effective_to);

ALTER TABLE public.investigator_payment_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "investigator_payment_terms_read" ON public.investigator_payment_terms
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

CREATE POLICY "investigator_payment_terms_modify" ON public.investigator_payment_terms
  FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin())
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin());

-- 10. SEED DEFAULT OUTCOMES & SLA POLICIES FUNCTION
CREATE OR REPLACE FUNCTION public.seed_agency_masters(p_agency_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Seed Standard Outcomes
  INSERT INTO public.outcomes (agency_id, code, name, category, financial_rule) VALUES
    (p_agency_id, 'PENDING', 'Investigation Pending', 'PENDING', '{"investigator_payable_percent": 100}'::jsonb),
    (p_agency_id, 'GENUINE', 'Claim Genuine', 'GENUINE', '{"investigator_payable_percent": 100}'::jsonb),
    (p_agency_id, 'FRAUD', 'Confirmed Fraud', 'FRAUD', '{"investigator_payable_percent": 100}'::jsonb),
    (p_agency_id, 'SUSPICIOUS', 'Suspicious / Inconclusive', 'SUSPICIOUS', '{"investigator_payable_percent": 100}'::jsonb),
    (p_agency_id, 'REPUDIATED', 'Repudiated by Insurer', 'REPUDIATED', '{"investigator_payable_percent": 100}'::jsonb),
    (p_agency_id, 'WITHDRAWN', 'Case Withdrawn by Insurer', 'EXCEPTION', '{"investigator_payable_percent": 0}'::jsonb)
  ON CONFLICT (agency_id, code) DO NOTHING;

  -- Seed Default SLA Policies
  INSERT INTO public.sla_policies (agency_id, name, target_hours, warning_threshold_percent, is_agency_default) VALUES
    (p_agency_id, 'Standard TAT (48 Hours)', 48, 75, true),
    (p_agency_id, 'Express Spot (24 Hours)', 24, 80, false),
    (p_agency_id, 'Urgent Cashless (12 Hours)', 12, 85, false),
    (p_agency_id, 'Complex Project (120 Hours)', 120, 70, false)
  ON CONFLICT (agency_id, name) DO NOTHING;

  -- Seed Default Case Types
  INSERT INTO public.case_types (agency_id, code, name, default_sla_hours, default_fee_rule) VALUES
    (p_agency_id, 'PA', 'Personal Accident', 48, '{"base_fee": 1500.00}'::jsonb),
    (p_agency_id, 'Cashless', 'Cashless Hospitalization', 24, '{"base_fee": 1200.00}'::jsonb),
    (p_agency_id, 'Reimbursement', 'Reimbursement Claim', 48, '{"base_fee": 1500.00}'::jsonb),
    (p_agency_id, 'MB', 'Mediclaim Bill Verification', 48, '{"base_fee": 1000.00}'::jsonb),
    (p_agency_id, 'FVR', 'Field Verification Report', 48, '{"base_fee": 1200.00}'::jsonb),
    (p_agency_id, 'Spot', 'Spot Accident Investigation', 24, '{"base_fee": 2000.00}'::jsonb),
    (p_agency_id, 'Project', 'Special Project Investigation', 120, '{"base_fee": 3500.00}'::jsonb),
    (p_agency_id, 'Hospicash', 'Hospital Daily Cash', 48, '{"base_fee": 1000.00}'::jsonb),
    (p_agency_id, 'Post Facto', 'Post Facto Verification', 72, '{"base_fee": 1800.00}'::jsonb)
  ON CONFLICT (agency_id, code) DO NOTHING;
END;
$$;


-- ==============================================================================
-- FILE: 00004_case_core_and_workflow.sql
-- ==============================================================================

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

CREATE POLICY "case_status_history_read" ON public.case_status_history
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

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

CREATE POLICY "case_notes_read" ON public.case_notes
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

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

CREATE POLICY "case_tasks_read" ON public.case_tasks
  FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin());

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


-- ==============================================================================
-- FILE: 00005_assignment_and_command_center.sql
-- ==============================================================================

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


-- ==============================================================================
-- FILE: 00006_investigation_evidence_pwa.sql
-- ==============================================================================

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

CREATE POLICY "documents_tenant_insert" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    agency_id = public.current_agency_id()
  );

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



-- ==============================================================================
-- FILE: 00007_reports_review_rework_hardcopy.sql
-- ==============================================================================

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



-- ==============================================================================
-- FILE: 00008_invoicing_gst_credit_notes.sql
-- ==============================================================================

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

