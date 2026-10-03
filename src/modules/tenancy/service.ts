import { SupabaseClient } from '@supabase/supabase-js';

export interface AgencyBranding {
  agency_id: string;
  agency_name: string;
  agency_code: string;
  show_branding_footer: boolean;
  plan_tier: string;
  is_active: boolean;
}

export async function getAgencyBranding(
  client: SupabaseClient,
  agencyId: string
): Promise<AgencyBranding | null> {
  const { data: agency, error: agencyError } = await client
    .from('agencies')
    .select(`
      id,
      name,
      code,
      is_active,
      agency_subscriptions (
        plan_id,
        status,
        plans (
          tier,
          show_branding_footer
        )
      )
    `)
    .eq('id', agencyId)
    .maybeSingle();

  if (agencyError || !agency) {
    return null;
  }

  // Extract subscription and plan info
  const sub: any = Array.isArray(agency.agency_subscriptions)
    ? agency.agency_subscriptions[0]
    : agency.agency_subscriptions;

  const plan: any = Array.isArray(sub?.plans) ? sub.plans[0] : sub?.plans;

  return {
    agency_id: agency.id,
    agency_name: agency.name,
    agency_code: agency.code,
    is_active: agency.is_active,
    show_branding_footer: plan ? plan.show_branding_footer : true,
    plan_tier: plan ? plan.tier : 'free',
  };
}

export async function getAgencyByCode(client: SupabaseClient, code: string) {
  const normalized = code.trim().toUpperCase();
  const { data, error } = await client
    .from('agencies')
    .select('id, code, name, is_active')
    .eq('code', normalized)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  return data;
}

export interface UserContext {
  id: string;
  agency_id: string;
  username: string;
  full_name: string;
  scope: 'ALL' | 'TEAM' | 'ASSIGNED' | 'OWN_ENTERED';
  reports_to_id?: string | null;
  is_active: boolean;
  agency: {
    code: string;
    name: string;
    is_active: boolean;
  };
  roles: string[];
}

export async function getUserContext(
  client: SupabaseClient,
  authUserId: string
): Promise<UserContext | null> {
  const { data: user, error } = await client
    .from('users')
    .select(`
      id,
      agency_id,
      username,
      full_name,
      scope,
      reports_to_id,
      is_active,
      agencies (
        code,
        name,
        is_active
      ),
      user_roles (
        roles (
          name
        )
      )
    `)
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error || !user) {
    return null;
  }

  const agencyData = Array.isArray(user.agencies) ? user.agencies[0] : user.agencies;
  const userRoles = Array.isArray(user.user_roles) ? user.user_roles : [];
  const roleNames = userRoles
    .map((ur: any) => ur?.roles?.name)
    .filter(Boolean) as string[];

  return {
    id: user.id,
    agency_id: user.agency_id,
    username: user.username,
    full_name: user.full_name,
    scope: user.scope as any,
    reports_to_id: user.reports_to_id,
    is_active: user.is_active,
    agency: {
      code: agencyData?.code || '',
      name: agencyData?.name || '',
      is_active: agencyData?.is_active ?? true,
    },
    roles: roleNames,
  };
}
