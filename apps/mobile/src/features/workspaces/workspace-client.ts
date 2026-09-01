import {
  createWorkspaceRequestSchema,
  invitationSchema,
  inviteRequestSchema,
  listInvitationsResponseSchema,
  listMembersResponseSchema,
  listWorkspacesResponseSchema,
  workspaceSchema,
} from '@bigmind/contracts';

import { authStore } from '../auth/auth-store';
import { getApiUrl } from '../auth/api-url';
import {
  getCachedWorkspaceId,
  getStoredWorkspaceId,
} from './workspace-store';

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string | null;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  joinedAt: string;
}

export interface InvitationInfo {
  id: string;
  workspaceId: string;
  email: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

async function authHeaders(
  workspaceId?: string | null,
): Promise<Record<string, string>> {
  const token = authStore.getAccessToken();
  // Prefer the synchronous cache for the header, falling back to the
  // persisted id when the cache has not been hydrated yet.
  const wsId =
    workspaceId ?? getCachedWorkspaceId() ?? (await getStoredWorkspaceId());
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(wsId ? { 'X-Workspace-Id': wsId } : {}),
  };
}

/**
 * Authenticated fetch with the same 401 → token-refresh → retry behavior as
 * the web workspace client. Uses the SHARED AuthStore (identical refresh /
 * offline_authenticated semantics on both platforms).
 */
async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  workspaceId?: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(await authHeaders(workspaceId)),
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const result = await authStore.refreshAccessToken();
    if (result === 'ok') {
      const retryHeaders: Record<string, string> = {
        ...(await authHeaders(workspaceId)),
        ...((options.headers as Record<string, string> | undefined) ?? {}),
      };
      return fetch(url, { ...options, headers: retryHeaders });
    }
  }

  return response;
}

/** Loads the authenticated user's workspaces (shared contract schema). */
export async function fetchUserWorkspaces(): Promise<WorkspaceInfo[]> {
  const response = await fetchWithAuth(`${getApiUrl()}/workspaces`);
  if (!response.ok) {
    throw new Error('Failed to fetch workspaces');
  }
  const parsed = listWorkspacesResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Unexpected workspaces response');
  }
  return parsed.data;
}

/** Creates a workspace; name/description validated with the shared schema. */
export async function createWorkspace(data: {
  name: string;
  description?: string | null;
}): Promise<WorkspaceInfo> {
  const body = createWorkspaceRequestSchema.parse(data);
  const response = await fetchWithAuth(`${getApiUrl()}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ?? 'Failed to create workspace',
    );
  }
  const parsed = workspaceSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Unexpected create workspace response');
  }
  return parsed.data;
}

/** Lists workspace members (any member may view). */
export async function fetchMembers(
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/members`,
    undefined,
    workspaceId,
  );
  if (!response.ok) {
    throw new Error('Failed to fetch members');
  }
  const parsed = listMembersResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Unexpected members response');
  }
  return parsed.data;
}

/** Changes a member role (OWNER only — the API enforces it with 403). */
export async function changeMemberRole(
  workspaceId: string,
  userId: string,
  role: 'OWNER' | 'EDITOR' | 'VIEWER',
): Promise<void> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/members/${userId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    },
    workspaceId,
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ?? 'Failed to change role',
    );
  }
}

/** Removes a member (OWNER only — the API enforces it with 403). */
export async function removeMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/members/${userId}`,
    { method: 'DELETE' },
    workspaceId,
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ?? 'Failed to remove member',
    );
  }
}

/** Deletes a workspace (OWNER only; personal workspaces and shared ones with other members are rejected by the API). */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}`,
    { method: 'DELETE' },
    workspaceId,
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ?? 'Failed to delete workspace',
    );
  }
}

/** Lists invitations for a workspace (OWNER only — the API enforces it). */
export async function fetchInvitations(
  workspaceId: string,
): Promise<InvitationInfo[]> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/invitations`,
    undefined,
    workspaceId,
  );
  if (!response.ok) {
    throw new Error('Failed to fetch invitations');
  }
  const parsed = listInvitationsResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Unexpected invitations response');
  }
  return parsed.data;
}

/** Sends an invitation; email + role validated with the shared schema. */
export async function createInvitation(
  workspaceId: string,
  email: string,
  role: 'EDITOR' | 'VIEWER',
): Promise<InvitationInfo> {
  const body = inviteRequestSchema.parse({ email, role });
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/invitations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    workspaceId,
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ?? 'Failed to send invitation',
    );
  }
  const parsed = invitationSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Unexpected invitation response');
  }
  return parsed.data;
}

/** Revokes a pending invitation (OWNER only — the API enforces it). */
export async function revokeInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/invitations/${invitationId}`,
    { method: 'DELETE' },
    workspaceId,
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ?? 'Failed to revoke invitation',
    );
  }
}