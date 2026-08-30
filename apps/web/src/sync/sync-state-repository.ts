import { SyncStateRepository } from '@bigmind/sync';
import { storage } from '../storage';

export { SyncStateRepository } from '@bigmind/sync';

/** Web sync-state repository, backed by the Dexie storage adapter. */
export const syncStateRepository = new SyncStateRepository(storage);
