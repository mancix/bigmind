import * as React from 'react';
import { render } from '@testing-library/react-native';

import App from './App';

// Seed persisted tokens in the expo-secure-store mock BEFORE the app module
// loads, so the shared AuthStore (constructed at module scope) boots already
// authenticated and the main tabs render. jest.mock is hoisted above imports.
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {
    bigmind_access_token: 'test-access',
    bigmind_refresh_token: 'test-refresh',
    bigmind_user: JSON.stringify({ id: 'user-1', email: 'a@b.com' }),
  };
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    deleteItemAsync: async (key: string) => {
      delete store[key];
    },
    getItemAsync: async (key: string) => store[key] ?? null,
    setItemAsync: async (key: string, value: string) => {
      store[key] = value;
    },
  };
});

describe('App bootstrap (authenticated)', () => {
  beforeEach(() => {
    // Prevent the token-refresh effect from hitting the network.
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('offline in tests'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the bottom tab navigator with all five tabs', async () => {
    const { findAllByText } = render(<App />);

    // Each tab name shows up in both the tab bar label and the screen header.
    for (const tab of [
      'Home',
      'Notes',
      'Categories',
      'Reminders',
      'Settings',
    ]) {
      const matches = await findAllByText(tab);
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it('shows the shared domain showcase on the Home screen', async () => {
    const { findByText } = render(<App />);

    expect(await findByText('Shared domain')).toBeTruthy();
    expect(await findByText('Storage abstraction')).toBeTruthy();
  });
});
