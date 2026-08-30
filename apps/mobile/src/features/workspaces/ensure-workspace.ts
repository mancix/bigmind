import { fetchUserWorkspaces } from './workspace-client';
import {
  getCachedWorkspaceId,
  hydrateWorkspaceStore,
  setStoredWorkspaceId,
} from './workspace-store';

/**
 * Ensures a workspace id is selected before syncing.
 *
 * The API's `WorkspaceGuard` rejects sync calls without `X-Workspace-Id`
 * (400), so mobile picks the user's first workspace (their personal
 * workspace) after login or on cold start with a stored session. Returns the
 * selected id, or null when the API is unreachable (sync will retry later).
 */
export async function ensureWorkspaceId(): Promise<string | null> {
  await hydrateWorkspaceStore();
  if (getCachedWorkspaceId()) {
    return getCachedWorkspaceId();
  }

  try {
    const workspaces = await fetchUserWorkspaces();
    const first = workspaces[0];
    if (first) {
      await setStoredWorkspaceId(first.id);
      return first.id;
    }
  } catch {
    // Offline or API unavailable — keep the cached id (may be null); the
    // background sync will retry automatically.
  }

  return getCachedWorkspaceId();
}
