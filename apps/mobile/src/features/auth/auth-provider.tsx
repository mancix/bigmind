import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthState, AuthUser } from '@bigmind/auth';

import { login as apiLogin, register as apiRegister } from './auth-api';
import { authStore, createAuthStore } from './auth-store';
import { ensureWorkspaceId } from '../workspaces/ensure-workspace';

type AuthStore = ReturnType<typeof createAuthStore>;

interface AuthContextValue {
  authState: AuthState;
  isAuthenticated: boolean;
  user: AuthUser | null;
  /** Log in: validates via the shared contracts, requests the API, stores tokens. */
  login: (email: string, password: string) => Promise<void>;
  /** Register a new account (also signs in with the returned token pair). */
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [store] = useState<AuthStore>(authStore);
  const [authState, setAuthState] = useState<AuthState>(store.getState());

  useEffect(() => {
    const unsubscribe = store.subscribe(setAuthState);
    return unsubscribe;
  }, [store]);

  useEffect(() => {
    const initial = store.getState();
    if (initial === 'authenticated' || initial === 'unauthenticated') {
      void store.refreshAccessToken().then((result) => {
        if (result === 'ok' || result === 'network_error') {
          store.startPeriodicRefresh();
        }
      });
    }
    return () => store.stopPeriodicRefresh();
  }, [store]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await apiLogin(email, password);
      store.setTokens(
        response.accessToken,
        response.refreshToken,
        response.user,
      );
      // Select the first workspace so sync calls carry X-Workspace-Id.
      void ensureWorkspaceId();
    },
    [store],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const response = await apiRegister(email, password);
      store.setTokens(
        response.accessToken,
        response.refreshToken,
        response.user,
      );
      // Select the first workspace so sync calls carry X-Workspace-Id.
      void ensureWorkspaceId();
    },
    [store],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      authState,
      isAuthenticated: store.isAuthenticated(),
      user: store.getUser(),
      login,
      register,
      logout: () => store.clear(),
    }),
    [authState, store, login, register],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
