import { useEffect } from 'react';
import { createSyncScheduler, type SyncScheduler } from '@bigmind/sync';

import { authStore } from '../features/auth/auth-store';
import { syncEngine } from './sync-service';
import { subscribeToBackgroundSyncRequests } from './background-sync';
import { webConnectivity } from './connectivity';

/**
 * Web sync supervisor.
 *
 * Maps browser events (connectivity, visibility, auth changes, local-change
 * requests) onto the shared {@link SyncScheduler}, which decides when to run
 * the platform-independent {@link syncEngine}.
 */
export function SyncConnectivity() {
  useEffect(() => {
    const scheduler: SyncScheduler = createSyncScheduler({
      run: () => void syncEngine.sync(),
      isOnline: () => webConnectivity.isOnline(),
      isAuthRequired: () => authStore.getState() === 'auth_required',
      changeDelayMs: 1_000,
      periodicMs: 30_000,
    });

    let online = webConnectivity.isOnline();
    syncEngine.setOnline(online);

    const unsubscribeConnectivity = webConnectivity.subscribe((isOnline) => {
      online = isOnline;
      syncEngine.setOnline(isOnline);
      if (isOnline) {
        scheduler.request(0);
      }
    });

    const unsubscribeBackground = subscribeToBackgroundSyncRequests(() =>
      scheduler.request(),
    );

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduler.request(0);
      }
    };

    const unsubscribeAuth = authStore.subscribe((state) => {
      if (state === 'authenticated') {
        scheduler.request(0);
      }
    });

    document.addEventListener('visibilitychange', handleVisibilityChange);
    scheduler.start();

    if (online) {
      scheduler.request(0);
    }

    return () => {
      unsubscribeAuth();
      unsubscribeBackground();
      unsubscribeConnectivity();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      scheduler.stop();
    };
  }, []);

  return null;
}
