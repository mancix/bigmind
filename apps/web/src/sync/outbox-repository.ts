import { OutboxRepository } from '@bigmind/sync';
import { storage } from '../storage';

export { OutboxRepository } from '@bigmind/sync';

/** Web outbox repository, backed by the Dexie storage adapter. */
export const outboxRepository = new OutboxRepository(storage);
