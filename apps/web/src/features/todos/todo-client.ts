import { getApiUrl } from '../auth/api-url';
import { authStore } from '../auth/auth-store';
import { getStoredWorkspaceId } from '../workspaces/workspace-store';

export interface TodoItemData {
  id: string;
  todoListId: string;
  text: string;
  completed: boolean;
  position: number;
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

export async function fetchTodoItems(noteId: string): Promise<TodoItemData[]> {
  const response = await fetchWithAuth(`${getApiUrl()}/notes/${noteId}/todos`);
  if (!response.ok) throw new Error('Failed to fetch todo items');
  return response.json();
}

export async function createTodoItem(
  noteId: string,
  text: string,
): Promise<TodoItemData> {
  const response = await fetchWithAuth(`${getApiUrl()}/notes/${noteId}/todos`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to create todo item');
  }
  return response.json();
}

export async function updateTodoItem(
  noteId: string,
  itemId: string,
  text: string,
): Promise<TodoItemData> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/notes/${noteId}/todos/${itemId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to update todo item');
  }
  return response.json();
}

export async function toggleTodoItem(
  noteId: string,
  itemId: string,
): Promise<TodoItemData> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/notes/${noteId}/todos/${itemId}/toggle`,
    { method: 'PUT' },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to toggle todo item');
  }
  return response.json();
}

export async function deleteTodoItem(
  noteId: string,
  itemId: string,
): Promise<void> {
  const response = await fetchWithAuth(
    `${getApiUrl()}/notes/${noteId}/todos/${itemId}`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Failed to delete todo item');
  }
}
