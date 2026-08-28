import { FakeSyncTransport } from './fake-sync-transport';
import { HttpSyncTransport } from './http-sync-transport';
import type { SyncTransport } from './sync-transport';

interface SyncEnvironment {
  VITE_SYNC_TRANSPORT?: string;
  VITE_API_URL?: string;
}

export function createSyncTransport(
  environment: SyncEnvironment = import.meta.env as SyncEnvironment,
): SyncTransport {
  if (environment.VITE_SYNC_TRANSPORT === 'http') {
    return new HttpSyncTransport(
      environment.VITE_API_URL ?? 'http://localhost:3000',
    );
  }

  return new FakeSyncTransport();
}
