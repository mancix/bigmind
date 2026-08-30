import { tokenStorage } from './token-storage';

const TOKEN_KEY = 'bigmind_test_token';

const table = (globalThis as Record<string, unknown>)
  .__secureStoreTable as Record<string, string>;

describe('SecureStoreTokenStorage', () => {
  beforeEach(() => {
    for (const key of Object.keys(table)) {
      delete table[key];
    }
  });

  it('round-trips tokens through the SecureStore mock', () => {
    tokenStorage.setItem(TOKEN_KEY, 'the-token');

    expect(tokenStorage.getItem(TOKEN_KEY)).toBe('the-token');
    expect(table[TOKEN_KEY]).toBe('the-token'); // persisted, not in AsyncStorage
  });

  it('returns null for missing keys', () => {
    expect(tokenStorage.getItem('missing')).toBeNull();
  });

  it('removes tokens with a deterministic read after deletion', async () => {
    tokenStorage.setItem(TOKEN_KEY, 'the-token');
    tokenStorage.removeItem(TOKEN_KEY);

    // Reads are deterministic while the async deletion is in flight.
    expect(tokenStorage.getItem(TOKEN_KEY)).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(table[TOKEN_KEY]).toBeUndefined();
    expect(tokenStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
