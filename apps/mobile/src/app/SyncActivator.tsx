import { useEffect } from 'react';

import { useAuth } from '../features/auth/auth-provider';
import { ensureWorkspaceId } from '../features/workspaces/ensure-workspace';
import { notifyDataChanged } from '../features/data/repositories';
import { mobileSyncEngine } from '../sync/sync-service';
import { startMobileSyncSupervisor } from '../sync/supervisor';

/**
 * Activates the SHARED sync engine while authenticated: starts the
 * background supervisor (AppState + NetInfo + periodic) and performs an
 * initial pull so server data (categories, notes, …) created elsewhere (e.g.
 * the web app) appears on this device.
 *
 * Note: persistence is still the shared in-memory adapter; the sync pipeline
 * runs end-to-end today, while SQLite persistence is the next milestone.
 */
export function SyncActivator() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    // Notify screens whenever a sync pass lands in `idle` (fresh data).
    const unsubscribeStatus = mobileSyncEngine.subscribe((status) => {
      if (status === 'idle') {
        notifyDataChanged();
      }
    });

    const stopSupervisor = startMobileSyncSupervisor(mobileSyncEngine);
    void (async () => {
      // The API rejects sync calls without X-Workspace-Id, so make sure a
      // workspace is selected (first workspace) before the first pull.
      await ensureWorkspaceId();
      if (!cancelled) {
        await mobileSyncEngine.sync();
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
