import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { storage } from '../../storage';
import { requestBackgroundSync } from '../../sync/background-sync';
import {
  fetchUserWorkspaces,
  createWorkspace,
  renameWorkspace as renameWorkspaceApi,
  deleteWorkspace as deleteWorkspaceApi,
  setCurrentWorkspaceId,
  getCurrentWorkspaceId,
  type WorkspaceInfo,
} from './workspace-client';
import { useAuth } from '../auth/auth-context';

interface WorkspaceContextValue {
  workspaces: WorkspaceInfo[];
  currentWorkspace: WorkspaceInfo | null;
  isLoading: boolean;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  addWorkspace: (
    name: string,
    description?: string | null,
  ) => Promise<WorkspaceInfo>;
  renameWorkspace: (
    workspaceId: string,
    name: string,
  ) => Promise<WorkspaceInfo>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

async function resetLocalData(): Promise<void> {
  await storage.clearAll();
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { authState } = useAuth();
  const isAuthReady =
    authState === 'authenticated' || authState === 'offline_authenticated';
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(
    getCurrentWorkspaceId(),
  );
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isAuthReady) return;
    setIsLoading(true);
    try {
      const list = await fetchUserWorkspaces();
      setWorkspaces(list);

      const stored = getCurrentWorkspaceId();
      const valid = list.find((ws) => ws.id === stored);
      if (valid) {
        setCurrentId(valid.id);
      } else if (list.length > 0) {
        setCurrentWorkspaceId(list[0].id);
        setCurrentId(list[0].id);
      }
    } catch {
      // not authenticated or network error
    } finally {
      setIsLoading(false);
    }
  }, [isAuthReady]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (workspaceId === currentId) return;
      await resetLocalData();
      setCurrentWorkspaceId(workspaceId);
      setCurrentId(workspaceId);
      requestBackgroundSync();
    },
    [currentId],
  );

  const addWorkspace = useCallback(
    async (name: string, description?: string | null) => {
      const newWs = await createWorkspace({ name, description });
      await resetLocalData();
      setWorkspaces((prev) => [...prev, newWs]);
      setCurrentWorkspaceId(newWs.id);
      setCurrentId(newWs.id);
      return newWs;
    },
    [],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      const updated = await renameWorkspaceApi(workspaceId, name);
      setWorkspaces((prev) =>
        prev.map((ws) =>
          ws.id === workspaceId ? { ...ws, name: updated.name } : ws,
        ),
      );
      return updated;
    },
    [],
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      await deleteWorkspaceApi(workspaceId);
      let nextId: string | null = null;
      setWorkspaces((prev) => {
        const updated = prev.filter((ws) => ws.id !== workspaceId);
        if (currentId === workspaceId && updated.length > 0) {
          nextId = updated[0].id;
        }
        return updated;
      });
      if (nextId) {
        setCurrentWorkspaceId(nextId);
        setCurrentId(nextId);
      }
    },
    [currentId],
  );

  const currentWorkspace = workspaces.find((ws) => ws.id === currentId) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspace,
        isLoading,
        switchWorkspace,
        addWorkspace,
        renameWorkspace,
        deleteWorkspace,
        refresh,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaces(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx)
    throw new Error('useWorkspaces must be used within WorkspaceProvider');
  return ctx;
}
