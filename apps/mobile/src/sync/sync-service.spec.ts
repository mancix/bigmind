import {
  conflictService,
  FakeSyncTransport,
  OutboxRepository,
  SyncEngine,
  SyncStateRepository,
} from '@bigmind/sync';
import { storage } from '../storage';
import { createMobileSyncConflictSink } from './conflicts';

function makeNote(id: string) {
  const now = new Date().toISOString();
  return {
    id,
    title: 'Test note',
    content: '',
    categoryId: null,
    templateType: 'MARKDOWN' as const,
    createdAt: now,
    updatedAt: now,
    version: 0,
    syncStatus: 'synced' as const,
  };
}

describe('mobile sync wiring (shared engine reuse)', () => {
  afterEach(async () => {
    await storage.delete();
    await storage.open();
  });

  it('runs the shared engine + outbox over the mobile storage adapter', async () => {
    const note = makeNote('mobile-note');
    await storage.notes.add(note);
    await storage.outbox.add({
      id: 'mobile-operation-1',
      entityId: note.id,
      entityType: 'note',
      operation: 'create',
      baseVersion: 0,
      payload: note,
      createdAt: note.createdAt,
      retryCount: 0,
      status: 'pending',
    });

    const outbox = new OutboxRepository(storage);
    const syncState = new SyncStateRepository(storage);
    const engine = new SyncEngine(
      {
        transport: new FakeSyncTransport(),
        storage,
        outbox,
        syncState,
        conflicts: createMobileSyncConflictSink(),
        buildConflictSnapshots: (input) =>
          conflictService.buildSnapshots(input),
        getAuthState: () => 'authenticated',
      },
      { isOnline: () => true },
    );

    await engine.sync();

    expect(await outbox.countPending()).toBe(0);
    expect(await storage.notes.get(note.id)).toMatchObject({
      version: 1,
      syncStatus: 'synced',
    });
  });
});
