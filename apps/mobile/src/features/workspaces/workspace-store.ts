import AsyncStorage from '@react-native-async-storage/async-storage';

const WORKSPACE_KEY = 'bigmind_workspace_id';

/**
 * Selected workspace id with a synchronous cache.
 *
 * The sync transport builds request headers synchronously, so the id is
 * mirrored in memory and hydrated from AsyncStorage before the first sync
 * (see `ensureWorkspaceId`).
 */
let cachedWorkspaceId: string | null = null;

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
