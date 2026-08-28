import { useEffect } from 'react';

import { authStore } from '../features/auth/auth-store';
import { syncEngine } from './sync-service';
import { subscribeToBackgroundSyncRequests } from './background-sync';

const SYNC_AFTER_CHANGE_DELAY_MS = 1_000;
const PERIODIC_SYNC_INTERVAL_MS = 30_000;

export function SyncConnectivity() {
  useEffect(() => {
    let scheduledSync: number | undefined;

    function scheduleSync(delay = SYNC_AFTER_CHANGE_DELAY_MS) {
      if (!navigator.onLine) return;
      if (authStore.getState() === 'auth_required') return;
      if (scheduledSync !== undefined) window.clearTimeout(scheduledSync);
      scheduledSync = window.setTimeout(() => {
        scheduledSync = undefined;
        void syncEngine.sync();
      }, delay);
    }

    function handleOnline() {
      syncEngine.setOnline(true);
      scheduleSync(0);
    }

    function handleOffline() {
      syncEngine.setOnline(false);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') scheduleSync(0);
    }

    const unsubscribeAuth = authStore.subscribe((state) => {
      if (state === 'authenticated') {
        if (scheduledSync !== undefined) window.clearTimeout(scheduledSync);
        scheduledSync = window.setTimeout(() => {
          scheduledSync = undefined;
          void syncEngine.sync();
        }, 0);
      }
    });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const unsubscribe = subscribeToBackgroundSyncRequests(() => scheduleSync());
    const periodicSync = window.setInterval(
      () => scheduleSync(0),
      PERIODIC_SYNC_INTERVAL_MS,
    );

    if (navigator.onLine) {
      scheduleSync(0);
    } else {
      handleOffline();
    }

    return () => {
      unsubscribeAuth();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribe();
      window.clearInterval(periodicSync);
      if (scheduledSync !== undefined) window.clearTimeout(scheduledSync);
    };
  }, []);

  return null;
}
