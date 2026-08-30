import { listWorkspacesResponseSchema } from '@bigmind/contracts';
import { authStore } from '../auth/auth-store';
import { getApiUrl } from '../auth/api-url';

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string | null;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

/** Loads the authenticated user's workspaces (shared contract schema). */
export async function fetchUserWorkspaces(): Promise<WorkspaceInfo[]> {
  const response = await fetch(`${getApiUrl()}/workspaces`, {
    headers: {
      Authorization: `Bearer ${authStore.getAccessToken() ?? ''}`,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch workspaces');
  }
  const parsed = listWorkspacesResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Unexpected workspaces response');
  }
  return parsed.data;
}
