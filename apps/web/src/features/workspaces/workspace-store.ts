import type { WorkspaceContext } from '@bigmind/features';

const WORKSPACE_KEY = 'bigmind_workspace_id';

export function getStoredWorkspaceId(): string | null {
  return localStorage.getItem(WORKSPACE_KEY);
}

export function setStoredWorkspaceId(id: string): void {
  localStorage.setItem(WORKSPACE_KEY, id);
}

export function clearStoredWorkspaceId(): void {
  localStorage.removeItem(WORKSPACE_KEY);
}

/**
 * Web workspace context: reads the selected workspace id from `localStorage`
 * (`bigmind_workspace_id`). Shared repositories receive this provider at
 * construction time — they never touch `localStorage` themselves.
 */
export const webWorkspaceContext: WorkspaceContext = {
  getWorkspaceId: getStoredWorkspaceId,
};