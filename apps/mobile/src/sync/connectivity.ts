import NetInfo from '@react-native-community/netinfo';
import type { Connectivity } from '@bigmind/sync';

/**
 * React Native connectivity built on `@react-native-community/netinfo`
 * (bundled in Expo Go). `isOnline()` reflects the last known state and
 * listeners fire on every online/offline transition.
 */
export function createMobileConnectivity(): Connectivity & {
  close(): void;
} {
  const listeners = new Set<(online: boolean) => void>();
  let isOnlineNow = true;

  const unsubscribe = NetInfo.addEventListener((state) => {
    const online =
      state.isConnected === true && state.isInternetReachable !== false;
    if (online !== isOnlineNow) {
      isOnlineNow = online;
      for (const listener of listeners) {
        listener(online);
      }
    }
  });

  return {
    isOnline: () => isOnlineNow,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => unsubscribe(),
  };
}

export const mobileConnectivity: Connectivity = createMobileConnectivity();
