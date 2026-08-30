import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from './auth-store.js';
import type { TokenStorage } from './token-storage.js';

function createMemoryTokenStorage(): TokenStorage & { clear(): void } {
  let store: Record<string, string> = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = value;
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
}

describe('AuthStore state model', () => {
  let storage: ReturnType<typeof createMemoryTokenStorage>;
  let store: AuthStore;

  beforeEach(() => {
    storage = createMemoryTokenStorage();
    store = new AuthStore({
      tokenStorage: storage,
      apiUrl: 'http://localhost:3000',
    });
    store['accessToken'] = null;
    store['refreshToken'] = null;
    store['user'] = null;
    store['state'] = 'unauthenticated';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    storage.clear();
  });

  it('starts unauthenticated when no tokens are stored', () => {
    const fresh = new AuthStore({
      tokenStorage: storage,
      apiUrl: 'http://localhost:3000',
    });
    expect(fresh.getState()).toBe('unauthenticated');
    expect(fresh.isAuthenticated()).toBe(false);
  });

  it('hydrates from stored tokens', () => {
    storage.setItem('bigmind_access_token', 'a');
    storage.setItem('bigmind_refresh_token', 'r');
    storage.setItem(
      'bigmind_user',
      JSON.stringify({ id: 'u1', email: 'a@b.com' }),
    );

    const fresh = new AuthStore({
      tokenStorage: storage,
      apiUrl: 'http://localhost:3000',
    });
    expect(fresh.getState()).toBe('authenticated');
    expect(fresh.getUser()).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('transitions to authenticated when tokens are set', () => {
    store.setTokens('access-123', 'refresh-456', {
      id: 'user-1',
      email: 'a@b.com',
    });

    expect(store.getState()).toBe('authenticated');
    expect(store.isAuthenticated()).toBe(true);
    expect(store.getAccessToken()).toBe('access-123');
    expect(store.getRefreshToken()).toBe('refresh-456');
    expect(storage.getItem('bigmind_access_token')).toBe('access-123');
  });

  it('transitions to unauthenticated on clear', () => {
    store.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    store.clear();

    expect(store.getState()).toBe('unauthenticated');
    expect(store.isAuthenticated()).toBe(false);
    expect(store.getAccessToken()).toBeNull();
    expect(storage.getItem('bigmind_access_token')).toBeNull();
  });

  it('transitions to offline_authenticated on network error during refresh', async () => {
    store.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await store.refreshAccessToken();

    expect(result).toBe('network_error');
    expect(store.getState()).toBe('offline_authenticated');
    expect(store.isAuthenticated()).toBe(true);
    expect(store.getAccessToken()).toBe('a');
    expect(store.getRefreshToken()).toBe('r');
  });

  it('transitions to auth_required on auth error during refresh', async () => {
    store.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Invalid refresh token' }),
    });

    const result = await store.refreshAccessToken();

    expect(result).toBe('auth_error');
    expect(store.getState()).toBe('auth_required');
    expect(store.isAuthenticated()).toBe(false);
  });

  it('refreshes tokens and persists the new pair', async () => {
    store.setTokens('old-access', 'old-refresh', {
      id: 'u1',
      email: 'a@b.com',
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          user: { id: 'u1', email: 'a@b.com' },
        }),
    });

    const result = await store.refreshAccessToken();

    expect(result).toBe('ok');
    expect(store.getAccessToken()).toBe('new-access');
    expect(store.getRefreshToken()).toBe('new-refresh');
    expect(store.getState()).toBe('authenticated');
  });

  it('notifies subscribed listeners on state changes', () => {
    const listener = vi.fn();
    store.subscribe(listener);

    store.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    store.clear();

    expect(listener).toHaveBeenCalledWith('authenticated');
    expect(listener).toHaveBeenCalledWith('unauthenticated');
  });
});
