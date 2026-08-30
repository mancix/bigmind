import { AppState, type AppStateStatus } from 'react-native';
import {
  createSyncScheduler,
  subscribeToBackgroundSyncRequests,
  type SyncEngine,
  type SyncScheduler,
} from '@bigmind/sync';
import { authStore } from '../features/auth/auth-store';
import { mobileConnectivity } from './connectivity';

/**
 * Mobile background-sync supervisor.
 *
 * The platform-specific half of the background-sync abstraction: it forwards
 * mobile events (AppState foreground, NetInfo reconnects, local-change
 * requests from the shared bus, periodic ticks) onto the shared
 * {@link SyncScheduler}, which runs the platform-independent {@link SyncEngine}.
 *
 * Started by `SyncActivator` while authenticated (and stopped on logout).
 */
export function startMobileSyncSupervisor(engine: SyncEngine): () => void {
  const scheduler: SyncScheduler = createSyncScheduler({
    run: () => void engine.sync(),
    isOnline: () => mobileConnectivity.isOnline(),
    isAuthRequired: () => authStore.getState() === 'auth_required',
    changeDelayMs: 1_000,
    periodicMs: 30_000,
  });

  engine.setOnline(mobileConnectivity.isOnline());

  const unsubscribeConnectivity = mobileConnectivity.subscribe((online) => {
    engine.setOnline(online);
    if (online) {
      scheduler.request(0);
    }
  });

  const unsubscribeBackground = subscribeToBackgroundSyncRequests(() =>
    scheduler.request(),
  );

  const handleAppState = (state: AppStateStatus) => {
    if (state === 'active') {
      scheduler.request(0);
    }
  };
  const appStateSubscription = AppState.addEventListener(
    'change',
    handleAppState,
  );

  scheduler.start();
  scheduler.request(mobileConnectivity.isOnline() ? 0 : undefined);

  return () => {
    appStateSubscription.remove();
    unsubscribeConnectivity();
    unsubscribeBackground();
    scheduler.stop();
  };
}
