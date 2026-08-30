import { HttpSyncTransport, type HttpSyncTransportAuth } from '@bigmind/sync';
import { authStore } from '../features/auth/auth-store';
import { getApiUrl } from '../features/auth/api-url';
import { getCachedWorkspaceId } from '../features/workspaces/workspace-store';

/**
 * Mobile auth wiring for the HTTP sync transport: bearer token + the
 * workspace id required by the API's WorkspaceGuard (`X-Workspace-Id`), and
 * the mobile AuthStore token refresh on 401.
 */
export const mobileSyncAuth: HttpSyncTransportAuth = {
  getHeaders: () => {
    const headers: Record<string, string> = {};
    const token = authStore.getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const workspaceId = getCachedWorkspaceId();
    if (workspaceId) {
      headers['X-Workspace-Id'] = workspaceId;
    }
    return headers;
  },
  getAuthState: () => authStore.getState(),
  refreshAccessToken: () => authStore.refreshAccessToken(),
};

export function createMobileHttpTransport(): HttpSyncTransport {
  return new HttpSyncTransport({ baseUrl: getApiUrl(), auth: mobileSyncAuth });
}
