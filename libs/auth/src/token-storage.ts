/**
 * Minimal key-value persistence used by {@link AuthStore}.
 *
 * The web app implements this with `localStorage`, the mobile app with
 * `@react-native-async-storage/async-storage` (wrapped behind a synchronous
 * cache hydrated before the app renders).
 */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** TokenStorage backed by the browser's `localStorage`. */
export function createLocalStorageTokenStorage(): TokenStorage {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  };
}
