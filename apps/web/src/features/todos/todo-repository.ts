import { TodoRepository } from '@bigmind/features';

import { storage } from '../../storage';
import { outboxRepository } from '../../sync/outbox-repository';

export { TodoRepository } from '@bigmind/features';

/** Web todo repository, backed by the Dexie storage adapter. */
export const todoRepository = new TodoRepository(storage, outboxRepository);
