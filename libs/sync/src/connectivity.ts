/**
 * Platform abstraction for network connectivity.
 *
 * Implementations:
 * - Web: `apps/web/src/sync/connectivity.ts` (navigator.onLine + window events)
 * - Mobile: `apps/mobile/src/sync/connectivity.ts` (@react-native-community/netinfo)
 *
 * The sync engine and scheduler only depend on this interface, never on
 * `navigator` or NetInfo directly.
 */
export interface Connectivity {
  /** Current online state. */
  isOnline(): boolean;

  /**
   * Receive online/offline transitions.
   * Listeners are invoked with the new state; returns an unsubscribe function.
   */
  subscribe(listener: (online: boolean) => void): () => void;
}

/** Connectivity that always reports online (tests, embedded platforms). */
export function createAlwaysOnlineConnectivity(): Connectivity {
  return {
    isOnline: () => true,
    subscribe: () => () => undefined,
  };
}
