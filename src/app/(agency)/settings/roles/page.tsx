'use client';

import React, { useState, useEffect } from 'react';

interface Permission {
  id: string;
  module: string;
  name: string;
  description: string;
}

interface Role {
  id: string;
  name: string;
  description?: string;
  default_scope: string;
  is_system_template: boolean;
  role_permissions: Array<{ permission_id: string }>;
}

export default function RolesMatrixPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleScope, setNewRoleScope] = useState('TEAM');
  const [cloneSourceId, setCloneSourceId] = useState('');
  const [notification, setNotification] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/settings/roles');
      const json = await res.json();
      if (json.success) {
        setPermissions(json.data.permissions || []);
        setRoles(json.data.roles || []);
        if (json.data.roles?.length > 0 && !selectedRole) {
          setSelectedRole(json.data.roles[0]);
        }
      }
    } catch {
      setNotification('Failed to load roles and permissions matrix.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTogglePermission = async (roleId: string, permissionId: string, currentlyEnabled: boolean) => {
    try {
      const res = await fetch(`/api/settings/roles/${roleId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permission_id: permissionId,
          enabled: !currentlyEnabled,
        }),
      });

      if (res.ok) {
        // Update local state immediately
        setRoles((prev) =>
          prev.map((r) => {
            if (r.id !== roleId) return r;
            const existing = r.role_permissions.some((rp) => rp.permission_id === permissionId);
            const newPerms = existing
              ? r.role_permissions.filter((rp) => rp.permission_id !== permissionId)
              : [...r.role_permissions, { permission_id: permissionId }];
            const updated = { ...r, role_permissions: newPerms };
            if (selectedRole?.id === roleId) setSelectedRole(updated);
            return updated;
          })
        );
        setNotification(`Permission updated for ${roles.find((r) => r.id === roleId)?.name}.`);
        setTimeout(() => setNotification(null), 3000);
      }
    } catch {
      setNotification('Error updating permission toggle.');
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRoleName.trim(),
          default_scope: newRoleScope,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setShowCreateModal(false);
        setNewRoleName('');
        loadData();
        setNotification(`Custom role created successfully.`);
      }
    } catch {
      setNotification('Error creating custom role.');
    }
  };

  const handleCloneRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_role_id: cloneSourceId,
          name: newRoleName.trim(),
        }),
      });

      const json = await res.json();
      if (json.success) {
        setShowCloneModal(false);
        setNewRoleName('');
        loadData();
        setNotification(`Role cloned successfully.`);
      }
    } catch {
      setNotification('Error cloning role.');
    }
  };

  // Group permissions by module
  const modules = Array.from(new Set(permissions.map((p) => p.module)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Roles & Permission Matrix
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure system and custom agency roles. Real-time toggle propagation with immutable audit trail.
          </p>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => setShowCloneModal(true)}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider rounded border border-slate-300 transition"
          >
            Clone Role
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold uppercase tracking-wider rounded transition"
          >
            + Create Custom Role
          </button>
        </div>
      </div>

      {notification && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded">
          {notification}
        </div>
      )}

      {/* Role Selector Tabs */}
      <div className="flex space-x-2 overflow-x-auto pb-2 border-b border-slate-200">
        {roles.map((role) => (
          <button
            key={role.id}
            onClick={() => setSelectedRole(role)}
            className={`px-3 py-1.5 text-xs font-semibold rounded whitespace-nowrap transition ${
              selectedRole?.id === role.id
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            {role.name}
            {role.is_system_template && (
              <span className="ml-1 text-[10px] text-slate-400 font-normal">template</span>
            )}
          </button>
        ))}
      </div>

      {/* Active Role Matrix Card */}
      {selectedRole && (
        <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  {selectedRole.name}
                </h2>
                <span className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-800 font-mono-code rounded">
                  DEFAULT SCOPE: {selectedRole.default_scope}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {selectedRole.description || 'Custom agency role configuration'}
              </p>
            </div>
            <div className="text-xs text-slate-500 font-mono-code">
              {selectedRole.role_permissions.length} of {permissions.length} permissions active
            </div>
          </div>

          <div className="p-6 space-y-6">
            {modules.map((mod) => {
              const modPerms = permissions.filter((p) => p.module === mod);
              return (
                <div key={mod} className="border border-slate-100 rounded-lg p-4 bg-slate-50/50">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center space-x-2">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    <span>{mod} Module</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {modPerms.map((perm) => {
                      const isEnabled = selectedRole.role_permissions.some(
                        (rp) => rp.permission_id === perm.id
                      );
                      const isOwnerRole = selectedRole.name === 'Agency Owner';

                      return (
                        <div
                          key={perm.id}
                          className={`p-3 rounded border text-xs flex items-start justify-between space-x-2 ${
                            isEnabled
                              ? 'bg-white border-blue-200 shadow-sm'
                              : 'bg-slate-100/50 border-slate-200 text-slate-400'
                          }`}
                        >
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center space-x-1">
                              <span>{perm.name}</span>
                              <span className="text-[10px] font-mono-code text-slate-400">({perm.id})</span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{perm.description}</div>
                          </div>

                          <input
                            type="checkbox"
                            disabled={isOwnerRole} // Agency Owner holds all permissions
                            checked={isEnabled}
                            onChange={() =>
                              handleTogglePermission(selectedRole.id, perm.id, isEnabled)
                            }
                            className="mt-1 h-4 w-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal: Create Custom Role */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 w-full max-w-sm rounded-lg p-6 space-y-4 shadow-xl">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              Create Custom Role
            </h2>
            <form onSubmit={handleCreateRole} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                  Role Name
                </label>
                <input
                  type="text"
                  required
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="e.g. Senior Regional Reviewer"
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                  Default Scope Level
                </label>
                <select
                  value={newRoleScope}
                  onChange={(e) => setNewRoleScope(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                >
                  <option value="ALL">ALL (Entire Agency)</option>
                  <option value="TEAM">TEAM (Subordinate Subtree)</option>
                  <option value="ASSIGNED">ASSIGNED (Directly Assigned Cases)</option>
                  <option value="OWN_ENTERED">OWN_ENTERED (Self-Ingested Cases)</option>
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold"
                >
                  Create Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Clone Role */}
      {showCloneModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 w-full max-w-sm rounded-lg p-6 space-y-4 shadow-xl">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              Clone Existing Role
            </h2>
            <form onSubmit={handleCloneRole} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                  Source Role
                </label>
                <select
                  required
                  value={cloneSourceId}
                  onChange={(e) => setCloneSourceId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                >
                  <option value="">Select role to duplicate...</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.role_permissions.length} perms)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1 uppercase tracking-wider">
                  New Cloned Role Name
                </label>
                <input
                  type="text"
                  required
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="e.g. Back Office Level 2"
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCloneModal(false)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!cloneSourceId}
                  className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold disabled:opacity-50"
                >
                  Clone Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
