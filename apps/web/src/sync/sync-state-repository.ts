import { db } from '../storage/database';

const CURSOR_KEY = 'lastSuccessfulCursor';
const LAST_SYNC_KEY = 'lastSyncTimestamp';

export class SyncStateRepository {
  async getCursor(): Promise<string | undefined> {
    return (await db.syncState.get(CURSOR_KEY))?.value;
  }

  async getLastSyncTimestamp(): Promise<string | undefined> {
    return (await db.syncState.get(LAST_SYNC_KEY))?.value;
  }

  async recordSuccessfulSync(cursor: string, timestamp: string): Promise<void> {
    await db.syncState.bulkPut([
      { key: CURSOR_KEY, value: cursor },
      { key: LAST_SYNC_KEY, value: timestamp },
    ]);
  }
}

export const syncStateRepository = new SyncStateRepository();
