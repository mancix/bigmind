import { getApiUrl } from '../auth/api-url';
import { authStore } from '../auth/auth-store';
import { getStoredWorkspaceId, setStoredWorkspaceId } from './workspace-store';

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string | null;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
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

export interface MemberInfo {
  userId: string;
  email: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  joinedAt: string;
}

function authHeader(): Record<string, string> {
  const token = authStore.getAccessToken();
  const wsId = getStoredWorkspaceId();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(wsId ? { 'X-Workspace-Id': wsId } : {}),
  };
}

async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...authHeader(),
    ...(options.headers as Record<string, string> | undefined),
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const result = await authStore.refreshAccessToken();
    if (result === 'ok') {
      const retryHeaders: Record<string, string> = {
        ...authHeader(),
        ...(options.headers as Record<string, string> | undefined),
      };
      return fetch(url, { ...options, headers: retryHeaders });
    }
  }

  return response;
}

export async function fetchUserWorkspaces(): Promise<WorkspaceInfo[]> {
  const response = await fetchWithAuth(`${getApiUrl()}/workspaces`);
  if (!response.ok) {
    throw new Error('Failed to fetch workspaces');
  }
  return response.json();
}

export async function createWorkspace(data: {
  name: string;
  description?: string | null;
}): Promise<WorkspaceInfo> {
  const response = await fetchWithAuth(`${getApiUrl()}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to create workspace');
  }

  return response.json();
}

export function getCurrentWorkspaceId(): string | null {
  return getStoredWorkspaceId();
}

export function setCurrentWorkspaceId(id: string): void {
  setStoredWorkspaceId(id);
}

export async function fetchInvitations(workspaceId: string): Promise<InvitationInfo[]> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/invitations`,
  );
  if (!response.ok) throw new Error('Failed to fetch invitations');
  return response.json();
}

export async function createInvitation(
  workspaceId: string,
  email: string,
  role: 'EDITOR' | 'VIEWER',
): Promise<InvitationInfo> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/invitations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to send invitation');
  }
  return response.json();
}

export async function revokeInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/invitations/${invitationId}`,
    { method: 'DELETE' },
  );
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to delete workspace');
  }
}

export async function fetchMembers(workspaceId: string): Promise<MemberInfo[]> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/members`,
  );
  if (!response.ok) throw new Error('Failed to fetch members');
  return response.json();
}

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
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to change role');
  }
}

export async function renameWorkspace(
  workspaceId: string,
  name: string,
): Promise<WorkspaceInfo> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/rename`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to rename workspace');
  }
  return response.json();
}

export async function removeMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/workspaces/${workspaceId}/members/${userId}`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to remove member');
  }
}
