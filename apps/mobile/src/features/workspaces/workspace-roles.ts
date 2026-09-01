import type { WorkspaceInfo } from './workspace-client';

export type WorkspaceRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export type WorkspaceType = 'personal' | 'shared';

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  'OWNER',
  'EDITOR',
  'VIEWER',
] as const;

const PERSONAL_WORKSPACE_MARKER = 'personal workspace';

/**
 * Whether a workspace is the user's personal workspace.
 *
 * Matches the backend's own protection rule (`workspaces.service.ts` refuses
 * to delete workspaces whose name contains "personal workspace"), so the type
 * badge is consistent with server-side behavior. The workspace list contract
 * does not expose a type field.
 */
export function workspaceType(workspace: WorkspaceInfo): WorkspaceType {
  return workspace.name.toLowerCase().includes(PERSONAL_WORKSPACE_MARKER)
    ? 'personal'
    : 'shared';
}

export function isRole(role: WorkspaceRole, expected: WorkspaceRole): boolean {
  return role === expected;
}

/** Owner: full administration (invite, roles, remove, delete workspace). */
export function canManageWorkspace(role: WorkspaceRole): boolean {
  return role === 'OWNER';
}

/** Editor (and above): may create/edit content. Viewers are read-only. */
export function canEditContent(role: WorkspaceRole): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}

/** Viewers and editors may view members; owners may manage them. */
export function canViewMembers(role: WorkspaceRole): boolean {
  return role === 'OWNER' || role === 'EDITOR' || role === 'VIEWER';
}