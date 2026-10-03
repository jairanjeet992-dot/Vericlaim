import { SupabaseClient } from '@supabase/supabase-js';
import { CreateAgencyInput, CreateFirstOwnerInput, SuspendAgencyInput, ChangePlanInput } from './schema';
import { generateSyntheticEmail } from '../auth/schema';
import { recordAuditLog } from '../audit/service';

export interface AgencyMetrics {
  agency_id: string;
  user_count: number;
  case_count: number;
  storage_bytes: number;
}

export async function verifyPlatformAdmin(
  client: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await client
    .from('platform_admins')
    .select('id, is_active')
    .eq('auth_user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) {
    return false;
  }
  return true;
}

export async function createAgency(
  client: SupabaseClient,
  adminUserId: string,
  input: CreateAgencyInput
) {
  // 1. Insert Agency
  const { data: agency, error: agencyError } = await client
    .from('agencies')
    .insert({
      name: input.name,
      code: input.code,
      slug: input.slug,
      state_code: input.state_code,
      gstin: input.gstin || null,
      address: input.address || '',
      phone: input.phone || null,
      email: input.email || null,
      is_active: true,
    })
    .select()
    .single();

  if (agencyError || !agency) {
    throw new Error(`Failed to create agency: ${agencyError?.message || 'Unknown error'}`);
  }

  // 2. Insert Default Subscription
  const { error: subError } = await client.from('agency_subscriptions').insert({
    agency_id: agency.id,
    plan_id: input.plan_id,
    status: 'active',
  });

  if (subError) {
    throw new Error(`Failed to create agency subscription: ${subError.message}`);
  }

  // 3. Seed Default Agency Roles via RPC
  const { error: rpcError } = await client.rpc('seed_agency_default_roles', {
    p_agency_id: agency.id,
  });

  if (rpcError) {
    // If RPC isn't available (e.g. running in mock environment), we don't abort but log
    console.warn(`Warning: Could not seed roles via RPC: ${rpcError.message}`);
  }

  // 4. Audit Log
  await recordAuditLog(client, {
    agency_id: agency.id,
    platform_admin_id: adminUserId,
    action: 'AGENCY_CREATE',
    entity_type: 'agency',
    entity_id: agency.id,
    new_values: {
      name: agency.name,
      code: agency.code,
      plan_id: input.plan_id,
    },
  });

  return agency;
}

export async function createFirstOwner(
  client: SupabaseClient,
  adminUserId: string,
  input: CreateFirstOwnerInput
) {
  // 1. Generate internal synthetic auth email
  const syntheticEmail = generateSyntheticEmail();

  // 2. Create Auth User in Supabase Auth
  const { data: authUser, error: authError } = await client.auth.admin.createUser({
    email: syntheticEmail,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      agency_id: input.agency_id,
      username: input.username,
      full_name: input.full_name,
    },
  });

  if (authError || !authUser.user) {
    throw new Error(`Failed to create auth identity for owner: ${authError?.message || 'Unknown'}`);
  }

  // 3. Insert into public.users
  const { data: user, error: userError } = await client
    .from('users')
    .insert({
      agency_id: input.agency_id,
      auth_user_id: authUser.user.id,
      synthetic_auth_email: syntheticEmail,
      username: input.username,
      full_name: input.full_name,
      phone: input.phone || null,
      scope: 'ALL',
      is_active: true,
    })
    .select()
    .single();

  if (userError || !user) {
    // Attempt rollback of auth user
    await client.auth.admin.deleteUser(authUser.user.id).catch(() => {});
    throw new Error(`Failed to create user record: ${userError?.message || 'Unknown'}`);
  }

  // 4. Assign Agency Owner Role
  const { data: ownerRole } = await client
    .from('roles')
    .select('id')
    .eq('agency_id', input.agency_id)
    .eq('name', 'Agency Owner')
    .maybeSingle();

  if (ownerRole) {
    await client.from('user_roles').insert({
      user_id: user.id,
      role_id: ownerRole.id,
    });
  }

  // 5. Audit Log
  await recordAuditLog(client, {
    agency_id: input.agency_id,
    platform_admin_id: adminUserId,
    action: 'USER_CREATE_FIRST_OWNER',
    entity_type: 'user',
    entity_id: user.id,
    new_values: {
      username: user.username,
      full_name: user.full_name,
      synthetic_auth_email: syntheticEmail,
      scope: 'ALL',
    },
  });

  return user;
}

export async function suspendAgency(
  client: SupabaseClient,
  adminUserId: string,
  input: SuspendAgencyInput
) {
  const { data: existing, error: fetchError } = await client
    .from('agencies')
    .select('id, name, is_active')
    .eq('id', input.agency_id)
    .single();

  if (fetchError || !existing) {
    throw new Error(`Agency not found: ${input.agency_id}`);
  }

  const { data: updated, error: updateError } = await client
    .from('agencies')
    .update({
      is_active: input.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.agency_id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to update agency status: ${updateError?.message || 'Unknown'}`);
  }

  await recordAuditLog(client, {
    agency_id: input.agency_id,
    platform_admin_id: adminUserId,
    action: input.is_active ? 'AGENCY_ACTIVATE' : 'AGENCY_SUSPEND',
    entity_type: 'agency',
    entity_id: input.agency_id,
    old_values: { is_active: existing.is_active },
    new_values: { is_active: updated.is_active, reason: input.reason },
  });

  return updated;
}

export async function changeAgencyPlan(
  client: SupabaseClient,
  adminUserId: string,
  input: ChangePlanInput
) {
  const { data: existingSub } = await client
    .from('agency_subscriptions')
    .select('id, plan_id')
    .eq('agency_id', input.agency_id)
    .maybeSingle();

  let updatedSub;
  if (existingSub) {
    const { data, error } = await client
      .from('agency_subscriptions')
      .update({ plan_id: input.plan_id })
      .eq('agency_id', input.agency_id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update plan: ${error.message}`);
    updatedSub = data;
  } else {
    const { data, error } = await client
      .from('agency_subscriptions')
      .insert({
        agency_id: input.agency_id,
        plan_id: input.plan_id,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to assign plan: ${error.message}`);
    updatedSub = data;
  }

  await recordAuditLog(client, {
    agency_id: input.agency_id,
    platform_admin_id: adminUserId,
    action: 'PLAN_CHANGE',
    entity_type: 'agency_subscription',
    entity_id: updatedSub.id,
    old_values: { plan_id: existingSub?.plan_id || null },
    new_values: { plan_id: input.plan_id },
  });

  return updatedSub;
}

export async function listAgencies(client: SupabaseClient) {
  const { data, error } = await client
    .from('agencies')
    .select(`
      id,
      code,
      name,
      slug,
      state_code,
      is_active,
      created_at,
      agency_subscriptions (
        plan_id,
        status,
        plans (
          id,
          name,
          tier,
          max_users,
          max_cases_per_month,
          show_branding_footer
        )
      )
    `)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list agencies: ${error.message}`);
  return data;
}

export async function getAgencyMetrics(
  client: SupabaseClient,
  agencyId: string
): Promise<AgencyMetrics> {
  const { count: userCount, error: userErr } = await client
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId);

  if (userErr) throw new Error(`Failed to get user count: ${userErr.message}`);

  // In Phase 1, cases table does not exist yet; default to 0
  const caseCount = 0;
  const storageBytes = 0;

  return {
    agency_id: agencyId,
    user_count: userCount || 0,
    case_count: caseCount,
    storage_bytes: storageBytes,
  };
}
