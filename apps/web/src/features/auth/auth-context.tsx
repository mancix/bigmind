import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import type { AuthResponse } from '@bigmind/contracts';

import { storage } from '../../storage';
import { authStore, type AuthState, type AuthUser } from './auth-store';
import { getApiUrl } from './api-url';
import { clearStoredWorkspaceId } from '../workspaces/workspace-store';

interface AuthContextValue {
  user: AuthUser | null;
  authState: AuthState;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function resetLocalData(): Promise<void> {
  await storage.clearAll();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(authStore.getState());
  const user = authStore.getUser();

  useEffect(() => {
    const unsubscribe = authStore.subscribe(setAuthState);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const initial = authStore.getState();
    if (initial === 'authenticated' || initial === 'unauthenticated') {
      void authStore.refreshAccessToken().then((result) => {
        if (result === 'ok') {
          authStore.startPeriodicRefresh();
        } else if (result === 'network_error') {
          authStore.startPeriodicRefresh();
        }
      });
    }
    return () => authStore.stopPeriodicRefresh();
  }, []);

  async function handleAuthResponse(response: Response): Promise<AuthResponse> {
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? 'Authentication failed');
    }
    const data = (await response.json()) as AuthResponse;
    authStore.setTokens(data.accessToken, data.refreshToken, data.user);
    setAuthState('authenticated');
    return data;
  }

  async function login(email: string, password: string): Promise<void> {
    const response = await fetch(`${getApiUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    await handleAuthResponse(response);
  }

  async function register(email: string, password: string): Promise<void> {
    const response = await fetch(`${getApiUrl()}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    await handleAuthResponse(response);
  }

  async function logout(): Promise<void> {
    try {
      const rt = authStore.getRefreshToken();
      if (rt) {
        await fetch(`${getApiUrl()}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
      }
    } catch {
      // ignore logout errors
    }
    await resetLocalData();
    authStore.clear();
    clearStoredWorkspaceId();
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        authState,
        isAuthenticated:
          authState === 'authenticated' ||
          authState === 'offline_authenticated',
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
