import { getApiUrl } from '../auth/api-url';
import { authStore } from '../auth/auth-store';
import { getStoredWorkspaceId } from '../workspaces/workspace-store';

export interface NoteResponse {
  id: string;
  title: string;
  content: string;
  categoryId: string | null;
  workspaceId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = authStore.getAccessToken();
  const wsId = getStoredWorkspaceId();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(wsId ? { 'X-Workspace-Id': wsId } : {}),
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const result = await authStore.refreshAccessToken();
    if (result === 'ok') {
      const newToken = authStore.getAccessToken();
      const newWsId = getStoredWorkspaceId();
      return fetch(url, {
        ...options,
        headers: {
          ...(newToken ? { Authorization: `Bearer ${newToken}` } : {}),
          ...(newWsId ? { 'X-Workspace-Id': newWsId } : {}),
          'Content-Type': 'application/json',
        },
      });
    }
  }

  return response;
}

export async function moveNote(
  noteId: string,
  destinationWorkspaceId: string,
): Promise<NoteResponse> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/notes/${noteId}/move`,
    {
      method: 'POST',
      body: JSON.stringify({ destinationWorkspaceId }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to move note');
  }
  return response.json();
}

export async function copyNote(
  noteId: string,
  destinationWorkspaceId: string,
): Promise<NoteResponse> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/notes/${noteId}/copy`,
    {
      method: 'POST',
      body: JSON.stringify({ destinationWorkspaceId }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to copy note');
  }
  return response.json();
}
