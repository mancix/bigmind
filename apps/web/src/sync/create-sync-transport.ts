import { FakeSyncTransport } from './fake-sync-transport';
import { createWebHttpSyncTransport, webSyncAuth } from './web-sync-auth';
import type { SyncTransport } from './sync-transport';
import type { HttpSyncTransport } from './http-sync-transport';

interface SyncEnvironment {
  VITE_SYNC_TRANSPORT?: string;
  VITE_API_URL?: string;
}

export function createSyncTransport(
  environment: SyncEnvironment = import.meta.env as SyncEnvironment,
): SyncTransport {
  if (environment.VITE_SYNC_TRANSPORT === 'http') {
    return createWebHttpSyncTransport(
      environment.VITE_API_URL ?? 'http://localhost:3000',
    );
  }

  return new FakeSyncTransport();
}

export type { HttpSyncTransport };
export { webSyncAuth };
