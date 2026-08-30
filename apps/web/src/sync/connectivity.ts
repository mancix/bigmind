import {
  createAlwaysOnlineConnectivity,
  type Connectivity,
} from '@bigmind/sync';

/**
 * Browser connectivity: `navigator.onLine` + the global online/offline
 * events. Falls back to always-online in non-browser environments (SSR,
 * tests).
 */
export function createBrowserConnectivity(): Connectivity {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return createAlwaysOnlineConnectivity();
  }

  const listeners = new Set<(online: boolean) => void>();

  const handleOnline = () => {
    for (const listener of listeners) {
      listener(true);
    }
  };
  const handleOffline = () => {
    for (const listener of listeners) {
      listener(false);
    }
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return {
    isOnline: () => navigator.onLine,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          window.removeEventListener('online', handleOnline);
          window.removeEventListener('offline', handleOffline);
        }
      };
    },
  };
}

export const webConnectivity: Connectivity = createBrowserConnectivity();
