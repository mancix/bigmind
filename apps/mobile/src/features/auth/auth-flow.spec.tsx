import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { Text } from 'react-native';

import { AuthProvider, useAuth, type AuthContextValue } from './auth-provider';
import { authStore, createAuthStore } from './auth-store';
import { AuthNavigator } from '../../navigation/AuthNavigator';

const table = (globalThis as Record<string, unknown>)
  .__secureStoreTable as Record<string, string>;

function authResponseBody() {
  return {
    accessToken: 'access-123',
    refreshToken: 'refresh-456',
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.com' },
  };
}

function renderAuthFlow() {
  return render(
    <AuthProvider>
      <NavigationContainer>
        <AuthNavigator />
      </NavigationContainer>
    </AuthProvider>,
  );
}

describe('mobile auth flow', () => {
  beforeEach(() => {
    for (const key of Object.keys(table)) {
      delete table[key];
    }
    authStore.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the login screen when signed out', async () => {
    const { findByText, findByTestId } = renderAuthFlow();

    expect(await findByText('Welcome back')).toBeTruthy();
    expect(await findByTestId('login-email')).toBeTruthy();
    expect(await findByTestId('login-password')).toBeTruthy();
  });

  it('validates the email client-side with the shared contract schema', async () => {
    globalThis.fetch = jest.fn();
    const { getByTestId, findByTestId } = renderAuthFlow();

    fireEvent.changeText(getByTestId('login-email'), 'not-an-email');
    fireEvent.changeText(getByTestId('login-password'), 'password-123');
    fireEvent.press(getByTestId('login-submit'));

    const error = await findByTestId('auth-error');
    expect(error).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(authStore.isAuthenticated()).toBe(false);
  });

  it('logs in with the shared contracts-validated request and stores tokens', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => authResponseBody(),
    });
    const { getByTestId, queryByTestId } = renderAuthFlow();

    fireEvent.changeText(getByTestId('login-email'), 'a@b.com');
    fireEvent.changeText(getByTestId('login-password'), 'password-123');
    fireEvent.press(getByTestId('login-submit'));

    await waitFor(() => expect(authStore.isAuthenticated()).toBe(true));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'password-123' }),
      }),
    );
    expect(authStore.getAccessToken()).toBe('access-123');
    expect(table['bigmind_access_token']).toBe('access-123');
    // The error message stays hidden on success.
    expect(queryByTestId('auth-error')).toBeNull();
  });

  it('shows the API error message when login is rejected', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid credentials.' }),
    });
    const { getByTestId, findByTestId } = renderAuthFlow();

    fireEvent.changeText(getByTestId('login-email'), 'a@b.com');
    fireEvent.changeText(getByTestId('login-password'), 'wrong');
    fireEvent.press(getByTestId('login-submit'));

    expect((await findByTestId('auth-error')).props.children).toBe(
      'Invalid credentials.',
    );
    expect(authStore.isAuthenticated()).toBe(false);
  });

  it('navigates from login to the register screen and back', async () => {
    const { getByTestId, findByText } = renderAuthFlow();

    fireEvent.press(getByTestId('goto-register'));
    expect(await findByText('Create your account')).toBeTruthy();

    fireEvent.press(getByTestId('goto-login'));
    expect(await findByText('Welcome back')).toBeTruthy();
  });

  it('validates the register form (password min length + match) client-side', async () => {
    globalThis.fetch = jest.fn();
    const { getByTestId, findByTestId } = renderAuthFlow();

    fireEvent.press(getByTestId('goto-register'));

    fireEvent.changeText(getByTestId('register-email'), 'a@b.com');
    fireEvent.changeText(getByTestId('register-password'), 'short');
    fireEvent.changeText(getByTestId('register-confirm'), 'short');
    fireEvent.press(getByTestId('register-submit'));
    expect((await findByTestId('auth-error')).props.children).toBe(
      'String must contain at least 8 character(s)',
    );

    fireEvent.changeText(getByTestId('register-password'), 'password-123');
    fireEvent.changeText(getByTestId('register-confirm'), 'different-123');
    fireEvent.press(getByTestId('register-submit'));
    expect((await findByTestId('auth-error')).props.children).toBe(
      'Passwords do not match.',
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('registers with a valid payload and signs the user in', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => authResponseBody(),
    });
    const { getByTestId } = renderAuthFlow();

    fireEvent.press(getByTestId('goto-register'));
    fireEvent.changeText(getByTestId('register-email'), 'a@b.com');
    fireEvent.changeText(getByTestId('register-password'), 'password-123');
    fireEvent.changeText(getByTestId('register-confirm'), 'password-123');
    fireEvent.press(getByTestId('register-submit'));

    await waitFor(() => expect(authStore.isAuthenticated()).toBe(true));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/register'),
      expect.objectContaining({
        body: JSON.stringify({ email: 'a@b.com', password: 'password-123' }),
      }),
    );
  });

  /** Mounts the provider with a probe that exposes the auth context API. */
  function renderAuthProbe() {
    const api: { current: AuthContextValue | null } = { current: null };
    const { getByTestId } = render(
      <AuthProvider>
        <AuthProbe api={api} />
      </AuthProvider>,
    );
    return { getByTestId: getByTestId as (id: string) => ReturnType<typeof getByTestId>, api };
  }

  it('logs out: clears the SecureStore session and returns to signed-out state', async () => {
    // Stored session; the startup refresh fails (offline) so the probe starts
    // in `offline_authenticated` — logout must still work from there.
    authStore.setTokens('access-123', 'refresh-456', {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.com',
    });
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Network request failed'));

    const { getByTestId, api } = renderAuthProbe();
    await waitFor(() =>
      expect(authStore.getState()).toBe('offline_authenticated'),
    );
    expect(getByTestId('auth-probe').props.children).toBe(
      'offline_authenticated:true',
    );

    api.current?.logout();

    expect(authStore.getState()).toBe('unauthenticated');
    expect(authStore.isAuthenticated()).toBe(false);
    expect(table['bigmind_access_token']).toBeUndefined();
    expect(table['bigmind_refresh_token']).toBeUndefined();
    expect(table['bigmind_user']).toBeUndefined();
    await waitFor(() =>
      expect(getByTestId('auth-probe').props.children).toBe(
        'unauthenticated:false',
      ),
    );
  });

  it('restores a stored session from SecureStore on cold start (restart survival)', () => {
    // Seed what a previous app session persisted in SecureStore.
    table['bigmind_access_token'] = 'access-123';
    table['bigmind_refresh_token'] = 'refresh-456';
    table['bigmind_user'] = JSON.stringify({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.com',
    });

    const restored = createAuthStore();

    expect(restored.getState()).toBe('authenticated');
    expect(restored.getAccessToken()).toBe('access-123');
    expect(restored.getUser()?.email).toBe('a@b.com');
    expect(restored.isAuthenticated()).toBe(true);
  });

  it('keeps the app usable offline when a stored session cannot refresh (offline startup)', async () => {
    authStore.setTokens('access-123', 'refresh-456', {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.com',
    });
    // The server is unreachable: the startup refresh hits the network-error
    // branch and must degrade to offline_authenticated, NOT unauthenticated.
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Network request failed'));

    const { getByTestId } = renderAuthProbe();

    await waitFor(() =>
      expect(authStore.getState()).toBe('offline_authenticated'),
    );
    expect(authStore.isAuthenticated()).toBe(true);
    // isAuthenticated stays true → the RootGate keeps the main tabs mounted
    // and the locally stored data remains available.
    expect(getByTestId('auth-probe').props.children).toBe(
      'offline_authenticated:true',
    );
    // Tokens are never wiped by a network failure.
    expect(table['bigmind_access_token']).toBe('access-123');
  });

  it('prompts to log in again when the refresh token becomes invalid (auth_required)', async () => {
    authStore.setTokens('access-123', 'refresh-456', {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.com',
    });
    // Refresh was rejected by the server: expired/revoked refresh token.
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid refresh token' }),
    });

    const { getByTestId } = renderAuthProbe();

    await waitFor(() => expect(authStore.getState()).toBe('auth_required'));
    expect(authStore.isAuthenticated()).toBe(false);
    // isAuthenticated false → the RootGate switches to the AuthNavigator
    // (login screen) so the user is prompted to authenticate again.
    expect(getByTestId('auth-probe').props.children).toBe('auth_required:false');
    // Local data is NOT destroyed: the stored tokens survive an auth failure
    // and nothing is cleared automatically.
    expect(table['bigmind_access_token']).toBe('access-123');
    expect(table['bigmind_refresh_token']).toBe('refresh-456');
  });

  it('keeps a stored session authenticated when the startup refresh succeeds', async () => {
    authStore.setTokens('access-123', 'refresh-456', {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.com',
    });
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.com' },
      }),
    });

    const { getByTestId } = renderAuthProbe();

    await waitFor(() =>
      expect(authStore.getAccessToken()).toBe('new-access'),
    );
    expect(authStore.getState()).toBe('authenticated');
    expect(getByTestId('auth-probe').props.children).toBe('authenticated:true');
  });
});

function AuthProbe({ api }: { api: { current: AuthContextValue | null } }) {
  const auth = useAuth();
  api.current = auth;
  return (
    <Text testID="auth-probe">{`${auth.authState}:${String(auth.isAuthenticated)}`}</Text>
  );
}
