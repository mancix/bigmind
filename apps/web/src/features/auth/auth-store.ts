import { getApiUrl } from './api-url';

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthState = 'authenticated' | 'offline_authenticated' | 'auth_required' | 'unauthenticated';

const ACCESS_KEY = 'bigmind_access_token';
const REFRESH_KEY = 'bigmind_refresh_token';
const USER_KEY = 'bigmind_user';

const REFRESH_INTERVAL_MS = 12 * 60 * 1000;

type StateChangeListener = (state: AuthState) => void;

class AuthStore {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private user: AuthUser | null = null;
  private refreshPromise: Promise<'ok' | 'network_error' | 'auth_error'> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private state: AuthState = 'unauthenticated';
  private readonly listeners = new Set<StateChangeListener>();

  constructor() {
    this.accessToken = localStorage.getItem(ACCESS_KEY);
    this.refreshToken = localStorage.getItem(REFRESH_KEY);
    const stored = localStorage.getItem(USER_KEY);
    if (stored) {
      try {
        this.user = JSON.parse(stored);
        this.state = this.accessToken ? 'authenticated' : 'unauthenticated';
      } catch {
        this.clear();
      }
    }
  }

  getState(): AuthState { return this.state; }

  getAccessToken(): string | null { return this.accessToken; }
  getRefreshToken(): string | null { return this.refreshToken; }
  getUser(): AuthUser | null { return this.user; }
  isAuthenticated(): boolean { return this.state === 'authenticated' || this.state === 'offline_authenticated'; }

  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(newState: AuthState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.listeners.forEach((fn) => fn(newState));
  }

  setTokens(accessToken: string, refreshToken: string, user: AuthUser): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.user = user;
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.setState('authenticated');
  }

  clear(): void {
    this.stopPeriodicRefresh();
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    this.setState('unauthenticated');
  }

  async refreshAccessToken(): Promise<'ok' | 'network_error' | 'auth_error'> {
    if (!this.refreshToken) return 'auth_error';

    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh();
    }

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<'ok' | 'network_error' | 'auth_error'> {
    try {
      const response = await fetch(`${getApiUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (!response.ok) {
        this.stopPeriodicRefresh();
        this.setState('auth_required');
        return 'auth_error';
      }

      const data = await response.json();
      this.setTokens(data.accessToken, data.refreshToken, data.user);
      return 'ok';
    } catch {
      this.setState('offline_authenticated');
      return 'network_error';
    }
  }

  startPeriodicRefresh(): void {
    this.stopPeriodicRefresh();
    if (!this.refreshToken) return;
    this.refreshTimer = setInterval(() => {
      void this.refreshAccessToken();
    }, REFRESH_INTERVAL_MS);
  }

  stopPeriodicRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

export const authStore = new AuthStore();
