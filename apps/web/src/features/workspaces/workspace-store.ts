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