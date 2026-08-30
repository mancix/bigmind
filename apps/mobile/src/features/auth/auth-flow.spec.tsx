import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';

import { AuthProvider } from './auth-provider';
import { authStore } from './auth-store';
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
});
