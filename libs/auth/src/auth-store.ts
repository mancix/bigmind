import type { AuthResponse, AuthUser } from '@bigmind/contracts';

import type { TokenStorage } from './token-storage.js';

export type { AuthUser } from '@bigmind/contracts';

export type AuthState =
  | 'authenticated'
  | 'offline_authenticated'
  | 'auth_required'
  | 'unauthenticated';

const ACCESS_KEY = 'bigmind_access_token';
const REFRESH_KEY = 'bigmind_refresh_token';
const USER_KEY = 'bigmind_user';

const DEFAULT_REFRESH_INTERVAL_MS = 12 * 60 * 1000;

type StateChangeListener = (state: AuthState) => void;

export interface AuthStoreOptions {
  /** Platform key-value storage (localStorage / AsyncStorage). */
  tokenStorage: TokenStorage;
  /** Base URL of the BigMind API, without a trailing slash. */
  apiUrl: string;
  /** How often to proactively refresh the access token. */
  refreshIntervalMs?: number;
}

/**
 * Platform-agnostic authentication state machine.
 *
 * Shared by the web PWA (`apps/web/src/features/auth/auth-store.ts`) and the
 * mobile app (`apps/mobile/src/features/auth/auth-store.ts`). The offline
 * model distinguishes `authenticated`, `offline_authenticated`,
 * `auth_required`, and `unauthenticated`, preserving local data on network
 * and authentication failures.
 */
export class AuthStore {
  private readonly tokenStorage: TokenStorage;
  private readonly apiUrl: string;
  private readonly refreshIntervalMs: number;

  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private user: AuthUser | null = null;
  private refreshPromise: Promise<
    'ok' | 'network_error' | 'auth_error'
  > | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private state: AuthState = 'unauthenticated';
  private readonly listeners = new Set<StateChangeListener>();

  constructor(options: AuthStoreOptions) {
    this.tokenStorage = options.tokenStorage;
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.refreshIntervalMs =
      options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;

    this.accessToken = this.tokenStorage.getItem(ACCESS_KEY);
    this.refreshToken = this.tokenStorage.getItem(REFRESH_KEY);
    const stored = this.tokenStorage.getItem(USER_KEY);
    if (stored) {
      try {
        this.user = JSON.parse(stored);
        this.state = this.accessToken ? 'authenticated' : 'unauthenticated';
      } catch {
        this.clear();
      }
    }
  }

  getState(): AuthState {
    return this.state;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }
  getRefreshToken(): string | null {
    return this.refreshToken;
  }
  getUser(): AuthUser | null {
    return this.user;
  }
  isAuthenticated(): boolean {
    return (
      this.state === 'authenticated' || this.state === 'offline_authenticated'
    );
  }

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
    this.tokenStorage.setItem(ACCESS_KEY, accessToken);
    this.tokenStorage.setItem(REFRESH_KEY, refreshToken);
    this.tokenStorage.setItem(USER_KEY, JSON.stringify(user));
    this.setState('authenticated');
  }

  clear(): void {
    this.stopPeriodicRefresh();
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    this.tokenStorage.removeItem(ACCESS_KEY);
    this.tokenStorage.removeItem(REFRESH_KEY);
    this.tokenStorage.removeItem(USER_KEY);
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
      const response = await fetch(`${this.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (!response.ok) {
        this.stopPeriodicRefresh();
        this.setState('auth_required');
        return 'auth_error';
      }

      const data = (await response.json()) as AuthResponse;
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
    }, this.refreshIntervalMs);
  }

  stopPeriodicRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
