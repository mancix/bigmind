import type { ConflictCreateInput, ConflictSink } from '@bigmind/sync';
import type { ConflictRecord } from '@bigmind/storage';
import { storage } from '../storage';

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mobile conflict sink: persists detected conflicts through the shared
 * storage adapter so the sync engine can report them (placeholder until the
 * SQLite adapter and the conflict-resolution UI land).
 */
export function createMobileSyncConflictSink(): ConflictSink {
  return {
    async create(input: ConflictCreateInput) {
      const record: ConflictRecord = {
        id: makeId(),
        entityType: input.entityType,
        entityId: input.entityId,
        conflictType: input.conflictType,
        localVersion: input.localVersion,
        remoteVersion: input.remoteVersion,
        localSnapshot: input.localSnapshot,
        remoteSnapshot: input.remoteSnapshot,
        baseVersion: input.baseVersion,
        createdAt: input.detectedAt ?? new Date().toISOString(),
        status: 'open',
      };
      await storage.conflicts.add(record);
      return record.id;
    },
  };
}
