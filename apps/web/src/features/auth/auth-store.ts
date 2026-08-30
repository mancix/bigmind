import { AuthStore, createLocalStorageTokenStorage } from '@bigmind/auth';

import { getApiUrl } from './api-url';

export type { AuthState, AuthUser } from '@bigmind/auth';

export const authStore = new AuthStore({
  tokenStorage: createLocalStorageTokenStorage(),
  apiUrl: getApiUrl(),
});
