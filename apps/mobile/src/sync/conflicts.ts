import { ConflictRepository } from '@bigmind/features';
import type { ConflictSink } from '@bigmind/sync';

import { mobileOutbox } from '../features/data/repositories';
import { storage } from '../storage';

/**
 * Mobile conflict sink: the SHARED conflict repository from `@bigmind/features`
 * (same class the web app uses), persisted through the mobile storage adapter
 * so conflicts survive restarts. The sync engine only needs the
 * {@link ConflictSink} surface; repository resolution strategies (keep_mine,
 * keep_remote, …) are available to future mobile conflict screens for free.
 */
export function createMobileSyncConflictSink(): ConflictSink {
  return new ConflictRepository(storage, mobileOutbox);
}