import type { StorageAdapter } from '@bigmind/storage';

const CURSOR_KEY = 'lastSuccessfulCursor';
const LAST_SYNC_KEY = 'lastSyncTimestamp';

/** Sync cursor persistence consumed by the sync engine, shared by all platforms. */
export class SyncStateRepository {
  constructor(private readonly storage: StorageAdapter) {}

  async getCursor(): Promise<string | undefined> {
    return (await this.storage.syncState.get(CURSOR_KEY))?.value;
  }

  async getLastSyncTimestamp(): Promise<string | undefined> {
    return (await this.storage.syncState.get(LAST_SYNC_KEY))?.value;
  }

  async recordSuccessfulSync(cursor: string, timestamp: string): Promise<void> {
    await this.storage.syncState.bulkPut([
      { key: CURSOR_KEY, value: cursor },
      { key: LAST_SYNC_KEY, value: timestamp },
    ]);
  }
}
