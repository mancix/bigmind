import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from '@bigmind/auth';

/**
 * Token persistence backed by Expo SecureStore (Keychain/encrypted
 * SharedPreferences on Android). Tokens are NEVER stored in AsyncStorage.
 *
 * SecureStore exposes synchronous native reads/writes, so the shared
 * `TokenStorage` contract (`getItem`/`setItem`/`removeItem`) is satisfied
 * directly — no hydration ceremony is needed before the `AuthStore` boots.
 *
 * `deleteItemAsync` is the only async primitive; a tombstone set makes reads
 * deterministic while a deletion is in flight.
 */
export class SecureStoreTokenStorage implements TokenStorage {
  private readonly pendingDeletes = new Set<string>();

  getItem(key: string): string | null {
    if (this.pendingDeletes.has(key)) {
      return null;
    }
    return SecureStore.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.pendingDeletes.delete(key);
    SecureStore.setItem(key, value);
  }

  removeItem(key: string): void {
    this.pendingDeletes.add(key);
    void SecureStore.deleteItemAsync(key).finally(() => {
      this.pendingDeletes.delete(key);
    });
  }
}

export const tokenStorage: TokenStorage = new SecureStoreTokenStorage();
