import { AuthStore } from '@bigmind/auth';

import { getApiUrl } from './api-url';
import { tokenStorage } from './token-storage';

/**
 * Mobile auth store — the exact same state machine the web PWA uses,
 * extracted into `@bigmind/auth` so both platforms share the token-refresh
 * and offline-authentication logic.
 */
export function createAuthStore(): AuthStore {
  return new AuthStore({
    tokenStorage,
    apiUrl: getApiUrl(),
  });
}

/** Application-wide auth store singleton (used by the provider and sync). */
export const authStore = createAuthStore();

export type { AuthState, AuthUser } from '@bigmind/auth';
