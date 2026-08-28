import { useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { conflictRepository } from '../features/conflicts/conflict-repository';
import { outboxRepository } from './outbox-repository';
import { syncEngine } from './sync-service';
import { syncStateRepository } from './sync-state-repository';
import type { SyncStatus as SyncStatusValue } from './sync.types';

export function SyncStatus() {
  const status = useSyncExternalStore(
    (listener) => syncEngine.subscribe(listener),
    () => syncEngine.getStatus(),
    (): SyncStatusValue => 'idle',
  );
  const pendingCount = useLiveQuery(() => outboxRepository.countPending(), []);
  const conflictCount = useLiveQuery(
    () => conflictRepository.countOpen(),
    [],
  );
  const lastSyncTimestamp = useLiveQuery(
    () => syncStateRepository.getLastSyncTimestamp(),
    [],
  );
  const [isManualSync, setIsManualSync] = useState(false);

  async function handleSyncNow() {
    setIsManualSync(true);

    try {
      await syncEngine.sync();
    } finally {
      setIsManualSync(false);
    }
  }

  const label = getLabel({
    status,
    pendingCount: pendingCount ?? 0,
    conflictCount: conflictCount ?? 0,
    hasSynced: Boolean(lastSyncTimestamp),
  });
  const isBusy = status === 'syncing' || isManualSync;

  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className={`text-xs ${getLabelColor(status, conflictCount ?? 0)}`}
        role="status"
      >
        {label}
      </span>

      <button
        type="button"
        onClick={() => void handleSyncNow()}
        disabled={isBusy}
        className="text-xs font-medium text-blue-600 transition hover:text-blue-700 disabled:cursor-wait disabled:text-slate-400"
      >
        Sync now
      </button>
    </div>
  );
}

function getLabel({
  status,
  pendingCount,
  conflictCount,
  hasSynced,
}: {
  status: SyncStatusValue;
  pendingCount: number;
  conflictCount: number;
  hasSynced: boolean;
}): string {
  if (status === 'syncing') return 'Syncing...';
  if (status === 'offline') return 'Offline';
  if (status === 'auth_required') return 'Login required';
  if (status === 'error') return 'Sync error';
  if (conflictCount > 0) return 'Conflict';
  if (pendingCount > 0 || !hasSynced) return 'Saved locally';
  return 'Synced';
}

function getLabelColor(status: SyncStatusValue, conflictCount: number): string {
  if (status === 'error' || conflictCount > 0) return 'text-red-600';
  if (status === 'offline' || status === 'auth_required') return 'text-amber-600';
  return 'text-slate-500';
}
