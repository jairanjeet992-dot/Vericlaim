import { z } from 'zod';

export const ScopeLevelSchema = z.enum(['ALL', 'TEAM', 'ASSIGNED', 'OWN_ENTERED']);
export type ScopeLevel = z.infer<typeof ScopeLevelSchema>;

export const CreateRoleSchema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().optional(),
  default_scope: ScopeLevelSchema.default('TEAM'),
  permissions: z.array(z.string()).default([]),
});
export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;

export const CloneRoleSchema = z.object({
  source_role_id: z.string().uuid(),
  name: z.string().min(2).max(64),
  description: z.string().optional(),
});
export type CloneRoleInput = z.infer<typeof CloneRoleSchema>;

export const ToggleRolePermissionSchema = z.object({
  role_id: z.string().uuid(),
  permission_id: z.string().min(1),
  enabled: z.boolean(),
});
export type ToggleRolePermissionInput = z.infer<typeof ToggleRolePermissionSchema>;

export const ToggleUserPermissionSchema = z.object({
  user_id: z.string().uuid(),
  permission_id: z.string().min(1),
  effect: z.enum(['ALLOW', 'DENY', 'RESET']),
});
export type ToggleUserPermissionInput = z.infer<typeof ToggleUserPermissionSchema>;

export const UpdateUserScopeSchema = z.object({
  user_id: z.string().uuid(),
  scope: ScopeLevelSchema,
});
export type UpdateUserScopeInput = z.infer<typeof UpdateUserScopeSchema>;

export const DelegatePermissionSchema = z.object({
  target_user_id: z.string().uuid(),
  permission_id: z.string().min(1),
  effect: z.enum(['ALLOW', 'DENY']),
});
export type DelegatePermissionInput = z.infer<typeof DelegatePermissionSchema>;

export const CreateManagerScopeSchema = z.object({
  manager_id: z.string().uuid(),
  client_id: z.string().uuid(),
  case_type: z.string().min(1).max(32),
  is_default: z.boolean().default(false),
});
export type CreateManagerScopeInput = z.infer<typeof CreateManagerScopeSchema>;

export const ManagerTransferWizardSchema = z.object({
  old_manager_id: z.string().uuid(),
  new_manager_id: z.string().uuid(),
  reason: z.string().min(5, 'Mandatory reason explaining transfer'),
});
export type ManagerTransferWizardInput = z.infer<typeof ManagerTransferWizardSchema>;
