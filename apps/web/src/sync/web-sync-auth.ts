import { HttpSyncTransport, type HttpSyncTransportAuth } from '@bigmind/sync';
import { authStore } from '../features/auth/auth-store';
import { getStoredWorkspaceId } from '../features/workspaces/workspace-store';

/**
 * Web auth wiring for the HTTP sync transport: bearer token + workspace id
 * headers, and the shared AuthStore token refresh on 401.
 */
export const webSyncAuth: HttpSyncTransportAuth = {
  getHeaders: () => {
    const token = authStore.getAccessToken();
    const wsId = getStoredWorkspaceId();
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(wsId ? { 'X-Workspace-Id': wsId } : {}),
    };
  },
  getAuthState: () => authStore.getState(),
  refreshAccessToken: () => authStore.refreshAccessToken(),
};

export function createWebHttpSyncTransport(baseUrl: string): HttpSyncTransport {
  return new HttpSyncTransport({ baseUrl, auth: webSyncAuth });
}
