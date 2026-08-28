import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockStorage = vi.hoisted(() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
});

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, writable: true });
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    writable: true,
  });
});

import { authStore } from './auth-store';

describe('AuthStore state model', () => {
  beforeEach(() => {
    mockStorage.clear();
    authStore['accessToken'] = null;
    authStore['refreshToken'] = null;
    authStore['user'] = null;
    authStore['state'] = 'unauthenticated';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockStorage.clear();
  });

  it('starts unauthenticated when no tokens are stored', () => {
    expect(authStore.getState()).toBe('unauthenticated');
    expect(authStore.isAuthenticated()).toBe(false);
  });

  it('transitions to authenticated when tokens are set', () => {
    authStore.setTokens('access-123', 'refresh-456', { id: 'user-1', email: 'a@b.com' });

    expect(authStore.getState()).toBe('authenticated');
    expect(authStore.isAuthenticated()).toBe(true);
    expect(authStore.getAccessToken()).toBe('access-123');
    expect(authStore.getRefreshToken()).toBe('refresh-456');
  });

  it('transitions to unauthenticated on clear', () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    authStore.clear();

    expect(authStore.getState()).toBe('unauthenticated');
    expect(authStore.isAuthenticated()).toBe(false);
    expect(authStore.getAccessToken()).toBeNull();
  });

  it('transitions to offline_authenticated on network error during refresh', async () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await authStore.refreshAccessToken();

    expect(result).toBe('network_error');
    expect(authStore.getState()).toBe('offline_authenticated');
    expect(authStore.isAuthenticated()).toBe(true);
    expect(authStore.getAccessToken()).toBe('a');
    expect(authStore.getRefreshToken()).toBe('r');
  });

  it('transitions to auth_required on auth error during refresh', async () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Invalid refresh token' }),
    });

    const result = await authStore.refreshAccessToken();

    expect(result).toBe('auth_error');
    expect(authStore.getState()).toBe('auth_required');
    expect(authStore.isAuthenticated()).toBe(false);
    expect(authStore.getAccessToken()).toBe('a');
    expect(authStore.getRefreshToken()).toBe('r');
  });

  it('preserves local data on auth_required state', async () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Expired' }),
    });

    await authStore.refreshAccessToken();

    expect(authStore.getState()).toBe('auth_required');
    expect(authStore.getUser()).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('preserves local data on offline_authenticated state', async () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Network error'));

    await authStore.refreshAccessToken();

    expect(authStore.getState()).toBe('offline_authenticated');
    expect(authStore.getUser()).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('transitions to authenticated after successful refresh following offline_authenticated', async () => {
    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Network error'));

    await authStore.refreshAccessToken();
    expect(authStore.getState()).toBe('offline_authenticated');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        user: { id: 'u1', email: 'a@b.com' },
      }),
    });

    const result = await authStore.refreshAccessToken();

    expect(result).toBe('ok');
    expect(authStore.getState()).toBe('authenticated');
    expect(authStore.getAccessToken()).toBe('new-access');
  });

  it('notifies listeners on state changes', () => {
    const states: string[] = [];
    const unsubscribe = authStore.subscribe((s) => states.push(s));

    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });
    authStore.clear();

    unsubscribe();

    expect(states).toEqual(['authenticated', 'unauthenticated']);
  });

  it('does not notify listeners after unsubscribe', () => {
    const states: string[] = [];
    const unsubscribe = authStore.subscribe((s) => states.push(s));
    unsubscribe();

    authStore.setTokens('a', 'r', { id: 'u1', email: 'a@b.com' });

    expect(states).toEqual([]);
  });

  it('loads tokens from localStorage on construction', () => {
    mockStorage.setItem('bigmind_access_token', 'stored-access');
    mockStorage.setItem('bigmind_refresh_token', 'stored-refresh');
    mockStorage.setItem('bigmind_user', JSON.stringify({ id: 'u1', email: 'a@b.com' }));

    const AuthStoreClass = (authStore as any).constructor;
    const store = new AuthStoreClass();

    expect(store.getAccessToken()).toBe('stored-access');
    expect(store.getRefreshToken()).toBe('stored-refresh');
    expect(store.getUser()).toEqual({ id: 'u1', email: 'a@b.com' });
    expect(store.getState()).toBe('authenticated');
  });
});
