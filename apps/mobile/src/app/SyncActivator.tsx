import { useEffect } from 'react';

import { useAuth } from '../features/auth/auth-provider';
import { ensureWorkspaceId } from '../features/workspaces/ensure-workspace';
import {
  notifyDataChanged,
  remindersRepository,
  reminderNotificationService,
} from '../features/data/repositories';
import { mobileSyncEngine } from '../sync/sync-service';
import { startMobileSyncSupervisor } from '../sync/supervisor';

/**
 * Re-converge the OS-scheduled local notifications with the device reminder
 * store (see docs/mobile-notifications.md). Runs after every sync pass and on
 * app start; fully offline (reads the local DB + the native scheduler only).
 * Covers reminders created/edited/completed/deleted on other devices and
 * pulled in by the sync engine, plus workspace switches.
 */
async function reconcileReminderNotifications(): Promise<void> {
  const reminders = await remindersRepository.list();
  await reminderNotificationService.reconcile(reminders);
}

/**
 * Activates the SHARED sync engine while authenticated: starts the
 * background supervisor (AppState + NetInfo + periodic) and performs an
 * initial pull so server data (categories, notes, …) created elsewhere (e.g.
 * the web app) appears on this device.
 */
export function SyncActivator() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    // Notify screens whenever a sync pass lands in `idle` (fresh data), and
    // re-converge scheduled local notifications with the pulled reminders.
    const unsubscribeStatus = mobileSyncEngine.subscribe((status) => {
      if (status === 'idle') {
        notifyDataChanged();
        void reconcileReminderNotifications();
      }
    });

    const stopSupervisor = startMobileSyncSupervisor(mobileSyncEngine);
    void (async () => {
      // The API rejects sync calls without X-Workspace-Id, so make sure a
      // workspace is selected (first workspace) before the first pull.
      await ensureWorkspaceId();
      if (cancelled) return;
      // Offline start: sync() resolves without a status transition, so the
      // explicit reconcile below is what converges notifications with the
      // locally stored reminders (requirement: works fully offline).
      await mobileSyncEngine.sync().catch(() => undefined);
      if (!cancelled) {
        await reconcileReminderNotifications();
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeStatus();
      stopSupervisor();
    };
  }, [isAuthenticated]);

  return null;
}
