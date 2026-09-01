import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { requestBackgroundSync } from '@bigmind/sync';

import { storage } from '../../storage';
import { useAuth } from '../auth/auth-provider';
import {
  cacheWorkspaces,
  getCachedWorkspaces,
  getCachedWorkspaceId,
  hydrateWorkspaceStore,
  setStoredWorkspaceId,
} from './workspace-store';
import {
  createWorkspace as createWorkspaceApi,
  deleteWorkspace as deleteWorkspaceApi,
  fetchUserWorkspaces,
  type WorkspaceInfo,
} from './workspace-client';

interface WorkspaceContextValue {
  workspaces: WorkspaceInfo[];
  currentWorkspace: WorkspaceInfo | null;
  isLoading: boolean;
  /** Switch the active workspace: clears local data and re-pulls it. */
  switchWorkspace: (workspaceId: string) => Promise<void>;
  /** Create a workspace and switch to it. */
  addWorkspace: (
    name: string,
    description?: string | null,
  ) => Promise<WorkspaceInfo>;
  /** Delete a workspace (OWNER only; enforced by the API with 403/409). */
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  /** Fresh fetch; falls back to the cached list when offline. */
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
    getCachedWorkspaceId(),
  );
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isAuthReady) return;
    setIsLoading(true);
    try {
      const list = await fetchUserWorkspaces();
      setWorkspaces(list);
      await cacheWorkspaces(list);

      const stored = getCachedWorkspaceId();
      const valid = list.find((ws) => ws.id === stored);
      if (valid) {
        setCurrentId(valid.id);
      } else if (list.length > 0) {
        await setStoredWorkspaceId(list[0].id);
        setCurrentId(list[0].id);
      }
    } catch {
      // Offline / API unavailable: fall back to the cached workspace list so
      // the list and the current workspace stay usable offline.
      const cached = await getCachedWorkspaces();
      if (cached && cached.length > 0) {
        setWorkspaces(cached);
        const stored = getCachedWorkspaceId();
        if (cached.some((ws) => ws.id === stored)) {
          setCurrentId(stored);
        } else {
          setCurrentId(cached[0].id);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [isAuthReady]);

  useEffect(() => {
    void hydrateWorkspaceStore().then(() => {
      setCurrentId(getCachedWorkspaceId());
      void refresh();
    });
  }, [refresh]);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (workspaceId === currentId) return;
      await resetLocalData();
      await setStoredWorkspaceId(workspaceId);
      setCurrentId(workspaceId);
      requestBackgroundSync();
    },
    [currentId],
  );

  const addWorkspace = useCallback(
    async (name: string, description?: string | null) => {
      const created = await createWorkspaceApi({ name, description });
      await resetLocalData();
      setWorkspaces((prev) => [...prev, created]);
      await setStoredWorkspaceId(created.id);
      setCurrentId(created.id);
      requestBackgroundSync();
      return created;
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
        await setStoredWorkspaceId(nextId);
        setCurrentId(nextId);
        requestBackgroundSync();
      }
    },
    [currentId],
  );

  const currentWorkspace =
    workspaces.find((ws) => ws.id === currentId) ?? null;

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      currentWorkspace,
      isLoading,
      switchWorkspace,
      addWorkspace,
      deleteWorkspace,
      refresh,
    }),
    [
      workspaces,
      currentWorkspace,
      isLoading,
      switchWorkspace,
      addWorkspace,
      deleteWorkspace,
      refresh,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaces(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspaces must be used within WorkspaceProvider');
  }
  return ctx;
}

export type { WorkspaceInfo } from './workspace-client';