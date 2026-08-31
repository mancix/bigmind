import { ConflictRepository } from '@bigmind/features';

import { storage } from '../../storage';
import { outboxRepository } from '../../sync/outbox-repository';

export {
  ConflictRepository,
  ConflictRepositoryError,
  subscribeToConflictCreations,
  type ConflictResolutionStrategy,
  type ConflictSnapshot,
  type ConflictSnapshotRecord,
  type CreateConflictInput,
} from '@bigmind/features';

/** Web conflict repository, backed by the Dexie storage adapter. */
export const conflictRepository = new ConflictRepository(
  storage,
  outboxRepository,
);