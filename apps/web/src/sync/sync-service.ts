import { createSyncTransport } from './create-sync-transport';
import { SyncEngine } from './sync-engine';

export const syncTransport = createSyncTransport();
export const syncEngine = new SyncEngine(syncTransport);
