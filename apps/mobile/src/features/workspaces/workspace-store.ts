import AsyncStorage from '@react-native-async-storage/async-storage';

const WORKSPACE_KEY = 'bigmind_workspace_id';
const WORKSPACES_KEY = 'bigmind_workspaces';

/**
 * Selected workspace id with a synchronous cache.
 *
 * The sync transport builds request headers synchronously, so the id is
 * mirrored in memory and hydrated from AsyncStorage before the first sync
 * (see `ensureWorkspaceId`).
 */
let cachedWorkspaceId: string | null = null;

export interface CachedWorkspace {
  id: string;
  name: string;
  description: string | null;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

export async function hydrateWorkspaceStore(): Promise<void> {
  cachedWorkspaceId = await AsyncStorage.getItem(WORKSPACE_KEY);
}

/** Synchronous access used by the HTTP sync transport headers. */
export function getCachedWorkspaceId(): string | null {
  return cachedWorkspaceId;
}

export async function getStoredWorkspaceId(): Promise<string | null> {
  return AsyncStorage.getItem(WORKSPACE_KEY);
}

export async function setStoredWorkspaceId(id: string): Promise<void> {
  cachedWorkspaceId = id;
  await AsyncStorage.setItem(WORKSPACE_KEY, id);
}

export async function clearStoredWorkspaceId(): Promise<void> {
  cachedWorkspaceId = null;
  await AsyncStorage.removeItem(WORKSPACE_KEY);
}

/**
 * Offline cache of the user's workspace list (non-sensitive metadata).
 *
 * The workspace list stays available when the server is unreachable: the
 * provider seeds state from here on a failed refresh, so the user can still
 * see and switch between workspaces and the current workspace remains
 * usable until connectivity returns.
 */
export async function cacheWorkspaces(
  workspaces: CachedWorkspace[],
): Promise<void> {
  await AsyncStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));
}

export async function getCachedWorkspaces(): Promise<CachedWorkspace[] | null> {
  const raw = await AsyncStorage.getItem(WORKSPACES_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedWorkspace[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearCachedWorkspaces(): Promise<void> {
  await AsyncStorage.removeItem(WORKSPACES_KEY);
}
