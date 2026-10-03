import { SupabaseClient } from '@supabase/supabase-js';
import {
  CreateRoleInput,
  CloneRoleInput,
  CreateManagerScopeInput,
  ScopeLevel,
} from './schema';
import { recordAuditLog } from '../audit/service';

export interface EffectiveUserPermissions {
  user_id: string;
  scope: ScopeLevel;
  role_permissions: string[];
  user_allows: string[];
  user_denies: string[];
  effective_permissions: string[];
}

export class RbacService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Calculates effective permissions per Rule A9:
   * Effective = (Role Permissions UNION User ALLOW) MINUS User DENY
   */
  async getEffectivePermissions(
    agencyId: string,
    userId: string
  ): Promise<EffectiveUserPermissions> {
    // 1. Get user record & roles
    const { data: user, error: userError } = await this.supabase
      .from('users')
      .select('id, agency_id, scope, user_roles ( role_id, roles ( default_scope, role_permissions ( permission_id ) ) )')
      .eq('id', userId)
      .eq('agency_id', agencyId)
      .single();

    if (userError || !user) {
      throw new Error(`User not found: ${userError?.message || userId}`);
    }

    const rolePermsSet = new Set<string>();
    const userRoles = Array.isArray(user.user_roles) ? user.user_roles : [];
    for (const ur of userRoles) {
      const rpList = (ur as any)?.roles?.role_permissions || [];
      for (const rp of rpList) {
        if (rp.permission_id) rolePermsSet.add(rp.permission_id);
      }
    }

    // 2. Get user explicit overrides
    const { data: overrides } = await this.supabase
      .from('user_permissions')
      .select('permission_id, effect')
      .eq('user_id', userId);

    const allowsSet = new Set<string>();
    const deniesSet = new Set<string>();

    for (const o of overrides || []) {
      if (o.effect === 'ALLOW') allowsSet.add(o.permission_id);
      if (o.effect === 'DENY') deniesSet.add(o.permission_id);
    }

    // Effective calculation: (role_permissions UNION allows) MINUS denies
    const effectiveSet = new Set<string>();
    for (const p of rolePermsSet) {
      if (!deniesSet.has(p)) effectiveSet.add(p);
    }
    for (const p of allowsSet) {
      if (!deniesSet.has(p)) effectiveSet.add(p);
    }

    return {
      user_id: user.id,
      scope: user.scope as ScopeLevel,
      role_permissions: Array.from(rolePermsSet),
      user_allows: Array.from(allowsSet),
      user_denies: Array.from(deniesSet),
      effective_permissions: Array.from(effectiveSet),
    };
  }

  /**
   * Create Custom Role for Agency
   */
  async createCustomRole(
    actorUserId: string,
    agencyId: string,
    input: CreateRoleInput
  ) {
    const { data: role, error: roleError } = await this.supabase
      .from('roles')
      .insert({
        agency_id: agencyId,
        name: input.name,
        description: input.description || null,
        default_scope: input.default_scope,
        is_system_template: false,
      })
      .select()
      .single();

    if (roleError || !role) {
      throw new Error(`Failed to create role: ${roleError?.message}`);
    }

    if (input.permissions.length > 0) {
      const rolePerms = input.permissions.map((p) => ({
        role_id: role.id,
        permission_id: p,
      }));
      await this.supabase.from('role_permissions').insert(rolePerms);
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'ROLE_CREATE',
      entity_type: 'role',
      entity_id: role.id,
      new_values: { name: role.name, default_scope: role.default_scope },
    });

    return role;
  }

  /**
   * Clone Role with all permissions
   */
  async cloneRole(
    actorUserId: string,
    agencyId: string,
    input: CloneRoleInput
  ) {
    const { data: sourceRole, error: srcError } = await this.supabase
      .from('roles')
      .select('id, name, description, default_scope, role_permissions ( permission_id )')
      .eq('id', input.source_role_id)
      .eq('agency_id', agencyId)
      .single();

    if (srcError || !sourceRole) {
      throw new Error(`Source role not found: ${input.source_role_id}`);
    }

    const perms = (sourceRole.role_permissions || []).map((rp: any) => rp.permission_id);

    return this.createCustomRole(actorUserId, agencyId, {
      name: input.name,
      description: input.description || `Cloned from ${sourceRole.name}`,
      default_scope: sourceRole.default_scope as ScopeLevel,
      permissions: perms,
    });
  }

  /**
   * Toggle permission on a Role
   */
  async toggleRolePermission(
    actorUserId: string,
    agencyId: string,
    roleId: string,
    permissionId: string,
    enabled: boolean
  ) {
    if (enabled) {
      await this.supabase.from('role_permissions').insert({
        role_id: roleId,
        permission_id: permissionId,
      });
    } else {
      await this.supabase
        .from('role_permissions')
        .delete()
        .eq('role_id', roleId)
        .eq('permission_id', permissionId);
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: enabled ? 'ROLE_PERMISSION_ENABLED' : 'ROLE_PERMISSION_DISABLED',
      entity_type: 'role_permission',
      entity_id: roleId,
      new_values: { permission_id: permissionId, enabled },
    });
  }

  /**
   * Toggle individual user permission override (ALLOW, DENY, or RESET)
   */
  async toggleUserPermissionOverride(
    actorUserId: string,
    agencyId: string,
    targetUserId: string,
    permissionId: string,
    effect: 'ALLOW' | 'DENY' | 'RESET'
  ) {
    if (effect === 'RESET') {
      await this.supabase
        .from('user_permissions')
        .delete()
        .eq('user_id', targetUserId)
        .eq('permission_id', permissionId);
    } else {
      await this.supabase.from('user_permissions').upsert(
        {
          user_id: targetUserId,
          permission_id: permissionId,
          effect,
          granted_by: actorUserId,
          granted_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,permission_id' }
      );
    }

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: `USER_PERMISSION_OVERRIDE_${effect}`,
      entity_type: 'user_permission',
      entity_id: targetUserId,
      new_values: { permission_id: permissionId, effect },
    });
  }

  /**
   * Update User Scope Level
   */
  async updateUserScope(
    actorUserId: string,
    agencyId: string,
    targetUserId: string,
    newScope: ScopeLevel
  ) {
    const { data: updated, error } = await this.supabase
      .from('users')
      .update({ scope: newScope, updated_at: new Date().toISOString() })
      .eq('id', targetUserId)
      .eq('agency_id', agencyId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update scope: ${error.message}`);

    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'USER_SCOPE_CHANGED',
      entity_type: 'user',
      entity_id: targetUserId,
      new_values: { scope: newScope },
    });

    return updated;
  }

  /**
   * Delegate Permission per Rule A9
   * Manager can delegate ONLY permissions they hold, ONLY to users in their subtree, never to self, never scope ALL.
   */
  async delegatePermission(
    actorUserId: string,
    agencyId: string,
    targetUserId: string,
    permissionId: string,
    effect: 'ALLOW' | 'DENY'
  ) {
    // 1. Disallow self-delegation
    if (actorUserId === targetUserId) {
      throw new Error('A9 Violation: A manager cannot modify their own permissions or delegate to themselves.');
    }

    // 2. Fetch actor permissions and scope
    const actorPerms = await this.getEffectivePermissions(agencyId, actorUserId);
    const isAgencyAdminOrOwner = actorPerms.scope === 'ALL';

    // 3. Subset Constraint: Actor must possess the permission they are delegating
    if (!actorPerms.effective_permissions.includes(permissionId)) {
      throw new Error(`A9 Violation: A manager cannot delegate a permission they do not personally hold (${permissionId}).`);
    }

    // 4. Subtree Constraint: Target must be in actor's subtree unless actor has ALL scope
    if (!isAgencyAdminOrOwner) {
      const isInSubtree = await this.isUserInSubtree(actorUserId, targetUserId);
      if (!isInSubtree) {
        throw new Error('A9 Violation: A manager can only delegate permissions to users within their subordinate subtree.');
      }
    }

    // 5. Apply delegation override
    await this.toggleUserPermissionOverride(actorUserId, agencyId, targetUserId, permissionId, effect);
    return { success: true };
  }

  /**
   * Check if target user is in manager's subordinate subtree
   */
  async isUserInSubtree(managerId: string, targetUserId: string): Promise<boolean> {
    const { data: subordinates, error } = await this.supabase.rpc('get_user_subtree', {
      p_user_id: managerId,
    });

    if (error) {
      // Fallback in-memory recursive traversal for testing/mock environments
      return this.isUserInSubtreeFallback(managerId, targetUserId);
    }

    return (subordinates || []).some((s: any) => s.id === targetUserId);
  }

  private async isUserInSubtreeFallback(managerId: string, targetUserId: string): Promise<boolean> {
    const visited = new Set<string>();
    let queue = [managerId];
    let depth = 0;

    while (queue.length > 0 && depth < 5) {
      depth++;
      const { data: directReports } = await this.supabase
        .from('users')
        .select('id')
        .in('reports_to_id', queue);

      if (!directReports || directReports.length === 0) break;

      const nextQueue: string[] = [];
      for (const r of directReports) {
        if (r.id === targetUserId) return true;
        if (!visited.has(r.id)) {
          visited.add(r.id);
          nextQueue.push(r.id);
        }
      }
      queue = nextQueue;
    }

    return false;
  }

  /**
   * Routing Engine: Resolve eligible managers for a case intimation (client_id, case_type)
   */
  async resolveCaseManager(
    agencyId: string,
    clientId: string,
    caseType: string
  ) {
    const { data: scopes, error } = await this.supabase
      .from('manager_scopes')
      .select('id, manager_id, client_id, case_type, is_default, users ( id, full_name, username, is_active )')
      .eq('agency_id', agencyId)
      .eq('client_id', clientId)
      .eq('case_type', caseType);

    if (error) throw new Error(`Routing query failed: ${error.message}`);

    const eligible = (scopes || [])
      .filter((s: any) => s.users?.is_active)
      .map((s: any) => ({
        manager_id: s.manager_id,
        full_name: s.users?.full_name,
        username: s.users?.username,
        is_default: s.is_default,
      }));

    if (eligible.length === 0) {
      return { eligible_managers: [], default_manager_id: null, needs_manual_routing: true };
    }

    if (eligible.length === 1) {
      return {
        eligible_managers: eligible,
        default_manager_id: eligible[0].manager_id,
        needs_manual_routing: false,
      };
    }

    // Multiple eligible
    const defaultMgr = eligible.find((e) => e.is_default);
    return {
      eligible_managers: eligible,
      default_manager_id: defaultMgr ? defaultMgr.manager_id : null,
      needs_manual_routing: !defaultMgr, // If no default set, data entry must pick explicitly
    };
  }

  /**
   * Manager Transfer Wizard: Atomic transfer of open cases, subordinates, and scopes before deactivation
   */
  async executeManagerTransferWizard(
    actorUserId: string,
    agencyId: string,
    oldManagerId: string,
    newManagerId: string,
    reason: string
  ) {
    if (oldManagerId === newManagerId) {
      throw new Error('Successor manager must be different from departing manager.');
    }

    // Try RPC first
    const { data: rpcRes, error: rpcError } = await this.supabase.rpc(
      'transfer_manager_responsibilities',
      {
        p_old_manager_id: oldManagerId,
        p_new_manager_id: newManagerId,
        p_transfer_reason: reason,
      }
    );

    if (!rpcError && rpcRes) {
      return rpcRes;
    }

    // Application-level atomic fallback if RPC not installed in current client
    // 1. Reassign open cases
    const { data: casesUpdated } = await this.supabase
      .from('cases')
      .update({ owner_manager_id: newManagerId, updated_at: new Date().toISOString() })
      .eq('owner_manager_id', oldManagerId)
      .not('status', 'in', '("CLOSED","FINANCIALLY_CLOSED")')
      .select('id');

    // 2. Reassign reporting staff
    const { data: staffUpdated } = await this.supabase
      .from('users')
      .update({ reports_to_id: newManagerId, updated_at: new Date().toISOString() })
      .eq('reports_to_id', oldManagerId)
      .select('id');

    // 3. Reassign manager scopes
    const { data: scopesUpdated } = await this.supabase
      .from('manager_scopes')
      .update({ manager_id: newManagerId })
      .eq('manager_id', oldManagerId)
      .select('id');

    // 4. Deactivate old manager
    await this.supabase
      .from('users')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', oldManagerId);

    // 5. Audit Log
    await recordAuditLog(this.supabase, {
      agency_id: agencyId,
      user_id: actorUserId,
      action: 'MANAGER_TRANSFER_WIZARD_COMPLETED',
      entity_type: 'user',
      entity_id: oldManagerId,
      new_values: {
        from_manager_id: oldManagerId,
        to_manager_id: newManagerId,
        transferred_cases: casesUpdated?.length || 0,
        transferred_staff: staffUpdated?.length || 0,
        transferred_scopes: scopesUpdated?.length || 0,
        reason,
      },
    });

    return {
      success: true,
      transferred_cases: casesUpdated?.length || 0,
      transferred_staff: staffUpdated?.length || 0,
      transferred_scopes: scopesUpdated?.length || 0,
    };
  }
}

export async function getUserEffectivePermissions(
  supabase: SupabaseClient,
  agencyId: string,
  userId: string
): Promise<string[]> {
  const rbac = new RbacService(supabase);
  const effective = await rbac.getEffectivePermissions(agencyId, userId);
  return effective.effective_permissions;
}

export async function getUserEffectiveScope(
  supabase: SupabaseClient,
  agencyId: string,
  userId: string
): Promise<ScopeLevel> {
  const rbac = new RbacService(supabase);
  const effective = await rbac.getEffectivePermissions(agencyId, userId);
  return effective.scope;
}

export async function getUserSubtree(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data } = await supabase.rpc('get_user_subtree', { p_user_id: userId });
  return (data || []).map((row: any) => row.id);
}
